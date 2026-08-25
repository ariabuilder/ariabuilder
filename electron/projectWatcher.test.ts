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
      fs.mkdirSync(path.join(root, "src", "generated", `artifact-${index}`, "nested"), { recursive: true });
    }
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });

    let rootListener:
      | ((eventType: fs.WatchEventType, filename: string | Buffer | null) => void)
      | undefined;
    const makeWatcher = (
      directory: string,
      listener: (eventType: fs.WatchEventType, filename: string | Buffer | null) => void,
    ) => {
      if (path.resolve(directory) === path.resolve(root)) rootListener = listener;
      const nativeWatcher = new EventEmitter() as fs.FSWatcher;
      nativeWatcher.close = () => undefined;
      nativeWatcher.ref = () => nativeWatcher;
      nativeWatcher.unref = () => nativeWatcher;
      return nativeWatcher;
    };
    const changes: Array<ReturnType<typeof classifyProjectChange>> = [];
    const watcher = new ProjectWatcher(
      root,
      (change) => changes.push(change),
      makeWatcher,
      makeWatcher,
    );
    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(watcher.activeWatcherCount()).toBe(process.platform === "win32" ? 1 : 3);
    rootListener?.("change", "src/generated/artifact-1/output.ts");
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(changes).toEqual([]);
    watcher.stop();
    expect(watcher.activeWatcherCount()).toBe(0);
  });

  it("preserves an Astro structure change when a later source change is batched", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-project-watcher-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
    const listeners = new Map<
      string,
      (eventType: fs.WatchEventType, filename: string | Buffer | null) => void
    >();
    const makeWatcher = (
      directory: string,
      listener: (eventType: fs.WatchEventType, filename: string | Buffer | null) => void,
    ) => {
      listeners.set(path.resolve(directory), listener);
      const nativeWatcher = new EventEmitter() as fs.FSWatcher;
      nativeWatcher.close = () => undefined;
      nativeWatcher.ref = () => nativeWatcher;
      nativeWatcher.unref = () => nativeWatcher;
      return nativeWatcher;
    };
    const changes: Array<ReturnType<typeof classifyProjectChange>> = [];
    const watcher = new ProjectWatcher(root, (change) => changes.push(change), makeWatcher, makeWatcher);
    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 30));

    if (process.platform === "win32") {
      const listener = [...listeners.entries()].find(([directory]) =>
        path.basename(directory) === path.basename(root)
      )?.[1];
      expect(listener).toBeTypeOf("function");
      listener?.("change", "src/pages/index.astro");
      listener?.("change", "src/components/Card.ts");
    } else {
      const pageListener = [...listeners.entries()].find(([directory]) =>
        directory.endsWith(path.join("src", "pages"))
      )?.[1];
      const componentListener = [...listeners.entries()].find(([directory]) =>
        directory.endsWith(path.join("src", "components"))
      )?.[1];
      expect(pageListener).toBeTypeOf("function");
      expect(componentListener).toBeTypeOf("function");
      pageListener?.("change", "index.astro");
      componentListener?.("change", "Card.ts");
    }

    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(changes.filter((change) => change.category === "structure")).toEqual([
      expect.objectContaining({ path: "src/pages/index.astro" }),
    ]);
    watcher.stop();
  });

  it("drops stale fallback watchers when a directory is deleted and rebuilds them when recreated", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-project-watcher-recreate-"));
    roots.push(root);
    const src = path.join(root, "src");
    const nested = path.join(src, "nested");
    fs.mkdirSync(nested, { recursive: true });
    let srcListener:
      | ((eventType: fs.WatchEventType, filename: string | Buffer | null) => void)
      | undefined;
    const makeWatcher = (
      directory: string,
      listener: (eventType: fs.WatchEventType, filename: string | Buffer | null) => void,
    ) => {
      const nativeWatcher = new EventEmitter() as fs.FSWatcher;
      nativeWatcher.close = () => undefined;
      nativeWatcher.ref = () => nativeWatcher;
      nativeWatcher.unref = () => nativeWatcher;
      if (path.basename(directory).toLowerCase() === "src") srcListener = listener;
      return nativeWatcher;
    };
    const watcher = new ProjectWatcher(
      root,
      () => undefined,
      () => {
        throw new Error("recursive watch unavailable");
      },
      (directory, listener) => makeWatcher(directory, listener),
    );
    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(watcher.activeWatcherCount()).toBe(3);

    fs.rmSync(nested, { recursive: true });
    expect(srcListener).toBeTypeOf("function");
    srcListener?.("rename", "nested");
    expect(watcher.activeWatcherCount()).toBe(2);

    fs.mkdirSync(path.join(nested, "deeper"), { recursive: true });
    srcListener?.("rename", "nested");
    expect(watcher.activeWatcherCount()).toBe(4);
    watcher.stop();
  });

  it("rebuilds the current fallback subtree after its watcher errors", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-project-watcher-error-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "src", "nested"), { recursive: true });
    const sourceWatchers: fs.FSWatcher[] = [];
    const makeWatcher = (directory: string) => {
      const nativeWatcher = new EventEmitter() as fs.FSWatcher;
      nativeWatcher.close = () => undefined;
      nativeWatcher.ref = () => nativeWatcher;
      nativeWatcher.unref = () => nativeWatcher;
      if (path.basename(directory).toLowerCase() === "src") {
        sourceWatchers.push(nativeWatcher);
      }
      return nativeWatcher;
    };
    const watcher = new ProjectWatcher(
      root,
      () => undefined,
      () => {
        throw new Error("recursive watch unavailable");
      },
      (directory) => makeWatcher(directory),
    );
    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(sourceWatchers).toHaveLength(1);
    sourceWatchers[0]?.emit("error", new Error("watcher stopped"));
    expect(sourceWatchers).toHaveLength(2);
    expect(watcher.activeWatcherCount()).toBe(3);
    watcher.stop();
  });
});
