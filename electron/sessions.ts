import path from "node:path";
import { AstroRuntimeManager } from "./astroRuntime";
import {
  cancelAllInstalls,
  cancelInstall,
  hasNodeModules,
  runProjectInstall,
  trimInstallLogs,
} from "./deps";
import { canonicalDirectory } from "./pathSafety";
import { ProjectWatcher, type ProjectChange } from "./projectWatcher";
import { syncMotionArtifacts } from "./composer/motionAssets";
import {
  stopAllComposerLanguageServers,
  stopComposerLanguageServer,
} from "./composer/languageServer";
import {
  disposeTranslationCatalogRegistry,
  invalidateTranslationCatalogRegistry,
  isTranslationRegistryChange,
} from "./composer/translationCatalogs";
import {
  disposeProjectDataCatalogRegistry,
  invalidateProjectDataCatalogRegistry,
  isProjectDataRegistryChange,
} from "./composer/projectDataCatalog";
import { isAstroProject } from "./project";
import type { ProjectRuntimeSession } from "../shared/types";
import { recoverCmsTransactions } from "./cms";
import {
  drainProjectMutations,
  recoverProjectMutations,
} from "./mutations";
import { drainCmsTransactions } from "./cms/mutationCoordinator";
import {
  disposeProjectSearch,
  invalidateProjectSearch,
} from "./search";

export type { ProjectRuntimeSession } from "../shared/types";

const sessions = new Map<string, ProjectRuntimeSession>();
const sessionOwners = new Map<string, Set<number>>();
const watchers = new Map<string, ProjectWatcher>();
const closing = new Map<string, Promise<void>>();
const opening = new Map<string, Promise<ProjectRuntimeSession>>();
const installing = new Map<string, Promise<ProjectRuntimeSession>>();
const sessionListeners = new Set<(session: ProjectRuntimeSession) => void>();
const changeListeners = new Set<(projectPath: string, change: ProjectChange) => void>();

const runtime = new AstroRuntimeManager((snapshot) => {
  const session = sessions.get(snapshot.path);
  if (!session) return;
  // Don't clobber an in-flight install with runtime snapshots.
  if (session.status === "installing") return;
  session.live = snapshot.live;
  session.previewUrl = snapshot.previewUrl;
  session.previewOwnership = snapshot.previewOwnership;
  session.status = snapshot.status;
  session.error = snapshot.error;
  session.logs = snapshot.logs;
  session.markersPresent = snapshot.markersPresent;
  session.composerWarning = snapshot.composerWarning;
  session.authoringState = snapshot.authoringState;
  session.recoveryAction = snapshot.recoveryAction;
  session.externalPreview = snapshot.externalPreview;
  notify(session);
});

function resolveKey(projectPath: string): string {
  return canonicalDirectory(projectPath);
}

function resolveLookupKey(projectPath: string): string {
  try {
    return resolveKey(projectPath);
  } catch {
    return path.resolve(projectPath.trim());
  }
}

function sessionName(projectPath: string): string {
  return path.basename(projectPath) || projectPath;
}

function addSessionOwner(projectPath: string, ownerId: number): void {
  let owners = sessionOwners.get(projectPath);
  if (!owners) {
    owners = new Set<number>();
    sessionOwners.set(projectPath, owners);
  }
  owners.add(ownerId);
}

function removeSessionOwner(projectPath: string, ownerId: number): boolean {
  const owners = sessionOwners.get(projectPath);
  if (!owners?.delete(ownerId)) return false;
  if (owners.size === 0 && !sessions.has(projectPath) && !opening.has(projectPath)) {
    sessionOwners.delete(projectPath);
  }
  return true;
}

export function listSessions(): ProjectRuntimeSession[] {
  return [...sessions.values()].sort((a, b) => b.openedAt - a.openedAt);
}

function notify(session: ProjectRuntimeSession): void {
  const copy = { ...session, logs: [...session.logs] };
  for (const listener of sessionListeners) listener(copy);
}

export function onSessionUpdate(listener: (session: ProjectRuntimeSession) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function onProjectChange(
  listener: (projectPath: string, change: ProjectChange) => void,
): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function getSession(projectPath: string): ProjectRuntimeSession | null {
  return sessions.get(resolveKey(projectPath)) ?? null;
}

/** Resolve an active, non-closing session without turning a lifecycle race into an IPC error. */
export function findOpenSessionPath(projectPath: string): string | null {
  const key = resolveLookupKey(projectPath);
  if (closing.has(key) || !sessions.has(key)) return null;
  return key;
}

/** Register or touch a session when the user opens/activates a project. */
export function openSession(
  projectPath: string,
  ownerId = 0,
): Promise<ProjectRuntimeSession> {
  const key = resolveKey(projectPath);
  // Reserve ownership before any recovery work awaits. A window-close release
  // can then see and revoke this owner even while first-open is in flight.
  addSessionOwner(key, ownerId);
  const existing = sessions.get(key);
  if (existing && !closing.has(key)) {
    existing.openedAt = Date.now();
    if (!hasNodeModules(key)) {
      if (
        existing.status === "stopped" ||
        existing.status === "failed" ||
        existing.status === "needs_install"
      ) {
        existing.status = "needs_install";
        existing.authoringState = "stopped";
        existing.recoveryAction = "none";
        existing.externalPreview = null;
      }
    } else if (existing.status === "needs_install") {
      existing.status = "stopped";
      existing.error = null;
    }
    notify(existing);
    return Promise.resolve(existing);
  }
  const pending = opening.get(key);
  if (pending) return pending;
  const operation = openSessionInternal(key).finally(() => {
    if (opening.get(key) === operation) opening.delete(key);
    if (!sessions.has(key)) sessionOwners.delete(key);
  });
  opening.set(key, operation);
  return operation.catch((error) => {
    removeSessionOwner(key, ownerId);
    throw error;
  });
}

async function openSessionInternal(key: string): Promise<ProjectRuntimeSession> {
  const startedAt = Date.now();
  await closing.get(key);
  if (!isAstroProject(key)) throw new Error("The selected folder is not an Astro project");
  const existing = sessions.get(key);
  if (existing) {
    existing.openedAt = Date.now();
    notify(existing);
    return existing;
  }
  // Recovery is a first-open boundary. It completes before session state,
  // watchers, or renderer reads can observe a partially applied transaction.
  recoverProjectMutations(key);
  await recoverCmsTransactions(key);
  const needsInstall = !hasNodeModules(key);
  const record: ProjectRuntimeSession = {
    path: key,
    name: sessionName(key),
    live: false,
    previewUrl: null,
    previewOwnership: null,
    status: needsInstall ? "needs_install" : "stopped",
    error: null,
    logs: [],
    openedAt: Date.now(),
    markersPresent: null,
    composerWarning: null,
    authoringState: "stopped",
    recoveryAction: "none",
    externalPreview: null,
  };
  sessions.set(key, record);
  const watcher = new ProjectWatcher(key, (change) => {
    invalidateProjectSearch(key, change);
    if (isTranslationRegistryChange(change.path)) {
      invalidateTranslationCatalogRegistry(key);
    }
    if (isProjectDataRegistryChange(change.path)) {
      invalidateProjectDataCatalogRegistry(key);
    }
    if (!change.path || change.path.endsWith(".astro")) {
      try {
        syncMotionArtifacts(key);
      } catch {
        // Runtime startup performs a fail-visible reconciliation as well.
      }
    }
    for (const listener of changeListeners) listener(key, change);
  });
  watcher.start();
  watchers.set(key, watcher);
  notify(record);
  console.info(`[aria:perf] Project session opened in ${Date.now() - startedAt}ms.`);
  return record;
}

/** Return the canonical path only when the project is an active session. */
export function requireOpenSession(projectPath: string): string {
  const key = resolveLookupKey(projectPath);
  if (closing.has(key)) {
    throw new Error("Project session is closing");
  }
  if (!sessions.has(key)) {
    throw new Error("Project is not open in Aria");
  }
  return key;
}

/** Resolve a session only when the requesting renderer currently owns it. */
export function requireSessionOwner(projectPath: string, ownerId: number): string {
  const key = requireOpenSession(projectPath);
  if (!sessionOwners.get(key)?.has(ownerId)) {
    throw new Error("Project is not attached to this window");
  }
  return key;
}

export function sessionOwnerCount(projectPath: string): number {
  const key = resolveLookupKey(projectPath);
  return sessionOwners.get(key)?.size ?? 0;
}

export function listSessionPathsForOwner(ownerId: number): string[] {
  return [...sessionOwners.entries()]
    .filter(([, owners]) => owners.has(ownerId))
    .map(([projectPath]) => projectPath);
}

/** Drop a session (and later stop its server). */
export async function closeSession(
  projectPath: string,
  ownerId?: number,
): Promise<boolean> {
  const key = resolveLookupKey(projectPath);
  if (typeof ownerId === "number") {
    if (!removeSessionOwner(key, ownerId)) return false;
    if ((sessionOwners.get(key)?.size ?? 0) > 0) return false;
  }
  const pendingOpen = opening.get(key);
  if (pendingOpen) {
    await pendingOpen.catch(() => undefined);
    if ((sessionOwners.get(key)?.size ?? 0) > 0) return false;
  }
  const existed = sessions.has(key);
  if (!existed) return false;
  const existing = sessions.get(key);
  const currentClose = closing.get(key);
  if (currentClose) {
    await currentClose;
    return true;
  }
  const close = (async () => {
    disposeTranslationCatalogRegistry(key);
    disposeProjectSearch(key);
    disposeProjectDataCatalogRegistry(key);
    watchers.get(key)?.stop();
    watchers.delete(key);
    await Promise.all([
      drainProjectMutations(key),
      drainCmsTransactions(key),
    ]);
    await cancelInstall(key);
    await runtime.stop(key);
    await stopComposerLanguageServer(key);
    if (sessions.get(key) === existing) sessions.delete(key);
    sessionOwners.delete(key);
  })();
  closing.set(key, close);
  try {
    await close;
  } finally {
    if (closing.get(key) === close) closing.delete(key);
  }
  return true;
}

export async function startSessionRuntime(projectPath: string): Promise<ProjectRuntimeSession> {
  const key = requireOpenSession(projectPath);
  const session = sessions.get(key);
  if (!session) throw new Error("Project is not open in Aria");
  if (!hasNodeModules(key)) {
    session.status = "needs_install";
    session.live = false;
    session.previewUrl = null;
    session.error = "Install project dependencies before starting preview.";
    session.authoringState = "stopped";
    session.recoveryAction = "none";
    session.externalPreview = null;
    notify(session);
    return session;
  }
  await runtime.start(key);
  if (sessions.get(key) !== session) throw new Error("Project session was closed");
  return session;
}

export async function stopSessionRuntime(projectPath: string): Promise<ProjectRuntimeSession | null> {
  const key = requireOpenSession(projectPath);
  await runtime.stop(key);
  return sessions.get(key) ?? null;
}

export async function restartSessionRuntime(projectPath: string): Promise<ProjectRuntimeSession> {
  const key = requireOpenSession(projectPath);
  const session = sessions.get(key);
  if (!session) throw new Error("Project is not open in Aria");
  if (!hasNodeModules(key)) {
    session.status = "needs_install";
    session.live = false;
    session.previewUrl = null;
    session.error = "Install project dependencies before starting preview.";
    session.authoringState = "stopped";
    session.recoveryAction = "none";
    session.externalPreview = null;
    notify(session);
    return session;
  }
  await runtime.restart(key);
  if (closing.has(key)) throw new Error("Project session is closing");
  if (sessions.get(key) !== session) throw new Error("Project session was closed");
  return session;
}

export async function replaceExternalSessionRuntime(projectPath: string): Promise<ProjectRuntimeSession> {
  const key = requireOpenSession(projectPath);
  const session = sessions.get(key);
  if (!session) throw new Error("Project is not open in Aria");
  await runtime.replaceExternal(key);
  if (closing.has(key)) throw new Error("Project session is closing");
  if (sessions.get(key) !== session) throw new Error("Project session was closed");
  return session;
}

/** Install project dependencies, stream logs on the session, then start preview. */
export async function installSessionDeps(projectPath: string): Promise<ProjectRuntimeSession> {
  const key = requireOpenSession(projectPath);
  const session = sessions.get(key);
  if (!session) throw new Error("Project is not open in Aria");

  const pending = installing.get(key);
  if (pending) return pending;

  const operation = (async () => {
    if (session.status === "live" || session.status === "starting") {
      await runtime.stop(key);
    }

    session.status = "installing";
    session.live = false;
    session.previewUrl = null;
    session.error = null;
    session.logs = [];
    session.authoringState = "stopped";
    session.recoveryAction = "none";
    session.externalPreview = null;
    notify(session);

    try {
      await runProjectInstall(key, (chunk) => {
        if (sessions.get(key) !== session) return;
        session.logs = trimInstallLogs(session.logs, chunk);
        notify(session);
      });
    } catch (error) {
      if (sessions.get(key) !== session) throw error;
      session.status = "needs_install";
      session.error =
        error instanceof Error ? error.message : String(error);
      notify(session);
      return session;
    }

    if (sessions.get(key) !== session) {
      throw new Error("Project session was closed");
    }
    if (closing.has(key)) {
      throw new Error("Project session is closing");
    }

    session.status = "stopped";
    session.error = null;
    notify(session);

    await runtime.start(key);
    if (sessions.get(key) !== session) {
      throw new Error("Project session was closed");
    }
    return session;
  })().finally(() => {
    if (installing.get(key) === operation) installing.delete(key);
  });

  installing.set(key, operation);
  return operation;
}

export async function stopAllSessions(): Promise<void> {
  await Promise.all([...opening.values()].map((pending) => pending.catch(() => undefined)));
  await cancelAllInstalls();
  for (const key of sessions.keys()) {
    disposeTranslationCatalogRegistry(key);
    disposeProjectSearch(key);
  }
  for (const watcher of watchers.values()) watcher.stop();
  watchers.clear();
  await runtime.stopAll();
  await stopAllComposerLanguageServers();
  sessions.clear();
  sessionOwners.clear();
}
