import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARIA_DESIGN_QUERY,
  ARIA_MARKER_DIR,
} from "../../shared/composer/constants";
import {
  ARIA_BRIDGE_HEALTH_PATH,
  ARIA_BRIDGE_ID,
  ARIA_PROTOCOL_VERSION,
} from "../../shared/composer/protocol";
import { writeTextFileAtomic } from "../pathSafety";
import { DESIGN_CLIENT_SOURCE } from "./designClientSource";
import {
  COMPONENT_AUTHORING_ROUTE,
  COMPONENT_PREVIEW_ROUTE,
  ensureComponentPreviewEntrypoints,
} from "../componentPreviewHarness";
import {
  LAYOUT_PREVIEW_ROUTE,
  ensureLayoutPreviewEntrypoint,
} from "../layoutPreviewHarness";
import {
  composerDraftFileForProject,
  composerJournalFileForProject,
} from "./draftPreview";

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/**
 * Resolve the prebuilt composer kernel next to the Electron main bundle.
 * (`dist-electron/composer-kernel.mjs`, built by `scripts/build-electron.mjs`)
 */
export function resolveComposerKernelPath(): string {
  const besideBundle = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "composer-kernel.mjs",
  );
  if (fs.existsSync(besideBundle)) return besideBundle;

  // Source / vitest: import.meta points at electron/composer/*.ts — look at dist-electron.
  const fromRepo = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "dist-electron",
    "composer-kernel.mjs",
  );
  if (fs.existsSync(fromRepo)) return fromRepo;

  const fromCwd = path.join(process.cwd(), "dist-electron", "composer-kernel.mjs");
  if (fs.existsSync(fromCwd)) return fromCwd;

  return besideBundle;
}

/**
 * Resolve Aria's own `@astrojs/compiler` (WASM parser). The marker kernel
 * imports it as an external — Node resolves from `node_modules/.aria/`, which
 * does **not** see nested `astro/node_modules` (pnpm / unhoisted installs).
 * We vendor a copy beside the kernel so parse always works.
 */
export function resolveAriaCompilerRoot(): string | null {
  const tryResolve = (from: string): string | null => {
    try {
      const require = createRequire(from);
      return path.dirname(require.resolve("@astrojs/compiler/package.json"));
    } catch {
      return null;
    }
  };

  return (
    tryResolve(import.meta.url) ??
    tryResolve(path.join(process.cwd(), "package.json")) ??
    null
  );
}

function readPackageVersion(pkgRoot: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDirSync(from, to);
    else fs.copyFileSync(from, to);
  }
}

/**
 * Ensure `node_modules/.aria/node_modules/@astrojs/compiler` exists so the
 * copied kernel can `import "@astrojs/compiler"` without relying on the
 * project's hoist layout.
 */
export function ensureVendoredCompiler(ariaDir: string): boolean {
  const compilerSrc = resolveAriaCompilerRoot();
  if (!compilerSrc) {
    console.warn(
      "[aria:composer] @astrojs/compiler missing from Aria install — markers may fail",
    );
    return false;
  }

  const compilerDest = path.join(
    ariaDir,
    "node_modules",
    "@astrojs",
    "compiler",
  );
  const srcVersion = readPackageVersion(compilerSrc);
  const destVersion = readPackageVersion(compilerDest);
  const wasmOk = fs.existsSync(path.join(compilerDest, "dist", "astro.wasm"));
  if (srcVersion && destVersion === srcVersion && wasmOk) return true;

  fs.rmSync(compilerDest, { recursive: true, force: true });
  copyDirSync(compilerSrc, compilerDest);
  return fs.existsSync(path.join(compilerDest, "dist", "astro.wasm"));
}

function findUserAstroConfig(projectPath: string): string | null {
  for (const name of [
    "astro.config.mjs",
    "astro.config.js",
    "astro.config.ts",
    "astro.config.mts",
    "astro.config.cts",
    "astro.config.cjs",
  ]) {
    if (fs.existsSync(path.join(projectPath, name))) return name;
  }
  return null;
}

function findUserMiddleware(projectPath: string): string | null {
  for (const name of [
    "middleware.ts",
    "middleware.js",
    "middleware.mts",
    "middleware.mjs",
    "middleware.cts",
    "middleware.cjs",
  ]) {
    const candidate = path.join(projectPath, "src", name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export type MarkerConfigResult = {
  /** Absolute path to the generated override config. */
  configPath: string;
  /** Path relative to the project root (for `astro --config`). */
  configArg: string;
  dir: string;
  bridgeId: typeof ARIA_BRIDGE_ID;
};

/**
 * Write ephemeral Astro/Vite override under `node_modules/.aria/`.
 * Never mutates the user's committed `astro.config.*`.
 *
 * Returns null when the kernel is missing or the write fails — preview can
 * still start, but without selection markers.
 */
export function writeMarkerConfig(projectPath: string): MarkerConfigResult | null {
  try {
    const kernelSrc = resolveComposerKernelPath();
    if (!fs.existsSync(kernelSrc)) {
      console.warn(
        "[aria:composer] composer-kernel.mjs missing — run build:electron",
      );
      return null;
    }

    const dir = path.join(projectPath, "node_modules", ARIA_MARKER_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const previewEntries = ensureComponentPreviewEntrypoints(projectPath);
    const layoutPreviewEntry = ensureLayoutPreviewEntrypoint(projectPath);

    const kernelDest = path.join(dir, "kernel.mjs");
    fs.copyFileSync(kernelSrc, kernelDest);

    if (!ensureVendoredCompiler(dir)) {
      console.warn(
        "[aria:composer] failed to vendor @astrojs/compiler beside marker kernel",
      );
      return null;
    }

    const userCfg = findUserAstroConfig(projectPath);
    const userMiddleware = findUserMiddleware(projectPath);
    const pagesDir = toPosix(path.join(projectPath, "src", "pages"));
    const srcDir = toPosix(path.join(projectPath, "src"));
    const projectDirPosix = toPosix(projectPath);
    let draftFile: string;
    let journalFile: string;
    try {
      draftFile = toPosix(composerDraftFileForProject(projectPath));
      journalFile = toPosix(composerJournalFileForProject(projectPath));
    } catch {
      // Source-level tests can build the config before Electron userData exists.
      draftFile = toPosix(path.join(dir, "preview-draft.disabled.json"));
      journalFile = toPosix(path.join(dir, "preview-writes.disabled.json"));
    }

    const userImport = userCfg
      ? `import userConfigMod from ${JSON.stringify(`../../${userCfg}`)};`
      : "const userConfigMod = {};";

    const cfg = `// Generated by Aria (dev preview only) — do not edit.
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
${userImport}

const kernel = await import(pathToFileURL(${JSON.stringify(kernelDest)}).href);
const { parseAstro, serializeAstroMarked, resolveRawChunks } = kernel;
const PAGES_DIR = ${JSON.stringify(pagesDir)};
const SRC_DIR = ${JSON.stringify(srcDir)};
const PROJECT_DIR = ${JSON.stringify(projectDirPosix)};
const USER_MIDDLEWARE = ${JSON.stringify(userMiddleware ? toPosix(userMiddleware) : null)};
const DESIGN_QUERY = ${JSON.stringify(ARIA_DESIGN_QUERY)};
const ORIGINAL_MIDDLEWARE_QUERY = "aria-original-middleware";
const DRAFT_FILE = ${JSON.stringify(draftFile)};
const JOURNAL_FILE = ${JSON.stringify(journalFile)};
const DESIGN_CLIENT_SOURCE = ${JSON.stringify(DESIGN_CLIENT_SOURCE)};
const BRIDGE_HEALTH_PATH = ${JSON.stringify(ARIA_BRIDGE_HEALTH_PATH)};
const BRIDGE_HEALTH_JSON = ${JSON.stringify(JSON.stringify({ bridgeId: ARIA_BRIDGE_ID, protocolVersion: ARIA_PROTOCOL_VERSION }))};
const COMPONENT_THUMB_ENTRY = ${JSON.stringify(toPosix(previewEntries.thumbnail))};
const COMPONENT_AUTHORING_ENTRY = ${JSON.stringify(toPosix(previewEntries.authoring))};
const LAYOUT_THUMB_ENTRY = ${JSON.stringify(toPosix(layoutPreviewEntry))};
const HARNESS_FILES = [COMPONENT_THUMB_ENTRY, COMPONENT_AUTHORING_ENTRY, LAYOUT_THUMB_ENTRY];
const HARNESS_ROUTES = [
  { prefix: ${JSON.stringify(COMPONENT_AUTHORING_ROUTE)}, file: COMPONENT_AUTHORING_ENTRY },
  { prefix: ${JSON.stringify(COMPONENT_PREVIEW_ROUTE)}, file: COMPONENT_THUMB_ENTRY },
  { prefix: ${JSON.stringify(LAYOUT_PREVIEW_ROUTE)}, file: LAYOUT_THUMB_ENTRY },
];
const harnessSeenMtime = new Map();
const announcedTransactions = new Set();

async function readReadyJournal() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let journal = null;
    try { journal = JSON.parse(readFileSync(JOURNAL_FILE, "utf8")); } catch {}
    if (!journal || journal.expiresAt < Date.now()) return null;
    if (journal.complete !== false) return journal;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return null;
}

function sourceReadyPayload(journal) {
  return {
    revision: journal.revision,
    transactionId: journal.transactionId,
    changedFiles: journal.files.map((file) => ({ relativeFile: file.relativeFile, role: file.role || "astro" })),
  };
}

function posixFile(value) {
  return String(value || "").replace(/\\\\/g, "/");
}

function harnessMtime(file) {
  try { return statSync(file).mtimeMs; } catch { return 0; }
}

function invalidateFileModules(graph, file) {
  if (!graph) return;
  const normalized = posixFile(file);
  const fromApi = graph.getModulesByFile?.(file) || graph.getModulesByFile?.(normalized);
  if (fromApi && fromApi.size) {
    for (const mod of fromApi) graph.invalidateModule(mod);
    return;
  }
  for (const mod of graph.idToModuleMap.values()) {
    const candidate = posixFile(mod.file || mod.id).split("?")[0];
    if (candidate === normalized) graph.invalidateModule(mod);
  }
}

function invalidateHarnessIfStale(server, file) {
  const mtime = harnessMtime(file);
  if (!mtime) return;
  if (harnessSeenMtime.get(file) === mtime) return;
  harnessSeenMtime.set(file, mtime);
  invalidateFileModules(server.moduleGraph, file);
}

function mergeWatchIgnored(existing) {
  const allowAria = "!**/node_modules/.aria/**";
  if (!existing) return undefined;
  if (typeof existing === "function") {
    return (watchPath, stats) => {
      if (posixFile(watchPath).includes("/node_modules/.aria/")) return false;
      return existing(watchPath, stats);
    };
  }
  const list = Array.isArray(existing) ? existing : [existing];
  return list.includes(allowAria) ? list : [...list, allowAria];
}

const resolvedUser = await Promise.resolve(userConfigMod);
// CJS / interop default unwrap — never spread a \`{ default: config }\` shell.
const unwrapped =
  resolvedUser &&
  typeof resolvedUser === "object" &&
  "default" in resolvedUser &&
  resolvedUser.default &&
  typeof resolvedUser.default === "object"
    ? resolvedUser.default
    : resolvedUser;
const baseDefault =
  unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)
    ? unwrapped
    : {};
const userVite = baseDefault.vite || {};
const userServer = userVite.server || {};
const userWatch = userServer.watch || {};
const mergedIgnored = mergeWatchIgnored(userWatch.ignored);

// Must hook \`load\` (not \`transform\`): Astro's compiler plugin is also
// enforce:'pre' and runs first — a transform would see compiled JS.
const ariaMarkers = {
  name: "aria-node-markers",
  enforce: "pre",
  configureServer(server) {
    server.watcher.add(DRAFT_FILE);
    for (const file of HARNESS_FILES) server.watcher.add(file);
    server.middlewares.use((req, res, next) => {
      const pathname = String(req.url || "").split("?")[0];
      if (pathname !== BRIDGE_HEALTH_PATH) return next();
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(BRIDGE_HEALTH_JSON);
    });
    const refreshDraft = (changed) => {
      if (changed.replace(/\\\\/g, "/") !== DRAFT_FILE) return;
      server.moduleGraph.invalidateAll();
      let draft = null;
      try { draft = JSON.parse(readFileSync(DRAFT_FILE, "utf8")); } catch {}
      if (draft && Number.isFinite(draft.revision)) {
        server.ws.send({ type: "custom", event: "aria:source-ready", data: { revision: draft.revision } });
      }
    };
    const refreshHarness = (changed) => {
      const file = posixFile(changed);
      if (!HARNESS_FILES.includes(file)) return;
      harnessSeenMtime.delete(file);
      invalidateFileModules(server.moduleGraph, file);
    };
    server.watcher.on("add", refreshDraft);
    server.watcher.on("change", refreshDraft);
    server.watcher.on("unlink", refreshDraft);
    server.watcher.on("add", refreshHarness);
    server.watcher.on("change", refreshHarness);
    server.middlewares.use((req, _res, next) => {
      const pathname = String(req.url || "").split("?")[0];
      for (const route of HARNESS_ROUTES) {
        if (pathname === route.prefix || pathname.startsWith(route.prefix + "/")) {
          invalidateHarnessIfStale(server, route.file);
          break;
        }
      }
      next();
    });
  },
  async handleHotUpdate(context) {
    const file = context.file.replace(/\\\\/g, "/");
    if (!file.startsWith(PROJECT_DIR + "/")) return;
    const journal = await readReadyJournal();
    if (!journal || journal.expiresAt < Date.now() || !Array.isArray(journal.files)) return;
    const relativeFile = file.slice(PROJECT_DIR.length + 1);
    const expected = journal.files.find((entry) => entry.relativeFile === relativeFile);
    if (!expected) return;
    const source = await context.read();
    if (createHash("sha256").update(source).digest("hex") !== expected.contentHash) return;
    if (!announcedTransactions.has(journal.transactionId)) {
      for (const entry of journal.files) {
        if (entry.role === "astro" || entry.relativeFile.endsWith(".astro")) {
          invalidateFileModules(context.server.moduleGraph, PROJECT_DIR + "/" + entry.relativeFile);
        }
      }
      announcedTransactions.add(journal.transactionId);
      context.server.ws.send({ type: "custom", event: "aria:source-ready", data: sourceReadyPayload(journal) });
    }
    if (!file.endsWith(".astro")) return expected.role === "runtime" ? [] : undefined;
    for (const module of context.modules || []) context.server.moduleGraph.invalidateModule(module);
    return [];
  },
  async hotUpdate(options) {
    const file = String(options.file || "").replace(/\\\\/g, "/");
    if (!file.startsWith(PROJECT_DIR + "/")) return;
    const journal = await readReadyJournal();
    if (!journal || journal.expiresAt < Date.now() || !Array.isArray(journal.files)) return;
    const relativeFile = file.slice(PROJECT_DIR.length + 1);
    const expected = journal.files.find((entry) => entry.relativeFile === relativeFile);
    if (!expected) return;
    if (options.type === "delete") return expected.deleted === true ? [] : undefined;
    if (expected.deleted === true) return;
    const source = await options.read();
    if (createHash("sha256").update(source).digest("hex") !== expected.contentHash) return;
    if (!announcedTransactions.has(journal.transactionId)) {
      for (const entry of journal.files) {
        if (entry.role === "astro" || entry.relativeFile.endsWith(".astro")) {
          invalidateFileModules(this.environment?.moduleGraph, PROJECT_DIR + "/" + entry.relativeFile);
        }
      }
      announcedTransactions.add(journal.transactionId);
      this.environment?.hot?.send?.("aria:source-ready", sourceReadyPayload(journal));
    }
    if (!file.endsWith(".astro")) return expected.role === "runtime" ? [] : undefined;
    for (const module of options.modules || []) this.environment?.moduleGraph?.invalidateModule?.(module);
    return [];
  },
  async load(id) {
    const qi = id.indexOf("?");
    const raw = qi === -1 ? id : id.slice(0, qi);
    const file = raw.replace(/\\\\/g, "/");
    const query = qi === -1 ? "" : id.slice(qi + 1);
    if (USER_MIDDLEWARE && file === USER_MIDDLEWARE) {
      if (query.split("&").includes(ORIGINAL_MIDDLEWARE_QUERY)) {
        return readFileSync(raw, "utf8");
      }
      const originalId = USER_MIDDLEWARE + "?" + ORIGINAL_MIDDLEWARE_QUERY;
      return [
        "import * as userMiddleware from " + JSON.stringify(originalId) + ";",
        "export * from " + JSON.stringify(originalId) + ";",
        "const userOnRequest = userMiddleware.onRequest;",
        "export const onRequest = async (context, next) => {",
        "  if (typeof userOnRequest !== 'function') return next();",
        "  let middlewareRedirected = false;",
        "  const previewContext = new Proxy(context, {",
        "    get(target, property, receiver) {",
        "      if (property !== 'redirect') return Reflect.get(target, property, receiver);",
        "      return (...args) => { middlewareRedirected = true; return target.redirect(...args); };",
        "    },",
        "  });",
        "  const response = await userOnRequest(previewContext, next);",
        "  const isDesignRequest = context.url.searchParams.get(" + JSON.stringify(DESIGN_QUERY) + ") === '1';",
        "  const isRedirect = response instanceof Response && response.status >= 300 && response.status < 400;",
        "  if (isDesignRequest && middlewareRedirected && isRedirect) return next();",
        "  return response;",
        "};",
      ].join("\\n");
    }
    if (!file.endsWith(".astro")) return null;
    if (HARNESS_FILES.includes(file)) {
      try { return readFileSync(raw, "utf8"); } catch { return null; }
    }
    const isPage = file.startsWith(PAGES_DIR + "/");
    if (!isPage && !file.startsWith(SRC_DIR + "/")) return null;
    try {
      const relativeFile = file.slice(PROJECT_DIR.length + 1);
      let draft = null;
      try {
        const candidate = JSON.parse(readFileSync(DRAFT_FILE, "utf8"));
        if (
          candidate &&
          candidate.relativeFile === relativeFile &&
          typeof candidate.source === "string"
        ) draft = candidate;
      } catch {}
      const source = draft ? draft.source : readFileSync(raw, "utf8");
      const parsed = await parseAstro(source, { filename: raw });
      if (!parsed.editable) return draft ? source : null;
      await resolveRawChunks(parsed.model, raw);
      if (isPage) return serializeAstroMarked(parsed.model);
      return serializeAstroMarked(parsed.model, relativeFile + "|");
    } catch {
      return null;
    }
  },
};

const VIRTUAL_ID = "\\0aria-design-client";
const ariaDesignClientVite = {
  name: "aria-design-client-vite",
  enforce: "pre",
  resolveId(id) {
    if (id === "virtual:aria-design-client") return VIRTUAL_ID;
  },
  load(id) {
    if (id === VIRTUAL_ID) return 'if (import.meta.hot) import.meta.hot.on("aria:source-ready", (payload) => requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("aria:source-ready", { detail: payload })))));\\n' + DESIGN_CLIENT_SOURCE;
  },
};

// Astro pages are not served via Vite transformIndexHtml — injectScript is required.
const ariaDesignClientIntegration = {
  name: "aria-design-client",
  hooks: {
    "astro:config:setup"({ injectScript, injectRoute }) {
      injectScript("page", 'import "virtual:aria-design-client";');
      injectRoute({ pattern: ${JSON.stringify(COMPONENT_PREVIEW_ROUTE)}, entrypoint: COMPONENT_THUMB_ENTRY });
      injectRoute({ pattern: ${JSON.stringify(COMPONENT_AUTHORING_ROUTE)}, entrypoint: COMPONENT_AUTHORING_ENTRY });
      injectRoute({ pattern: ${JSON.stringify(LAYOUT_PREVIEW_ROUTE)}, entrypoint: LAYOUT_THUMB_ENTRY });
    },
  },
};

export default {
  ...baseDefault,
  // Toolbar already disabled via .astro/settings.json; keep config explicit.
  devToolbar: { enabled: false },
  // Marker <template>s turn boundary whitespace into inter-element space —
  // compressHTML would drop it and shift layout vs the real build.
  compressHTML: false,
  integrations: [
    ...(baseDefault.integrations || []),
    ariaDesignClientIntegration,
  ],
  vite: {
    ...userVite,
    plugins: [
      ariaMarkers,
      ariaDesignClientVite,
      ...(userVite.plugins || []),
    ],
    server: {
      ...userServer,
      watch: {
        ...userWatch,
        ...(mergedIgnored !== undefined ? { ignored: mergedIgnored } : {}),
      },
    },
  },
};
`;

    const configPath = path.join(dir, "astro.config.mjs");
    writeTextFileAtomic(configPath, cfg);
    // Still write the file for inspection / fallback; virtual module is primary.
    writeTextFileAtomic(path.join(dir, "design-client.js"), DESIGN_CLIENT_SOURCE);

    return {
      configPath,
      configArg: toPosix(path.join("node_modules", ARIA_MARKER_DIR, "astro.config.mjs")),
      dir,
      bridgeId: ARIA_BRIDGE_ID,
    };
  } catch (error) {
    console.warn(
      "[aria:composer] writeMarkerConfig failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
