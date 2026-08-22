import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { packageManagerEnv } from "./toolEnv";
import {
  afterTrackedMutation,
  beforeTrackedMutation,
} from "./mutationTracking";

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
const LOG_LIMIT = 120;

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type InstallCommand = {
  manager: PackageManager;
  command: string;
  args: string[];
};

export type PackageMutationCommand = InstallCommand & {
  action: "add" | "remove";
};

type InstallRun = {
  child: ChildProcess;
  cancelled: boolean;
};

const installs = new Map<string, InstallRun>();

export function hasNodeModules(root: string): boolean {
  try {
    return fs.statSync(path.join(root, "node_modules")).isDirectory();
  } catch {
    return false;
  }
}

export function resolveInstallCommand(root: string): InstallCommand {
  const win = process.platform === "win32";
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) {
    return {
      manager: "pnpm",
      command: win ? "pnpm.cmd" : "pnpm",
      args: ["install"],
    };
  }
  if (fs.existsSync(path.join(root, "yarn.lock"))) {
    return {
      manager: "yarn",
      command: win ? "yarn.cmd" : "yarn",
      args: ["install"],
    };
  }
  if (
    fs.existsSync(path.join(root, "bun.lock")) ||
    fs.existsSync(path.join(root, "bun.lockb"))
  ) {
    return {
      manager: "bun",
      command: win ? "bun.cmd" : "bun",
      args: ["install"],
    };
  }
  return {
    manager: "npm",
    command: win ? "npm.cmd" : "npm",
    args: ["install"],
  };
}

export function resolvePackageMutationCommand(
  root: string,
  action: "add" | "remove",
  packages: readonly string[],
): PackageMutationCommand {
  if (!packages.length) throw new Error("At least one package is required.");
  const { manager, command } = resolveInstallCommand(root);
  const args = action === "add"
    ? manager === "npm"
      ? ["install", "--save-dev", ...packages]
      : manager === "pnpm"
        ? ["add", "--save-dev", ...packages]
        : ["add", "--dev", ...packages]
    : manager === "npm"
      ? ["uninstall", ...packages]
      : ["remove", ...packages];
  return { manager, command, args, action };
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "").replace(/\r/g, "\n");
}

function toolMissingMessage(manager: PackageManager): string {
  switch (manager) {
    case "pnpm":
      return "pnpm could not be found. Install pnpm (or enable Corepack) and try again.";
    case "yarn":
      return "yarn could not be found. Install Yarn (or enable Corepack) and try again.";
    case "bun":
      return "bun could not be found. Install Bun and try again.";
    default:
      return "npm could not be found. Install Node.js (which includes npm) and try again.";
  }
}

async function terminateInstallChild(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return;

  const leaderGone = child.exitCode !== null || child.signalCode !== null;
  if (leaderGone) {
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        execFile("taskkill", ["/pid", String(pid), "/t", "/f"], () => resolve());
      });
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Process group already gone.
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
    const timedOut = await Promise.race([
      exited.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 3_000)),
    ]);
    if (timedOut) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  }
  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

/** Kill any in-flight install for this project (session close / stopAll). */
export async function cancelInstall(root: string): Promise<void> {
  const run = installs.get(root);
  if (!run) return;
  run.cancelled = true;
  await terminateInstallChild(run.child);
  if (installs.get(root) === run) installs.delete(root);
}

export async function cancelAllInstalls(): Promise<void> {
  await Promise.all([...installs.keys()].map((root) => cancelInstall(root)));
}

/**
 * Spawn package-manager install in `root`. Streams cleaned log chunks via
 * `onLog`. Resolves on exit 0; rejects on failure / cancel / missing tool.
 */
export function runProjectInstall(
  root: string,
  onLog: (chunk: string) => void,
): Promise<void> {
  if (installs.has(root)) {
    return Promise.reject(new Error("Dependencies are already installing."));
  }

  const { manager, command, args } = resolveInstallCommand(root);
  onLog(`> ${manager} ${args.join(" ")}\n\n`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: packageManagerEnv(),
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    const run: InstallRun = { child, cancelled: false };
    installs.set(root, run);

    const append = (buf: Buffer) => {
      const text = stripAnsi(buf.toString("utf8"));
      if (text) onLog(text);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    child.on("error", (err) => {
      if (installs.get(root) === run) installs.delete(root);
      if (run.cancelled) {
        reject(new Error("Dependency install canceled."));
        return;
      }
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(toolMissingMessage(manager)));
        return;
      }
      reject(new Error(`Could not run ${manager}: ${err.message}`));
    });

    child.on("close", (code) => {
      if (installs.get(root) === run) installs.delete(root);
      if (run.cancelled) {
        reject(new Error("Dependency install canceled."));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `${manager} install failed${code === null ? "" : ` with code ${code}`}.`,
          ),
        );
        return;
      }
      if (!hasNodeModules(root)) {
        reject(
          new Error(
            "Install finished but node_modules is still missing. Check the install log.",
          ),
        );
        return;
      }
      resolve();
    });
  });
}

const PACKAGE_MUTATION_FILES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

/** Add or remove project packages while Project History captures manifest and lockfile writes. */
export function runProjectPackageMutation(
  root: string,
  action: "add" | "remove",
  packages: readonly string[],
  onLog: (chunk: string) => void,
): Promise<void> {
  if (installs.has(root)) {
    return Promise.reject(new Error("Dependencies are already changing."));
  }
  const { manager, command, args } = resolvePackageMutationCommand(
    root,
    action,
    packages,
  );
  const tracked = PACKAGE_MUTATION_FILES.map((name) => path.join(root, name));
  for (const file of tracked) beforeTrackedMutation(file);
  onLog(`> ${manager} ${args.join(" ")}\n\n`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: packageManagerEnv(),
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const run: InstallRun = { child, cancelled: false };
    installs.set(root, run);
    let settled = false;
    const finishTracking = () => {
      for (const file of tracked) afterTrackedMutation(file);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      finishTracking();
      reject(error);
    };
    const append = (buf: Buffer) => {
      const text = stripAnsi(buf.toString("utf8"));
      if (text) onLog(text);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (error) => {
      if (installs.get(root) === run) installs.delete(root);
      if (run.cancelled) return fail(new Error("Dependency change canceled."));
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return fail(new Error(toolMissingMessage(manager)));
      }
      fail(new Error(`Could not run ${manager}: ${error.message}`));
    });
    child.on("close", (code) => {
      if (installs.get(root) === run) installs.delete(root);
      if (run.cancelled) return fail(new Error("Dependency change canceled."));
      if (code !== 0) {
        return fail(new Error(
          `${manager} ${action} failed${code === null ? "" : ` with code ${code}`}.`,
        ));
      }
      if (settled) return;
      settled = true;
      finishTracking();
      resolve();
    });
  });
}

export function trimInstallLogs(logs: string[], chunk: string): string[] {
  const next = [...logs, ...chunk.split("\n").filter(Boolean)];
  if (next.length > LOG_LIMIT) next.splice(0, next.length - LOG_LIMIT);
  return next;
}
