import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
} from "node:fs";
import path from "node:path";
import { dialog, type BrowserWindow } from "./electron-api";
import { canonicalDirectory, writeTextFileAtomic } from "./pathSafety";
import { packageManagerEnv } from "./toolEnv";
import type { CreateAstroOpts, DialogOutcome, RecentProject } from "../shared/types";
import type { ProjectCreationJob } from "../shared/types";
import { seedAriaStarter } from "./starterSeed";

export type { CreateAstroOpts, DialogOutcome, RecentProject } from "../shared/types";

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
const approvedCreateDirs = new Set<string>();
const approvedOpenDirs = new Set<string>();
const creationChildren = new Set<ChildProcess>();
const cancelledCreationChildren = new Set<ChildProcess>();
type InternalCreationJob = ProjectCreationJob & {
  ownerId: number;
  child: ChildProcess | null;
  createdFiles: Map<string, string>;
};
const creationJobs = new Map<string, InternalCreationJob>();

export function isAstroProject(dir: string): boolean {
  const pkgPath = path.join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      if (pkg.dependencies?.astro || pkg.devDependencies?.astro) return true;
    } catch {
      // ignore invalid package.json
    }
  }
  return [
    "astro.config.mjs",
    "astro.config.ts",
    "astro.config.js",
    "astro.config.cjs",
    "astro.config.mts",
    "astro.config.cts",
  ].some(
    (name) => existsSync(path.join(dir, name)),
  );
}

function recentsPath(userData: string): string {
  mkdirSync(userData, { recursive: true });
  return path.join(userData, "recents.json");
}

function readRecents(file: string): RecentProject[] {
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as RecentProject[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    if (existsSync(file)) {
      try {
        renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        // A read-only profile should still return an empty list.
      }
    }
    return [];
  }
}

function writeRecents(file: string, list: RecentProject[]): void {
  writeTextFileAtomic(file, `${JSON.stringify(list, null, 2)}\n`);
}

function nowMs(): number {
  return Date.now();
}

const EMPTY_DIR_IGNORE = new Set([
  ".DS_Store",
  "desktop.ini",
  "Thumbs.db",
]);

function dirIsEmpty(dir: string): boolean {
  const entries = readdirSync(dir);
  return entries.every((name) => EMPTY_DIR_IGNORE.has(name));
}

function npmEnv(): NodeJS.ProcessEnv {
  return packageManagerEnv();
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "").replace(/\r/g, "\n");
}

function publicJob(job: InternalCreationJob): ProjectCreationJob {
  return {
    id: job.id,
    destination: job.destination,
    step: job.step,
    progress: job.progress,
    logs: job.logs,
    status: job.status,
    ...(job.error ? { error: job.error } : {}),
  };
}

function sendJob(win: BrowserWindow | null, job: InternalCreationJob): void {
  if (!win || win.isDestroyed()) return;
  try {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send("create-astro-job", publicJob(job));
    }
  } catch {
    // The wizard can close while npm is still flushing output.
  }
}

function sendLog(
  win: BrowserWindow | null,
  job: InternalCreationJob,
  chunk: string,
): void {
  const text = stripAnsi(chunk);
  if (!text) return;
  job.logs = `${job.logs}${text}`.slice(-20_000);
  sendJob(win, job);
  if (!win || win.isDestroyed()) return;
  try {
    if (!win.webContents.isDestroyed()) win.webContents.send("create-astro-log", text);
  } catch {
    // The wizard can close while npm is still flushing output.
  }
}

function snapshotCreatedFiles(directory: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (EMPTY_DIR_IGNORE.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(directory, absolute).split(path.sep).join("/");
      files.set(
        relative,
        createHash("sha256").update(readFileSync(absolute)).digest("hex"),
      );
    }
  };
  walk(directory);
  return files;
}

function cleanupRetryFiles(job: InternalCreationJob): void {
  const current = snapshotCreatedFiles(job.destination);
  const unsafe = [...current.entries()].some(
    ([file, hash]) => job.createdFiles.get(file) !== hash,
  );
  if (unsafe || current.size !== job.createdFiles.size) {
    throw new Error(
      "Aria cannot retry safely because files in the partial project changed. Open the partial project or choose another folder.",
    );
  }
  const directories = new Set<string>();
  for (const relative of job.createdFiles.keys()) {
    const absolute = path.join(job.destination, ...relative.split("/"));
    rmSync(absolute, { force: true });
    let directory = path.dirname(absolute);
    while (directory !== job.destination) {
      directories.add(directory);
      directory = path.dirname(directory);
    }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    try {
      rmdirSync(directory);
    } catch {
      // Keep directories containing user or platform files.
    }
  }
}

export async function openProjectDialog(
  win: BrowserWindow | null,
): Promise<DialogOutcome> {
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: "Open an Astro project",
        properties: ["openDirectory"],
      })
    : await dialog.showOpenDialog({
        title: "Open an Astro project",
        properties: ["openDirectory"],
      });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  const dir = result.filePaths[0];
  if (!isAstroProject(dir)) {
    return { canceled: false, error: "not_astro_project" };
  }
  const canonical = canonicalDirectory(dir);
  approvedOpenDirs.add(canonical);
  return { canceled: false, projectPath: canonical };
}

export async function pickNewProjectDir(
  win: BrowserWindow | null,
): Promise<DialogOutcome> {
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: "Choose an empty folder for the new project",
        properties: ["openDirectory", "createDirectory"],
      })
    : await dialog.showOpenDialog({
        title: "Choose an empty folder for the new project",
        properties: ["openDirectory", "createDirectory"],
      });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  const dir = canonicalDirectory(result.filePaths[0]);
  if (!dirIsEmpty(dir)) {
    return { canceled: false, error: "folder_not_empty" };
  }
  const canonical = canonicalDirectory(dir);
  approvedCreateDirs.add(canonical);
  return { canceled: false, projectPath: canonical };
}

export function listRecents(userData: string): RecentProject[] {
  const file = recentsPath(userData);
  const seen = new Set<string>();
  const list = readRecents(file).flatMap((r) => {
    try {
      if (
        !r ||
        typeof r !== "object" ||
        typeof r.path !== "string" ||
        typeof r.openedAt !== "number" ||
        !Number.isFinite(r.openedAt)
      ) return [];
      const projectPath = canonicalDirectory(r.path);
      if (seen.has(projectPath) || !isAstroProject(projectPath)) return [];
      seen.add(projectPath);
      return [{ ...r, path: projectPath, name: path.basename(projectPath) || projectPath }];
    } catch {
      return [];
    }
  }).slice(0, 12);
  writeRecents(file, list);
  return list;
}

export function isRecentProject(userData: string, projectPath: string): boolean {
  let canonical: string;
  try {
    canonical = canonicalDirectory(projectPath);
  } catch {
    return false;
  }
  return listRecents(userData).some((recent) => recent.path === canonical);
}

export function consumeApprovedProjectOpen(projectPath: string): boolean {
  const canonical = canonicalDirectory(projectPath);
  if (!approvedOpenDirs.has(canonical)) return false;
  approvedOpenDirs.delete(canonical);
  return true;
}

export function addRecent(userData: string, projectPath: string): void {
  const file = recentsPath(userData);
  const canonical = canonicalDirectory(projectPath);
  const list = readRecents(file).filter((r) => {
    try {
      return canonicalDirectory(r.path) !== canonical;
    } catch {
      return false;
    }
  });
  list.unshift({
    path: canonical,
    name: path.basename(canonical) || canonical,
    openedAt: nowMs(),
  });
  writeRecents(file, list.slice(0, 12));
}

export function removeRecent(userData: string, projectPath: string): void {
  const file = recentsPath(userData);
  let canonical: string;
  try {
    canonical = canonicalDirectory(projectPath);
  } catch {
    canonical = path.resolve(projectPath.trim());
  }
  writeRecents(
    file,
    readRecents(file).filter((r) => {
      try {
        return canonicalDirectory(r.path) !== canonical;
      } catch {
        return false;
      }
    }),
  );
}

export function createAstroProject(
  win: BrowserWindow | null,
  opts: CreateAstroOpts,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (
      !opts ||
      typeof opts !== "object" ||
      typeof opts.dir !== "string" ||
      typeof opts.template !== "string" ||
      typeof opts.install !== "boolean" ||
      typeof opts.git !== "boolean" ||
      typeof opts.ai !== "boolean"
    ) {
      reject(new Error("Invalid project creation options."));
      return;
    }
    const ownerId = win?.webContents.id ?? 0;
    const jobId =
      typeof opts.jobId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(opts.jobId)
        ? opts.jobId
        : randomUUID();
    let destination: string;
    try {
      destination = canonicalDirectory(opts.dir);
    } catch {
      reject(new Error("Choose a folder for the new project first."));
      return;
    }
    const retryJob =
      typeof opts.retryJobId === "string"
        ? creationJobs.get(opts.retryJobId)
        : undefined;
    if (retryJob) {
      if (
        retryJob.ownerId !== ownerId ||
        retryJob.destination !== destination ||
        (retryJob.status !== "failed" && retryJob.status !== "canceled")
      ) {
        reject(new Error("This partial project cannot be retried from this window."));
        return;
      }
      try {
        cleanupRetryFiles(retryJob);
        approvedCreateDirs.add(destination);
      } catch (error) {
        reject(error);
        return;
      }
    }
    if (!approvedCreateDirs.has(destination)) {
      reject(new Error("Choose the project folder through Aria first."));
      return;
    }
    if (!dirIsEmpty(destination)) {
      reject(new Error("The project folder must be empty."));
      return;
    }
    if (!existsSync(destination)) {
      reject(new Error("Choose a folder for the new project first."));
      return;
    }

    const useAriaStarter = opts.template === "aria";
    const template = ["basics", "blog", "starlight", "minimal"].includes(
      opts.template,
    )
      ? opts.template
      : useAriaStarter
        ? "minimal"
        : "basics";

    const job: InternalCreationJob = {
      id: jobId,
      ownerId,
      destination,
      step: "Creating Astro project",
      progress: 0.05,
      logs: "",
      status: "running",
      child: null,
      createdFiles: new Map(),
    };
    creationJobs.set(job.id, job);
    sendJob(win, job);

    const args = [
      "create",
      "astro@latest",
      ".",
      "--",
      "--template",
      template,
      opts.install ? "--install" : "--no-install",
      opts.git ? "--git" : "--no-git",
    ];
    if (!opts.ai) args.push("--no-ai");
    args.push("--skip-houston", "--yes");

    sendLog(win, job, `> npm ${args.join(" ")}\n\n`);

    const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npmBin, args, {
      cwd: destination,
      env: npmEnv(),
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
    });
    creationChildren.add(child);
    job.child = child;
    let settled = false;

    child.stdout?.on("data", (buf: Buffer) => {
      sendLog(win, job, buf.toString("utf8"));
    });
    child.stderr?.on("data", (buf: Buffer) => {
      sendLog(win, job, buf.toString("utf8"));
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      creationChildren.delete(child);
      job.child = null;
      const cancelled = cancelledCreationChildren.delete(child);
      approvedCreateDirs.delete(destination);
      if (cancelled) {
        job.status = "canceled";
        job.step = "Canceled";
        job.error = "Project creation canceled.";
        job.createdFiles = snapshotCreatedFiles(destination);
        sendJob(win, job);
        reject(new Error("Project creation canceled."));
        return;
      }
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        job.status = "failed";
        job.step = "Creation failed";
        job.error = "npm could not be found. Install Node.js and try again.";
        job.createdFiles = snapshotCreatedFiles(destination);
        sendJob(win, job);
        reject(
          new Error(
            "npm could not be found. Install Node.js (which includes npm) and try again.",
          ),
        );
        return;
      }
      job.status = "failed";
      job.step = "Creation failed";
      job.error = `Could not run npm: ${err.message}`;
      job.createdFiles = snapshotCreatedFiles(destination);
      sendJob(win, job);
      reject(new Error(`Could not run npm: ${err.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      void (async () => {
      creationChildren.delete(child);
      job.child = null;
      const cancelled = cancelledCreationChildren.delete(child);
      if (cancelled) {
        approvedCreateDirs.delete(destination);
        job.status = "canceled";
        job.step = "Canceled";
        job.error = "Project creation canceled.";
        job.createdFiles = snapshotCreatedFiles(destination);
        sendJob(win, job);
        reject(new Error("Project creation canceled."));
        return;
      }
      if (code !== 0) {
        approvedCreateDirs.delete(destination);
        job.status = "failed";
        job.step = "Creation failed";
        job.error = `create-astro exited with code ${code ?? -1}.`;
        job.createdFiles = snapshotCreatedFiles(destination);
        sendJob(win, job);
        reject(new Error(`create-astro exited with code ${code ?? -1}.`));
        return;
      }
      approvedCreateDirs.delete(destination);
      if (!existsSync(path.join(destination, "package.json"))) {
        job.status = "failed";
        job.step = "Creation failed";
        job.error = "create-astro finished but no package.json appeared.";
        job.createdFiles = snapshotCreatedFiles(destination);
        sendJob(win, job);
        reject(
          new Error("create-astro finished but no package.json appeared."),
        );
        return;
      }
      if (useAriaStarter) {
        job.step = "Applying Aria starter";
        job.progress = 0.75;
        sendJob(win, job);
        await seedAriaStarter(destination, (step, total, label) => {
          job.step = label;
          job.progress = 0.75 + (step / total) * 0.24;
          sendLog(win, job, `\n${label}…\n`);
        });
      }
      approvedOpenDirs.add(destination);
      job.status = "succeeded";
      job.step = "Project ready";
      job.progress = 1;
      delete job.error;
      sendJob(win, job);
      resolve();
      })().catch((error: unknown) => {
        job.status = "failed";
        job.step = "Starter setup failed";
        job.error = error instanceof Error ? error.message : String(error);
        job.createdFiles = snapshotCreatedFiles(destination);
        sendJob(win, job);
        reject(error);
      });
    });
  });
}

/** Stop any npm process still running while the creation wizard/app is closing. */
export async function stopProjectCreationJobs(): Promise<void> {
  const children = [...creationChildren];
  for (const child of children) cancelledCreationChildren.add(child);
  await Promise.all(
    children.map(
      (child) => terminateCreationChild(child),
    ),
  );
  for (const child of [...cancelledCreationChildren]) {
    if (!creationChildren.has(child)) cancelledCreationChildren.delete(child);
  }
  approvedCreateDirs.clear();
  approvedOpenDirs.clear();
}

export async function cancelProjectCreation(
  jobId?: string,
  ownerId?: number,
): Promise<void> {
  const jobs = typeof jobId === "string"
    ? [creationJobs.get(jobId)].filter((job): job is InternalCreationJob => Boolean(job))
    : [...creationJobs.values()].filter(
        (job) => job.status === "running" && (ownerId === undefined || job.ownerId === ownerId),
      );
  for (const job of jobs) {
    if (ownerId !== undefined && job.ownerId !== ownerId) continue;
    if (!job.child || job.status !== "running") continue;
    cancelledCreationChildren.add(job.child);
    await terminateCreationChild(job.child);
  }
}

async function terminateCreationChild(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return;

  const leaderGone = child.exitCode !== null || child.signalCode !== null;
  // The npm leader can exit while install-script descendants remain in its
  // process group. Always signal the group when we still know the pid.
  if (leaderGone) {
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        execFile("taskkill", ["/pid", String(pid), "/t", "/f"], () => resolve());
      });
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // The process group is already gone.
      }
    }
    return;
  }

  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile("taskkill", ["/pid", String(pid), "/t", "/f"], () => resolve());
    });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        execFile("taskkill", ["/pid", String(pid), "/t", "/f"], () => resolve());
      });
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))]);
  } else if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // The process group is already gone.
    }
  }
}
