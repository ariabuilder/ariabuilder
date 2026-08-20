import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { shell } from "../electron-api";
import {
  SiteExportRecordSchema,
  type SiteExportRecord,
} from "../../shared/export";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeBinaryFileAtomic,
  writeTextFileAtomic,
} from "../pathSafety";

const EXPORTS_REL = path.join(".aria", "exports");
const METADATA_FILE_NAME = "meta.json";

function exportsRoot(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(root, path.join(root, EXPORTS_REL), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function exportDirForId(projectPath: string, id: string): string {
  const root = canonicalDirectory(projectPath);
  const base = exportsRoot(projectPath);
  return resolveWithinRoot(root, path.join(base, id), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

function isExpired(record: SiteExportRecord): boolean {
  return Date.now() >= new Date(record.expiresAt).getTime();
}

function compareNewestFirst(a: SiteExportRecord, b: SiteExportRecord): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function ensureExportsRoot(projectPath: string): string {
  const dir = exportsRoot(projectPath);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function listExportIds(projectPath: string): string[] {
  const base = exportsRoot(projectPath);
  if (!existsSync(base) || !statSync(base).isDirectory()) return [];
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readRecord(
  projectPath: string,
  id: string,
): SiteExportRecord | null {
  const root = canonicalDirectory(projectPath);
  const metaPath = path.join(exportDirForId(projectPath, id), METADATA_FILE_NAME);
  try {
    const absolute = resolveWithinRoot(root, metaPath, {
      rejectFinalSymlink: true,
    });
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return null;
    const raw = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
    return SiteExportRecordSchema.parse(raw);
  } catch {
    return null;
  }
}

export function buildSiteExportRecord(input: {
  id: string;
  filename: string;
  createdAt: string;
  expiresAt: string;
  pageCount: number;
  layoutCount?: number;
  componentCount?: number;
  mediaCount: number;
  cmsCollectionCount?: number;
  cmsEntryCount?: number;
  redirectCount?: number;
  sizeBytes: number;
  estimatedMediaBytes?: number;
  selection?: SiteExportRecord["selection"];
}): SiteExportRecord {
  const exportDir = toPosix(path.join(".aria", "exports", input.id));
  return SiteExportRecordSchema.parse({
    id: input.id,
    filename: input.filename,
    exportDir,
    artifactPath: `${exportDir}/${input.filename}`,
    metadataPath: `${exportDir}/${METADATA_FILE_NAME}`,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    pageCount: input.pageCount,
    layoutCount: input.layoutCount ?? 0,
    componentCount: input.componentCount ?? 0,
    mediaCount: input.mediaCount,
    cmsCollectionCount: input.cmsCollectionCount ?? 0,
    cmsEntryCount: input.cmsEntryCount ?? 0,
    redirectCount: input.redirectCount ?? 0,
    sizeBytes: input.sizeBytes,
    estimatedMediaBytes: input.estimatedMediaBytes ?? 0,
    selection: input.selection,
  });
}

/** Persist zip bytes + meta.json under `.aria/exports/{id}/`. */
export function saveSiteExport(
  projectPath: string,
  record: SiteExportRecord,
  bytes: Uint8Array,
): SiteExportRecord {
  const root = canonicalDirectory(projectPath);
  const dir = exportDirForId(projectPath, record.id);
  mkdirSync(dir, { recursive: true });

  const artifactAbsolute = resolveWithinRoot(
    root,
    path.join(dir, record.filename),
    { allowMissing: true, rejectFinalSymlink: true },
  );
  const metaAbsolute = resolveWithinRoot(
    root,
    path.join(dir, METADATA_FILE_NAME),
    { allowMissing: true, rejectFinalSymlink: true },
  );

  writeBinaryFileAtomic(artifactAbsolute, bytes);
  writeTextFileAtomic(metaAbsolute, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** Non-expired exports, newest first. */
export function listSiteExports(projectPath: string): SiteExportRecord[] {
  ensureExportsRoot(projectPath);
  const records = listExportIds(projectPath)
    .map((id) => readRecord(projectPath, id))
    .filter((record): record is SiteExportRecord => record !== null)
    .filter((record) => !isExpired(record))
    .sort(compareNewestFirst);
  return records;
}

export function getSiteExport(
  projectPath: string,
  id: string,
): SiteExportRecord | null {
  const record = readRecord(projectPath, id);
  if (!record || isExpired(record)) return null;
  return record;
}

export function getLatestSiteExport(
  projectPath: string,
): SiteExportRecord | null {
  return listSiteExports(projectPath)[0] ?? null;
}

export function deleteSiteExport(
  projectPath: string,
  id: string,
): boolean {
  const record = readRecord(projectPath, id);
  if (!record) return false;
  const dir = exportDirForId(projectPath, id);
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Remove expired export directories. Returns number deleted. */
export function cleanupExpiredSiteExports(projectPath: string): number {
  ensureExportsRoot(projectPath);
  let deleted = 0;
  for (const id of listExportIds(projectPath)) {
    const record = readRecord(projectPath, id);
    if (!record) {
      // Orphan directory without valid meta — remove.
      rmSync(exportDirForId(projectPath, id), { recursive: true, force: true });
      deleted += 1;
      continue;
    }
    if (isExpired(record)) {
      rmSync(exportDirForId(projectPath, id), { recursive: true, force: true });
      deleted += 1;
    }
  }
  return deleted;
}

/** Absolute filesystem path to the zip (for reveal / save-as). */
export function resolveSiteExportArtifactPath(
  projectPath: string,
  id: string,
): string | null {
  const record = getSiteExport(projectPath, id);
  if (!record) return null;
  const root = canonicalDirectory(projectPath);
  try {
    const absolute = resolveWithinRoot(
      root,
      path.join(root, record.artifactPath),
      { rejectFinalSymlink: true },
    );
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return null;
    return absolute;
  } catch {
    return null;
  }
}

/** Reveal the zip in Finder / Explorer. */
export function revealSiteExport(
  projectPath: string,
  id: string,
): { path: string } {
  const absolute = resolveSiteExportArtifactPath(projectPath, id);
  if (!absolute) {
    throw new Error("Export not found or expired");
  }
  shell.showItemInFolder(absolute);
  return { path: absolute };
}

export function getSiteExportBytes(
  projectPath: string,
  id: string,
): { bytes: Uint8Array; record: SiteExportRecord } | null {
  const record = getSiteExport(projectPath, id);
  if (!record) return null;
  const absolute = resolveSiteExportArtifactPath(projectPath, id);
  if (!absolute) return null;
  return {
    record,
    bytes: new Uint8Array(readFileSync(absolute)),
  };
}
