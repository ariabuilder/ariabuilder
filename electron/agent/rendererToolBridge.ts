import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import {
  AgentRendererToolResponseSchema,
  agentToolFail,
  type AgentToolResult,
} from "../../shared/agent";

const RENDERER_TOOL_TIMEOUT_MS = 30_000;

type RendererHost = {
  projectPath: string;
  webContents: WebContents;
  workspaceRegistrations: Set<string>;
  documentRegistrations: Set<string>;
};

type PendingCall = {
  projectPath: string;
  webContentsId: number;
  toolName: string;
  resolve: (result: AgentToolResult) => void;
  timer: ReturnType<typeof setTimeout>;
  abortCleanup?: () => void;
};

const hosts = new Map<string, RendererHost>();
const pending = new Map<string, PendingCall>();

function hostKey(projectPath: string, webContentsId: number): string {
  return `${projectPath}\0${webContentsId}`;
}

function settlePendingCall(requestId: string, result: AgentToolResult): void {
  const call = pending.get(requestId);
  if (!call) return;
  clearTimeout(call.timer);
  call.abortCleanup?.();
  pending.delete(requestId);
  call.resolve(result);
}

export function registerAgentRendererHost(input: {
  projectPath: string;
  webContents: WebContents;
  scope: "workspace" | "document";
  registrationId: string;
  active: boolean;
}): { registered: boolean } {
  const key = hostKey(input.projectPath, input.webContents.id);
  const current = hosts.get(key);
  const registrations = input.scope === "workspace"
    ? current?.workspaceRegistrations
    : current?.documentRegistrations;
  if (!input.active) {
    registrations?.delete(input.registrationId);
    const workspaceUnavailable = current?.workspaceRegistrations.size === 0;
    const documentUnavailable = current?.documentRegistrations.size === 0;
    if (workspaceUnavailable || (input.scope === "document" && documentUnavailable)) {
      for (const [requestId, call] of pending) {
        if (
          call.projectPath !== input.projectPath ||
          call.webContentsId !== input.webContents.id ||
          (!workspaceUnavailable && call.toolName === "open_in_composer")
        ) continue;
        settlePendingCall(
          requestId,
          agentToolFail(
            "NO_OPEN_DOCUMENT",
            "The active Composer document closed before the tool completed.",
            { suggestedFix: "Reopen the document in Composer, then retry." },
          ),
        );
      }
    }
    if (
      current &&
      current.workspaceRegistrations.size === 0 &&
      current.documentRegistrations.size === 0
    ) {
      hosts.delete(key);
    }
    return { registered: false };
  }
  const host = current ?? {
    projectPath: input.projectPath,
    webContents: input.webContents,
    workspaceRegistrations: new Set<string>(),
    documentRegistrations: new Set<string>(),
  };
  host.webContents = input.webContents;
  const activeRegistrations = input.scope === "workspace"
    ? host.workspaceRegistrations
    : host.documentRegistrations;
  activeRegistrations.add(input.registrationId);
  hosts.set(key, host);
  return { registered: true };
}

export function getAgentRendererHostCapabilities(input: {
  projectPath: string;
  webContentsId: number;
}): { navigation: boolean; document: boolean } {
  const host = hosts.get(hostKey(input.projectPath, input.webContentsId));
  return {
    navigation: Boolean(
      host &&
      !host.webContents.isDestroyed() &&
      host.workspaceRegistrations.size > 0
    ),
    document: Boolean(
      host &&
      !host.webContents.isDestroyed() &&
      host.workspaceRegistrations.size > 0 &&
      host.documentRegistrations.size > 0
    ),
  };
}

export function dispatchAgentRendererTool(input: {
  projectPath: string;
  webContentsId: number;
  toolName: string;
  args: unknown;
  signal?: AbortSignal;
}): Promise<AgentToolResult> {
  const host = hosts.get(hostKey(input.projectPath, input.webContentsId));
  const requiresDocument = input.toolName !== "open_in_composer";
  if (
    !host ||
    host.webContents.isDestroyed() ||
    host.workspaceRegistrations.size === 0 ||
    (requiresDocument && host.documentRegistrations.size === 0)
  ) {
    return Promise.resolve(
      agentToolFail(
        "NO_OPEN_DOCUMENT",
        requiresDocument
          ? "No active Composer document is registered for this project window."
          : "Composer navigation is not registered for this project window.",
        {
          suggestedFix: requiresDocument
            ? "Open the target document in Composer, then retry the change."
            : "Reload the project window, then retry opening the document.",
        },
      ),
    );
  }
  if (input.signal?.aborted) {
    return Promise.resolve(agentToolFail("INTERNAL", "The request was canceled."));
  }
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const finish = (result: AgentToolResult) => {
      settlePendingCall(requestId, result);
    };
    const timer = setTimeout(() => {
      finish(agentToolFail("INTERNAL", "Composer did not finish the tool within 30 seconds."));
    }, RENDERER_TOOL_TIMEOUT_MS);
    const call: PendingCall = {
      projectPath: input.projectPath,
      webContentsId: input.webContentsId,
      toolName: input.toolName,
      resolve,
      timer,
    };
    if (input.signal) {
      const onAbort = () => finish(agentToolFail("INTERNAL", "The request was canceled."));
      input.signal.addEventListener("abort", onAbort, { once: true });
      call.abortCleanup = () => input.signal?.removeEventListener("abort", onAbort);
    }
    pending.set(requestId, call);
    host.webContents.send("agent:rendererToolRequest", {
      requestId,
      projectPath: input.projectPath,
      toolName: input.toolName,
      args: input.args,
    });
  });
}

export function resolveAgentRendererTool(
  webContentsId: number,
  responseRaw: unknown,
): { accepted: true } {
  const raw = responseRaw && typeof responseRaw === "object"
    ? responseRaw as Record<string, unknown>
    : {};
  const requestId = typeof raw.requestId === "string" ? raw.requestId : "";
  const projectPath = typeof raw.projectPath === "string" ? raw.projectPath : "";
  const call = pending.get(requestId);
  if (!call) throw new Error("Renderer tool request is no longer active");
  if (
    call.webContentsId !== webContentsId ||
    call.projectPath !== projectPath
  ) {
    throw new Error("Renderer tool response belongs to another project window");
  }
  // Pick the response contract explicitly. Renderers commonly echo the request
  // object (including toolName/args); those fields must never become trusted
  // response data, but they should not obscure the ownership check above.
  const response = AgentRendererToolResponseSchema.parse({
    requestId,
    projectPath,
    result: raw.result,
  });
  const result: AgentToolResult = response.result.ok
    ? { ok: true, data: response.result.data }
    : { ok: false, error: response.result.error };
  settlePendingCall(response.requestId, result);
  return { accepted: true };
}

export function disposeAgentRendererBridgeForWebContents(webContentsId: number): void {
  for (const [key, host] of hosts) {
    if (host.webContents.id === webContentsId) hosts.delete(key);
  }
  for (const [requestId, call] of pending) {
    if (call.webContentsId !== webContentsId) continue;
    settlePendingCall(
      requestId,
      agentToolFail("NO_OPEN_DOCUMENT", "The Composer window closed before the tool completed."),
    );
  }
}

export function disposeAgentRendererBridgeForProject(projectPath: string): void {
  for (const [key, host] of hosts) {
    if (host.projectPath === projectPath) hosts.delete(key);
  }
  for (const [requestId, call] of pending) {
    if (call.projectPath !== projectPath) continue;
    settlePendingCall(
      requestId,
      agentToolFail("NO_OPEN_DOCUMENT", "The project closed before the Composer tool completed."),
    );
  }
}
