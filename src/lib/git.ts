import type { GitDiffResult, GitStatus } from "../../shared/types";

export type { GitDiffResult, GitFileChange, GitStatus } from "../../shared/types";

function api() {
  if (!window.aria?.git) {
    throw new Error("Aria desktop bridge is unavailable");
  }
  return window.aria.git;
}

export function getGitStatus(projectPath: string): Promise<GitStatus> {
  return api().status(projectPath);
}

export function commitGit(
  projectPath: string,
  message: string,
): Promise<GitStatus> {
  return api().commit(projectPath, message);
}

export function pushGit(projectPath: string): Promise<GitStatus> {
  return api().push(projectPath);
}

export function listGitBranches(projectPath: string): Promise<string[]> {
  return api().listBranches(projectPath);
}

export function checkoutGitBranch(
  projectPath: string,
  branch: string,
): Promise<GitStatus> {
  return api().checkout(projectPath, branch);
}

export function createGitBranch(
  projectPath: string,
  branch: string,
): Promise<GitStatus> {
  return api().createBranch(projectPath, branch);
}

export function initGitRepo(projectPath: string): Promise<GitStatus> {
  return api().init(projectPath);
}

export function diffGitFile(
  projectPath: string,
  filePath: string,
): Promise<GitDiffResult> {
  return api().diffFile(projectPath, filePath);
}
