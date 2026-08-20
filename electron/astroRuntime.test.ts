import { describe, expect, it } from "vitest";
import {
  isAriaRuntimeCommand,
  shouldTerminateRuntimeProcess,
} from "./astroRuntime";

describe("Astro runtime ownership", () => {
  it("terminates only Aria-spawned processes", () => {
    expect(shouldTerminateRuntimeProcess("spawned")).toBe(true);
    expect(shouldTerminateRuntimeProcess("observed")).toBe(false);
  });

  it("recognizes legacy Aria marker-config launches without claiming normal Astro", () => {
    expect(isAriaRuntimeCommand(
      "electron node_modules/astro/astro.js dev --config node_modules/.aria/astro.config.mjs",
    )).toBe(true);
    expect(isAriaRuntimeCommand("node_modules/.bin/astro dev")).toBe(false);
  });
});
