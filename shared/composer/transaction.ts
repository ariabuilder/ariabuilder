import type { AstroDocumentModel } from "./types";

export type ComposerFileRevision = {
  relativeFile: string;
  mtimeMs: number;
};

export type ComposerPageEdit = {
  relativeFile: string;
  model: AstroDocumentModel;
  expectedMtimeMs?: number | null;
};

/** Exact Astro source authored in Code mode. */
export type ComposerSourceEdit = {
  relativeFile: string;
  source: string;
  /** Exact disk source the draft was based on (stronger than mtime alone). */
  expectedSource?: string;
  expectedMtimeMs?: number | null;
};

export type ComposerStylesheetEdit = {
  relativeFile: string;
  content: string;
  expectedMtimeMs?: number | null;
};

export type ComposerManagedArtifactEdit = {
  /** Restricted to Aria-owned generated motion outputs. */
  relativeFile: string;
  /** Null deletes the managed artifact. */
  content: string | null;
  expectedMtimeMs?: number | null;
  owner: "motion";
};

/**
 * A single source edit. Every referenced revision is preflighted before any
 * rename occurs, so an Astro mutation and its CSS rule are one disk commit.
 */
export type ComposerEditTransaction = {
  projectPath: string;
  /** Backward-compatible single-page edit. */
  page?: ComposerPageEdit;
  /** Every Astro document participating in one layout-contract commit. */
  pages?: ComposerPageEdit[];
  /** Compiler-valid raw Astro sources; formatting is preserved byte-for-byte. */
  sources?: ComposerSourceEdit[];
  stylesheets?: ComposerStylesheetEdit[];
  managedArtifacts?: ComposerManagedArtifactEdit[];
  /** Surface-owned preview revision associated with this persistence write. */
  previewRevision?: number;
};

export type ComposerConflictResult = {
  ok: false;
  code: "mtime_conflict";
  message: string;
  conflicts: Array<ComposerFileRevision & { expectedMtimeMs: number }>;
};

export type ComposerEditTransactionResult =
  | {
      ok: true;
      revisions: ComposerFileRevision[];
      transactionId: string;
      previewRevision: number | null;
      changedFiles: Array<{ relativeFile: string; contentHash: string; role: "astro" | "stylesheet" | "runtime" }>;
      runtimeAssetsChanged: boolean;
    }
  | ComposerConflictResult;
