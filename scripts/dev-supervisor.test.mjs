import { describe, expect, it } from "vitest";
import { isElectronRuntimeSource } from "./dev-supervisor.mjs";

describe("Electron dev watcher policy", () => {
  it("rebuilds production Electron and shared sources", () => {
    expect(isElectronRuntimeSource("electron/main.ts")).toBe(true);
    expect(isElectronRuntimeSource("shared/composer/protocol.ts")).toBe(true);
    expect(isElectronRuntimeSource("electron/config/defaults.json")).toBe(true);
  });

  it("does not restart Electron for tests or fixtures", () => {
    expect(isElectronRuntimeSource("electron/main.test.ts")).toBe(false);
    expect(isElectronRuntimeSource("shared/composer/protocol.spec.ts")).toBe(false);
    expect(isElectronRuntimeSource("electron/__fixtures__/project.ts")).toBe(false);
    expect(isElectronRuntimeSource("shared/test-data/sample.json")).toBe(false);
  });
});

