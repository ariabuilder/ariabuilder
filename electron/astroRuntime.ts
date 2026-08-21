import { execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  ExternalPreview,
  RuntimeAuthoringState,
  RuntimeRecoveryAction,
  RuntimeStatus,
} from "../shared/types";
import { hasNodeModules } from "./deps";
import { canonicalDirectory } from "./pathSafety";
import { resolveLocalAstroCommand } from "./astroCli";
import { spawnElectronNode } from "./processLaunch";
import { projectProcessEnv } from "./toolEnv";
import { readSiteSettings } from "./siteSettings";
import { syncSnippetsInjection } from "./snippetsInjection";
import { syncManagedSeoAndDiscovery } from "./seoSync";
import { syncRedirectsFromDisk } from "./redirects";
import {
  FOREIGN_SERVER_WARNING,
  probeAriaBridge,
  probeAriaMarkers,
} from "./composer/probeMarkers";
import { writeMarkerConfig } from "./composer/writeMarkerConfig";
import { ARIA_MARKER_DIR } from "../shared/composer/constants";
import {
  ARIA_BRIDGE_ID,
  ARIA_PROTOCOL_VERSION,
} from "../shared/composer/protocol";
export { prepareComponentAuthoringPreview } from "./componentPreviewHarness";

export type { RuntimeStatus } from "../shared/types";

export type RuntimeSnapshot = {
  path: string;
  status: RuntimeStatus;
  live: boolean;
  previewUrl: string | null;
  previewOwnership: "aria" | "external" | null;
  error: string | null;
  logs: string[];
  /** True when Aria marker config is active / markers detected in HTML. */
  markersPresent: boolean | null;
  /** Non-fatal warning for Composer (foreign server, missing kernel, …). */
  composerWarning: string | null;
  authoringState: RuntimeAuthoringState;
  recoveryAction: RuntimeRecoveryAction;
  externalPreview: ExternalPreview | null;
};

type RuntimeProcess = ChildProcess;
type RuntimeRun = {
  generation: number;
  controller: AbortController;
  child: RuntimeProcess | null;
  /** PID of an already-running Astro we adopted (not our spawn). */
  adoptedPid: number | null;
  ownership: "spawned" | "observed";
  cancelled: boolean;
  exitError: string | null;
  cleanup: Promise<void> | null;
  /** Clears the adopted-process health poll, if any. */
  stopWatch: (() => void) | null;
};

export function shouldTerminateRuntimeProcess(
  ownership: RuntimeRun["ownership"],
): boolean {
  return ownership === "spawned";
}

/**
 * Cloudflare SSR / heavy first-compile projects often need well over 30s before
 * the first HTML response completes. Keep this above 2× the readiness probe
 * budget so a slow first paint can still succeed.
 */
const STARTUP_TIMEOUT_MS = 90_000;
/** Per-request budget while waiting for Astro to become ready. */
const PROBE_READY_TIMEOUT_MS = 20_000;
/** Shorter health probes — slow SSR should miss a few times, not hang the poller. */
const PROBE_HEALTH_TIMEOUT_MS = 8_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const ADOPTED_WATCH_MS = 2_000;
const ADOPT_RETRY_MS = 1_500;
const LOG_LIMIT = 120;
const PREVIEW_URL_RE =
  /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/gi;

type DevLock = {
  pid: number;
  url: string;
};

type AriaRuntimeOwner = {
  pid: number;
  bridgeId: string;
  protocolVersion: number;
};

function runtimeOwnerPath(root: string): string {
  return path.join(root, "node_modules", ARIA_MARKER_DIR, "runtime-owner.json");
}

function readRuntimeOwner(root: string): AriaRuntimeOwner | null {
  try {
    const value = JSON.parse(fs.readFileSync(runtimeOwnerPath(root), "utf8")) as {
      pid?: unknown;
      bridgeId?: unknown;
      protocolVersion?: unknown;
    };
    if (
      typeof value.pid !== "number" ||
      typeof value.bridgeId !== "string" ||
      typeof value.protocolVersion !== "number"
    ) return null;
    return value as AriaRuntimeOwner;
  } catch {
    return null;
  }
}

function writeRuntimeOwner(root: string, pid: number): void {
  try {
    fs.writeFileSync(runtimeOwnerPath(root), JSON.stringify({
      pid,
      bridgeId: ARIA_BRIDGE_ID,
      protocolVersion: ARIA_PROTOCOL_VERSION,
    } satisfies AriaRuntimeOwner));
  } catch {
    // Ownership metadata improves cleanup but must not block preview startup.
  }
}

function removeRuntimeOwner(root: string, pid: number | null): void {
  try {
    const owner = readRuntimeOwner(root);
    if (!owner || pid === null || owner.pid === pid) {
      fs.unlinkSync(runtimeOwnerPath(root));
    }
  } catch {
    // Already removed or inaccessible.
  }
}

export function isAriaRuntimeCommand(command: string): boolean {
  return command.replace(/\\/g, "/").includes("node_modules/.aria/astro.config.mjs");
}

async function processCommand(pid: number): Promise<string> {
  return new Promise((resolve) => {
    const command = process.platform === "win32" ? "powershell.exe" : "ps";
    const args = process.platform === "win32"
      ? [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$process = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"; if ($process) { $process.CommandLine }`,
        ]
      : ["-p", String(pid), "-o", "command="];
    execFile(command, args, { windowsHide: true }, (error, stdout) => {
      resolve(error ? "" : stdout.trim());
    });
  });
}

function normalizedCommandPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/["']/g, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function commandBelongsToProjectAstro(command: string, astroEntry: string): boolean {
  if (!command.trim() || !astroEntry.trim()) return false;
  return normalizedCommandPath(command).includes(normalizedCommandPath(astroEntry));
}

/** Detect the exact option in the project-local Astro CLI without loading user config. */
export function astroCliSupportsIgnoreLock(root: string): boolean {
  const packageRoot = path.join(root, "node_modules", "astro");
  const candidates = [
    path.join(packageRoot, "dist", "cli", "dev", "index.js"),
    path.join(packageRoot, "dist", "cli", "index.js"),
    path.join(packageRoot, "astro.js"),
  ];
  for (const candidate of candidates) {
    try {
      const source = fs.readFileSync(candidate, "utf8");
      if (source.includes("ignore-lock") || source.includes("ignoreLock")) return true;
    } catch {
      // Astro releases move CLI files. Check the next known location.
    }
  }
  return false;
}

async function isAriaOwnedRuntime(root: string, pid: number): Promise<boolean> {
  const owner = readRuntimeOwner(root);
  if (owner?.pid !== pid) return false;
  return isAriaRuntimeCommand(await processCommand(pid));
}

function cleanLog(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "\n");
}

function normalizePreviewUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function isAllowedPreviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: process exists but we can't signal it — still treat as alive.
    return (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    );
  }
}

function readDevLock(root: string): DevLock | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, ".astro", "dev.json"), "utf8"),
    ) as { pid?: unknown; url?: unknown };
    if (typeof raw.pid !== "number" || typeof raw.url !== "string") return null;
    const url = normalizePreviewUrl(raw.url);
    if (!isAllowedPreviewUrl(url)) return null;
    return { pid: raw.pid, url };
  } catch {
    return null;
  }
}

export function externalPreviewMatchesLock(
  expected: ExternalPreview,
  actual: ExternalPreview | null,
): boolean {
  return Boolean(
    actual &&
    actual.pid === expected.pid &&
    normalizePreviewUrl(actual.url) === normalizePreviewUrl(expected.url),
  );
}

function extractPreviewUrl(text: string): string | null {
  PREVIEW_URL_RE.lastIndex = 0;
  let last: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = PREVIEW_URL_RE.exec(text)) !== null) {
    const url = normalizePreviewUrl(match[0]);
    if (isAllowedPreviewUrl(url)) last = url;
  }
  return last;
}

async function probeHttp(
  url: string,
  signal: AbortSignal,
  opts?: { okOnly?: boolean; timeoutMs?: number },
): Promise<boolean> {
  if (signal.aborted) return false;
  const requestController = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? PROBE_READY_TIMEOUT_MS;
  const timeout = setTimeout(() => requestController.abort(), timeoutMs);
  const abort = () => requestController.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, { signal: requestController.signal });
    if (opts?.okOnly) return response.ok;
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

/** Join a live preview base URL with an app route (`/about`). */
export function previewRouteUrl(baseUrl: string, route: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    ) {
      return null;
    }
    const pathname = route.trim() || "/";
    url.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

const ROUTE_READY_TIMEOUT_MS = 45_000;
const ROUTE_READY_POLL_MS = 250;

/**
 * Poll until Astro serves the route (HTTP 2xx). Used after creating a page so
 * Composer does not navigate into a transient Vite 404.
 * Returns false on timeout/abort — callers still navigate.
 */
export async function waitForPreviewRoute(
  previewUrl: string,
  route: string,
  timeoutMs = ROUTE_READY_TIMEOUT_MS,
): Promise<boolean> {
  const target = previewRouteUrl(previewUrl, route);
  if (!target) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    while (!controller.signal.aborted) {
      if (await probeHttp(target, controller.signal, { okOnly: true })) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, ROUTE_READY_POLL_MS));
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Two successful probes spaced briefly so we don't mark live mid-restart. */
async function probeHttpStable(
  url: string,
  signal: AbortSignal,
  gapMs = 300,
): Promise<boolean> {
  const opts = { timeoutMs: PROBE_READY_TIMEOUT_MS };
  if (!(await probeHttp(url, signal, opts))) return false;
  await new Promise((resolve) => setTimeout(resolve, gapMs));
  if (signal.aborted) return false;
  return probeHttp(url, signal, opts);
}

/**
 * Prefer Astro's lock file / log URL over allocating a port ourselves.
 *
 * Never treat "something answers on a stale lock URL" as this project's
 * server — another keep-alive session often owns that port.
 */
async function waitForPreviewUrl(
  root: string,
  getLogText: () => string,
  signal: AbortSignal,
  isForeignUrl: (url: string) => boolean,
): Promise<{ url: string; pid: number | null }> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("Preview startup cancelled");
    const lock = readDevLock(root);
    const fromLogs = extractPreviewUrl(getLogText());
    // Lock URL is only trustworthy when its pid is still alive (same process
    // that wrote the lock). A dead pid + live HTTP usually means another
    // project's Astro reused the port.
    const lockUrl =
      lock && isPidAlive(lock.pid) && !isForeignUrl(lock.url) ? lock.url : null;
    const logUrl =
      fromLogs && !isForeignUrl(fromLogs) ? fromLogs : null;
    const candidates = [lockUrl, logUrl].filter(
      (u): u is string => Boolean(u),
    );
    for (const url of candidates) {
      if (await probeHttpStable(`${url}/`, signal)) {
        const pid =
          lock && lock.url === url && isPidAlive(lock.pid) ? lock.pid : null;
        return { url, pid };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Astro did not become ready before the timeout");
}

/**
 * Attach to an already-running Astro for this project only when the lock's
 * pid is alive and the URL is not claimed by another Aria session.
 */
async function tryAdoptExisting(
  root: string,
  signal: AbortSignal,
  isForeignUrl: (url: string) => boolean,
): Promise<{ url: string; pid: number } | null> {
  const lock = readDevLock(root);
  if (!lock) return null;
  if (!isPidAlive(lock.pid)) return null;
  if (isForeignUrl(lock.url)) return null;
  if (!(await probeHttpStable(`${lock.url}/`, signal))) return null;
  return { url: lock.url, pid: lock.pid };
}

function taskkill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile("taskkill", ["/pid", String(pid), "/t", "/f"], () => resolve());
  });
}

async function killProcessTree(
  child: RuntimeProcess | null,
  adoptedPid: number | null = null,
): Promise<void> {
  const pid = child?.pid ?? adoptedPid;
  if (!pid) return;

  if (process.platform === "win32") {
    await taskkill(pid);
    return;
  }

  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      try {
        if (child) child.kill(signal);
        else process.kill(pid, signal);
        return true;
      } catch {
        return false;
      }
    }
  };

  const exited = () => child
    ? child.exitCode !== null || child.signalCode !== null
    : !isPidAlive(pid);
  let adoptedExitPoll: ReturnType<typeof setInterval> | null = null;
  const waitForExit = new Promise<void>((resolve) => {
    if (exited()) {
      resolve();
      return;
    }
    if (child) {
      child.once("exit", () => resolve());
      return;
    }
    adoptedExitPoll = setInterval(() => {
      if (!exited()) return;
      if (adoptedExitPoll) clearInterval(adoptedExitPoll);
      adoptedExitPoll = null;
      resolve();
    }, 50);
  });
  signalGroup("SIGTERM");
  await Promise.race([
    waitForExit,
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
  ]);
  if (!exited()) {
    signalGroup("SIGKILL");
    await Promise.race([
      waitForExit,
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }
  // The leader can exit while descendants remain in its process group.
  signalGroup("SIGKILL");
  if (adoptedExitPoll) clearInterval(adoptedExitPoll);
}

export class AstroRuntimeManager {
  private readonly records = new Map<string, RuntimeSnapshot>();
  private readonly runs = new Map<string, RuntimeRun>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private readonly generations = new Map<string, number>();

  public constructor(
    private readonly onUpdate: (snapshot: RuntimeSnapshot) => void,
  ) {}

  public get(projectPath: string): RuntimeSnapshot | null {
    const key = canonicalDirectory(projectPath);
    return this.records.get(key) ?? null;
  }

  public start(projectPath: string): Promise<RuntimeSnapshot> {
    const key = canonicalDirectory(projectPath);
    const existing = this.records.get(key);
    if (
      !this.operations.has(key) &&
      existing?.status === "live" &&
      existing.authoringState === "ready"
    ) {
      return Promise.resolve(existing);
    }
    return this.enqueue(key, () => this.startInternal(key));
  }

  public stop(projectPath: string): Promise<void> {
    let key: string;
    try {
      key = canonicalDirectory(projectPath);
    } catch {
      key = path.resolve(projectPath.trim());
    }
    const run = this.runs.get(key);
    if (run) {
      run.cancelled = true;
      run.controller.abort();
    }
    return this.enqueue(key, () => this.stopInternal(key));
  }

  public async restart(projectPath: string): Promise<RuntimeSnapshot> {
    await this.stop(projectPath);
    return this.start(projectPath);
  }

  public replaceExternal(projectPath: string): Promise<RuntimeSnapshot> {
    const key = canonicalDirectory(projectPath);
    return this.enqueue(key, () => this.replaceExternalInternal(key));
  }

  public async stopAll(): Promise<void> {
    const keys = new Set([
      ...this.records.keys(),
      ...this.runs.keys(),
      ...this.operations.keys(),
    ]);
    await Promise.all([...keys].map((key) => this.stop(key)));
  }

  private enqueue<T>(root: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(root) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.operations.set(root, current);
    void current.finally(() => {
      if (this.operations.get(root) === current) this.operations.delete(root);
    }).catch(() => undefined);
    return current;
  }

  private nextGeneration(root: string): number {
    const generation = (this.generations.get(root) ?? 0) + 1;
    this.generations.set(root, generation);
    return generation;
  }

  private isCurrent(root: string, run: RuntimeRun): boolean {
    return this.runs.get(root) === run;
  }

  private async replaceExternalInternal(root: string): Promise<RuntimeSnapshot> {
    const record = this.records.get(root);
    const expected = record?.externalPreview;
    if (
      !record ||
      record.authoringState !== "blocked_external" ||
      record.recoveryAction !== "replace_external" ||
      !expected
    ) {
      throw new Error("No external Astro preview is waiting to be replaced.");
    }

    const lock = readDevLock(root);
    if (!externalPreviewMatchesLock(expected, lock) || !lock || !isPidAlive(lock.pid)) {
      throw new Error("The existing Astro preview changed. Retry preview detection before replacing it.");
    }

    const command = resolveLocalAstroCommand(root, []);
    const observedCommand = await processCommand(lock.pid);
    if (!command || !commandBelongsToProjectAstro(observedCommand, command.entry)) {
      throw new Error("Aria could not verify that the existing process belongs to this project's Astro installation.");
    }

    const validationController = new AbortController();
    const [reachable, bridge, markers] = await Promise.all([
      probeHttpStable(`${lock.url}/`, validationController.signal),
      probeAriaBridge(lock.url, validationController.signal),
      probeAriaMarkers(lock.url, validationController.signal),
    ]);
    if (!reachable) {
      throw new Error("The existing Astro preview stopped. Retry preview detection.");
    }
    if (bridge.compatible && markers) {
      throw new Error("The existing preview now supports Composer. Retry preview detection instead of replacing it.");
    }

    record.logs.push(`[aria:composer] Replacing confirmed external preview ${lock.url} (PID ${lock.pid}).`);
    this.emit(record);
    await killProcessTree(null, lock.pid);
    if (isPidAlive(lock.pid)) {
      throw new Error("The existing Astro preview did not stop.");
    }

    const previousRun = this.runs.get(root);
    if (previousRun) {
      previousRun.cancelled = true;
      previousRun.controller.abort();
      await this.cleanupRun(root, previousRun);
    }
    record.externalPreview = null;
    record.recoveryAction = "none";
    return this.startInternal(root);
  }

  /** True when another live session already owns this preview URL. */
  private isPreviewUrlClaimedByOther(root: string, url: string): boolean {
    const normalized = normalizePreviewUrl(url);
    for (const [key, record] of this.records) {
      if (key === root) continue;
      if (!record.live || !record.previewUrl) continue;
      if (normalizePreviewUrl(record.previewUrl) === normalized) return true;
    }
    return false;
  }

  private async startInternal(root: string): Promise<RuntimeSnapshot> {
    const startupStartedAt = Date.now();
    const previousRun = this.runs.get(root);
    if (previousRun?.cleanup) await previousRun.cleanup;
    const existing = this.records.get(root);
    if (
      existing?.status === "live" &&
      existing.authoringState === "ready" &&
      !this.runs.get(root)?.cancelled
    ) return existing;

    if (!hasNodeModules(root)) {
      return this.needsInstall(
        root,
        "Install project dependencies before starting preview.",
      );
    }

    const run: RuntimeRun = {
      generation: this.nextGeneration(root),
      controller: new AbortController(),
      child: null,
      adoptedPid: null,
      ownership: "spawned",
      cancelled: false,
      exitError: null,
      cleanup: null,
      stopWatch: null,
    };
    this.runs.set(root, run);
    const record: RuntimeSnapshot = {
      path: root,
      status: "starting",
      live: false,
      previewUrl: null,
      previewOwnership: null,
      error: null,
      logs: [],
      markersPresent: null,
      composerWarning: null,
      authoringState: "starting",
      recoveryAction: "none",
      externalPreview: null,
    };
    this.records.set(root, record);
    this.emit(record);

    const command = resolveLocalAstroCommand(root, []);
    if (!command) {
      this.runs.delete(root);
      return this.needsInstall(
        root,
        "Astro is not installed. Install the project dependencies first.",
      );
    }

    try {
      if (run.cancelled || !this.isCurrent(root, run)) return this.stopped(root);

      // Hide the Astro Dev Toolbar in Composer (iframe) previews. This is the
      // project preference Astro documents — not a global machine setting.
      // Ensure snippet middleware exists so Stage preview injects site snippets.
      try {
        const settings = readSiteSettings(root);
        syncSnippetsInjection(root, settings.snippets ?? [], settings.analytics, settings.localization, settings.siteUrl);
        syncRedirectsFromDisk(root);
        syncManagedSeoAndDiscovery(root, settings);
      } catch {
        // Snippet / SEO sync is best-effort at start; Settings save will retry.
      }

      // Ephemeral marker config under node_modules/.aria/ (never mutates user config).
      const markerCfg = writeMarkerConfig(root);
      if (!markerCfg) {
        throw new Error("Aria could not prepare the Composer preview controls.");
      }
      if (run.cancelled || !this.isCurrent(root, run)) return this.stopped(root);

      // If Astro already has a live lock for this project, attach to it.
      // After a preference write, Astro may briefly restart — retry briefly.
      const isForeignUrl = (url: string) =>
        this.isPreviewUrlClaimedByOther(root, url);
      const adoptDeadline = Date.now() + ADOPT_RETRY_MS;
      let adopted: { url: string; pid: number } | null = null;
      while (true) {
        adopted = await tryAdoptExisting(
          root,
          run.controller.signal,
          isForeignUrl,
        );
        if (adopted || Date.now() >= adoptDeadline) break;
        if (!readDevLock(root)) break;
        if (run.cancelled || !this.isCurrent(root, run)) return this.stopped(root);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (run.cancelled || !this.isCurrent(root, run)) return this.stopped(root);
      let parallelExternal: ExternalPreview | null = null;
      if (adopted) {
        const [bridge, hasMarkers, ariaOwned] = await Promise.all([
          probeAriaBridge(adopted.url, run.controller.signal),
          probeAriaMarkers(adopted.url, run.controller.signal),
          isAriaOwnedRuntime(root, adopted.pid),
        ]);
        if (bridge.compatible && hasMarkers) {
          run.adoptedPid = adopted.pid;
          run.ownership = ariaOwned ? "spawned" : "observed";
          record.status = "live";
          record.live = true;
          record.previewUrl = adopted.url;
          record.previewOwnership = ariaOwned ? "aria" : "external";
          record.error = null;
          record.markersPresent = true;
          record.composerWarning = null;
          record.authoringState = "ready";
          record.recoveryAction = "none";
          record.externalPreview = null;
          record.logs.push(
            `[aria:perf] Composer preview bridge ready in ${Date.now() - startupStartedAt}ms.`,
          );
          this.watchPreview(root, run, adopted.url);
          this.emit(record);
          return record;
        }
        if (ariaOwned) {
          record.logs.push(
            `[aria:composer] Replacing stale Aria preview bridge ${bridge.bridgeId ?? "unknown"}.`,
          );
          await killProcessTree(null, adopted.pid);
          removeRuntimeOwner(root, adopted.pid);
          adopted = null;
        } else if (astroCliSupportsIgnoreLock(root)) {
          parallelExternal = adopted;
          record.logs.push(
            `[aria:composer] Existing preview ${adopted.url} remains running. Starting an instrumented Composer preview alongside it.`,
          );
        } else {
          run.adoptedPid = adopted.pid;
          run.ownership = "observed";
          record.status = "failed";
          record.live = false;
          record.previewUrl = null;
          record.previewOwnership = "external";
          record.error =
            "Another Astro preview is using this project. Replace it to enable Composer selection and editing.";
          record.markersPresent = false;
          record.composerWarning = null;
          record.authoringState = "blocked_external";
          record.recoveryAction = "replace_external";
          record.externalPreview = adopted;
          record.logs.push(`[aria:composer] ${FOREIGN_SERVER_WARNING}`);
          this.emit(record);
          return record;
        }
      }

      // Let Astro choose the port; we read it from logs / .astro/dev.json.
      // Pass Aria's ephemeral marker config when available.
      const spawnArgs = [
        command.entry,
        "dev",
        "--host",
        "127.0.0.1",
        "--clear-screen",
        "false",
      ];
      // Astro resolves --config against cwd; relative path avoids ConfigNotFound.
      spawnArgs.push("--config", markerCfg.configArg);
      if (parallelExternal) spawnArgs.push("--ignore-lock");
      const child = spawnElectronNode(spawnArgs, {
        cwd: root,
        env: projectProcessEnv(),
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      run.child = child;
      if (child.pid) writeRuntimeOwner(root, child.pid);

      const appendLog = (chunk: Buffer) => {
        if (!this.isCurrent(root, run)) return;
        record.logs.push(...cleanLog(chunk.toString("utf8")).split("\n").filter(Boolean));
        if (record.logs.length > LOG_LIMIT) record.logs.splice(0, record.logs.length - LOG_LIMIT);
        this.emit(record);
      };
      child.stdout?.on("data", appendLog);
      child.stderr?.on("data", appendLog);
      child.once("error", (error) => {
        if (!this.isCurrent(root, run)) return;
        run.exitError = `Could not start Astro: ${error.message}`;
        if (record.status === "live") {
          run.controller.abort();
          this.fail(root, run.exitError);
          run.cleanup = this.cleanupRun(root, run);
        }
      });
      child.once("exit", (code, signal) => {
        if (!this.isCurrent(root, run)) return;
        if (record.status === "live") {
          if (run.ownership === "observed") return;
          if (!run.cancelled) {
            run.exitError = `Astro preview stopped${code === null ? ` (${signal ?? "unknown signal"})` : ` with code ${code}`}.`;
            this.fail(root, run.exitError);
            run.cleanup = this.cleanupRun(root, run);
          }
          run.controller.abort();
          return;
        }
        // Still starting — Astro may have exited after pointing at an existing server.
        if (!run.cancelled && code !== 0 && code !== null) {
          run.exitError = `Astro preview stopped with code ${code}.`;
        }
      });

      const ready = await waitForPreviewUrl(
        root,
        () => record.logs.join("\n"),
        run.controller.signal,
        (url) =>
          isForeignUrl(url) ||
          Boolean(
            parallelExternal &&
            normalizePreviewUrl(url) === normalizePreviewUrl(parallelExternal.url),
          ),
      );
      if (run.cancelled || !this.isCurrent(root, run)) return this.stopped(root);

      // Our spawn may have exited after reporting an existing server — track that PID.
      const childGone =
        child.exitCode !== null || child.signalCode !== null;
      if (childGone) {
        run.child = null;
        run.adoptedPid = ready.pid;
        const ariaOwned = Boolean(
          ready.pid && await isAriaOwnedRuntime(root, ready.pid),
        );
        run.ownership = ariaOwned ? "spawned" : "observed";
        if (ariaOwned && ready.pid) writeRuntimeOwner(root, ready.pid);
      } else if (ready.pid && ready.pid !== child.pid) {
        run.adoptedPid = ready.pid;
        writeRuntimeOwner(root, ready.pid);
      }

      record.status = "live";
      record.live = true;
      record.previewUrl = ready.url;
      record.previewOwnership =
        run.ownership === "observed" ? "external" : "aria";
      record.error = null;
      const [hasMarkers, bridge] = await Promise.all([
        probeAriaMarkers(ready.url, run.controller.signal),
        probeAriaBridge(ready.url, run.controller.signal),
      ]);
      if (!hasMarkers || !bridge.compatible) {
        throw new Error(
          bridge.bridgeId
            ? `Composer preview bridge ${bridge.bridgeId} is incompatible with ${markerCfg.bridgeId}.`
            : "Composer preview started without Aria selection controls.",
        );
      }
      record.markersPresent = true;
      record.composerWarning = null;
      record.authoringState = "ready";
      record.recoveryAction = "none";
      record.externalPreview = null;
      record.logs.push(
        `[aria:perf] Composer preview bridge ready in ${Date.now() - startupStartedAt}ms.`,
      );
      // No live child means we only know about an adopted/external server — poll it.
      if (!run.child) this.watchPreview(root, run, ready.url);
      this.emit(record);
      return record;
    } catch (error) {
      const current = this.isCurrent(root, run);
      if (!current) return this.records.get(root) ?? this.stopped(root);
      await this.cleanupRun(root, run);
      this.runs.delete(root);
      if (run.cancelled) return this.stopped(root);
      return this.fail(
        root,
        run.exitError ?? (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  private async stopInternal(root: string): Promise<void> {
    const run = this.runs.get(root);
    if (run) {
      run.cancelled = true;
      run.controller.abort();
      await this.cleanupRun(root, run);
      if (this.isCurrent(root, run)) this.runs.delete(root);
    }
    const record = this.records.get(root);
    if (record) {
      record.status = "stopped";
      record.live = false;
      record.previewUrl = null;
      record.previewOwnership = null;
      record.error = null;
      record.markersPresent = null;
      record.composerWarning = null;
      record.authoringState = "stopped";
      record.recoveryAction = "none";
      record.externalPreview = null;
      this.emit(record);
    }
  }

  private stopped(root: string): RuntimeSnapshot {
    const record = this.records.get(root) ?? {
      path: root,
      status: "stopped" as const,
      live: false,
      previewUrl: null,
      previewOwnership: null,
      error: null,
      logs: [],
      markersPresent: null,
      composerWarning: null,
      authoringState: "stopped" as const,
      recoveryAction: "none" as const,
      externalPreview: null,
    };
    record.status = "stopped";
    record.live = false;
    record.previewUrl = null;
    record.previewOwnership = null;
    record.error = null;
    record.markersPresent = null;
    record.composerWarning = null;
    record.authoringState = "stopped";
    record.recoveryAction = "none";
    record.externalPreview = null;
    this.records.set(root, record);
    this.emit(record);
    return record;
  }

  private cleanupRun(root: string, run: RuntimeRun): Promise<void> {
    if (!run.cleanup) {
      run.cleanup = (async () => {
        run.stopWatch?.();
        run.stopWatch = null;
        if (shouldTerminateRuntimeProcess(run.ownership)) {
          const ownerPid = run.adoptedPid ?? run.child?.pid ?? null;
          await killProcessTree(run.child, run.adoptedPid);
          removeRuntimeOwner(root, ownerPid);
        }
      })().finally(() => {
        if (this.runs.get(root) === run) this.runs.delete(root);
      });
    }
    return run.cleanup;
  }

  /**
   * Adopted / externally-owned Astro has no child `exit` event — poll until it dies.
   */
  private watchPreview(root: string, run: RuntimeRun, url: string): void {
    run.stopWatch?.();
    let timer: ReturnType<typeof setInterval> | null = null;
    let misses = 0;
    let probing = false;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      run.stopWatch = null;
    };
    run.stopWatch = stop;

    timer = setInterval(() => {
      void (async () => {
        if (probing) return;
        if (!this.isCurrent(root, run) || run.cancelled) {
          stop();
          return;
        }
        const record = this.records.get(root);
        if (!record || record.status !== "live") {
          stop();
          return;
        }

        probing = true;
        try {
          const up = await probeHttp(`${url}/`, run.controller.signal, {
            timeoutMs: PROBE_HEALTH_TIMEOUT_MS,
          });
          if (!this.isCurrent(root, run) || run.cancelled) return;
          if (up) {
            misses = 0;
            return;
          }

          misses += 1;
          // Several consecutive misses — brief stalls during route compiles
          // or background thumb warming shouldn't kill a live session.
          if (misses < 5) return;

          stop();
          if (!this.isCurrent(root, run) || run.cancelled) return;
          run.exitError = "Astro preview stopped.";
          this.fail(root, run.exitError);
          run.cleanup = this.cleanupRun(root, run);
          run.controller.abort();
        } finally {
          probing = false;
        }
      })();
    }, ADOPTED_WATCH_MS);

    run.controller.signal.addEventListener("abort", stop, { once: true });
  }

  private needsInstall(root: string, error: string): RuntimeSnapshot {
    const record = this.records.get(root) ?? {
      path: root,
      status: "needs_install" as const,
      live: false,
      previewUrl: null,
      previewOwnership: null,
      error,
      logs: [],
      markersPresent: null,
      composerWarning: null,
      authoringState: "stopped" as const,
      recoveryAction: "none" as const,
      externalPreview: null,
    };
    record.status = "needs_install";
    record.live = false;
    record.previewUrl = null;
    record.previewOwnership = null;
    record.error = error;
    record.markersPresent = null;
    record.composerWarning = null;
    record.authoringState = "stopped";
    record.recoveryAction = "none";
    record.externalPreview = null;
    this.records.set(root, record);
    this.emit(record);
    return record;
  }

  private fail(root: string, error: string): RuntimeSnapshot {
    const record = this.records.get(root) ?? {
      path: root,
      status: "failed" as const,
      live: false,
      previewUrl: null,
      previewOwnership: null,
      error,
      logs: [],
      markersPresent: null,
      composerWarning: null,
      authoringState: "failed" as const,
      recoveryAction: "retry" as const,
      externalPreview: null,
    };
    record.status = "failed";
    record.live = false;
    record.previewUrl = null;
    record.previewOwnership = null;
    record.error = error;
    record.markersPresent = null;
    record.composerWarning = null;
    record.authoringState = "failed";
    record.recoveryAction = "retry";
    record.externalPreview = null;
    this.records.set(root, record);
    this.emit(record);
    return record;
  }

  private emit(record: RuntimeSnapshot): void {
    this.onUpdate({ ...record, logs: [...record.logs] });
  }
}
