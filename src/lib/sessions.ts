import type {
  ProjectChange,
  ProjectRuntimeSession,
} from "../../shared/types";

export type { ProjectChange, ProjectRuntimeSession } from "../../shared/types";

function api() {
  if (!window.aria) {
    throw new Error("Aria desktop bridge is unavailable");
  }
  return window.aria;
}

export function listSessions() {
  return api().sessions.list();
}

export function openSession(projectPath: string) {
  return api().sessions.open(projectPath);
}

export function confirmTrustAndOpen(challengeId: string) {
  return api().sessions.confirmTrustAndOpen(challengeId);
}

export function revokeProjectTrust(projectPath: string) {
  return api().sessions.revokeTrust(projectPath);
}

export function closeSession(projectPath: string) {
  return api().sessions.close(projectPath);
}

export function startSessionRuntime(projectPath: string) {
  return api().sessions.start(projectPath);
}

export function stopSessionRuntime(projectPath: string) {
  return api().sessions.stop(projectPath);
}

export function restartSessionRuntime(projectPath: string) {
  return api().sessions.restart(projectPath);
}

export function installSessionDeps(projectPath: string) {
  return api().sessions.installDeps(projectPath);
}

export function onSessionUpdate(
  handler: (session: ProjectRuntimeSession) => void,
): () => void {
  return api().sessions.onUpdate(handler);
}

export function onProjectChange(
  handler: (projectPath: string, change: ProjectChange) => void,
): () => void {
  return api().project.onChange(handler);
}
