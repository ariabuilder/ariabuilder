import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { canonicalDirectory, resolveWithinRoot, writeTextFileAtomic } from "../pathSafety";

const ProviderSchema = z.enum(["payload", "sanity", "external"]);
const HandoffDraftInputSchema = z.object({
  provider: ProviderSchema,
  collection: z.string().trim().min(1).max(200),
  recordId: z.string().trim().min(1).max(500),
  sourceVersion: z.string().trim().min(1).max(500).optional(),
  sourceContentHash: z.string().trim().min(1).max(500),
  targetLocale: z.string().trim().min(1).max(40),
  proposedFieldPatch: z.record(z.string().trim().min(1).max(500), z.unknown()),
}).strict();

export type HandoffDraftInput = z.infer<typeof HandoffDraftInputSchema>;
export type HandoffDraft = HandoffDraftInput & {
  id: string;
  createdAt: string;
  state: "local-unapplied";
};

const SENSITIVE_KEY = /(?:authorization|api[-_]?key|password|secret|token|credential)/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DRAFTS = 500;

function filePath(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(root, path.join(root, ".aria", "cms-handoff-drafts.json"), { allowMissing: true, rejectFinalSymlink: true });
}

function containsSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => SENSITIVE_KEY.test(key) || containsSensitiveKey(child));
}

export function readHandoffDrafts(projectPath: string): HandoffDraft[] {
  const file = filePath(projectPath);
  if (!existsSync(file)) return [];
  if (!statSync(file).isFile() || statSync(file).size > MAX_FILE_BYTES) throw new Error("CMS handoff draft file is invalid or too large");
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? parsed.slice(0, MAX_DRAFTS) as HandoffDraft[] : [];
}

export function createHandoffDraft(projectPath: string, input: unknown): HandoffDraft {
  const parsed = HandoffDraftInputSchema.parse(input);
  if (containsSensitiveKey(parsed.proposedFieldPatch)) {
    throw new Error("Handoff drafts cannot contain credentials, tokens, or secrets");
  }
  const serializedPatch = JSON.stringify(parsed.proposedFieldPatch);
  if (serializedPatch.length > 256 * 1024) throw new Error("Handoff patch is too large");
  const draft: HandoffDraft = { ...parsed, id: randomUUID(), createdAt: new Date().toISOString(), state: "local-unapplied" };
  const existing = readHandoffDrafts(projectPath);
  const file = filePath(projectPath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeTextFileAtomic(file, `${JSON.stringify([draft, ...existing].slice(0, MAX_DRAFTS), null, 2)}\n`);
  return draft;
}
