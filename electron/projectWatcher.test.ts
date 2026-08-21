import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { classifyProjectChange, ProjectWatcher } from "./projectWatcher";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ProjectWatcher", () => {
  it("classifies changes without forcing workspace scans for styles and assets", () => {
    expect(classifyProjectChange("src/pages/index.astro").category).toBe("structure");
    expect(classifyProjectChange("src/components/Card.astro").category).toBe("structure");
    expect(classifyProjectChange("src/styles/global.css").category).toBe("style");
    expect(classifyProjectChange("public/hero.jpg")).toMatchObject({ kind: "asset", category: "asset" });
    expect(classifyProjectChange(".aria/site-settings.json").category).toBe("config");
  });

  it("keeps native watcher count bounded when generated output contains many directories", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-project-watcher-"));
    roots.push(root);
    for (let index = 0; index < 400; index += 1) {
      fs.mkdirSync(path.join(root, "release", `artifact-${index}`, "nested"), { recursive: true });
    }
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });

    const makeWatcher = () => {
      const nativeWatcher = new EventEmitter() as fs.FSWatcher;
      nativeWatcher.close = () => undefined;
      nativeWatcher.ref = () => nativeWatcher;
      nativeWatcher.unref = () => nativeWatcher;
      return nativeWatcher;
    };
    const watcher = new ProjectWatcher(
      root,
      () => undefined,
      () => makeWatcher(),
      () => makeWatcher(),
    );
    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(watcher.activeWatcherCount()).toBe(process.platform === "win32" ? 1 : 3);
    watcher.stop();
    expect(watcher.activeWatcherCount()).toBe(0);
  });
});
