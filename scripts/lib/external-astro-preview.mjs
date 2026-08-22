import { execFile, spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isProcessGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch {
    return false;
  }
}

export function readinessRequestTimeout(deadline, now = Date.now()) {
  return Math.min(2_500, Math.max(1, deadline - now));
}

async function waitForTermination(isAlive, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (isAlive()) {
    throw new Error(`${label} did not stop within ${timeoutMs}ms.`);
  }
}

export async function stopProcessTree(child) {
  if (!child?.pid) return;
  const pid = child.pid;
  if (process.platform === "win32") {
    if (!isPidAlive(pid)) return;
    await new Promise((resolve) => {
      execFile("taskkill", ["/pid", String(pid), "/t", "/f"], () => resolve());
    });
    await waitForTermination(() => isPidAlive(pid), `Process ${pid}`);
  } else {
    const processGroupId = child.processGroupId ?? pid;
    try {
      process.kill(-processGroupId, "SIGKILL");
      await waitForTermination(
        () => isProcessGroupAlive(processGroupId),
        `Process group ${processGroupId}`,
      );
      await waitForTermination(() => isPidAlive(pid), `Process ${pid}`);
      return;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH")) {
        throw error;
      }
    }
    if (!isPidAlive(pid)) return;
    if (typeof child.kill === "function") child.kill("SIGKILL");
    else process.kill(pid, "SIGKILL");
    await waitForTermination(() => isPidAlive(pid), `Process ${pid}`);
  }
}

export async function startExternalAstroPreview(project, timeoutMs = 30_000) {
  const lockFile = path.join(project, ".astro", "dev.json");
  try {
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    if (typeof lock.pid === "number" && isPidAlive(lock.pid)) {
      throw new Error(`Fixture already has a live Astro preview at PID ${lock.pid}`);
    }
    rmSync(lockFile, { force: true });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Fixture already")) throw error;
  }

  const astroPackageRoot = path.join(project, "node_modules", "astro");
  const astroPackage = JSON.parse(readFileSync(path.join(astroPackageRoot, "package.json"), "utf8"));
  const astroBin = typeof astroPackage.bin === "string" ? astroPackage.bin : astroPackage.bin?.astro;
  if (typeof astroBin !== "string" || !astroBin) {
    throw new Error("The fixture's Astro package has no CLI entry.");
  }
  const astroEntry = path.resolve(astroPackageRoot, astroBin);
  const child = spawn(process.execPath, [
    astroEntry,
    "dev",
    "--host",
    "127.0.0.1",
    "--clear-screen",
    "false",
  ], {
    cwd: project,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  if (process.platform !== "win32") child.processGroupId = child.pid;
  let output = "";
  child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const lock = JSON.parse(readFileSync(lockFile, "utf8"));
      if (
        typeof lock.pid === "number" &&
        isPidAlive(lock.pid) &&
        typeof lock.url === "string"
      ) {
        const response = await fetch(lock.url, {
          signal: AbortSignal.timeout(readinessRequestTimeout(deadline)),
        });
        if (response.ok) {
          return {
            child: lock.pid === child.pid
              ? child
              : { pid: lock.pid, processGroupId: child.processGroupId },
            url: lock.url,
          };
        }
      }
    } catch {}
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(`External Astro preview stopped with code ${child.exitCode}.\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await stopProcessTree(child);
  throw new Error(`External Astro preview did not become ready.\n${output}`);
}
