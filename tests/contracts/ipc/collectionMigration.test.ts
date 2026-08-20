import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("collection migration runtime contract", () => {
  it("keeps renderer, preload, and main on the same migration channel", () => {
    expect(read("src/lib/workspace.ts")).toContain("api().migrateCollectionToAria");
    expect(read("electron/preload.ts")).toContain('ipcRenderer.invoke("cms:migrate_collection"');
    expect(read("electron/workspace/ipc/collections.ts")).toContain(
      '"cms:migrate_collection"',
    );
    expect(read("electron/mutations.ts")).toContain('"cms:migrate_collection"');
  });

  it("rebuilds and restarts Electron when main or preload sources change in development", () => {
    const dev = read("scripts/dev.mjs");
    expect(dev).toContain('watchDirectoryTree(path.join(root, "electron"))');
    expect(dev).toContain('watchDirectoryTree(path.join(root, "shared"))');
    expect(dev).toContain("restartElectron()");
    expect(dev).toContain('scripts/build-electron.mjs');
  });
});
