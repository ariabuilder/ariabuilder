import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  AriaEntryRecordSchema,
  AriaEntryRevisionSchema,
  type AriaEntryRecord,
  type AriaEntryRevision,
} from "../../shared/cms";
import {
  canonicalDirectory,
  removePathTracked,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "../pathSafety";

const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_REVISION_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES_PER_COLLECTION = 50_000;
const MAX_REVISIONS_PER_ENTRY = 10_000;

function assertSafeSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  if (trimmed.length > 128) throw new Error(`${label} is too long`);
  if (
    trimmed.includes("\0") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    trimmed === "." ||
    trimmed === ".."
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return trimmed;
}

function entriesRoot(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(root, path.join(root, ".aria", "cms", "entries"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function revisionsRoot(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(
    root,
    path.join(root, ".aria", "cms", "revisions"),
    {
      allowMissing: true,
      rejectFinalSymlink: true,
    },
  );
}

function collectionEntriesDir(
  projectPath: string,
  collectionId: string,
): string {
  const root = canonicalDirectory(projectPath);
  const id = assertSafeSegment(collectionId, "collectionId");
  return resolveWithinRoot(root, path.join(entriesRoot(projectPath), id), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function entryFilePath(
  projectPath: string,
  collectionId: string,
  entryId: string,
): string {
  const root = canonicalDirectory(projectPath);
  const id = assertSafeSegment(entryId, "entryId");
  return resolveWithinRoot(
    root,
    path.join(collectionEntriesDir(projectPath, collectionId), `${id}.json`),
    {
      allowMissing: true,
      rejectFinalSymlink: true,
    },
  );
}

function entryRevisionsDir(projectPath: string, entryId: string): string {
  const root = canonicalDirectory(projectPath);
  const id = assertSafeSegment(entryId, "entryId");
  return resolveWithinRoot(root, path.join(revisionsRoot(projectPath), id), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function revisionFilePath(
  projectPath: string,
  entryId: string,
  revisionId: string,
): string {
  const root = canonicalDirectory(projectPath);
  const revId = assertSafeSegment(revisionId, "revisionId");
  return resolveWithinRoot(
    root,
    path.join(entryRevisionsDir(projectPath, entryId), `${revId}.json`),
    {
      allowMissing: true,
      rejectFinalSymlink: true,
    },
  );
}

function readJsonFile(file: string, maxBytes: number): unknown | null {
  if (!existsSync(file)) return null;
  try {
    const stats = statSync(file);
    if (!stats.isFile()) return null;
    if (stats.size > maxBytes) {
      throw new Error("File exceeds size limit");
    }
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `CMS file could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Keep older CMS documents readable without touching user frontmatter. */
function normalizeLegacyEntryRecord(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const record = raw as Record<string, unknown>;
  const entry = record.entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return raw;
  const normalized = { ...record };
  const nextEntry = { ...(entry as Record<string, unknown>) };
  delete nextEntry.scheduledFor;
  delete nextEntry.scheduleLeaseToken;
  delete nextEntry.scheduleLeaseExpiresAt;
  delete nextEntry.scheduleAttemptCount;
  delete nextEntry.lastScheduleError;
  if (nextEntry.status === "scheduled") nextEntry.status = "draft";
  normalized.entry = nextEntry;
  return normalized;
}

function normalizeLegacyRevision(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const revision = raw as Record<string, unknown>;
  const snapshot = revision.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return raw;
  }
  return { ...revision, snapshot: normalizeLegacyEntryRecord(snapshot) };
}

function parseEntryRecord(raw: unknown): AriaEntryRecord | null {
  const parsed = AriaEntryRecordSchema.safeParse(normalizeLegacyEntryRecord(raw));
  return parsed.success ? parsed.data : null;
}

function parseRevision(raw: unknown): AriaEntryRevision | null {
  const parsed = AriaEntryRevisionSchema.safeParse(normalizeLegacyRevision(raw));
  return parsed.success ? parsed.data : null;
}

/** List entry ids stored for a collection (filename stem without `.json`). */
export function listEntryFiles(
  projectPath: string,
  collectionId: string,
): string[] {
  const dir = collectionEntriesDir(projectPath, collectionId);
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir);
  const ids: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (!id || id.includes(".") || id.includes("/") || id.includes("\\")) {
      continue;
    }
    const file = path.join(dir, name);
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    ids.push(id);
    if (ids.length > MAX_ENTRIES_PER_COLLECTION) {
      throw new Error("Too many entries in collection");
    }
  }
  return ids;
}

export function readEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
): AriaEntryRecord | null {
  const file = entryFilePath(projectPath, collectionId, entryId);
  const raw = readJsonFile(file, MAX_ENTRY_BYTES);
  if (raw == null) return null;
  return parseEntryRecord(raw);
}

export function writeEntry(
  projectPath: string,
  collectionId: string,
  record: AriaEntryRecord,
): void {
  const normalized = AriaEntryRecordSchema.parse(record);
  if (normalized.entry.collectionId !== collectionId) {
    throw new Error("Entry collectionId mismatch");
  }
  const file = entryFilePath(projectPath, collectionId, normalized.entry.id);
  mkdirSync(path.dirname(file), { recursive: true });
  const payload = `${JSON.stringify(normalized, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MAX_ENTRY_BYTES) {
    throw new Error("Entry exceeds size limit");
  }
  writeTextFileAtomic(file, payload);
  // Content sync runs from services after mutations (syncAfterEntryMutation).
}

export function deleteEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
): void {
  const file = entryFilePath(projectPath, collectionId, entryId);
  if (existsSync(file)) {
    removePathTracked(file, { force: true });
  }
  const revisionsDir = entryRevisionsDir(projectPath, entryId);
  if (existsSync(revisionsDir)) {
    removePathTracked(revisionsDir, { recursive: true, force: true });
  }
}

/** Remove all entry JSON (+ revisions) for a collection. */
export function deleteAllEntriesForCollection(
  projectPath: string,
  collectionId: string,
): AriaEntryRecord[] {
  const records = listEntries(projectPath, collectionId);
  for (const record of records) {
    deleteEntry(projectPath, collectionId, record.entry.id);
  }
  const dir = collectionEntriesDir(projectPath, collectionId);
  if (existsSync(dir)) {
    removePathTracked(dir, { recursive: true, force: true });
  }
  return records;
}

export function listEntries(
  projectPath: string,
  collectionId: string,
): AriaEntryRecord[] {
  const ids = listEntryFiles(projectPath, collectionId);
  const records: AriaEntryRecord[] = [];
  for (const id of ids) {
    const record = readEntry(projectPath, collectionId, id);
    if (record) records.push(record);
  }
  return records;
}

export function writeRevision(
  projectPath: string,
  revision: AriaEntryRevision,
): void {
  const normalized = AriaEntryRevisionSchema.parse(revision);
  const file = revisionFilePath(
    projectPath,
    normalized.entryId,
    normalized.id,
  );
  mkdirSync(path.dirname(file), { recursive: true });
  const payload = `${JSON.stringify(normalized, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MAX_REVISION_BYTES) {
    throw new Error("Revision exceeds size limit");
  }
  writeTextFileAtomic(file, payload);
}

export function listRevisions(
  projectPath: string,
  entryId: string,
): AriaEntryRevision[] {
  const dir = entryRevisionsDir(projectPath, entryId);
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir);
  const revisions: AriaEntryRevision[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const revisionId = name.slice(0, -".json".length);
    if (!revisionId) continue;
    const revision = readRevision(projectPath, entryId, revisionId);
    if (revision) revisions.push(revision);
    if (revisions.length > MAX_REVISIONS_PER_ENTRY) {
      throw new Error("Too many revisions for entry");
    }
  }
  revisions.sort((a, b) => {
    if (a.createdAt === b.createdAt) return b.id.localeCompare(a.id);
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  return revisions;
}

export function readRevision(
  projectPath: string,
  entryId: string,
  revisionId: string,
): AriaEntryRevision | null {
  const file = revisionFilePath(projectPath, entryId, revisionId);
  const raw = readJsonFile(file, MAX_REVISION_BYTES);
  if (raw == null) return null;
  return parseRevision(raw);
}

export function findEntryBySlug(
  projectPath: string,
  collectionId: string,
  slug: string,
  locale?: string,
): AriaEntryRecord | null {
  const needle = slug.trim();
  if (!needle) return null;
  const localeNeedle = locale?.trim() || null;
  for (const record of listEntries(projectPath, collectionId)) {
    for (const loc of record.locales) {
      if (loc.slug !== needle) continue;
      if (localeNeedle && loc.locale !== localeNeedle) continue;
      return record;
    }
  }
  return null;
}

export function findEntryByIdAcrossCollections(
  projectPath: string,
  entryId: string,
): { collectionId: string; record: AriaEntryRecord } | null {
  const id = assertSafeSegment(entryId, "entryId");
  const root = entriesRoot(projectPath);
  if (!existsSync(root)) return null;
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return null;
  }
  for (const collectionId of dirs) {
    const dirPath = path.join(root, collectionId);
    try {
      if (!statSync(dirPath).isDirectory()) continue;
    } catch {
      continue;
    }
    const record = readEntry(projectPath, collectionId, id);
    if (record) return { collectionId, record };
  }
  return null;
}
