/**
 * Serialize the editable model to clean `.astro` and write to disk.
 * Markers are NEVER written — only `serializeAstro` output.
 */

import { readFileSync, statSync } from "node:fs";
import { serializeAstro } from "../../shared/composer/serializeAstro";
import type { AstroDocumentModel } from "../../shared/composer/types";
import { writeTextFileAtomic } from "../pathSafety";
import { resolveComposerPageFile } from "./parsePage";
import { markSelfWrite } from "./selfWrite";

export type ComposerWritePageInput = {
  projectPath: string;
  /** Project-relative posix path (e.g. `src/pages/index.astro`). */
  relativeFile: string;
  model: AstroDocumentModel;
  /** Last mtime observed by the renderer. A mismatch refuses the write. */
  expectedMtimeMs?: number | null;
};

export type ComposerWritePageResult = {
  ok: true;
  relativeFile: string;
  mtimeMs: number;
};

function toPosix(p: string): string {
  return p.split(/[\\/]/).join("/");
}

/**
 * Astro's style module can lag one HMR tick behind the HTML SSR output.
 * Stacki nudges a second identical write for `.astro` files that carry
 * `<style>` so the canvas CSS catches up. Same pattern here.
 */
const STYLE_NUDGE_MS = 150;
const styleNudges = new Map<string, ReturnType<typeof setTimeout>>();

function writePageText(absolutePath: string, text: string): void {
  markSelfWrite(absolutePath);
  writeTextFileAtomic(absolutePath, text);

  if (!/<style[\s>]/i.test(text)) return;
  const existing = styleNudges.get(absolutePath);
  if (existing) clearTimeout(existing);
  styleNudges.set(
    absolutePath,
    setTimeout(() => {
      styleNudges.delete(absolutePath);
      try {
        if (readFileSync(absolutePath, "utf8") !== text) return;
        markSelfWrite(absolutePath);
        writeTextFileAtomic(absolutePath, text);
      } catch {
        /* moved or deleted */
      }
    }, STYLE_NUDGE_MS),
  );
}

export function writeComposerPage(
  input: ComposerWritePageInput,
): ComposerWritePageResult {
  const absolute = resolveComposerPageFile(
    input.projectPath,
    input.relativeFile,
  );
  const currentMtimeMs = Math.floor(statSync(absolute).mtimeMs);
  if (
    input.expectedMtimeMs != null &&
    Number.isFinite(input.expectedMtimeMs) &&
    currentMtimeMs !== Math.floor(input.expectedMtimeMs)
  ) {
    const error = new Error(
      "Page changed on disk. Reload Composer before saving.",
    ) as Error & { code: string; currentMtimeMs: number };
    error.code = "mtime_conflict";
    error.currentMtimeMs = currentMtimeMs;
    throw error;
  }
  const text = serializeAstro(input.model);
  // Guardrail: marked serializer output must never reach disk.
  if (
    text.includes("data-aria-s=") ||
    text.includes("data-aria-e=") ||
    text.includes("data-avb-s=") ||
    text.includes("data-avb-e=")
  ) {
    throw new Error("Refusing to write marked Composer source to disk");
  }
  writePageText(absolute, text);
  const mtimeMs = Math.floor(statSync(absolute).mtimeMs);
  return {
    ok: true,
    relativeFile: toPosix(input.relativeFile),
    mtimeMs,
  };
}
