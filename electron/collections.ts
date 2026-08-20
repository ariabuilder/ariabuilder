import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  COLLECTION_SCOPES,
  COLLECTION_SUPPORTS,
  EntryFieldOrderItemSchema,
  FIELD_TYPES,
  type CollectionScope,
  type CollectionSupport,
  type EntryFieldOrderItem,
  type FieldSchema,
  type FieldType,
} from "../shared/cms";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";
import type {
  AriaCollectionDef,
  AriaCollectionKind,
  AriaCollectionSchemaDef,
  CollectionsState,
} from "../shared/types";

export type { AriaCollectionDef, CollectionsState };

const EMPTY_COLLECTIONS: CollectionsState = {
  collections: [],
};

const COLLECTION_KINDS = new Set<AriaCollectionKind>([
  "content",
  "data",
  "config",
  "tags",
]);

const SUPPORTS_SET = new Set<string>(COLLECTION_SUPPORTS);
const SCOPES_SET = new Set<string>(COLLECTION_SCOPES);
const FIELD_TYPES_SET = new Set<string>(FIELD_TYPES);

const MAX_COLLECTIONS = 500;

function withRevision(state: CollectionsState): CollectionsState {
  return {
    ...state,
    revision: createHash("sha256")
      .update(JSON.stringify({ collections: state.collections }))
      .digest("hex"),
  };
}

function collectionsPath(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  const ariaDir = resolveWithinRoot(root, path.join(root, ".aria"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  return resolveWithinRoot(root, path.join(ariaDir, "collections.json"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function normalizeNullableFile(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const file = value.trim().replace(/\\/g, "/");
  if (!file || file.length > 1024) return null;
  if (file.split("/").includes("..") || file.includes("\0")) return null;
  return file;
}

function normalizeNullablePattern(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const pattern = value.trim();
  if (!pattern || pattern.length > 512) return null;
  return pattern;
}

function normalizeNullableIcon(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const icon = value.trim();
  if (!icon || icon.length > 200) return null;
  return icon;
}

function normalizeSupports(value: unknown): CollectionSupport[] {
  if (!Array.isArray(value)) return [];
  const out: CollectionSupport[] = [];
  for (const item of value) {
    if (typeof item === "string" && SUPPORTS_SET.has(item)) {
      out.push(item as CollectionSupport);
    }
  }
  return out;
}

function normalizeScope(value: unknown): CollectionScope {
  if (typeof value === "string" && SCOPES_SET.has(value)) {
    return value as CollectionScope;
  }
  return "global";
}

function normalizeFieldSchema(raw: unknown): FieldSchema | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === "string" ? o.key.trim() : "";
  const label = typeof o.label === "string" ? o.label.trim() : "";
  const type =
    typeof o.type === "string" && FIELD_TYPES_SET.has(o.type)
      ? (o.type as FieldType)
      : null;
  if (!key || !label || !type) return null;

  const field: FieldSchema = { key, label, type };
  if (typeof o.required === "boolean") field.required = o.required;
  if ("default" in o) field.default = o.default;
  if (Array.isArray(o.options)) {
    field.options = o.options.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  }
  if (typeof o.targetCollection === "string" && o.targetCollection.trim()) {
    field.targetCollection = o.targetCollection.trim();
  }
  if (typeof o.searchable === "boolean") field.searchable = o.searchable;
  if (typeof o.showInEntryList === "boolean") {
    field.showInEntryList = o.showInEntryList;
  }
  if (typeof o.inlineEditable === "boolean") {
    field.inlineEditable = o.inlineEditable;
  }
  if (Array.isArray(o.fields)) {
    const nested: FieldSchema[] = [];
    for (const child of o.fields) {
      const next = normalizeFieldSchema(child);
      if (next) nested.push(next);
    }
    if (nested.length > 0) field.fields = nested;
  }
  if (o.repeaterDisplay && typeof o.repeaterDisplay === "object") {
    const rd = o.repeaterDisplay as Record<string, unknown>;
    const repeaterDisplay: NonNullable<FieldSchema["repeaterDisplay"]> = {};
    if (typeof rd.titleFieldKey === "string" && rd.titleFieldKey.trim()) {
      repeaterDisplay.titleFieldKey = rd.titleFieldKey.trim();
    }
    if (typeof rd.addButtonLabel === "string" && rd.addButtonLabel.trim()) {
      repeaterDisplay.addButtonLabel = rd.addButtonLabel.trim();
    }
    if (Object.keys(repeaterDisplay).length > 0) {
      field.repeaterDisplay = repeaterDisplay;
    }
  }
  return field;
}

function normalizeEntryFieldOrder(value: unknown): EntryFieldOrderItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: EntryFieldOrderItem[] = [];
  for (const item of value) {
    const parsed = EntryFieldOrderItemSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out.length > 0 ? out : undefined;
}

function normalizeSchema(value: unknown): AriaCollectionSchemaDef {
  if (!value || typeof value !== "object") {
    return { fields: [], version: 1 };
  }
  const o = value as Record<string, unknown>;
  const fields: FieldSchema[] = [];
  if (Array.isArray(o.fields)) {
    for (const item of o.fields) {
      const next = normalizeFieldSchema(item);
      if (next) fields.push(next);
    }
  }
  const version =
    typeof o.version === "number" && Number.isInteger(o.version) && o.version >= 1
      ? o.version
      : 1;
  const schema: AriaCollectionSchemaDef = { fields, version };
  const entryFieldOrder = normalizeEntryFieldOrder(o.entryFieldOrder);
  if (entryFieldOrder) schema.entryFieldOrder = entryFieldOrder;
  if (typeof o.icon === "string" && o.icon.trim()) {
    schema.icon = o.icon.trim();
  }
  return schema;
}

function normalizeRss(
  value: unknown,
): AriaCollectionDef["rss"] | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  const enabled = typeof o.enabled === "boolean" ? o.enabled : false;
  const rss: NonNullable<AriaCollectionDef["rss"]> = { enabled };
  if (typeof o.title === "string" && o.title.trim()) {
    rss.title = o.title.trim().slice(0, 180);
  }
  if (typeof o.description === "string") {
    rss.description = o.description.trim().slice(0, 1000);
  }
  if (
    typeof o.itemLimit === "number" &&
    Number.isInteger(o.itemLimit) &&
    o.itemLimit >= 1 &&
    o.itemLimit <= 100
  ) {
    rss.itemLimit = o.itemLimit;
  }
  return rss;
}

function normalizeComments(
  value: unknown,
): AriaCollectionDef["comments"] | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : false,
  };
}

function normalizeCollection(raw: unknown): AriaCollectionDef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const label = typeof o.label === "string" ? o.label.trim() : "";
  const kind =
    typeof o.kind === "string" && COLLECTION_KINDS.has(o.kind as AriaCollectionKind)
      ? (o.kind as AriaCollectionKind)
      : null;
  if (!id || !name || !label || !kind) return null;
  if (id.length > 128 || name.length > 200 || label.length > 200) return null;

  const contentDirectory = normalizeNullableFile(o.contentDirectory);
  const collection: AriaCollectionDef = {
    id,
    name,
    label,
    kind,
    urlPattern: normalizeNullablePattern(o.urlPattern),
    listPageFile: normalizeNullableFile(o.listPageFile),
    templatePageFile: normalizeNullableFile(o.templatePageFile),
    ...(contentDirectory ? { contentDirectory } : {}),
    supports: normalizeSupports(o.supports),
    schema: normalizeSchema(o.schema),
    scope: normalizeScope(o.scope),
  };

  const icon = normalizeNullableIcon(o.icon);
  if (icon !== undefined) collection.icon = icon;

  const rss = normalizeRss(o.rss);
  if (rss !== undefined) collection.rss = rss;

  const comments = normalizeComments(o.comments);
  if (comments !== undefined) collection.comments = comments;

  return collection;
}

export function normalizeCollectionsState(raw: unknown): CollectionsState {
  if (!raw || typeof raw !== "object") {
    return { collections: [] };
  }
  const o = raw as Record<string, unknown>;
  const collections: AriaCollectionDef[] = [];
  if (Array.isArray(o.collections)) {
    for (const item of o.collections) {
      const next = normalizeCollection(item);
      if (next) collections.push(next);
    }
  }
  if (collections.length > MAX_COLLECTIONS) {
    throw new Error("Too many collections");
  }
  return { collections };
}

export function readCollections(projectPath: string): CollectionsState {
  const file = collectionsPath(projectPath);
  if (!existsSync(file)) {
    return withRevision({ ...EMPTY_COLLECTIONS, collections: [] });
  }
  try {
    if (!statSync(file).isFile() || statSync(file).size > 512 * 1024) {
      throw new Error("collections file is too large or is not a file");
    }
    return withRevision(normalizeCollectionsState(JSON.parse(readFileSync(file, "utf8"))));
  } catch (error) {
    throw new Error(
      `Collections could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writeCollections(
  projectPath: string,
  next: unknown,
): CollectionsState {
  const normalized = normalizeCollectionsForPersistence(next);
  const file = collectionsPath(projectPath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeTextFileAtomic(file, `${JSON.stringify(normalized, null, 2)}\n`);
  return withRevision(normalized);
}

/** Strip discovered registry projections and normalize the Aria-owned state. */
export function normalizeCollectionsForPersistence(next: unknown): CollectionsState {
  const object = next && typeof next === "object" ? next as Record<string, unknown> : {};
  const persistedCollections = Array.isArray(object.collections)
    ? object.collections.filter((item) => {
        if (!item || typeof item !== "object") return false;
        const source = (item as Record<string, unknown>).source;
        if (!source || typeof source !== "object") return true;
        return (source as Record<string, unknown>).kind === "aria-managed";
      })
    : [];
  return normalizeCollectionsState({ collections: persistedCollections });
}
