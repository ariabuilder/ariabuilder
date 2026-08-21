import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { GitDiffResult, GitFileChange, GitStatus } from "../shared/types";
import { projectProcessEnv } from "./toolEnv";

export type { GitDiffResult, GitFileChange, GitStatus } from "../shared/types";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const DIFF_MAX_CHARS = 200_000;

function emptyStatus(partial?: Partial<GitStatus>): GitStatus {
  return {
    isRepo: false,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    dirty: false,
    error: null,
    ...partial,
  };
}

function hasGitDir(root: string): boolean {
  try {
    const gitPath = path.join(root, ".git");
    const st = fs.statSync(gitPath);
    return st.isDirectory() || st.isFile();
  } catch {
    return false;
  }
}

async function git(
  root: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: root,
      env: projectProcessEnv(),
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return {
      stdout: typeof stdout === "string" ? stdout : String(stdout),
      stderr: typeof stderr === "string" ? stderr : String(stderr),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
    };
    const stderr =
      typeof err.stderr === "string"
        ? err.stderr
        : err.stderr
          ? String(err.stderr)
          : err.message;
    const stdout =
      typeof err.stdout === "string"
        ? err.stdout
        : err.stdout
          ? String(err.stdout)
          : "";
    // `git status` exits 0 always when repo is valid; other commands may fail.
    const wrapped = new Error(stderr.trim() || err.message || "git failed");
    (wrapped as Error & { stdout?: string; stderr?: string }).stdout = stdout;
    (wrapped as Error & { stdout?: string; stderr?: string }).stderr = stderr;
    throw wrapped;
  }
}

/** Pure porcelain parser — exported for smoke tests. */
export function parsePorcelainStatus(text: string): Omit<
  GitStatus,
  "isRepo" | "error"
> {
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  const untracked: GitFileChange[] = [];
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;

  const records = text.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;

    if (record.startsWith("## ")) {
      const header = record.slice(3).trim();
      const aheadMatch = header.match(/\[ahead (\d+)/);
      const behindMatch = header.match(/behind (\d+)/);
      if (aheadMatch) ahead = Number(aheadMatch[1]) || 0;
      if (behindMatch) behind = Number(behindMatch[1]) || 0;

      const withoutCounts = header.replace(/\s*\[.*\]\s*$/, "");
      if (withoutCounts === "HEAD (no branch)") {
        branch = "HEAD";
        upstream = null;
      } else {
        const dots = withoutCounts.indexOf("...");
        if (dots >= 0) {
          branch = withoutCounts.slice(0, dots) || null;
          upstream = withoutCounts.slice(dots + 3) || null;
        } else {
          branch = withoutCounts || null;
          upstream = null;
        }
      }
      continue;
    }

    const code = record.slice(0, 2);
    const filePath = record.slice(3);
    if (!filePath) continue;

    // With `-z`, rename/copy records contain the destination first and the
    // original path in the following NUL-delimited field. Keep the destination.
    if (code.includes("R") || code.includes("C")) index += 1;

    const entry: GitFileChange = { path: filePath, code };

    if (code === "??") {
      untracked.push(entry);
      continue;
    }

    const indexStatus = code[0] ?? " ";
    const worktreeStatus = code[1] ?? " ";
    if (indexStatus !== " " && indexStatus !== "?") staged.push(entry);
    if (worktreeStatus !== " " && worktreeStatus !== "?") unstaged.push(entry);
  }

  return {
    branch,
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    dirty: staged.length + unstaged.length + untracked.length > 0,
  };
}

export async function getGitStatus(root: string): Promise<GitStatus> {
  if (!hasGitDir(root)) return emptyStatus({ isRepo: false });

  try {
    const { stdout } = await git(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "-b",
      "--untracked-files=all",
    ]);
    return {
      isRepo: true,
      error: null,
      ...parsePorcelainStatus(stdout),
    };
  } catch (error) {
    return emptyStatus({
      isRepo: true,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function commitAll(
  root: string,
  message: string,
): Promise<GitStatus> {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("Commit message is required");
  if (!hasGitDir(root)) throw new Error("Not a git repository");

  const before = await getGitStatus(root);
  if (before.error) throw new Error(before.error);
  if (!before.dirty) throw new Error("Nothing to commit");

  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-m", trimmed]);
  return getGitStatus(root);
}

export async function pushUpstream(root: string): Promise<GitStatus> {
  if (!hasGitDir(root)) throw new Error("Not a git repository");
  const before = await getGitStatus(root);
  if (before.error) throw new Error(before.error);
  if (!before.upstream) {
    throw new Error("No upstream branch configured. Set an upstream before pushing.");
  }
  await git(root, ["push"]);
  return getGitStatus(root);
}

export async function listBranches(root: string): Promise<string[]> {
  if (!hasGitDir(root)) return [];
  try {
    const { stdout } = await git(root, [
      "branch",
      "--format=%(refname:short)",
    ]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function mapCheckoutError(detail: string, branch: string): Error {
  if (
    /would be overwritten|Please commit your changes|overwritten by checkout/i.test(
      detail,
    )
  ) {
    return new Error("Commit changes before switching branches");
  }
  return new Error(detail.trim() || `Could not switch to "${branch}"`);
}

export function normalizeBranchName(branch: string): string {
  const name = branch.trim();
  if (!name) throw new Error("Branch name is required");
  if (name.startsWith("-")) {
    throw new Error('Branch names cannot start with "-"');
  }
  return name;
}

export async function checkoutBranch(
  root: string,
  branch: string,
): Promise<GitStatus> {
  const name = normalizeBranchName(branch);
  if (!hasGitDir(root)) throw new Error("Not a git repository");
  try {
    await git(root, ["checkout", name]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw mapCheckoutError(detail, name);
  }
  return getGitStatus(root);
}

export async function createBranch(
  root: string,
  branch: string,
): Promise<GitStatus> {
  const name = normalizeBranchName(branch);
  if (!hasGitDir(root)) throw new Error("Not a git repository");
  try {
    await git(root, ["checkout", "-b", name]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw mapCheckoutError(detail, name);
  }
  return getGitStatus(root);
}

export async function initRepo(root: string): Promise<GitStatus> {
  if (hasGitDir(root)) {
    return getGitStatus(root);
  }
  await git(root, ["init", "-b", "main"]);
  return getGitStatus(root);
}

function truncateDiff(text: string): { text: string; truncated: boolean } {
  if (text.length <= DIFF_MAX_CHARS) return { text, truncated: false };
  return {
    text: `${text.slice(0, DIFF_MAX_CHARS)}\n\n… truncated`,
    truncated: true,
  };
}

/** Capture stdout even when git exits non-zero (diff / --no-index). */
async function gitDiffOutput(
  root: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await git(root, args);
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    const stdout = err.stdout ?? "";
    const stderr = err.stderr ?? err.message;
    if (stdout.trim()) return { stdout, stderr };
    throw error;
  }
}

export async function diffFile(
  root: string,
  filePath: string,
): Promise<GitDiffResult> {
  const relative = filePath.trim().replace(/\\/g, "/");
  if (!relative) throw new Error("File path is required");
  if (!hasGitDir(root)) throw new Error("Not a git repository");

  const status = await getGitStatus(root);
  const isUntracked = status.untracked.some((f) => f.path === relative);

  let stdout = "";
  let stderr = "";

  if (isUntracked) {
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    try {
      const result = await gitDiffOutput(root, [
        "diff",
        "--no-index",
        "--",
        nullDevice,
        relative,
      ]);
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/Binary files/i.test(detail)) {
        return { path: relative, text: "", binary: true, truncated: false };
      }
      throw error;
    }
  } else {
    const result = await gitDiffOutput(root, ["diff", "HEAD", "--", relative]);
    stdout = result.stdout;
    stderr = result.stderr;
  }

  if (/Binary files/i.test(stdout) || /Binary files/i.test(stderr)) {
    return { path: relative, text: "", binary: true, truncated: false };
  }

  const { text, truncated } = truncateDiff(stdout);
  return { path: relative, text, binary: false, truncated };
}
