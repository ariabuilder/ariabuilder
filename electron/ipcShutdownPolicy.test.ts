import { describe, expect, it } from "vitest";
import { shouldRejectIpcDuringShutdown } from "./ipcShutdownPolicy";

describe("IPC shutdown policy", () => {
  it("allows trusted idempotent cleanup without reopening general IPC", () => {
    expect(shouldRejectIpcDuringShutdown(true, "thumbs:cancelWarm", true)).toBe(false);
    expect(shouldRejectIpcDuringShutdown(true, "sessions:start")).toBe(true);
    expect(shouldRejectIpcDuringShutdown(false, "sessions:start")).toBe(false);
  });
});

