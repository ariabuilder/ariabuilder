import fs from "node:fs";
import path from "node:path";
import type { ProjectChange } from "../shared/types";
import { hasRecentSelfWrite, isRecentSelfWrite } from "./composer/selfWrite";
import { canonicalDirectory } from "./pathSafety";

export type { ProjectChange } from "../shared/types";

export type RecursiveWatchFactory = (
  directory: string,
  listener: (eventType: fs.WatchEventType, filename: string | Buffer | null) => void,
) => fs.FSWatcher;

export type DirectoryWatchFactory = (
  directory: string,
  listener: (eventType: fs.WatchEventType, filename: string | Buffer | null) => void,
) => fs.FSWatcher;

const defaultRecursiveWatch: RecursiveWatchFactory = (directory, listener) =>
  fs.watch(directory, { recursive: true }, listener);
const defaultDirectoryWatch: DirectoryWatchFactory = (directory, listener) =>
  fs.watch(directory, listener);

const IGNORED = new Set([
  "node_modules",
  ".git",
  ".astro",
  "dist",
  "build",
  "release",
  "coverage",
  ".cache",
  "aria-preview",
  "__aria__",
]);
const MAX_FALLBACK_WATCHERS = 2_000;
const MAX_FALLBACK_DEPTH = 40;

function hasIgnoredSegment(value: string): boolean {
  return value
    .split(/[\\/]/)
    .filter(Boolean)
    .some((segment) =>
      IGNORED.has(segment) || (segment.startsWith(".") && segment !== ".aria"),
    );
}

function isInsideLexically(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function isGeneratedOutputPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  return (
    normalized === "src/paraglide" ||
    normalized.startsWith("src/paraglide/") ||
    normalized === "src/generated" ||
    normalized.startsWith("src/generated/")
  );
}

function isMotionRelevantStructureChange(change: ProjectChange | undefined): boolean {
  return Boolean(
    change?.category === "structure" &&
    (!change.path || change.path.toLowerCase().endsWith(".astro")),
  );
}

export function classifyProjectChange(relativePath: string): ProjectChange {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const lower = normalized.toLowerCase();
  const asset = lower === "public" || lower.startsWith("public/") || lower.startsWith("src/assets/");
  if (asset) return { path: normalized, kind: "asset", category: "asset" };
  if (/\.(?:css|scss|sass|less|styl|stylus|pcss|postcss)$/i.test(lower)) {
    return { path: normalized, kind: "source", category: "style" };
  }
  if (
    lower.startsWith("src/pages/") ||
    lower.startsWith("src/components/") ||
    lower.startsWith("src/layouts/") ||
    lower === ".aria/pages-meta.json"
  ) {
    return { path: normalized, kind: "source", category: "structure" };
  }
  if (lower.startsWith("src/content/")) {
    return { path: normalized, kind: "source", category: "content" };
  }
  if (
    /^(?:astro\.config\.|package(?:-lock)?\.json$|tsconfig(?:\.[^.]+)?\.json$)/i.test(normalized) ||
    /^src\/content\.config\./i.test(normalized) ||
    lower.startsWith(".aria/")
  ) {
    return { path: normalized, kind: "source", category: "config" };
  }
  return { path: normalized, kind: "source", category: "other" };
}

export class ProjectWatcher {
  private readonly recursiveWatchers = new Map<string, fs.FSWatcher>();
  private rootWatcher: fs.FSWatcher | null = null;
  private readonly fallbackWatchers = new Map<string, fs.FSWatcher>();
  private timer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Immediate | null = null;
  private readonly pending = new Map<NonNullable<ProjectChange["category"]>, ProjectChange>();
  private generation = 0;
  private started = false;

  public constructor(
    private readonly projectPath: string,
    private readonly onChange: (change: ProjectChange) => void,
    private readonly recursiveWatch: RecursiveWatchFactory = defaultRecursiveWatch,
    private readonly directoryWatch: DirectoryWatchFactory = defaultDirectoryWatch,
  ) {}

  public start(): void {
    if (this.started) return;
    this.started = true;
    const generation = ++this.generation;
    const root = canonicalDirectory(this.projectPath);
    this.startTimer = setImmediate(() => {
      this.startTimer = null;
      if (!this.started || generation !== this.generation) return;
      this.startWatching(root);
    });
  }

  public activeWatcherCount(): number {
    return this.recursiveWatchers.size + (this.rootWatcher ? 1 : 0) + this.fallbackWatchers.size;
  }

  private startWatching(root: string): void {
    const startedAt = Date.now();
    if (process.platform === "win32") {
      this.startRecursiveWatcher(root, root);
    } else {
      this.startRootWatcher(root);
      for (const relative of ["src", "public", ".aria"]) {
        const directory = path.join(root, relative);
        try {
          if (fs.statSync(directory).isDirectory()) this.startFallbackTree(directory, root, 0);
        } catch {
          // Optional source root is absent.
        }
      }
    }
    console.info(
      `[aria:perf] Project watcher ready in ${Date.now() - startedAt}ms with ${this.activeWatcherCount()} scoped watchers.`,
    );
  }

  private startRootWatcher(root: string): void {
    if (this.rootWatcher) return;
    try {
      const watcher = this.directoryWatch(root, (eventType, filename) => {
        this.handleEvent(root, root, eventType, filename, true);
        const name = filename?.toString();
        if (eventType !== "rename" || !name || !["src", "public", ".aria"].includes(name)) return;
        const directory = path.join(root, name);
        if (process.platform === "win32") {
          try {
            if (fs.statSync(directory).isDirectory()) this.startRecursiveWatcher(directory, root);
          } catch {
            // A removed source root needs no watcher.
          }
        } else {
          this.refreshFallbackTree(directory, root);
        }
      });
      watcher.on("error", (error) => {
        if (this.rootWatcher !== watcher) return;
        console.warn(`[aria:watcher] Project root watcher failed: ${error.message}`);
        watcher.close();
        this.rootWatcher = null;
      });
      this.rootWatcher = watcher;
    } catch {
      // Source-root watchers still provide useful project updates.
    }
  }

  private startRecursiveWatcher(directory: string, root: string): void {
    const key = path.resolve(directory);
    if (this.recursiveWatchers.has(key)) return;
    try {
      const watcher = this.recursiveWatch(directory, (eventType, filename) => {
        this.handleEvent(root, directory, eventType, filename, true);
      });
      watcher.on("error", (error) => {
        if (this.recursiveWatchers.get(key) !== watcher) return;
        console.warn(`[aria:watcher] Recursive project watcher failed for ${path.relative(root, directory) || "."}: ${error.message}`);
        watcher.close();
        this.recursiveWatchers.delete(key);
        if (this.started) this.startFallbackTree(directory, root, 0);
      });
      this.recursiveWatchers.set(key, watcher);
    } catch {
      this.startFallbackTree(directory, root, 0);
    }
  }

  private startFallbackTree(directory: string, root: string, depth: number): void {
    if (
      !this.started ||
      depth > MAX_FALLBACK_DEPTH ||
      this.fallbackWatchers.size >= MAX_FALLBACK_WATCHERS ||
      !isInsideLexically(root, directory) ||
      isGeneratedOutputPath(path.relative(root, directory))
    ) return;

    try {
      if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory()) return;
    } catch {
      return;
    }

    this.watchFallbackDirectory(directory, root);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hasIgnoredSegment(entry.name) || !entry.isDirectory()) continue;
      this.startFallbackTree(path.join(directory, entry.name), root, depth + 1);
    }
  }

  private watchFallbackDirectory(directory: string, root: string): void {
    const key = path.resolve(directory);
    if (this.fallbackWatchers.has(key) || this.fallbackWatchers.size >= MAX_FALLBACK_WATCHERS) return;
    try {
      const watcher = this.directoryWatch(directory, (eventType, filename) => {
        this.handleEvent(root, directory, eventType, filename, false);
      });
      watcher.on("error", () => {
        if (this.fallbackWatchers.get(key) !== watcher) return;
        this.refreshFallbackTree(directory, root);
      });
      this.fallbackWatchers.set(key, watcher);
    } catch {
      // An inaccessible directory must not prevent the rest of the project watcher.
    }
  }

  private removeFallbackTree(directory: string): void {
    const key = path.resolve(directory);
    const prefix = `${key}${path.sep}`;
    for (const [watchedPath, watcher] of this.fallbackWatchers) {
      if (watchedPath !== key && !watchedPath.startsWith(prefix)) continue;
      watcher.close();
      this.fallbackWatchers.delete(watchedPath);
    }
  }

  private refreshFallbackTree(directory: string, root: string): void {
    this.removeFallbackTree(directory);
    try {
      if (fs.statSync(directory).isDirectory()) this.startFallbackTree(directory, root, 0);
    } catch {
      // Deleted directories stay detached until a later parent rename recreates them.
    }
  }

  private handleEvent(
    root: string,
    eventDirectory: string,
    eventType: string,
    filename: string | Buffer | null,
    recursive: boolean,
  ): void {
    if (!this.started) return;
    const name = filename?.toString();
    if (!name) {
      if (hasRecentSelfWrite()) return;
      this.queueChange({ path: "", kind: "source", category: "structure" });
      return;
    }
    if (hasIgnoredSegment(name)) return;
    const absolute = path.resolve(eventDirectory, name);
    if (!isInsideLexically(root, absolute) || isRecentSelfWrite(absolute)) return;
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (hasIgnoredSegment(relative) || isGeneratedOutputPath(relative)) return;
    this.queueChange(classifyProjectChange(relative));

    if (!recursive && eventType === "rename") {
      this.refreshFallbackTree(absolute, root);
    }
  }

  private queueChange(change: ProjectChange): void {
    const category = change.category ?? "other";
    const current = this.pending.get(category);
    if (
      !isMotionRelevantStructureChange(current) ||
      isMotionRelevantStructureChange(change)
    ) {
      this.pending.set(category, change);
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const changes = [...this.pending.values()];
      this.pending.clear();
      if (!this.started) return;
      for (const next of changes) this.onChange(next);
    }, 180);
  }

  public stop(): void {
    if (!this.started && !this.activeWatcherCount()) return;
    this.started = false;
    this.generation += 1;
    if (this.startTimer) clearImmediate(this.startTimer);
    if (this.timer) clearTimeout(this.timer);
    this.startTimer = null;
    this.timer = null;
    this.pending.clear();
    this.rootWatcher?.close();
    this.rootWatcher = null;
    for (const watcher of this.recursiveWatchers.values()) watcher.close();
    this.recursiveWatchers.clear();
    for (const watcher of this.fallbackWatchers.values()) watcher.close();
    this.fallbackWatchers.clear();
  }
}
