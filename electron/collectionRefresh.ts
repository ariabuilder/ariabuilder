import type { ChildProcess } from "node:child_process";
import { listExternalEntries, readCollectionRegistry } from "./collectionRegistry";
import { resolveLocalAstroCommand } from "./astroCli";
import { canonicalDirectory } from "./pathSafety";
import { execElectronNode } from "./processLaunch";
import { projectProcessEnv } from "./toolEnv";

const activeRefreshes = new Map<string, ChildProcess>();
function refreshKey(root: string): string { return root; }

export function sanitizeCollectionRefreshError(value: string): string {
  return value
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
    .replace(/(["']?(?:api[-_]?key|token|secret|password|authorization)["']?\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-jwt]")
    .slice(0, 2_000);
}

export function cancelCollectionRefresh(projectPath: string, _collectionId: string): boolean {
  const root = canonicalDirectory(projectPath);
  const child = activeRefreshes.get(refreshKey(root));
  if (!child) return false;
  child.kill("SIGTERM");
  return true;
}

export async function refreshCollectionSource(projectPath: string, collectionId: string): Promise<{ refreshedAt: string; collectionId: string }> {
  const root = canonicalDirectory(projectPath);
  const collection = readCollectionRegistry(root).collections.find((item) => item.id === collectionId || item.name === collectionId);
  if (!collection) throw new Error(`Collection not found: ${collectionId}`);
  if (!collection.capabilities?.refresh) throw new Error("This collection cannot be refreshed");
  if (["legacy-directory", "astro-glob", "astro-file"].includes(collection.source?.adapter ?? "")) {
    await listExternalEntries(root, { collectionId: collection.id, page: 1, limit: 1 });
    return { refreshedAt: new Date().toISOString(), collectionId: collection.id };
  }
  const command = resolveLocalAstroCommand(root, ["sync"]);
  if (!command) throw new Error("Astro is not installed in this project. Install project dependencies before refreshing.");
  const key = refreshKey(root);
  if (activeRefreshes.has(key)) throw new Error("Project content sources are already refreshing");

  return new Promise((resolve, reject) => {
    const child = execElectronNode(command.args, { cwd: root, env: projectProcessEnv(), timeout: 60_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, _stdout, stderr) => {
      activeRefreshes.delete(key);
      if (error) {
        const message = sanitizeCollectionRefreshError(String(stderr || error.message || "Collection refresh failed"));
        reject(new Error(message || "Collection refresh failed; the last successful cache was preserved."));
        return;
      }
      resolve({ refreshedAt: new Date().toISOString(), collectionId: collection.id });
    });
    activeRefreshes.set(key, child);
  });
}
