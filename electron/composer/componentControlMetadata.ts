import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseAstroSync } from "@astrojs/compiler/sync";
import {
  writeComponentControlMetadata as writeMetadataBlock,
  type ComponentControlMetadata,
} from "../../shared/conditions";
import { resolveWithinRoot, writeTextFileAtomic } from "../pathSafety";
import { markSelfWrite } from "./selfWrite";

export type WriteComponentControlMetadataInput = {
  projectPath: string;
  relativeFile: string;
  metadata: ComponentControlMetadata;
  expectedMtimeMs?: number | null;
};

export type WriteComponentControlMetadataResult = {
  ok: true;
  relativeFile: string;
  mtimeMs: number;
};

export function writeComposerComponentControlMetadata(
  input: WriteComponentControlMetadataInput,
): WriteComponentControlMetadataResult {
  const relativeFile = input.relativeFile.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relativeFile || relativeFile.split("/").includes("..") || !relativeFile.endsWith(".astro")) {
    throw new Error("Choose a project-owned Astro component.");
  }
  const absolute = resolveWithinRoot(
    path.resolve(input.projectPath),
    path.resolve(input.projectPath, relativeFile),
    { rejectFinalSymlink: true },
  );
  const currentMtimeMs = Math.floor(statSync(absolute).mtimeMs);
  if (
    input.expectedMtimeMs != null
    && Number.isFinite(input.expectedMtimeMs)
    && currentMtimeMs !== Math.floor(input.expectedMtimeMs)
  ) {
    const error = new Error("Component changed on disk. Reload its controls before saving.") as Error & { code: string };
    error.code = "mtime_conflict";
    throw error;
  }
  const current = readFileSync(absolute, "utf8");
  const next = writeMetadataBlock(current, input.metadata);
  const parsed = parseAstroSync(next, { position: true });
  const diagnostic = parsed.diagnostics.find((item) => item.severity === 1);
  if (diagnostic) throw new Error(`Astro rejected the component controls: ${diagnostic.text}`);
  markSelfWrite(absolute);
  writeTextFileAtomic(absolute, next);
  return {
    ok: true,
    relativeFile,
    mtimeMs: Math.floor(statSync(absolute).mtimeMs),
  };
}

