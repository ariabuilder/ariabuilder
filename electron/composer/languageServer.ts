import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  ComposerCodeCompletion,
  ComposerCodeDiagnostic,
  ComposerCodeLanguageResult,
  ComposerCodePosition,
} from "../../shared/composer/language";
import { canonicalDirectory } from "../pathSafety";
import { resolveComposerPageFile } from "./parsePage";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const require = createRequire(import.meta.url);
const clients = new Map<string, AstroLanguageClient>();

function languageServerEntry(): string {
  const resolved = require.resolve("@astrojs/language-server/bin/nodeServer.js");
  const unpacked = resolved.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  return fs.existsSync(unpacked) ? unpacked : resolved;
}

function typescriptSdk(projectRoot: string): string {
  try {
    const projectRequire = createRequire(path.join(projectRoot, "package.json"));
    return path.dirname(projectRequire.resolve("typescript/lib/typescript.js"));
  } catch {
    return path.dirname(require.resolve("typescript/lib/typescript.js"));
  }
}

function languageServerNodePath(entry: string): string | undefined {
  const marker = `${path.sep}app.asar.unpacked${path.sep}`;
  const index = entry.indexOf(marker);
  if (index < 0) return process.env.NODE_PATH;
  const resources = entry.slice(0, index);
  const packagedModules = path.join(resources, "app.asar", "node_modules");
  return [packagedModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
}

class AstroLanguageClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private childClosed: Promise<void> | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private initialized: Promise<void> | null = null;
  private versions = new Map<string, number>();
  private diagnostics = new Map<string, ComposerCodeDiagnostic[]>();

  constructor(private readonly root: string) {}

  private frame(message: JsonRpcMessage): Buffer {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    return Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"),
      body,
    ]);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private onTransportError(
    child: ChildProcessWithoutNullStreams,
    cause: Error,
  ): void {
    if (this.child !== child) return;
    const error = new Error("Astro language server transport stopped", {
      cause,
    });
    this.rejectPending(error);
    if (child.exitCode == null && child.signalCode == null && !child.killed) {
      child.kill();
    }
  }

  private send(message: JsonRpcMessage): void {
    const child = this.child;
    if (
      !child ||
      child.killed ||
      child.exitCode != null ||
      child.signalCode != null ||
      child.stdin.destroyed ||
      child.stdin.writableEnded ||
      !child.stdin.writable
    ) {
      throw new Error("Astro language server is unavailable");
    }
    child.stdin.write(this.frame(message));
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Astro language server timed out during ${method}`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private reply(id: number | string, result: unknown): void {
    this.send({ jsonrpc: "2.0", id, result });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString("ascii");
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.slice(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.slice(bodyStart + length);
      try {
        this.onMessage(JSON.parse(body) as JsonRpcMessage);
      } catch {
        // Ignore malformed server output; the next framed message can recover.
      }
    }
  }

  private onMessage(message: JsonRpcMessage): void {
    if (message.id != null && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as {
        uri?: string;
        diagnostics?: ComposerCodeDiagnostic[];
      };
      if (params.uri) this.diagnostics.set(params.uri, params.diagnostics ?? []);
      return;
    }
    if (message.id != null && message.method) {
      if (message.method === "workspace/workspaceFolders") {
        this.reply(message.id, [{ uri: pathToFileURL(this.root).href, name: path.basename(this.root) }]);
      } else if (message.method === "workspace/configuration") {
        const items = (message.params as { items?: unknown[] })?.items ?? [];
        this.reply(message.id, items.map(() => null));
      } else {
        this.reply(message.id, null);
      }
    }
  }

  ensureInitialized(): Promise<void> {
    if (this.initialized) return this.initialized;
    const initializing = (async () => {
      const entry = languageServerEntry();
      const child = spawn(process.execPath, [entry, "--stdio"], {
        cwd: this.root,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          ...(languageServerNodePath(entry)
            ? { NODE_PATH: languageServerNodePath(entry) }
            : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      const childClosed = new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });
      this.childClosed = childClosed;
      child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
      child.stdin.on("error", (error: Error) => {
        this.onTransportError(child, error);
      });
      child.on("error", (error: Error) => {
        this.onTransportError(child, error);
      });
      child.on("exit", () => {
        if (this.child !== child) return;
        const error = new Error("Astro language server stopped");
        this.rejectPending(error);
        this.initialized = null;
      });
      void childClosed.then(() => {
        if (this.child === child) {
          this.child = null;
          this.childClosed = null;
        }
      });
      child.stderr.on("data", () => {
        // The server reports actionable diagnostics over LSP; stderr is noisy.
      });
      const rootUri = pathToFileURL(this.root).href;
      await this.request("initialize", {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
        capabilities: {
          workspace: { workspaceFolders: true, configuration: true },
          textDocument: {
            completion: { completionItem: { snippetSupport: false } },
            publishDiagnostics: { relatedInformation: true },
          },
        },
        initializationOptions: {
          typescript: { tsdk: typescriptSdk(this.root) },
          contentIntellisense: true,
        },
      });
      this.notify("initialized", {});
    })();
    this.initialized = initializing.catch((error) => {
      this.initialized = null;
      throw error;
    });
    return this.initialized;
  }

  async complete(input: {
    relativeFile: string;
    source: string;
    position: ComposerCodePosition;
  }): Promise<ComposerCodeLanguageResult> {
    await this.ensureInitialized();
    const absolute = resolveComposerPageFile(this.root, input.relativeFile);
    const uri = pathToFileURL(absolute).href;
    const previous = this.versions.get(uri);
    const version = (previous ?? 0) + 1;
    this.versions.set(uri, version);
    if (previous == null) {
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "astro", version, text: input.source },
      });
    } else {
      this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text: input.source }],
      });
    }
    const raw = await this.request("textDocument/completion", {
      textDocument: { uri },
      position: input.position,
      context: { triggerKind: 1 },
    }) as { items?: ComposerCodeCompletion[] } | ComposerCodeCompletion[] | null;
    const pulledDiagnostics = await this.request("textDocument/diagnostic", {
      textDocument: { uri },
    }).catch(() => null) as { items?: ComposerCodeDiagnostic[] } | null;
    if (pulledDiagnostics?.items) {
      this.diagnostics.set(uri, pulledDiagnostics.items);
    }
    const completions = Array.isArray(raw) ? raw : raw?.items ?? [];
    return {
      completions: completions.map((item) => ({
        label: item.label,
        ...(item.detail ? { detail: item.detail } : {}),
        ...(item.kind ? { kind: item.kind } : {}),
        ...(item.insertText ? { insertText: item.insertText } : {}),
        ...(item.textEdit && "range" in item.textEdit ? { textEdit: item.textEdit } : {}),
      })),
      diagnostics: this.diagnostics.get(uri) ?? [],
    };
  }

  async stop(): Promise<void> {
    const child = this.child;
    const childClosed = this.childClosed;
    if (!child || !childClosed) {
      if (childClosed) await childClosed;
      return;
    }

    let forceTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      if (
        child.exitCode == null &&
        child.signalCode == null &&
        !child.stdin.destroyed &&
        !child.stdin.writableEnded &&
        child.stdin.writable
      ) {
        child.stdin.end(this.frame({ jsonrpc: "2.0", method: "exit", params: null }));
      } else if (!child.killed && child.exitCode == null && child.signalCode == null) {
        child.kill();
      }
    } catch {
      if (!child.killed && child.exitCode == null && child.signalCode == null) {
        child.kill();
      }
    }
    if (child.exitCode == null && child.signalCode == null) {
      forceTimer = setTimeout(() => {
        if (!child.killed && child.exitCode == null && child.signalCode == null) {
          child.kill();
        }
      }, 2_000);
    }
    try {
      await childClosed;
    } finally {
      if (forceTimer) clearTimeout(forceTimer);
      if (this.child === child) this.child = null;
      if (this.childClosed === childClosed) this.childClosed = null;
      this.initialized = null;
    }
  }
}

export async function completeComposerCode(input: {
  projectPath: string;
  relativeFile: string;
  source: string;
  position: ComposerCodePosition;
}): Promise<ComposerCodeLanguageResult> {
  const root = canonicalDirectory(input.projectPath);
  let client = clients.get(root);
  if (!client) {
    client = new AstroLanguageClient(root);
    clients.set(root, client);
  }
  return client.complete(input);
}

export async function stopComposerLanguageServer(projectPath: string): Promise<void> {
  const root = canonicalDirectory(projectPath);
  const client = clients.get(root);
  clients.delete(root);
  if (client) await client.stop();
}

export async function stopAllComposerLanguageServers(): Promise<void> {
  const active = [...clients.values()];
  clients.clear();
  await Promise.all(active.map((client) => client.stop()));
}
