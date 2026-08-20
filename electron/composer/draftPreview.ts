import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalDirectory, writeTextFileAtomic } from "../pathSafety";
import { resolveComposerPageFile } from "./parsePage";

export type ComposerPreviewDraft = {
  leaseId: string;
  relativeFile: string;
  source: string;
  revision: number;
  updatedAt: number;
};

export type ComposerWriteJournal = {
  transactionId: string;
  revision: number;
  expiresAt: number;
  complete: boolean;
  files: Array<{ relativeFile: string; contentHash: string; deleted: boolean; role: "astro" | "stylesheet" | "runtime" }>;
};

let draftsDirectory: string | null = null;

export function configureComposerDraftPreview(userDataPath: string): void {
  draftsDirectory = path.join(userDataPath, "composer-preview-drafts");
  fs.mkdirSync(draftsDirectory, { recursive: true });
  for (const name of fs.readdirSync(draftsDirectory)) {
    if (!name.endsWith(".json")) continue;
    try {
      fs.unlinkSync(path.join(draftsDirectory, name));
    } catch {
      /* stale preview cleanup is best effort */
    }
  }
}

function requireDraftsDirectory(): string {
  if (!draftsDirectory) throw new Error("Composer preview drafts are not configured");
  return draftsDirectory;
}

export function composerDraftFileForProject(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  const name = createHash("sha256").update(root).digest("hex");
  return path.join(requireDraftsDirectory(), `${name}.json`);
}

export function composerJournalFileForProject(projectPath: string): string {
  return composerDraftFileForProject(projectPath).replace(/\.json$/, ".writes.json");
}

export function recordComposerWriteJournal(input: {
  projectPath: string;
  transactionId: string;
  revision: number;
  complete?: boolean;
  files: Array<{ relativeFile: string; contentHash: string; deleted: boolean; role: "astro" | "stylesheet" | "runtime" }>;
}): void {
  const journal: ComposerWriteJournal = {
    transactionId: input.transactionId,
    revision: input.revision,
    expiresAt: Date.now() + 10_000,
    complete: input.complete === true,
    files: input.files.map((file) => ({
      relativeFile: file.relativeFile.replace(/\\/g, "/"),
      contentHash: file.contentHash,
      deleted: file.deleted,
      role: file.role,
    })),
  };
  writeTextFileAtomic(
    composerJournalFileForProject(input.projectPath),
    `${JSON.stringify(journal)}\n`,
  );
}

function readDraft(projectPath: string): ComposerPreviewDraft | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(composerDraftFileForProject(projectPath), "utf8"),
    ) as Partial<ComposerPreviewDraft>;
    if (
      typeof parsed.leaseId !== "string" ||
      typeof parsed.relativeFile !== "string" ||
      typeof parsed.source !== "string" ||
      typeof parsed.revision !== "number" ||
      typeof parsed.updatedAt !== "number"
    ) return null;
    return parsed as ComposerPreviewDraft;
  } catch {
    return null;
  }
}

export function setComposerPreviewDraft(input: {
  projectPath: string;
  relativeFile: string;
  source: string;
  leaseId: string;
  revision?: number;
}): { ok: true; revision: number } {
  const root = canonicalDirectory(input.projectPath);
  if (!input.leaseId.trim()) throw new Error("Composer draft lease is required");
  resolveComposerPageFile(root, input.relativeFile);
  const current = readDraft(root);
  if (current && current.leaseId !== input.leaseId) {
    throw new Error("Another Composer window owns this project's preview draft");
  }
  const revision = Math.max(
    (current?.revision ?? 0) + 1,
    Math.floor(input.revision ?? 0),
  );
  const draft: ComposerPreviewDraft = {
    leaseId: input.leaseId,
    relativeFile: input.relativeFile.replace(/\\/g, "/"),
    source: input.source,
    revision,
    updatedAt: Date.now(),
  };
  writeTextFileAtomic(
    composerDraftFileForProject(root),
    `${JSON.stringify(draft)}\n`,
  );
  return { ok: true, revision };
}

export function clearComposerPreviewDraft(input: {
  projectPath: string;
  leaseId?: string | null;
}): { ok: true; cleared: boolean } {
  const file = composerDraftFileForProject(input.projectPath);
  const current = readDraft(input.projectPath);
  if (!current) return { ok: true, cleared: false };
  if (input.leaseId && current.leaseId !== input.leaseId) {
    return { ok: true, cleared: false };
  }
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { ok: true, cleared: true };
}
