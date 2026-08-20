/**
 * Packaged boot/IPC and optional real-project smoke.
 *
 * Verifies: packaged binary launches, preload exposes window.aria, and
 * getVersion / sessions.list IPC round-trips succeed against an isolated
 * userData directory. With ARIA_SMOKE_OPEN, it also seeds trust, opens the
 * fixture, starts Astro, and loads a real route.
 * Close any running Aria instance first; Electron's single-instance lock
 * is process-wide and is not bypassed by --user-data-dir.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLegalResources } from "./legal-resources.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates =
  process.platform === "darwin"
    ? [
        path.join(root, "release", `mac-${process.arch}`, "Aria.app", "Contents", "MacOS", "Aria"),
        path.join(root, "release", "mac", "Aria.app", "Contents", "MacOS", "Aria"),
      ]
    : process.platform === "win32"
      ? [path.join(root, "release", "win-unpacked", "Aria.exe")]
      : [
          path.join(root, "release", "linux-unpacked", "aria-app"),
          path.join(root, "release", "linux-unpacked", "aria"),
        ];
const executable = process.env.ARIA_PACKAGED_EXECUTABLE
  ? path.resolve(process.env.ARIA_PACKAGED_EXECUTABLE)
  : candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];

if (!existsSync(executable)) {
  throw new Error(`Packaged executable not found: ${executable}. Run npm run build first.`);
}

const resourcesDir = process.env.ARIA_PACKAGED_RESOURCES_DIR
  ? path.resolve(process.env.ARIA_PACKAGED_RESOURCES_DIR)
  : process.platform === "darwin"
    ? path.resolve(path.dirname(executable), "..", "Resources")
    : path.join(path.dirname(executable), "resources");
assertLegalResources(resourcesDir);

const userData = mkdtempSync(path.join(tmpdir(), "aria-packaged-smoke-"));
// CI Linux runners cannot setuid chrome-sandbox; Electron aborts without --no-sandbox.
const args = [`--user-data-dir=${userData}`];
if (process.platform === "linux" && process.env.ARIA_SMOKE_ALLOW_NO_SANDBOX === "1") {
  args.push("--no-sandbox");
}
if (process.platform === "linux" && process.env.ARIA_SMOKE_OZONE_PLATFORM) {
  const ozonePlatform = process.env.ARIA_SMOKE_OZONE_PLATFORM;
  if (!new Set(["wayland", "x11"]).has(ozonePlatform)) {
    throw new Error(`Unsupported smoke Ozone platform: ${ozonePlatform}`);
  }
  args.push(`--ozone-platform=${ozonePlatform}`);
}
const child = spawn(executable, args, {
  env: (() => {
    const env = { ...process.env, ARIA_SMOKE_RENDERER: "1" };
    delete env.ARIA_SMOKE_IPC;
    if (!process.env.ARIA_SMOKE_OPEN) delete env.ARIA_SMOKE_OPEN;
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
  })(),
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout?.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr?.on("data", (chunk) => {
  output += chunk.toString();
});

function killSmokeChild() {
  if (!child.pid) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], () => undefined);
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Already gone.
  }
}

let exitCode;
try {
  exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      killSmokeChild();
      reject(new Error("Packaged smoke test timed out"));
    }, process.env.ARIA_SMOKE_OPEN ? 120_000 : 30_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
} finally {
  killSmokeChild();
  // Let Electron release locks on the temp userData directory.
  await new Promise((resolve) => setTimeout(resolve, 250));
  rmSync(userData, { recursive: true, force: true });
}

const expectedMarker = process.env.ARIA_SMOKE_OPEN
  ? "ARIA_SMOKE_OPEN_OK"
  : "ARIA_SMOKE_RENDERER_OK";
if (exitCode !== 0 || !output.includes(expectedMarker)) {
  if (output.includes("ARIA_SMOKE_FAIL another Aria instance")) {
    throw new Error(
      `Packaged smoke failed: another Aria instance is running (single-instance lock).\n${output}`,
    );
  }
  throw new Error(`Packaged smoke test failed (${exitCode}):\n${output}`);
}
console.log("smoke-packaged: ok (legal resources + boot + IPC)");
