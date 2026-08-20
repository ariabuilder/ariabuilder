import type { CreateAstroOpts } from "../../shared/types"

export type { CreateAstroOpts, DialogOutcome, RecentProject } from "../../shared/types"

function api() {
  if (!window.aria) {
    throw new Error("Aria desktop bridge is unavailable");
  }
  return window.aria;
}

export function openProjectDialog() {
  return api().openProjectDialog();
}

export function pickNewProjectDir() {
  return api().pickNewProjectDir();
}

export function createAstroProject(opts: CreateAstroOpts) {
  return api().createAstroProject(opts);
}

export function cancelAstroProject(jobId?: string) {
  return api().cancelAstroProject(jobId);
}

export function listRecents() {
  return api().listRecents();
}

export function addRecent(projectPath: string) {
  return api().addRecent(projectPath);
}

export function removeRecent(projectPath: string) {
  return api().removeRecent(projectPath);
}

export function getAppVersion() {
  return api().getVersion();
}

export function openExternalUrl(url: string) {
  return api().openUrl(url);
}

export function openProjectWindow(projectPath: string) {
  return api().openProjectWindow(projectPath);
}

export function onCreateAstroLog(
  handler: (chunk: string) => void,
): Promise<() => void> {
  return Promise.resolve(api().onCreateAstroLog(handler));
}

export function onProjectCreationJob(
  handler: (job: import("../../shared/types").ProjectCreationJob) => void,
): Promise<() => void> {
  return Promise.resolve(api().onProjectCreationJob(handler))
}
