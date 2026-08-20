import fs from "node:fs";
import path from "node:path";
import type { ProjectChange } from "../shared/types";
import { hasRecentSelfWrite, isRecentSelfWrite } from "./composer/selfWrite";
import { canonicalDirectory, isPathInside } from "./pathSafety";

export type { ProjectChange } from "../shared/types";

const IGNORED = new Set([
  "node_modules",
  ".git",
  ".astro",
  "dist",
  // Aria-managed component preview harness — warm rewrites must not rescan.
  "aria-preview",
  "__aria__",
]);
const MAX_WATCHERS = 2_000;
const MAX_DEPTH = 40;

function hasIgnoredSegment(value: string): boolean {
  return value
    .split(/[\\/]/)
    .some((segment) => segment.startsWith(".") || IGNORED.has(segment));
}

export class ProjectWatcher {
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private timer: NodeJS.Timeout | null = null;
  private rebuildTimer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Immediate | null = null;
  private pending: ProjectChange | null = null;
  private generation = 0;
  private started = false;

  public constructor(
    private readonly projectPath: string,
    private readonly onChange: (change: ProjectChange) => void,
  ) {}

  public start(): void {
    if (this.started) return;
    this.started = true;
    const generation = ++this.generation;
    const root = canonicalDirectory(this.projectPath);
    this.startTimer = setImmediate(() => {
      this.startTimer = null;
      if (!this.started || generation !== this.generation) return;
      this.watchTree(root, root, 0);
    });
  }

  private watchTree(directory: string, root: string, depth: number): void {
    if (
      !this.started ||
      depth > MAX_DEPTH ||
      this.watchers.size >= MAX_WATCHERS ||
      !isPathInside(root, directory)
    ) return;

    let stat: fs.Stats;
    try {
      if (fs.lstatSync(directory).isSymbolicLink()) return;
      stat = fs.statSync(directory);
      if (!stat.isDirectory()) return;
    } catch {
      return;
    }

    this.watchDirectory(directory, root);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hasIgnoredSegment(entry.name) || !entry.isDirectory()) continue;
      this.watchTree(path.join(directory, entry.name), root, depth + 1);
    }
  }

  private watchDirectory(directory: string, root: string): void {
    const key = path.resolve(directory);
    if (this.watchers.has(key) || this.watchers.size >= MAX_WATCHERS) return;
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(directory, (eventType, filename) => {
        if (!this.started) return;
        const name = filename?.toString();
        if (!name) {
          // Some platforms omit the basename; still suppress if we just wrote.
          if (hasRecentSelfWrite()) return;
          this.queueChange({ path: "", kind: "source" });
          return;
        }
        if (hasIgnoredSegment(name)) return;
        const absolute = path.resolve(directory, name);
        if (!isPathInside(root, absolute)) return;
        // Ignore Aria's own recent writes (Composer serialize, design CSS, …).
        if (isRecentSelfWrite(absolute)) return;
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        // Catch nested Aria harness files even when the watch event basename
        // is just `component.astro` under an already-watched aria-preview dir.
        if (hasIgnoredSegment(relative)) return;
        const publicRoot = path.join(root, "public");
        this.queueChange({
          path: relative,
          kind:
            absolute === publicRoot || absolute.startsWith(`${publicRoot}${path.sep}`)
              ? "asset"
              : "source",
        });

        if (eventType === "rename") this.scheduleRebuild(root);
      });
      watcher.on("error", () => {
        watcher.close();
        this.watchers.delete(key);
        this.scheduleRebuild(root);
      });
    } catch {
      return;
    }
    this.watchers.set(key, watcher);
  }

  private queueChange(change: ProjectChange): void {
    this.pending = change.path
      ? change
      : { path: "", kind: "source" };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const next = this.pending;
      this.pending = null;
      if (next && this.started) this.onChange(next);
    }, 180);
  }

  private scheduleRebuild(root: string): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      if (!this.started) return;
      for (const watcher of this.watchers.values()) watcher.close();
      this.watchers.clear();
      this.watchTree(root, root, 0);
    }, 250);
  }

  public stop(): void {
    if (!this.started && !this.watchers.size) return;
    this.started = false;
    this.generation += 1;
    if (this.startTimer) clearImmediate(this.startTimer);
    if (this.timer) clearTimeout(this.timer);
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.startTimer = null;
    this.timer = null;
    this.rebuildTimer = null;
    this.pending = null;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}
