import { randomBytes } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isElectronRuntimeSource } from "./dev-supervisor.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

const port = process.env.VITE_DEV_SERVER_URL
  ? null
  : await freePort();
const url = process.env.VITE_DEV_SERVER_URL || `http://127.0.0.1:${port}/`;
const token = randomBytes(32).toString("hex");
const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: url,
  VITE_ARIA_RENDERER_TOKEN: token,
  ARIA_RENDERER_TOKEN: token,
};
const viteBin = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);

const vite = spawn(viteBin, [], {
  cwd: root,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
  detached: process.platform !== "win32",
});
let electron = null;
let shuttingDown = false;
let restartRequested = false;
let rebuildTimer = null;
let rebuildRunning = false;
let rebuildPending = false;
let desiredElectronGeneration = 0;
let finalExitResolve = null;
const electronWatchers = [];
const changedElectronPaths = new Set();

async function waitForVite() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited with code ${vite.exitCode}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 750);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok || response.status === 304) return;
    } catch {
      // Vite is still starting.
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for Vite at ${url}`);
}

function signalProcessTree(pid, signal) {
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/t", "/f"]);
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // It exited between the check and the signal.
    }
  }
}

function stopVite(signal = "SIGTERM") {
  if (vite.exitCode !== null || !vite.pid) return;
  signalProcessTree(vite.pid, signal);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function stopViteGracefully() {
  if (vite.exitCode !== null || vite.signalCode !== null || !vite.pid) return;
  stopVite("SIGINT");
  if (await waitForExit(vite, 3_000)) return;
  stopVite("SIGTERM");
  if (await waitForExit(vite, 2_000)) return;
  stopVite("SIGKILL");
  await waitForExit(vite, 1_000);
}

function stopElectron(signal = "SIGTERM") {
  if (!electron || electron.exitCode !== null || electron.signalCode !== null || !electron.pid) return;
  signalProcessTree(electron.pid, signal);
}

function launchElectron(generation = desiredElectronGeneration) {
  const child = spawn(process.execPath, [path.join(root, "scripts/start-electron.mjs")], {
    cwd: root,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  electron = child;
  console.log(`[aria:dev] Electron generation ${generation} launched (pid ${child.pid ?? "unknown"}).`);
  child.once("exit", (code, signal) => {
    if (electron === child) electron = null;
    const expectedRestart = !shuttingDown && (
      restartRequested || generation < desiredElectronGeneration
    );
    console.log(
      `[aria:dev] Electron generation ${generation} exited` +
      ` (${code === null ? signal ?? "signal" : `code ${code}`})` +
      `${expectedRestart ? "; relaunching." : "."}`,
    );
    if (expectedRestart) {
      restartRequested = false;
      launchElectron(desiredElectronGeneration);
      return;
    }
    finalExitResolve?.(code ?? (signal ? 1 : 0));
  });
}

function restartElectron() {
  if (shuttingDown) return;
  if (!electron) {
    launchElectron(desiredElectronGeneration);
    return;
  }
  if (restartRequested) return;
  restartRequested = true;
  stopElectron("SIGTERM");
}

function closeElectronWatchers() {
  for (const watcher of electronWatchers.splice(0)) watcher.close();
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = null;
}

function watchDirectoryTree(directory) {
  if (!fs.existsSync(directory)) return;
  const directories = [directory];
  for (let index = 0; index < directories.length; index += 1) {
    const current = directories[index];
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(path.join(current, entry.name));
    }
  }
  for (const current of directories) {
    const watcher = fs.watch(current, (_event, filename) => {
      if (!filename) return;
      const changedPath = path.join(current, String(filename));
      if (!isElectronRuntimeSource(changedPath)) return;
      scheduleElectronRebuild(changedPath);
    });
    electronWatchers.push(watcher);
  }
}

function startElectronWatchers() {
  closeElectronWatchers();
  watchDirectoryTree(path.join(root, "electron"));
  watchDirectoryTree(path.join(root, "shared"));
}

function scheduleElectronRebuild(changedPath) {
  if (shuttingDown) return;
  changedElectronPaths.add(path.relative(root, changedPath));
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    void rebuildElectron();
  }, 180);
}

async function rebuildElectron() {
  if (rebuildRunning) {
    rebuildPending = true;
    return;
  }
  rebuildRunning = true;
  let builtGeneration = desiredElectronGeneration;
  do {
    rebuildPending = false;
    const paths = [...changedElectronPaths].sort();
    changedElectronPaths.clear();
    const generation = builtGeneration + 1;
    console.log(
      `[aria:dev] Rebuilding Electron generation ${generation}` +
      `${paths.length ? ` for ${paths.join(", ")}` : ""}.`,
    );
    const succeeded = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [path.join(root, "scripts/build-electron.mjs")],
        { cwd: root, env, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (stdout) process.stdout.write(stdout);
          if (stderr) process.stderr.write(stderr);
          if (error) console.error("Electron rebuild failed; the running app was kept open.");
          resolve(!error);
        },
      );
    });
    if (succeeded) builtGeneration = generation;
  } while (rebuildPending && !shuttingDown);
  rebuildRunning = false;
  if (builtGeneration > desiredElectronGeneration) {
    desiredElectronGeneration = builtGeneration;
    console.log(`[aria:dev] Electron generation ${builtGeneration} is ready; restarting once.`);
    restartElectron();
  }
}

async function handleSignal() {
  if (shuttingDown) return;
  shuttingDown = true;
  closeElectronWatchers();
  stopElectron("SIGTERM");
  stopVite("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  stopElectron("SIGKILL");
  stopVite("SIGKILL");
  process.exit(1);
}

process.once("SIGINT", () => void handleSignal());
process.once("SIGTERM", () => void handleSignal());

try {
  await waitForVite();
  const finalExit = new Promise((resolve) => {
    finalExitResolve = resolve;
  });
  launchElectron();
  startElectronWatchers();
  const exitCode = await finalExit;
  shuttingDown = true;
  closeElectronWatchers();
  await stopViteGracefully();
  process.exitCode = exitCode;
} catch (error) {
  await stopViteGracefully();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
