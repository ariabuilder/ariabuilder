import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  StructuredTextDocumentSchema,
  entryFieldsForCollection,
  type AriaEntryRecord,
  type FieldSchema,
  type StructuredTextDocument,
} from "../../shared/cms";
import type { AriaCollectionDef } from "../../shared/types";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeBinaryFileAtomic,
} from "../pathSafety";

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function safeFileName(value: string): string {
  const ext = path.extname(value).replace(/[^A-Za-z0-9.]/g, "");
  const stem = path.basename(value, path.extname(value))
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";
  return `${stem}${ext.toLowerCase()}`;
}

function isPortableUrl(value: string): boolean {
  return /^(?:https?:\/\/|data:)/i.test(value);
}

/**
 * Resolve a CMS media id to managed public storage. Astro source assets are
 * copied to a deterministic public/uploads name so projected Markdown never
 * depends on a bundler-only src/assets path.
 */
export function normalizeCmsMediaId(
  projectPath: string,
  rawMediaId: string,
): string {
  const trimmed = toPosix(rawMediaId.trim());
  if (!trimmed) throw new Error("VALIDATION_ERROR: Media reference is empty");
  if (/^blob:/i.test(trimmed)) {
    throw new Error(
      "VALIDATION_ERROR: Temporary blob media must be saved to managed uploads first",
    );
  }
  if (isPortableUrl(trimmed)) return trimmed;

  const root = canonicalDirectory(projectPath);
  if (trimmed.startsWith("/uploads/")) {
    return normalizeCmsMediaId(projectPath, `public${trimmed}`);
  }
  if (trimmed.startsWith("uploads/")) {
    return normalizeCmsMediaId(projectPath, `public/${trimmed}`);
  }

  const projectRelative = trimmed.replace(/^\/+/, "");
  if (projectRelative.startsWith("public/")) {
    const absolute = resolveWithinRoot(root, path.join(root, projectRelative), {
      rejectFinalSymlink: true,
    });
    if (!existsSync(absolute)) {
      throw new Error(`VALIDATION_ERROR: Media file not found: ${projectRelative}`);
    }
    return projectRelative;
  }

  const sourceRelative = projectRelative.startsWith("src/assets/")
    ? projectRelative
    : `public/uploads/${projectRelative}`;
  const source = resolveWithinRoot(root, path.join(root, sourceRelative), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  if (!existsSync(source)) {
    throw new Error(`VALIDATION_ERROR: Media file not found: ${projectRelative}`);
  }
  if (!sourceRelative.startsWith("src/assets/")) return sourceRelative;

  const bytes = readFileSync(source);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const targetRelative = `public/uploads/aria-cms/${hash}-${safeFileName(sourceRelative)}`;
  const target = resolveWithinRoot(root, path.join(root, targetRelative), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  if (!existsSync(target)) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeBinaryFileAtomic(target, bytes);
  }
  return targetRelative;
}

export function cmsMediaPublicUrl(mediaId: string): string {
  const normalized = toPosix(mediaId.trim());
  if (isPortableUrl(normalized) || normalized.startsWith("/")) return normalized;
  if (normalized.startsWith("public/")) return `/${normalized.slice("public/".length)}`;
  if (normalized.startsWith("uploads/")) return `/${normalized}`;
  throw new Error(`VALIDATION_ERROR: Media is not publicly addressable: ${mediaId}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStructuredText(
  projectPath: string,
  value: unknown,
): unknown {
  const parsed = StructuredTextDocumentSchema.safeParse(value);
  if (!parsed.success) return value;
  return parsed.data.map((block) =>
    block._type === "image"
      ? { ...block, mediaId: normalizeCmsMediaId(projectPath, block.mediaId) }
      : block,
  ) satisfies StructuredTextDocument;
}

function normalizeFieldValue(
  projectPath: string,
  field: FieldSchema,
  value: unknown,
): unknown {
  if (field.type === "image" || field.type === "file") {
    const record = isRecord(value) ? value : null;
    const mediaId = typeof value === "string"
      ? value
      : typeof record?.mediaId === "string"
        ? record.mediaId
        : null;
    if (!mediaId) return value;
    return { ...(record ?? {}), mediaId: normalizeCmsMediaId(projectPath, mediaId) };
  }
  if (field.type === "structuredText" || field.type === "richtext") {
    return normalizeStructuredText(projectPath, value);
  }
  if (field.type === "object" && isRecord(value)) {
    return normalizeFrontmatter(projectPath, field.fields ?? [], value);
  }
  if (field.type === "repeater" && Array.isArray(value)) {
    return value.map((item) =>
      isRecord(item)
        ? normalizeFrontmatter(projectPath, field.fields ?? [], item)
        : item,
    );
  }
  return value;
}

function normalizeFrontmatter(
  projectPath: string,
  fields: readonly FieldSchema[],
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const fieldMap = new Map(fields.map((field) => [field.key, field]));
  return Object.fromEntries(
    Object.entries(frontmatter).map(([key, value]) => {
      const field = fieldMap.get(key);
      return [key, field ? normalizeFieldValue(projectPath, field, value) : value];
    }),
  );
}

export function normalizeEntryMediaReferences(
  projectPath: string,
  collection: AriaCollectionDef,
  record: AriaEntryRecord,
): AriaEntryRecord {
  const fields = entryFieldsForCollection(collection);
  return {
    ...record,
    locales: record.locales.map((locale) => ({
      ...locale,
      frontmatter: normalizeFrontmatter(projectPath, fields, locale.frontmatter),
      body: normalizeStructuredText(projectPath, locale.body),
    })),
  };
}
