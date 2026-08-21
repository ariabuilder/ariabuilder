import { parentPort, workerData } from "node:worker_threads";
import { discoverProjectTranslationCatalogsInProcess } from "./composer/translationCatalogs";

const root = (workerData as { root?: unknown }).root;
if (!parentPort || typeof root !== "string" || !root.trim()) {
  throw new Error("Translation discovery worker requires a project root.");
}

try {
  const result = await discoverProjectTranslationCatalogsInProcess(root);
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
