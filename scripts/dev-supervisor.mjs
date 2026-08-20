import path from "node:path";

const RUNTIME_EXTENSION_RE = /\.(?:ts|tsx|json)$/;
const NON_RUNTIME_SEGMENTS = new Set([
  "__fixtures__",
  "__tests__",
  "fixtures",
  "test-data",
  "testdata",
]);

/**
 * Electron's dev bundle only needs production sources. Test and fixture edits
 * are handled by Vitest and must not tear down the running desktop process.
 */
export function isElectronRuntimeSource(filePath) {
  const normalized = filePath.split(path.sep).join("/");
  if (!RUNTIME_EXTENSION_RE.test(normalized)) return false;
  const segments = normalized.split("/");
  if (segments.some((segment) => NON_RUNTIME_SEGMENTS.has(segment))) return false;
  return !/\.(?:test|spec)\.(?:ts|tsx)$/.test(normalized);
}

