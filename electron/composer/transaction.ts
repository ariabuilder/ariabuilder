import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { parse as parseAstroSync } from "@astrojs/compiler/sync";
import type {
  ComposerEditTransaction,
  ComposerEditTransactionResult,
  ComposerFileRevision,
} from "../../shared/composer/transaction";
import { serializeAstro } from "../../shared/composer/serializeAstro";
import { canonicalDirectory, removePathTracked, resolveWithinRoot, writeTextFileAtomic } from "../pathSafety";
import { resolveComposerPageFile } from "./parsePage";
import { markSelfWrite } from "./selfWrite";
import { buildMotionArtifactEdits } from "./motionAssets";
import { recordComposerWriteJournal } from "./draftPreview";
import {
  applyAriaBemPrimitivesToStylesheet,
  buildAriaBemPrimitiveStylesheetEdit,
} from "../design";

type PreparedEdit = {
  absoluteFile: string;
  relativeFile: string;
  before: string | null;
  after: string | null;
  currentMtimeMs: number;
  expectedMtimeMs: number | null;
  expectedSource: string | null;
  reportRevision: boolean;
};

function toPosix(value: string): string {
  return value.split(/[\\/]/).join("/");
}

function cleanRelativeFile(projectRoot: string, absoluteFile: string): string {
  return toPosix(path.relative(projectRoot, absoluteFile));
}

function assertCleanPageSource(text: string): void {
  if (
    text.includes("data-aria-s=") ||
    text.includes("data-aria-e=") ||
    text.includes("data-avb-s=") ||
    text.includes("data-avb-e=")
  ) {
    throw new Error("Refusing to write marked Composer source to disk");
  }
}

function assertCompilerValidAstroSource(text: string, relativeFile: string): void {
  let result;
  try {
    result = parseAstroSync(text, { position: true });
  } catch (error) {
    throw new Error(
      `Astro compiler could not parse ${relativeFile}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const firstError = result.diagnostics.find((diagnostic) => diagnostic.severity === 1);
  if (firstError) {
    const line = firstError.location?.line;
    const column = firstError.location?.column;
    const at = line ? ` at ${line}${column ? `:${column}` : ""}` : "";
    throw new Error(`Astro compiler rejected ${relativeFile}${at}: ${firstError.text}`);
  }
}

function prepareEdit(
  absoluteFile: string,
  relativeFile: string,
  after: string,
  expectedMtimeMs?: number | null,
  expectedSource?: string | null,
): PreparedEdit {
  const currentMtimeMs = Math.floor(statSync(absoluteFile).mtimeMs);
  return {
    absoluteFile,
    relativeFile,
    before: readFileSync(absoluteFile, "utf8"),
    after,
    currentMtimeMs,
    expectedMtimeMs:
      expectedMtimeMs != null && Number.isFinite(expectedMtimeMs)
        ? Math.floor(expectedMtimeMs)
        : null,
    expectedSource: expectedSource ?? null,
    reportRevision: true,
  };
}

function prepareManagedEdit(
  absoluteFile: string,
  relativeFile: string,
  after: string | null,
  expectedMtimeMs?: number | null,
  reportRevision = true,
): PreparedEdit {
  const exists = existsSync(absoluteFile);
  const currentMtimeMs = exists ? Math.floor(statSync(absoluteFile).mtimeMs) : 0;
  return {
    absoluteFile,
    relativeFile,
    before: exists ? readFileSync(absoluteFile, "utf8") : null,
    after,
    currentMtimeMs,
    expectedMtimeMs:
      expectedMtimeMs != null && Number.isFinite(expectedMtimeMs)
        ? Math.floor(expectedMtimeMs)
        : null,
    expectedSource: null,
    reportRevision,
  };
}

const MOTION_ARTIFACTS = new Set([
  "src/aria/motion.generated.ts",
  "public/vendor/aria-motion/aria-motion.css",
  "public/vendor/aria-motion/aria-motion.js",
]);
const MOTION_RUNTIME_ASSETS = new Set([
  "public/vendor/aria-motion/aria-motion.css",
  "public/vendor/aria-motion/aria-motion.js",
]);

function previewFileRole(relativeFile: string): "astro" | "stylesheet" | "runtime" {
  if (relativeFile.endsWith(".astro")) return "astro";
  if (relativeFile.endsWith(".css")) return "stylesheet";
  return "runtime";
}

function assertManagedArtifact(relativeFile: string, owner: "motion"): string {
  const normalized = toPosix(relativeFile).replace(/^\.\//, "");
  if (owner !== "motion" || !MOTION_ARTIFACTS.has(normalized)) {
    throw new Error(`Composer managed artifact is not allowlisted: ${relativeFile}`);
  }
  return normalized;
}

function applyPreparedEdit(edit: PreparedEdit): void {
  markSelfWrite(edit.absoluteFile);
  if (edit.after === null) {
    if (existsSync(edit.absoluteFile)) removePathTracked(edit.absoluteFile, { force: true });
    return;
  }
  mkdirSync(path.dirname(edit.absoluteFile), { recursive: true });
  writeTextFileAtomic(edit.absoluteFile, edit.after);
}

function restorePreparedEdit(edit: PreparedEdit): void {
  markSelfWrite(edit.absoluteFile);
  if (edit.before === null) {
    if (existsSync(edit.absoluteFile)) removePathTracked(edit.absoluteFile, { force: true });
    return;
  }
  mkdirSync(path.dirname(edit.absoluteFile), { recursive: true });
  writeTextFileAtomic(edit.absoluteFile, edit.before);
}

/**
 * Commit all real-source edits as one optimistic transaction.
 *
 * Every revision is checked before the first write. Individual replacements
 * are atomic; if a later replacement fails, earlier files are atomically
 * restored from their captured snapshots before the error is rethrown.
 */
export function commitComposerEditTransaction(
  input: ComposerEditTransaction,
): ComposerEditTransactionResult {
  const projectRoot = canonicalDirectory(input.projectPath);
  const prepared: PreparedEdit[] = [];

  const pageEdits = [
    ...(input.page ? [input.page] : []),
    ...(input.pages ?? []),
  ];
  for (const pageEdit of pageEdits) {
    const absoluteFile = resolveComposerPageFile(
      projectRoot,
      pageEdit.relativeFile,
    );
    const text = serializeAstro(pageEdit.model);
    assertCleanPageSource(text);
    prepared.push(
      prepareEdit(
        absoluteFile,
        cleanRelativeFile(projectRoot, absoluteFile),
        text,
        pageEdit.expectedMtimeMs,
      ),
    );
  }

  for (const sourceEdit of input.sources ?? []) {
    const absoluteFile = resolveComposerPageFile(
      projectRoot,
      sourceEdit.relativeFile,
    );
    assertCleanPageSource(sourceEdit.source);
    assertCompilerValidAstroSource(sourceEdit.source, sourceEdit.relativeFile);
    prepared.push(
      prepareEdit(
        absoluteFile,
        cleanRelativeFile(projectRoot, absoluteFile),
        sourceEdit.source,
        sourceEdit.expectedMtimeMs,
        sourceEdit.expectedSource,
      ),
    );
  }

  for (const stylesheet of input.stylesheets ?? []) {
    const absoluteFile = resolveWithinRoot(projectRoot, stylesheet.relativeFile, {
      rejectFinalSymlink: true,
    });
    if (path.extname(absoluteFile).toLowerCase() !== ".css") {
      throw new Error("Composer stylesheet edits must target .css files");
    }
    prepared.push(
      prepareEdit(
        absoluteFile,
        cleanRelativeFile(projectRoot, absoluteFile),
        stylesheet.content,
        stylesheet.expectedMtimeMs,
      ),
    );
  }

  for (const artifact of input.managedArtifacts ?? []) {
    const relativeFile = assertManagedArtifact(artifact.relativeFile, artifact.owner);
    const absoluteFile = resolveWithinRoot(projectRoot, relativeFile, {
      allowMissing: true,
      rejectFinalSymlink: true,
    });
    prepared.push(
      prepareManagedEdit(
        absoluteFile,
        relativeFile,
        artifact.content,
        artifact.expectedMtimeMs,
      ),
    );
  }

  if ((pageEdits.length || input.sources?.length) && !(input.managedArtifacts?.length)) {
    const pendingSources = new Map<string, string>();
    for (const edit of prepared) {
      if (edit.relativeFile.endsWith(".astro") && edit.after !== null) {
        pendingSources.set(edit.relativeFile, edit.after);
      }
    }
    for (const artifact of buildMotionArtifactEdits(projectRoot, pendingSources)) {
      const relativeFile = assertManagedArtifact(artifact.relativeFile, artifact.owner);
      const absoluteFile = resolveWithinRoot(projectRoot, relativeFile, {
        allowMissing: true,
        rejectFinalSymlink: true,
      });
      prepared.push(prepareManagedEdit(absoluteFile, relativeFile, artifact.content, artifact.expectedMtimeMs, false));
    }
  }

  const pendingAstro = new Map<string, string>();
  for (const edit of prepared) {
    if (edit.relativeFile.endsWith(".astro") && edit.after !== null) {
      pendingAstro.set(edit.relativeFile, edit.after);
    }
  }
  const bemStyles = buildAriaBemPrimitiveStylesheetEdit(projectRoot, pendingAstro);
  if (bemStyles) {
    const existingCss = prepared.find(
      (edit) => toPosix(edit.relativeFile) === toPosix(bemStyles.relativeFile),
    );
    if (existingCss && existingCss.after != null) {
      existingCss.after = applyAriaBemPrimitivesToStylesheet(existingCss.after);
    } else {
      const absoluteFile = resolveWithinRoot(projectRoot, bemStyles.relativeFile, {
        rejectFinalSymlink: true,
      });
      prepared.push(
        prepareEdit(absoluteFile, bemStyles.relativeFile, bemStyles.content),
      );
    }
  }

  if (!prepared.length) throw new Error("Composer transaction has no edits");
  const duplicate = prepared.find(
    (edit, index) =>
      prepared.findIndex((candidate) => candidate.absoluteFile === edit.absoluteFile) !==
      index,
  );
  if (duplicate) {
    throw new Error(`Composer transaction targets ${duplicate.relativeFile} more than once`);
  }

  const conflicts = prepared
    .filter(
      (edit) =>
        (edit.expectedMtimeMs != null &&
          edit.expectedMtimeMs !== edit.currentMtimeMs) ||
        (edit.expectedSource != null && edit.expectedSource !== edit.before),
    )
    .map((edit) => ({
      relativeFile: edit.relativeFile,
      mtimeMs: edit.currentMtimeMs,
      expectedMtimeMs: edit.expectedMtimeMs ?? edit.currentMtimeMs,
    }));
  if (conflicts.length) {
    return {
      ok: false,
      code: "mtime_conflict",
      message: `${conflicts.map((item) => item.relativeFile).join(", ")} changed on disk. Reload Composer before saving.`,
      conflicts,
    };
  }

  const written: PreparedEdit[] = [];
  const transactionId = randomUUID();
  const pendingWrites = prepared.filter((edit) => edit.before !== edit.after);
  const changedFiles = pendingWrites.map((edit) => ({
    relativeFile: edit.relativeFile,
    contentHash: createHash("sha256").update(edit.after ?? "").digest("hex"),
    role: previewFileRole(edit.relativeFile),
  }));
  const runtimeAssetsChanged = pendingWrites.some(
    (edit) =>
      MOTION_RUNTIME_ASSETS.has(edit.relativeFile) &&
      (edit.before === null) !== (edit.after === null),
  );
  const previewWrites = pendingWrites.map((edit) => ({
      relativeFile: edit.relativeFile,
      contentHash: createHash("sha256").update(edit.after ?? "").digest("hex"),
      deleted: edit.after === null,
      role: previewFileRole(edit.relativeFile),
    }));
  if (
    previewWrites.length &&
    typeof input.previewRevision === "number" &&
    Number.isFinite(input.previewRevision) &&
    input.previewRevision > 0
  ) {
    try {
      recordComposerWriteJournal({
        projectPath: projectRoot,
        transactionId,
        revision: Math.max(0, Math.floor(input.previewRevision ?? 0)),
        files: previewWrites,
        complete: false,
      });
    } catch {
      // Source-level transaction tests and non-Electron consumers may not have
      // configured app-local preview storage. Persistence remains valid; only
      // Composer HMR suppression is unavailable in that environment.
    }
  }
  try {
    for (const edit of prepared) {
      if (edit.before === edit.after) continue;
      applyPreparedEdit(edit);
      written.push(edit);
    }
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const edit of [...written].reverse()) {
      try {
        restorePreparedEdit(edit);
      } catch (rollbackError) {
        rollbackErrors.push(
          `${edit.relativeFile}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error],
        `Composer transaction failed and rollback was incomplete: ${rollbackErrors.join("; ")}`,
      );
    }
    throw error;
  }

  if (
    previewWrites.length &&
    typeof input.previewRevision === "number" &&
    Number.isFinite(input.previewRevision) &&
    input.previewRevision > 0
  ) {
    try {
      recordComposerWriteJournal({
        projectPath: projectRoot,
        transactionId,
        revision: Math.floor(input.previewRevision),
        files: previewWrites,
        complete: true,
      });
    } catch {
      /* HMR suppression was already best-effort above. */
    }
  }

  const revisions: ComposerFileRevision[] = prepared.filter((edit) => edit.reportRevision).map((edit) => ({
    relativeFile: edit.relativeFile,
    mtimeMs: existsSync(edit.absoluteFile)
      ? Math.floor(statSync(edit.absoluteFile).mtimeMs)
      : 0,
  }));
  return {
    ok: true,
    revisions,
    transactionId,
    previewRevision: typeof input.previewRevision === "number" && Number.isFinite(input.previewRevision)
      ? Math.max(0, Math.floor(input.previewRevision))
      : null,
    changedFiles,
    runtimeAssetsChanged,
  };
}
