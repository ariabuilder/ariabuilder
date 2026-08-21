import { describe, expect, it } from "vitest";
import {
  astroCliSupportsIgnoreLock,
  commandBelongsToProjectAstro,
  externalPreviewMatchesLock,
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

  it("detects parallel-preview support from the project-local Astro CLI", () => {
    expect(astroCliSupportsIgnoreLock("tests/fixtures/astro-smoke")).toBe(true);
  });

  it("requires the observed process command to use this project's Astro entry", () => {
    expect(commandBelongsToProjectAstro(
      'node "/project/node_modules/astro/astro.js" dev',
      "/project/node_modules/astro/astro.js",
    )).toBe(true);
    expect(commandBelongsToProjectAstro(
      'node "/other/node_modules/astro/astro.js" dev',
      "/project/node_modules/astro/astro.js",
    )).toBe(false);
  });

  it("rejects stale external preview identity before replacement", () => {
    const expected = { pid: 42, url: "http://127.0.0.1:4321" };
    expect(externalPreviewMatchesLock(expected, { pid: 42, url: "http://127.0.0.1:4321/" })).toBe(true);
    expect(externalPreviewMatchesLock(expected, { pid: 43, url: expected.url })).toBe(false);
    expect(externalPreviewMatchesLock(expected, { pid: 42, url: "http://127.0.0.1:4322" })).toBe(false);
  });
});
