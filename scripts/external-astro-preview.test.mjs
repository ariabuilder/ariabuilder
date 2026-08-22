import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  isPidAlive,
  readinessRequestTimeout,
  stopProcessTree,
} from "./lib/external-astro-preview.mjs";

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
