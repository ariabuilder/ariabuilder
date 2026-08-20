/**
 * Read + parse a project `.astro` page for Composer structure / selection.
 * Markers are never written — this is model-only (Phase 2).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseAstro } from "../../shared/composer/parseAstro";
import type { AstroCollectionBinding, ParseAstroResult } from "../../shared/composer/types";
import { analyzeAstroCollectionProvenance } from "./collectionProvenance";

export type ComposerParsePageInput = {
  projectPath: string;
  /** Project-relative posix path (e.g. `src/pages/index.astro`). */
  relativeFile: string;
  /** Collection-backed props inherited from the selected component invocation. */
  collectionProps?: Record<string, AstroCollectionBinding>;
};

export type ComposerAnalyzeSourceInput = ComposerParsePageInput & {
  source: string;
};

export type ComposerParsePageResult = ParseAstroResult & {
  relativeFile: string;
  mtimeMs: number | null;
};

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Resolve a project-relative file under the open project root.
 * Rejects path escape (`..`) and non-`.astro` sources.
 */
export function resolveComposerPageFile(
  projectPath: string,
  relativeFile: string,
): string {
  const root = path.resolve(projectPath);
  const rel = relativeFile.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("\0") || rel.split("/").includes("..")) {
    throw new Error("Invalid page path");
  }
  if (!/\.astro$/i.test(rel)) {
    throw new Error("Composer parsePage only accepts .astro files");
  }
  const absolute = path.resolve(root, rel);
  const relToRoot = path.relative(root, absolute);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    throw new Error("Page path escapes project root");
  }
  return absolute;
}

export async function parseComposerPage(
  input: ComposerParsePageInput,
): Promise<ComposerParsePageResult> {
  const absolute = resolveComposerPageFile(
    input.projectPath,
    input.relativeFile,
  );
  if (!existsSync(absolute)) {
    return {
      editable: false,
      compilerValid: false,
      reason: "File not found",
      source: "",
      bail: {
        code: "parse_exception",
        what: `Missing file: ${toPosix(input.relativeFile)}`,
      },
      relativeFile: toPosix(input.relativeFile),
      mtimeMs: null,
    };
  }

  const source = readFileSync(absolute, "utf8");
  let mtimeMs: number | null = null;
  try {
    mtimeMs = statSync(absolute).mtimeMs;
  } catch {
    mtimeMs = null;
  }

  const result = await parseAstro(source, { filename: absolute });
  if (result.editable) {
    result.model.collectionBindings = analyzeAstroCollectionProvenance(source, {
      props: input.collectionProps,
    });
  }
  return {
    ...result,
    relativeFile: toPosix(input.relativeFile),
    mtimeMs,
  };
}

/** Parse an in-memory Code draft without touching project files. */
export async function analyzeComposerSource(
  input: ComposerAnalyzeSourceInput,
): Promise<ParseAstroResult> {
  const absolute = resolveComposerPageFile(input.projectPath, input.relativeFile);
  const result = await parseAstro(input.source, { filename: absolute });
  if (result.editable) {
    result.model.collectionBindings = analyzeAstroCollectionProvenance(input.source, {
      props: input.collectionProps,
    });
  }
  return result;
}
