/**
 * Suppress ProjectWatcher thrash from Aria's own disk writes (Stacki markSelfWrite).
 */

import path from "node:path";

const selfWrites = new Map<string, number>();

/** How long a write is treated as "ours" and ignored by the project watcher. */
export const SELF_WRITE_TTL_MS = 1500;

export function markSelfWrite(absolutePath: string): void {
  selfWrites.set(path.resolve(absolutePath), Date.now());
}

export function isRecentSelfWrite(
  absolutePath: string,
  ttlMs: number = SELF_WRITE_TTL_MS,
): boolean {
  const key = path.resolve(absolutePath);
  const wrote = selfWrites.get(key);
  if (wrote == null) return false;
  if (Date.now() - wrote > ttlMs) {
    selfWrites.delete(key);
    return false;
  }
  return true;
}

/**
 * True when any path was marked within TTL.
 * Used when `fs.watch` omits the filename (platform-dependent) so we still
 * suppress a generic rescan kicked by our own write.
 */
export function hasRecentSelfWrite(
  ttlMs: number = SELF_WRITE_TTL_MS,
): boolean {
  const now = Date.now();
  for (const [key, wrote] of selfWrites) {
    if (now - wrote > ttlMs) {
      selfWrites.delete(key);
      continue;
    }
    return true;
  }
  return false;
}

/** Test helper — clear the map between unit tests if needed. */
export function clearSelfWrites(): void {
  selfWrites.clear();
}
