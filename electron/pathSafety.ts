import fs from "node:fs";
import path from "node:path";
import {
  afterTrackedMutation,
  beforeTrackedMutation,
  withoutMutationTracking,
} from "./mutationTracking";

function realpathNative(target: string): string {
  return fs.realpathSync.native(target);
}

/** Return the canonical path for an existing directory. */
export function canonicalDirectory(target: string): string {
  if (typeof target !== "string" || !target.trim()) {
    throw new Error("Directory path is required");
  }

  const absolute = path.resolve(target.trim());
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    throw new Error("Directory does not exist");
  }
  return realpathNative(absolute);
}

/**
 * Resolve a path through existing symlinks, including symlinked parents when
 * the final path has not been created yet.
 */
export function canonicalPathAllowMissing(target: string): string {
  const absolute = path.resolve(target);
  const suffix: string[] = [];
  let current = absolute;

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return absolute;
    suffix.unshift(path.basename(current));
    current = parent;
  }

  return path.resolve(realpathNative(current), ...suffix);
}

/** Resolve a path and reject anything outside the supplied canonical root. */
export function resolveWithinRoot(
  root: string,
  target: string,
  options?: { allowMissing?: boolean; rejectFinalSymlink?: boolean },
): string {
  const canonicalRoot = canonicalDirectory(root);
  const absolute = path.isAbsolute(target)
    ? target
    : path.resolve(canonicalRoot, target);

  let targetExists = false;
  try {
    fs.lstatSync(absolute);
    targetExists = true;
  } catch {
    targetExists = false;
  }
  if (!options?.allowMissing && !targetExists) {
    throw new Error("Path does not exist");
  }
  if (
    options?.rejectFinalSymlink &&
    targetExists &&
    fs.lstatSync(absolute).isSymbolicLink()
  ) {
    throw new Error("Final path symlinks are not allowed");
  }

  const canonicalTarget = options?.allowMissing
    ? canonicalPathAllowMissing(absolute)
    : realpathNative(absolute);
  const relative = path.relative(canonicalRoot, canonicalTarget);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Path is outside the project");
  }

  return canonicalTarget;
}

export function isPathInside(root: string, target: string): boolean {
  try {
    resolveWithinRoot(root, target, { allowMissing: true });
    return true;
  } catch {
    return false;
  }
}

function writeFileAtomic(
  file: string,
  contents: string | Uint8Array,
  options?: { overwrite?: boolean; encoding?: BufferEncoding },
): void {
  const overwrite = options?.overwrite ?? true;
  let existing: fs.Stats | null = null;
  try {
    existing = fs.lstatSync(file);
  } catch {
    existing = null;
  }
  if (!overwrite && existing) throw new Error("File already exists");
  if (existing?.isSymbolicLink()) {
    throw new Error("Refusing to write through a symlink");
  }
  const intendedBytes =
    typeof contents === "string"
      ? Buffer.from(contents, options?.encoding ?? "utf8")
      : Buffer.from(contents);
  beforeTrackedMutation(file, intendedBytes);
  const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    withoutMutationTracking(() => {
      const handle = fs.openSync(temp, "wx", existing?.mode ?? 0o666);
      try {
        if (typeof contents === "string") {
          fs.writeFileSync(handle, contents, {
            encoding: options?.encoding ?? "utf8",
          });
        } else {
          fs.writeFileSync(handle, contents);
        }
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      if (existing && process.platform !== "win32") {
        fs.chmodSync(temp, existing.mode);
      }
      if (!overwrite) {
        // A hard link fails if the destination appeared after the first check,
        // so creation never replaces a concurrent file.
        fs.linkSync(temp, file);
        fs.unlinkSync(temp);
        return;
      }
      // libuv implements replace-existing semantics for rename on Windows.
      // Never unlink the destination first: a sharing violation must leave the
      // original bytes intact.
      fs.renameSync(temp, file);
    });
    afterTrackedMutation(file);
  } catch (error) {
    try {
      withoutMutationTracking(() => fs.rmSync(temp, { force: true }));
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
}

/** Write a small text file without leaving a truncated destination on crash. */
export function writeTextFileAtomic(
  file: string,
  contents: string,
  options?: { overwrite?: boolean },
): void {
  writeFileAtomic(file, contents, options);
}

/** Write binary bytes without leaving a truncated destination on crash. */
export function writeBinaryFileAtomic(
  file: string,
  contents: Uint8Array,
  options?: { overwrite?: boolean },
): void {
  writeFileAtomic(file, contents, options);
}

/** Remove a file or directory while registering every affected file. */
export function removePathTracked(
  target: string,
  options?: { recursive?: boolean; force?: boolean },
): void {
  const affected: string[] = [];
  const collect = (absolute: string): void => {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absolute);
    } catch {
      return;
    }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const entry of fs.readdirSync(absolute)) {
        collect(path.join(absolute, entry));
      }
      return;
    }
    affected.push(absolute);
  };
  collect(target);
  for (const file of affected) beforeTrackedMutation(file, null);
  withoutMutationTracking(() => fs.rmSync(target, options));
  for (const file of affected) afterTrackedMutation(file);
}

/** Rename a path while registering source and destination file states. */
export function renamePathTracked(source: string, destination: string): void {
  const sourceFiles: Array<{ source: string; destination: string }> = [];
  const collect = (absolute: string, relative = ""): void => {
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const entry of fs.readdirSync(absolute)) {
        collect(path.join(absolute, entry), path.join(relative, entry));
      }
      return;
    }
    sourceFiles.push({
      source: absolute,
      destination: relative ? path.join(destination, relative) : destination,
    });
  };
  collect(source);
  for (const file of sourceFiles) {
    const bytes = fs.readFileSync(file.source);
    beforeTrackedMutation(file.source, null);
    beforeTrackedMutation(file.destination, bytes);
  }
  withoutMutationTracking(() => fs.renameSync(source, destination));
  for (const file of sourceFiles) {
    afterTrackedMutation(file.source);
    afterTrackedMutation(file.destination);
  }
}

/** Copy a file while registering only the destination as changed. */
export function copyFileTracked(
  source: string,
  destination: string,
  mode?: number,
): void {
  beforeTrackedMutation(destination, fs.readFileSync(source));
  withoutMutationTracking(() => fs.copyFileSync(source, destination, mode));
  afterTrackedMutation(destination);
}
