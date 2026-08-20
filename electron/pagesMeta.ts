import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";
import { isPageRole } from "../shared/pages";
import type {
  PageMetaRecord,
  PageRole,
  PageSeoMeta,
  PagesMetaState,
} from "../shared/types";

export type { PagesMetaState, PageMetaRecord, PageSeoMeta };

const EMPTY_PAGES_META: PagesMetaState = {
  pages: {},
};

const MAX_PAGE_ENTRIES = 10_000;
const MAX_FILE_KEY_LEN = 1024;
const MAX_TEXT_LEN = 2_000;

function pagesMetaPath(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  const ariaDir = resolveWithinRoot(root, path.join(root, ".aria"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  return resolveWithinRoot(root, path.join(ariaDir, "pages-meta.json"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function normalizeFileKey(key: string): string | null {
  const file = key.trim().replace(/\\/g, "/");
  if (!file || file.length > MAX_FILE_KEY_LEN) return null;
  if (file.includes("..") || file.includes("\0")) return null;
  return file;
}

function normalizeOptionalString(value: unknown, max = MAX_TEXT_LEN): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function normalizeSeo(raw: unknown): PageSeoMeta | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const seo: PageSeoMeta = {};
  const title = normalizeOptionalString(o.title, 300);
  const description = normalizeOptionalString(o.description, 1_000);
  const canonical = normalizeOptionalString(o.canonical, 2_000);
  const ogTitle = normalizeOptionalString(o.ogTitle, 300);
  const ogDescription = normalizeOptionalString(o.ogDescription, 1_000);
  const ogImage = normalizeOptionalString(o.ogImage, 2_000);
  if (title) seo.title = title;
  if (description) seo.description = description;
  if (canonical) seo.canonical = canonical;
  if (ogTitle) seo.ogTitle = ogTitle;
  if (ogDescription) seo.ogDescription = ogDescription;
  if (ogImage) seo.ogImage = ogImage;
  if (typeof o.noindex === "boolean") seo.noindex = o.noindex;
  if (typeof o.nofollow === "boolean") seo.nofollow = o.nofollow;
  return Object.keys(seo).length > 0 ? seo : undefined;
}

function normalizePageRecord(raw: unknown): PageMetaRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const record: PageMetaRecord = {};
  if (isPageRole(o.role)) record.role = o.role;
  const title = normalizeOptionalString(o.title, 300);
  const description = normalizeOptionalString(o.description, 1_000);
  if (title) record.title = title;
  if (description) record.description = description;
  const seo = normalizeSeo(o.seo);
  if (seo) record.seo = seo;
  return Object.keys(record).length > 0 ? record : null;
}

function mergeRole(
  pages: Record<string, PageMetaRecord>,
  file: string,
  role: PageRole,
): void {
  const existing = pages[file];
  pages[file] = existing ? { ...existing, role } : { role };
}

export function normalizePagesMeta(raw: unknown): PagesMetaState {
  if (!raw || typeof raw !== "object") {
    return { pages: {} };
  }
  const o = raw as Record<string, unknown>;
  const pages: Record<string, PageMetaRecord> = {};

  if (o.pages && typeof o.pages === "object" && !Array.isArray(o.pages)) {
    for (const [key, value] of Object.entries(
      o.pages as Record<string, unknown>,
    )) {
      const file = normalizeFileKey(key);
      if (!file) continue;
      const record = normalizePageRecord(value);
      if (record) pages[file] = record;
    }
  }

  // Legacy shape: { roles: Record<file, PageRole> }
  if (o.roles && typeof o.roles === "object" && !Array.isArray(o.roles)) {
    for (const [key, value] of Object.entries(
      o.roles as Record<string, unknown>,
    )) {
      if (!isPageRole(value)) continue;
      const file = normalizeFileKey(key);
      if (!file) continue;
      if (!pages[file]?.role) mergeRole(pages, file, value);
    }
  }

  if (Object.keys(pages).length > MAX_PAGE_ENTRIES) {
    throw new Error("Too many page meta entries");
  }
  return { pages };
}

export function readPagesMeta(projectPath: string): PagesMetaState {
  const file = pagesMetaPath(projectPath);
  if (!existsSync(file)) {
    return { ...EMPTY_PAGES_META, pages: {} };
  }
  try {
    if (!statSync(file).isFile() || statSync(file).size > 512 * 1024) {
      throw new Error("pages-meta file is too large or is not a file");
    }
    return normalizePagesMeta(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    throw new Error(
      `Pages meta could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writePagesMeta(
  projectPath: string,
  next: unknown,
): PagesMetaState {
  const normalized = normalizePagesMeta(next);
  const file = pagesMetaPath(projectPath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeTextFileAtomic(file, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}
