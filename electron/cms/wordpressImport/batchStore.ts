import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeBinaryFileAtomic,
  writeTextFileAtomic,
} from "../../pathSafety";
import {
  WordPressImportBatchSchema,
  WordPressImportEventSchema,
  WordPressImportFileSchema,
  WordPressImportItemSchema,
  WordPressImportMappingSchema,
  WordPressImportMediaSchema,
  type WordPressImportBatch,
  type WordPressImportEvent,
  type WordPressImportFile,
  type WordPressImportItem,
  type WordPressImportMapping,
  type WordPressImportMedia,
} from "./schemas";

const IMPORTS_REL = ".aria/imports/wordpress";
const MAPPINGS_FILE = "mappings.json";

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function importsRoot(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(root, path.join(root, IMPORTS_REL), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function ensureImportsRoot(projectPath: string): string {
  const dir = importsRoot(projectPath);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function batchDir(projectPath: string, batchId: string): string {
  const safeId = batchId.trim();
  if (!safeId || safeId.includes("..") || safeId.includes("/") || safeId.includes("\\")) {
    throw new Error(`Invalid WordPress import batch id: ${batchId}`);
  }
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(root, path.join(importsRoot(projectPath), safeId), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function ensureBatchDir(projectPath: string, batchId: string): string {
  const dir = batchDir(projectPath, batchId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function batchFilePath(
  projectPath: string,
  batchId: string,
  name: string,
): string {
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(root, path.join(batchDir(projectPath, batchId), name), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function mappingsPath(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(root, path.join(importsRoot(projectPath), MAPPINGS_FILE), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function readJsonFile<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeTextFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readArrayFile<T>(
  file: string,
  schema: { parse: (value: unknown) => T },
): T[] {
  const raw = readJsonFile<unknown>(file, []);
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    try {
      out.push(schema.parse(item));
    } catch {
      // Skip corrupt rows rather than failing the whole batch.
    }
  }
  return out;
}

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) return [...items, next];
  const copy = [...items];
  copy[index] = next;
  return copy;
}

export function wordpressImportObjectKey(
  batchId: string,
  filename: string,
): string {
  const safe =
    filename
      .trim()
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "wordpress-import.xml";
  return toPosix(path.join(IMPORTS_REL, batchId, safe));
}

export function saveWordPressImportBatch(
  projectPath: string,
  batch: WordPressImportBatch,
): WordPressImportBatch {
  ensureBatchDir(projectPath, batch.id);
  const parsed = WordPressImportBatchSchema.parse(batch);
  writeJsonFile(batchFilePath(projectPath, batch.id, "batch.json"), parsed);
  return parsed;
}

export function getWordPressImportBatch(
  projectPath: string,
  batchId: string,
): WordPressImportBatch | null {
  const file = batchFilePath(projectPath, batchId, "batch.json");
  if (!existsSync(file)) return null;
  try {
    return WordPressImportBatchSchema.parse(
      JSON.parse(readFileSync(file, "utf8")),
    );
  } catch {
    return null;
  }
}

export function listWordPressImportBatches(
  projectPath: string,
  options?: { limit?: number },
): WordPressImportBatch[] {
  const root = ensureImportsRoot(projectPath);
  if (!existsSync(root)) return [];
  const batches: WordPressImportBatch[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const batch = getWordPressImportBatch(projectPath, entry.name);
    if (batch) batches.push(batch);
  }
  batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const limit = options?.limit;
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    return batches.slice(0, Math.floor(limit));
  }
  return batches;
}

export function deleteWordPressImportBatch(
  projectPath: string,
  batchId: string,
): void {
  const dir = batchDir(projectPath, batchId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function saveWordPressImportFile(
  projectPath: string,
  file: WordPressImportFile,
): WordPressImportFile {
  ensureBatchDir(projectPath, file.batchId);
  const parsed = WordPressImportFileSchema.parse(file);
  const pathName = batchFilePath(projectPath, file.batchId, "files.json");
  const existing = readArrayFile(pathName, WordPressImportFileSchema);
  writeJsonFile(pathName, upsertById(existing, parsed));
  return parsed;
}

export function listWordPressImportFiles(
  projectPath: string,
  batchId: string,
): WordPressImportFile[] {
  return readArrayFile(
    batchFilePath(projectPath, batchId, "files.json"),
    WordPressImportFileSchema,
  );
}

export function deleteWordPressImportFile(
  projectPath: string,
  batchId: string,
  fileId: string,
): void {
  const pathName = batchFilePath(projectPath, batchId, "files.json");
  const existing = readArrayFile(pathName, WordPressImportFileSchema);
  const next = existing.filter((item) => item.id !== fileId);
  writeJsonFile(pathName, next);
}

export function listExpiredWordPressImportFiles(
  projectPath: string,
  nowIso: string,
): WordPressImportFile[] {
  const expired: WordPressImportFile[] = [];
  for (const batch of listWordPressImportBatches(projectPath)) {
    for (const file of listWordPressImportFiles(projectPath, batch.id)) {
      if (file.retentionExpiresAt <= nowIso) {
        expired.push(file);
      }
    }
  }
  return expired;
}

export function writeWordPressImportSourceBytes(
  projectPath: string,
  objectKey: string,
  bytes: Uint8Array,
): string {
  const root = canonicalDirectory(projectPath);
  const absolute = resolveWithinRoot(
    root,
    path.join(root, ...toPosix(objectKey).split("/")),
    { allowMissing: true, rejectFinalSymlink: true },
  );
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeBinaryFileAtomic(absolute, bytes);
  return absolute;
}

export function readWordPressImportSourceBytes(
  projectPath: string,
  objectKey: string,
): Uint8Array | null {
  const root = canonicalDirectory(projectPath);
  try {
    const absolute = resolveWithinRoot(
      root,
      path.join(root, ...toPosix(objectKey).split("/")),
      { rejectFinalSymlink: true },
    );
    if (!existsSync(absolute)) return null;
    return new Uint8Array(readFileSync(absolute));
  } catch {
    return null;
  }
}

export function deleteWordPressImportSourceBytes(
  projectPath: string,
  objectKey: string,
): void {
  const root = canonicalDirectory(projectPath);
  const absolute = resolveWithinRoot(
    root,
    path.join(root, ...toPosix(objectKey).split("/")),
    { allowMissing: true, rejectFinalSymlink: true },
  );
  if (existsSync(absolute)) {
    unlinkSync(absolute);
  }
}

export function saveWordPressImportItem(
  projectPath: string,
  item: WordPressImportItem,
): WordPressImportItem {
  ensureBatchDir(projectPath, item.batchId);
  const parsed = WordPressImportItemSchema.parse(item);
  const pathName = batchFilePath(projectPath, item.batchId, "items.json");
  const existing = readArrayFile(pathName, WordPressImportItemSchema);
  writeJsonFile(pathName, upsertById(existing, parsed));
  return parsed;
}

export function listWordPressImportItems(
  projectPath: string,
  batchId: string,
): WordPressImportItem[] {
  return readArrayFile(
    batchFilePath(projectPath, batchId, "items.json"),
    WordPressImportItemSchema,
  );
}

export function saveWordPressImportMedia(
  projectPath: string,
  media: WordPressImportMedia,
): WordPressImportMedia {
  ensureBatchDir(projectPath, media.batchId);
  const parsed = WordPressImportMediaSchema.parse(media);
  const pathName = batchFilePath(projectPath, media.batchId, "media.json");
  const existing = readArrayFile(pathName, WordPressImportMediaSchema);
  writeJsonFile(pathName, upsertById(existing, parsed));
  return parsed;
}

export function listWordPressImportMedia(
  projectPath: string,
  batchId: string,
): WordPressImportMedia[] {
  return readArrayFile(
    batchFilePath(projectPath, batchId, "media.json"),
    WordPressImportMediaSchema,
  );
}

export function appendWordPressImportEvent(
  projectPath: string,
  event: WordPressImportEvent,
): WordPressImportEvent {
  ensureBatchDir(projectPath, event.batchId);
  const parsed = WordPressImportEventSchema.parse(event);
  const pathName = batchFilePath(projectPath, event.batchId, "events.json");
  const existing = readArrayFile(pathName, WordPressImportEventSchema);
  writeJsonFile(pathName, [...existing, parsed]);
  return parsed;
}

export function listWordPressImportEvents(
  projectPath: string,
  batchId: string,
): WordPressImportEvent[] {
  return readArrayFile(
    batchFilePath(projectPath, batchId, "events.json"),
    WordPressImportEventSchema,
  );
}

function readAllMappings(projectPath: string): WordPressImportMapping[] {
  ensureImportsRoot(projectPath);
  return readArrayFile(mappingsPath(projectPath), WordPressImportMappingSchema);
}

function writeAllMappings(
  projectPath: string,
  mappings: WordPressImportMapping[],
): void {
  ensureImportsRoot(projectPath);
  writeJsonFile(mappingsPath(projectPath), mappings);
}

export function saveWordPressImportMapping(
  projectPath: string,
  mapping: WordPressImportMapping,
): WordPressImportMapping {
  const parsed = WordPressImportMappingSchema.parse(mapping);
  const existing = readAllMappings(projectPath);
  const index = existing.findIndex(
    (item) =>
      item.sourceSiteHash === parsed.sourceSiteHash &&
      item.sourceKind === parsed.sourceKind &&
      item.sourceId === parsed.sourceId,
  );
  if (index >= 0) {
    const next = [...existing];
    next[index] = { ...parsed, id: existing[index]!.id, createdAt: existing[index]!.createdAt };
    writeAllMappings(projectPath, next);
    return next[index]!;
  }
  writeAllMappings(projectPath, [...existing, parsed]);
  return parsed;
}

export function getWordPressImportMapping(
  projectPath: string,
  options: {
    sourceSiteHash: string;
    sourceKind: string;
    sourceId: string;
  },
): WordPressImportMapping | null {
  return (
    readAllMappings(projectPath).find(
      (item) =>
        item.sourceSiteHash === options.sourceSiteHash &&
        item.sourceKind === options.sourceKind &&
        item.sourceId === options.sourceId,
    ) ?? null
  );
}

export function listWordPressImportMappings(
  projectPath: string,
  sourceSiteHash?: string,
): WordPressImportMapping[] {
  const mappings = readAllMappings(projectPath);
  if (!sourceSiteHash) return mappings;
  return mappings.filter((item) => item.sourceSiteHash === sourceSiteHash);
}
