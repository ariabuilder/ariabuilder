import { once } from "node:events";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  isPidAlive,
  readinessRequestTimeout,
  stopProcessTree,
} from "./lib/external-astro-preview.mjs";

async function spawnPosixProcessGroup(exitLauncher) {
  const launcher = spawn(process.execPath, ["-e", `
    const { spawn } = require("node:child_process");
    const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    console.log(descendant.pid);
    ${exitLauncher ? "descendant.unref();" : "setInterval(() => {}, 1000);"}
  `], {
    stdio: ["ignore", "pipe", "ignore"],
    detached: true,
    windowsHide: true,
  });
  launcher.processGroupId = launcher.pid;
  const exited = once(launcher, "exit");
  const [chunk] = await once(launcher.stdout, "data");
  const descendantPid = Number.parseInt(chunk.toString().trim(), 10);
  if (!Number.isInteger(descendantPid)) throw new Error("Launcher did not report its descendant PID");
  if (exitLauncher) await exited;
  return { descendantPid, launcher };
}

describe("external Astro preview smoke helpers", () => {
  it("bounds each readiness request by the per-request and overall deadlines", () => {
    expect(readinessRequestTimeout(10_000, 5_000)).toBe(2_500);
    expect(readinessRequestTimeout(6_200, 5_000)).toBe(1_200);
    expect(readinessRequestTimeout(4_000, 5_000)).toBe(1);
  });

  it("waits for a spawned process tree to stop", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      await stopProcessTree(child);
      expect(isPidAlive(child.pid)).toBe(false);
    } finally {
      if (isPidAlive(child.pid)) child.kill("SIGKILL");
    }
  });

  it.skipIf(process.platform === "win32")(
    "stops a POSIX process group while its launcher is alive",
    async () => {
      const { descendantPid, launcher } = await spawnPosixProcessGroup(false);
      try {
        await stopProcessTree(launcher);
        expect(isPidAlive(launcher.pid)).toBe(false);
        expect(isPidAlive(descendantPid)).toBe(false);
      } finally {
        if (isPidAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "stops POSIX descendants after the launcher exits",
    async () => {
      const { descendantPid, launcher } = await spawnPosixProcessGroup(true);
      expect(isPidAlive(launcher.pid)).toBe(false);
      try {
        await stopProcessTree(launcher);
        expect(isPidAlive(descendantPid)).toBe(false);
      } finally {
        if (isPidAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
      }
    },
  );

  it("keeps generated marker state out of installed fixtures", () => {
    const source = readFileSync(new URL("./smoke-installed.mjs", import.meta.url), "utf8");
    expect(source).toContain('"node_modules/.aria"');
  });

  it("derives the runtime smoke health route from the shared protocol", () => {
    const source = readFileSync(new URL("./smoke-runtime.mjs", import.meta.url), "utf8");
    expect(source).toContain("ARIA_BRIDGE_HEALTH_PATH\\s*=\\s*");
    expect(source).toContain("JSON.stringify(bridgeHealthPath)");
    expect(source).not.toContain("req.url === '/__aria/bridge-health'");
  });
});
