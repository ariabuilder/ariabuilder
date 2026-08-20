import { createHash, randomUUID } from "node:crypto";
import DOMPurify from "isomorphic-dompurify";
import type { AriaEntryRelation, FieldSchema } from "../../../shared/cms";
import type { AriaCollectionDef } from "../../../shared/types";
import { readCollections, writeCollections } from "../../collections";
import { runProjectMutation } from "../../mutations";
import { regenerateContentConfig } from "../contentSync";
import { runCmsTransaction } from "../mutationCoordinator";
import {
  createEntry,
  getEntry,
  slugify,
  updateEntry,
} from "../services";
import * as batchStore from "./batchStore";
import {
  downloadAndInstallWordPressAttachment,
  WORDPRESS_MEDIA_UPLOAD_MAX_BYTES,
} from "./media";
import {
  WordPressImportBatchSchema,
  WordPressImportCountsSchema,
  WordPressImportReportSchema,
  WordPressImportSummarySchema,
  type WordPressImportBatch,
  type WordPressImportEvent,
  type WordPressImportFile,
  type WordPressImportItem,
  type WordPressImportMapping,
  type WordPressImportMedia,
  type WordPressImportPhase,
  type WordPressImportReport,
  type WordPressImportSourceType,
} from "./schemas";
import {
  collectionNameForWordPressItem,
  extractImportSource,
  isCleanCustomField,
  parseWordPressSource,
  type WordPressSourceAuthor,
  type WordPressSourceGraph,
  type WordPressSourceItem,
  type WordPressSourceTerm,
} from "./source";

export type WordPressImportScope = {
  posts: boolean;
  pages: boolean;
  customPostTypes: boolean;
  attachments: boolean;
  authors: boolean;
  comments: boolean;
  terms: boolean;
  menus: boolean;
  customFields: boolean;
  seoFields: boolean;
};

export const DEFAULT_WORDPRESS_IMPORT_SCOPE: WordPressImportScope = {
  posts: true,
  pages: true,
  customPostTypes: true,
  attachments: true,
  authors: true,
  comments: false,
  terms: true,
  menus: true,
  customFields: true,
  seoFields: true,
};

export function normalizeWordPressImportScope(
  input?: Partial<WordPressImportScope> | null,
): WordPressImportScope {
  return {
    ...DEFAULT_WORDPRESS_IMPORT_SCOPE,
    ...(input ?? {}),
    comments: false,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptyWordPressImportCounts() {
  return WordPressImportCountsSchema.parse({});
}

export function createEmptyWordPressImportSummary() {
  return WordPressImportSummarySchema.parse({});
}

export function createWordPressImportBatch(input: {
  id?: string;
  sourceType: WordPressImportSourceType;
  actorId?: string;
}): WordPressImportBatch {
  const timestamp = nowIso();
  return WordPressImportBatchSchema.parse({
    id: input.id ?? randomUUID(),
    sourceType: input.sourceType,
    sourceSiteUrl: null,
    sourceHomeUrl: null,
    sourceWpVersion: null,
    tablePrefix: null,
    multisiteBlogId: null,
    mode: "dry_run",
    status: "uploaded",
    currentPhase: "uploading",
    currentMessage: "Uploading WordPress source...",
    progressPercent: 5,
    defaultEntryStatus: "draft",
    mediaMode: "download",
    counts: createEmptyWordPressImportCounts(),
    summary: createEmptyWordPressImportSummary(),
    errorMessage: null,
    actorId: input.actorId?.trim() || "local",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    completedAt: null,
  });
}

export function createWordPressImportEvent(input: {
  batchId: string;
  phase: WordPressImportPhase;
  level?: "info" | "warn" | "error";
  message: string;
  completedCount?: number | null;
  totalCount?: number | null;
  payload?: Record<string, unknown> | null;
}): WordPressImportEvent {
  return {
    id: randomUUID(),
    batchId: input.batchId,
    phase: input.phase,
    level: input.level ?? "info",
    message: input.message,
    completedCount: input.completedCount ?? null,
    totalCount: input.totalCount ?? null,
    payload: input.payload ?? null,
    createdAt: nowIso(),
  };
}

export function buildWordPressImportFile(input: {
  batchId: string;
  filename: string;
  objectKey: string;
  contentType: string | null;
  sizeBytes: number;
  sha256: string;
}): WordPressImportFile {
  const createdAt = nowIso();
  return {
    id: randomUUID(),
    batchId: input.batchId,
    filename: input.filename,
    objectKey: input.objectKey,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    retentionExpiresAt: new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    ).toISOString(),
    createdAt,
  };
}

async function recordJourney(input: {
  projectPath: string;
  batch: WordPressImportBatch;
  phase: WordPressImportPhase;
  message: string;
  progressPercent: number;
  level?: "info" | "warn" | "error";
  completedCount?: number | null;
  totalCount?: number | null;
  payload?: Record<string, unknown> | null;
}): Promise<WordPressImportBatch> {
  const next = WordPressImportBatchSchema.parse({
    ...input.batch,
    currentPhase: input.phase,
    currentMessage: input.message,
    progressPercent: input.progressPercent,
    updatedAt: nowIso(),
  });
  batchStore.saveWordPressImportBatch(input.projectPath, next);
  batchStore.appendWordPressImportEvent(
    input.projectPath,
    createWordPressImportEvent({
      batchId: input.batch.id,
      phase: input.phase,
      level: input.level,
      message: input.message,
      completedCount: input.completedCount,
      totalCount: input.totalCount,
      payload: input.payload,
    }),
  );
  return next;
}

function phaseForItem(item: WordPressSourceItem): WordPressImportPhase {
  if (item.kind === "post") return "importing-posts";
  if (item.kind === "page") return "importing-pages";
  if (item.kind === "custom-post-type") return "importing-custom-post-types";
  if (item.kind === "attachment") return "importing-media";
  if (item.kind === "menu-item") return "creating-menus";
  return "reading-source";
}

function targetTypeForItem(item: WordPressSourceItem): string | null {
  if (["post", "page", "custom-post-type"].includes(item.kind)) {
    return "cms-entry";
  }
  if (item.kind === "attachment") return "media";
  if (item.kind === "menu-item") return "cms-entry";
  return null;
}

function isItemIncludedByScope(
  item: WordPressSourceItem,
  scope: WordPressImportScope,
): boolean {
  if (item.kind === "post") return scope.posts;
  if (item.kind === "page") return scope.pages;
  if (item.kind === "custom-post-type") return scope.customPostTypes;
  if (item.kind === "attachment") return scope.attachments;
  if (item.kind === "menu-item") return scope.menus;
  return true;
}

function disabledScopeWarnings(scope: WordPressImportScope): string[] {
  const disabled = Object.entries(scope)
    .filter(([key, enabled]) => key !== "comments" && !enabled)
    .map(([key]) =>
      key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (char) => char.toUpperCase()),
    );
  if (!disabled.length) {
    return [];
  }
  return [`Skipped by import selection: ${disabled.join(", ")}.`];
}

function visibleImportWarnings(warnings: string[]): string[] {
  return warnings.filter((warning) => !/\bcomments?\b/i.test(warning));
}

class WordPressImportCancelledError extends Error {
  constructor() {
    super("WordPress import cancelled.");
    this.name = "WordPressImportCancelledError";
  }
}

function isWordPressImportCancelledError(
  error: unknown,
): error is WordPressImportCancelledError {
  return error instanceof WordPressImportCancelledError;
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sourceSiteHash(graph: WordPressSourceGraph): string {
  return stableHash({
    siteUrl: graph.site.siteUrl ?? null,
    homeUrl: graph.site.homeUrl ?? null,
    link: graph.site.link ?? null,
  });
}

function targetTypeForCollectionEntry(collectionName: string): string {
  return `cms-entry:${collectionName}`;
}

function taxonomyCollectionName(domain: string | undefined): string {
  const normalized = (domain ?? "tags").replace(/_/g, "-");
  return slugify(normalized) || "tags";
}

function taxonomyRelationFieldKey(collectionName: string): string {
  const key = collectionName.replace(/-/g, "_").replace(/[^a-z0-9_]/g, "");
  return `wp_${key || "tags"}`;
}

function humanizeSlug(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function termSourceId(term: WordPressSourceTerm): string {
  return `${term.domain}:${term.slug || term.name}`;
}

function createMapping(input: {
  sourceSiteHash: string;
  sourceKind: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  sourceChecksum?: string | null;
  batchId: string;
  existing?: WordPressImportMapping | null;
}): WordPressImportMapping {
  const timestamp = nowIso();
  return {
    id: input.existing?.id ?? randomUUID(),
    sourceSiteHash: input.sourceSiteHash,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    targetType: input.targetType,
    targetId: input.targetId,
    sourceChecksum: input.sourceChecksum ?? null,
    lastBatchId: input.batchId,
    createdAt: input.existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function assertNotCancelled(projectPath: string, batchId: string): void {
  const latest = batchStore.getWordPressImportBatch(projectPath, batchId);
  if (latest?.status === "cancelled") {
    throw new WordPressImportCancelledError();
  }
}

function createPlanItem(input: {
  batchId: string;
  item: {
    kind: string;
    id: string;
    title: string;
    sourceChecksum: string;
    postType?: string;
    builderDropped?: boolean;
    builderReasons?: string[];
  };
  action?: "create" | "update" | "skip" | "fail";
  status?: "planned" | "imported" | "skipped" | "failed";
  targetId?: string | null;
  targetType?: string | null;
  skipReason?: string | null;
}): WordPressImportItem {
  const timestamp = nowIso();
  return {
    id: randomUUID(),
    batchId: input.batchId,
    sourceKind: input.item.kind,
    sourceId: input.item.id,
    sourceParentId: null,
    sourceLabel: input.item.title,
    targetType:
      input.targetType ??
      (["post", "page", "custom-post-type", "attachment", "menu-item"].includes(
        input.item.kind,
      )
        ? targetTypeForItem(input.item as WordPressSourceItem)
        : null),
    targetId: input.targetId ?? null,
    action:
      input.action ??
      (["post", "page", "custom-post-type", "attachment", "menu-item"].includes(
        input.item.kind,
      )
        ? "create"
        : "skip"),
    status: input.status ?? "planned",
    sourceChecksum: input.item.sourceChecksum,
    skipReason: input.skipReason ?? null,
    diagnostics: {
      postType: input.item.postType,
      builderDropped: input.item.builderDropped ?? false,
      builderReasons: input.item.builderReasons ?? [],
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function extractFeaturedImageId(item: WordPressSourceItem): string | null {
  return item.meta.find((meta) => meta.key === "_thumbnail_id")?.value ?? null;
}

function cleanHtmlBody(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  return DOMPurify.sanitize(trimmed, {
    USE_PROFILES: { html: true },
  }).trim();
}

function fieldsForCollection(
  items: WordPressSourceItem[],
  scope: WordPressImportScope = DEFAULT_WORDPRESS_IMPORT_SCOPE,
  taxonomyCollectionsByName: ReadonlyMap<string, AriaCollectionDef> = new Map(),
): FieldSchema[] {
  const cleanKeys = Array.from(
    new Set(
      items.flatMap((item) =>
        item.meta
          .filter((meta) => isCleanCustomField(meta.key))
          .map((meta) => slugify(meta.key).replace(/-/g, "_"))
          .filter(Boolean),
      ),
    ),
  ).slice(0, 24);
  const taxonomyRelationFields = relationFieldsForCollectionItems(
    items,
    scope,
    taxonomyCollectionsByName,
  );

  return [
    {
      key: "excerpt",
      label: "Excerpt",
      type: "text",
      searchable: true,
      showInEntryList: true,
    },
    ...(scope.attachments
      ? [
          {
            key: "featured_image",
            label: "Featured Image",
            type: "image",
            showInEntryList: true,
          } satisfies FieldSchema,
        ]
      : []),
    ...(scope.authors
      ? [
          {
            key: "author",
            label: "Author",
            type: "string",
            searchable: true,
          } satisfies FieldSchema,
        ]
      : []),
    ...taxonomyRelationFields,
    ...(scope.seoFields
      ? [
          {
            key: "seo_title",
            label: "SEO Title",
            type: "string",
            searchable: true,
          } satisfies FieldSchema,
          {
            key: "seo_description",
            label: "SEO Description",
            type: "text",
          } satisfies FieldSchema,
        ]
      : []),
    ...(scope.customFields ? cleanKeys : []).map(
      (key): FieldSchema => ({
        key,
        label: key
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
        type: "text",
      }),
    ),
  ];
}

function relationFieldsForCollectionItems(
  items: WordPressSourceItem[],
  scope: WordPressImportScope,
  taxonomyCollectionsByName: ReadonlyMap<string, AriaCollectionDef>,
): FieldSchema[] {
  if (!scope.terms) {
    return [];
  }

  const collectionNames = Array.from(
    new Set(
      items.flatMap((item) =>
        item.terms.map((term) => taxonomyCollectionName(term.domain)),
      ),
    ),
  ).sort();

  return collectionNames.map(
    (collectionName): FieldSchema => ({
      key: taxonomyRelationFieldKey(collectionName),
      label: humanizeSlug(collectionName),
      type: "relation",
      targetCollection:
        taxonomyCollectionsByName.get(collectionName)?.id ?? collectionName,
    }),
  );
}

function taxonomyRelationFieldKeys(collection: AriaCollectionDef): string[] {
  return (collection.schema?.fields ?? [])
    .filter(
      (field) =>
        field.type === "relation" &&
        field.key.startsWith("wp_") &&
        Boolean(field.targetCollection),
    )
    .map((field) => field.key);
}

function buildTaxonomyRelations(input: {
  item: WordPressSourceItem;
  collection: AriaCollectionDef;
  termTargetIds: Map<string, string>;
}): AriaEntryRelation[] {
  const relationFields = new Map<string, FieldSchema>();
  for (const field of input.collection.schema?.fields ?? []) {
    if (
      field.type === "relation" &&
      field.key.startsWith("wp_") &&
      field.targetCollection
    ) {
      relationFields.set(field.key, field);
    }
  }

  const seen = new Set<string>();
  const positions = new Map<string, number>();
  const relations: AriaEntryRelation[] = [];
  for (const term of input.item.terms) {
    const collectionName = taxonomyCollectionName(term.domain);
    const field = relationFields.get(taxonomyRelationFieldKey(collectionName));
    const targetEntryId = input.termTargetIds.get(termSourceId(term));
    if (!field || !targetEntryId) {
      continue;
    }
    const dedupeKey = `${field.key}:${targetEntryId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const position = positions.get(field.key) ?? 0;
    positions.set(field.key, position + 1);
    relations.push({
      sourceEntryId: "__pending__",
      fieldKey: field.key,
      targetEntryId,
      position,
    });
  }
  return relations;
}

function buildFrontmatter(
  item: WordPressSourceItem,
  scope: WordPressImportScope = DEFAULT_WORDPRESS_IMPORT_SCOPE,
  mediaByAttachmentId: Map<string, string> = new Map(),
): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {};
  if (item.excerpt?.trim()) {
    frontmatter.excerpt = item.excerpt.trim();
  }
  const featuredImageId = extractFeaturedImageId(item);
  if (scope.attachments && featuredImageId) {
    const mediaId = mediaByAttachmentId.get(featuredImageId);
    if (mediaId) {
      frontmatter.featured_image = {
        mediaId,
        alt: item.title,
      };
    }
  }
  if (scope.authors && item.authorLogin) {
    frontmatter.author = slugify(item.authorLogin);
  }
  if (scope.customFields) {
    for (const meta of item.meta) {
      if (!isCleanCustomField(meta.key)) {
        continue;
      }
      const key = slugify(meta.key).replace(/-/g, "_");
      if (key) {
        frontmatter[key] = meta.value;
      }
    }
  }
  if (scope.seoFields) {
    const seoTitle =
      item.meta.find((meta) => meta.key === "_yoast_wpseo_title")?.value ??
      item.meta.find((meta) => meta.key === "rank_math_title")?.value;
    const seoDescription =
      item.meta.find((meta) => meta.key === "_yoast_wpseo_metadesc")?.value ??
      item.meta.find((meta) => meta.key === "rank_math_description")?.value;
    if (seoTitle) frontmatter.seo_title = seoTitle;
    if (seoDescription) frontmatter.seo_description = seoDescription;
  }
  return frontmatter;
}

function ensureCollection(input: {
  projectPath: string;
  name: string;
  label: string;
  items: WordPressSourceItem[];
  scope?: WordPressImportScope;
  taxonomyCollectionsByName?: ReadonlyMap<string, AriaCollectionDef>;
}): AriaCollectionDef {
  const fields = fieldsForCollection(
    input.items,
    input.scope,
    input.taxonomyCollectionsByName,
  );
  const state = readCollections(input.projectPath);
  const existing = state.collections.find(
    (collection) => collection.name === input.name || collection.id === input.name,
  );

  if (existing) {
    const desiredFieldsByKey = new Map(
      fields.map((field) => [field.key, field]),
    );
    let repairedTargetCollection = false;
    const existingFields = (existing.schema?.fields ?? []).map((field) => {
      const desiredField = desiredFieldsByKey.get(field.key);
      if (
        !desiredField ||
        field.type !== "relation" ||
        desiredField.type !== "relation" ||
        !field.key.startsWith("wp_") ||
        !desiredField.targetCollection ||
        field.targetCollection === desiredField.targetCollection
      ) {
        return field;
      }
      repairedTargetCollection = true;
      return {
        ...field,
        targetCollection: desiredField.targetCollection,
      } satisfies FieldSchema;
    });
    const existingKeys = new Set(
      (existing.schema?.fields ?? []).map((field) => field.key),
    );
    const missingFields = fields.filter(
      (field) => !existingKeys.has(field.key),
    );
    if (missingFields.length === 0 && !repairedTargetCollection) {
      return existing;
    }
    const updated: AriaCollectionDef = {
      ...existing,
      schema: {
        fields: [...existingFields, ...missingFields],
        version: (existing.schema?.version ?? 1) + 1,
        ...(existing.schema?.entryFieldOrder
          ? { entryFieldOrder: existing.schema.entryFieldOrder }
          : {}),
        ...(existing.schema?.icon ? { icon: existing.schema.icon } : {}),
      },
    };
    writeCollections(input.projectPath, {
      collections: state.collections.map((collection) =>
        collection.id === updated.id ? updated : collection,
      ),
    });
    regenerateContentConfig(input.projectPath);
    return updated;
  }

  const created: AriaCollectionDef = {
    id: input.name,
    name: input.name,
    label: input.label,
    kind: "content",
    urlPattern: `/${input.name}/{slug}`,
    listPageFile: null,
    templatePageFile: null,
    supports: ["body", "cover", "drafts", "revisions", "seo", "search"],
    scope: "global",
    schema: {
      fields,
      version: 1,
    },
  };
  writeCollections(input.projectPath, {
    collections: [...state.collections, created],
  });
  regenerateContentConfig(input.projectPath);
  return created;
}

function ensureDataCollection(input: {
  projectPath: string;
  name: string;
  label: string;
  kind?: "data" | "tags";
  fields: FieldSchema[];
}): AriaCollectionDef {
  const state = readCollections(input.projectPath);
  const existing = state.collections.find(
    (collection) => collection.name === input.name || collection.id === input.name,
  );

  if (existing) {
    // Merge WordPress fields into an existing collection (e.g. seeded authors)
    // so strict frontmatter validation accepts imported keys.
    const existingKeys = new Set(
      (existing.schema?.fields ?? []).map((field) => field.key),
    );
    const missingFields = input.fields.filter(
      (field) => !existingKeys.has(field.key),
    );
    if (missingFields.length === 0) {
      return existing;
    }
    const updated: AriaCollectionDef = {
      ...existing,
      schema: {
        fields: [...(existing.schema?.fields ?? []), ...missingFields],
        version: (existing.schema?.version ?? 1) + 1,
        ...(existing.schema?.entryFieldOrder
          ? { entryFieldOrder: existing.schema.entryFieldOrder }
          : {}),
        ...(existing.schema?.icon ? { icon: existing.schema.icon } : {}),
      },
    };
    writeCollections(input.projectPath, {
      collections: state.collections.map((collection) =>
        collection.id === updated.id ? updated : collection,
      ),
    });
    regenerateContentConfig(input.projectPath);
    return updated;
  }

  const created: AriaCollectionDef = {
    id: input.name,
    name: input.name,
    label: input.label,
    kind: input.kind ?? "data",
    urlPattern: null,
    listPageFile: null,
    templatePageFile: null,
    supports: ["drafts", "revisions", "search"],
    scope: "global",
    schema: {
      fields: input.fields,
      version: 1,
    },
  };
  writeCollections(input.projectPath, {
    collections: [...state.collections, created],
  });
  regenerateContentConfig(input.projectPath);
  return created;
}

function defaultValueForRequiredField(field: FieldSchema): unknown {
  switch (field.type) {
    case "string":
    case "slug":
    case "text":
    case "color":
    case "icon":
    case "reference":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "select": {
      const option = (field.options ?? []).map((o) => o.trim()).find(Boolean);
      return option ?? "";
    }
    case "multiSelect":
    case "relation":
    case "repeater":
      return [];
    case "image":
    case "file":
    case "link":
    case "object":
      return {};
    case "date":
    case "datetime":
      return new Date(0).toISOString();
    case "json":
    case "structuredText":
    case "richtext":
      return null;
    default:
      return null;
  }
}

/**
 * Seeded collections (e.g. authors) may require fields WordPress does not
 * supply. Fill those so Astro content validation and later publish stay sane.
 */
function withRequiredFieldDefaults(
  collection: AriaCollectionDef,
  frontmatter: Record<string, unknown>,
  hints: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...frontmatter };
  for (const field of collection.schema?.fields ?? []) {
    if (!field.required || field.type === "relation") continue;
    if (out[field.key] !== undefined) continue;
    if (hints[field.key] !== undefined) {
      out[field.key] = hints[field.key];
      continue;
    }
    out[field.key] = defaultValueForRequiredField(field);
  }
  return out;
}

function upsertCollectionEntry(input: {
  projectPath: string;
  collectionId: string;
  collectionName: string;
  slug: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body?: unknown;
  status: "draft" | "published" | "archived";
  sourceSiteHash: string;
  sourceKind: string;
  sourceId: string;
  sourceChecksum?: string | null;
  batchId: string;
  relations?: AriaEntryRelation[];
  replaceRelationFieldKeys?: string[];
}): { targetId: string; action: "create" | "update" } {
  const existingMapping = batchStore.getWordPressImportMapping(
    input.projectPath,
    {
      sourceSiteHash: input.sourceSiteHash,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
    },
  );
  const targetType = targetTypeForCollectionEntry(input.collectionName);
  const collection = readCollections(input.projectPath).collections.find(
    (item) => item.id === input.collectionId || item.name === input.collectionName,
  );
  const authorHints =
    input.collectionName === "authors"
      ? {
          role: input.title || "Author",
          bio: "Imported from WordPress.",
        }
      : {};
  const existingEntry =
    existingMapping?.targetType === targetType
      ? getEntry(
          input.projectPath,
          input.collectionId,
          existingMapping.targetId,
        )
      : null;

  if (existingEntry) {
    const replaceRelationFieldKeys = new Set(
      input.replaceRelationFieldKeys ?? [],
    );
    const normalizedRelations = input.relations?.map(
      (relation): AriaEntryRelation => ({
        ...relation,
        sourceEntryId: existingEntry.entry.id,
      }),
    );
    const nextRelations =
      normalizedRelations || replaceRelationFieldKeys.size > 0
        ? [
            ...(existingEntry.relations ?? []).filter(
              (relation) => !replaceRelationFieldKeys.has(relation.fieldKey),
            ),
            ...(normalizedRelations ?? []),
          ]
        : undefined;
    // Keep user-edited fields; overlay WP payload; then pad still-missing required keys.
    const mergedFrontmatter = collection
      ? withRequiredFieldDefaults(
          collection,
          {
            ...(existingEntry.locales[0]?.frontmatter ?? {}),
            ...input.frontmatter,
          },
          authorHints,
        )
      : {
          ...(existingEntry.locales[0]?.frontmatter ?? {}),
          ...input.frontmatter,
        };
    const updated = updateEntry(input.projectPath, {
      collectionId: input.collectionId,
      id: existingEntry.entry.id,
      version: existingEntry.entry.version,
      patch: {
        title: input.title,
        slug: input.slug,
        status: input.status,
        frontmatter: mergedFrontmatter,
        body: input.body,
        locale: "en",
        ...(nextRelations ? { relations: nextRelations } : {}),
      },
    });
    batchStore.saveWordPressImportMapping(
      input.projectPath,
      createMapping({
        sourceSiteHash: input.sourceSiteHash,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        targetType,
        targetId: updated.entry.id,
        sourceChecksum: input.sourceChecksum,
        batchId: input.batchId,
        existing: existingMapping,
      }),
    );
    return { targetId: updated.entry.id, action: "update" };
  }

  const frontmatter = collection
    ? withRequiredFieldDefaults(collection, input.frontmatter, authorHints)
    : input.frontmatter;

  const created = createEntry(input.projectPath, {
    collectionId: input.collectionId,
    slug: input.slug,
    title: input.title,
    status: input.status,
    frontmatter,
    body: input.body ?? null,
    locale: "en",
  });

  if (input.relations && input.relations.length > 0) {
    updateEntry(input.projectPath, {
      collectionId: input.collectionId,
      id: created.entry.id,
      version: created.entry.version,
      patch: {
        relations: input.relations.map((relation) => ({
          ...relation,
          sourceEntryId: created.entry.id,
        })),
      },
    });
  }

  batchStore.saveWordPressImportMapping(
    input.projectPath,
    createMapping({
      sourceSiteHash: input.sourceSiteHash,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      targetType,
      targetId: created.entry.id,
      sourceChecksum: input.sourceChecksum,
      batchId: input.batchId,
      existing: existingMapping,
    }),
  );
  return { targetId: created.entry.id, action: "create" };
}

function authorChecksum(author: WordPressSourceAuthor): string {
  return stableHash(author);
}

function termChecksum(term: WordPressSourceTerm): string {
  return stableHash(term);
}

async function importMediaAttachments(input: {
  projectPath: string;
  graph: WordPressSourceGraph;
  batch: WordPressImportBatch;
  sourceSiteHash: string;
  scope: WordPressImportScope;
}): Promise<Map<string, string>> {
  const mediaByAttachmentId = new Map<string, string>();
  const attachments = input.graph.items.filter(
    (item) =>
      item.kind === "attachment" && isItemIncludedByScope(item, input.scope),
  );

  if (!input.scope.attachments || attachments.length === 0) {
    return mediaByAttachmentId;
  }

  for (const [index, item] of attachments.entries()) {
    assertNotCancelled(input.projectPath, input.batch.id);
    await recordJourney({
      projectPath: input.projectPath,
      batch: input.batch,
      phase: "importing-media",
      message: `Importing media ${item.title}...`,
      progressPercent:
        20 + Math.round((index / Math.max(attachments.length, 1)) * 10),
      completedCount: index,
      totalCount: attachments.length,
    });

    const sourceUrl = item.attachmentUrl ?? item.content ?? "";
    const existingMapping = batchStore.getWordPressImportMapping(
      input.projectPath,
      {
        sourceSiteHash: input.sourceSiteHash,
        sourceKind: "attachment",
        sourceId: item.id,
      },
    );
    if (existingMapping?.targetType === "media") {
      mediaByAttachmentId.set(item.id, existingMapping.targetId);
      batchStore.saveWordPressImportMapping(
        input.projectPath,
        createMapping({
          sourceSiteHash: input.sourceSiteHash,
          sourceKind: "attachment",
          sourceId: item.id,
          targetType: "media",
          targetId: existingMapping.targetId,
          sourceChecksum: existingMapping.sourceChecksum,
          batchId: input.batch.id,
          existing: existingMapping,
        }),
      );
      batchStore.saveWordPressImportMedia(input.projectPath, {
        id: randomUUID(),
        batchId: input.batch.id,
        sourceAttachmentId: item.id,
        sourceUrl: sourceUrl || item.slug,
        targetMediaPath: existingMapping.targetId,
        targetMediaId: existingMapping.targetId,
        status: "referenced",
        contentType: null,
        sizeBytes: null,
        sha256: existingMapping.sourceChecksum,
        alt: item.title,
        caption: item.excerpt ?? null,
        errorMessage: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      continue;
    }

    if (!sourceUrl) {
      batchStore.saveWordPressImportMedia(input.projectPath, {
        id: randomUUID(),
        batchId: input.batch.id,
        sourceAttachmentId: item.id,
        sourceUrl: item.slug,
        targetMediaPath: null,
        targetMediaId: null,
        status: "skipped",
        contentType: null,
        sizeBytes: null,
        sha256: null,
        alt: item.title,
        caption: item.excerpt ?? null,
        errorMessage: "Attachment URL missing from WXR.",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      continue;
    }

    try {
      const installed = await downloadAndInstallWordPressAttachment({
        projectPath: input.projectPath,
        item,
        sourceUrl,
        maxBytes: WORDPRESS_MEDIA_UPLOAD_MAX_BYTES,
      });
      mediaByAttachmentId.set(item.id, installed.mediaId);
      batchStore.saveWordPressImportMapping(
        input.projectPath,
        createMapping({
          sourceSiteHash: input.sourceSiteHash,
          sourceKind: "attachment",
          sourceId: item.id,
          targetType: "media",
          targetId: installed.mediaId,
          sourceChecksum: installed.sha256,
          batchId: input.batch.id,
          existing: existingMapping,
        }),
      );
      batchStore.saveWordPressImportMedia(input.projectPath, {
        id: randomUUID(),
        batchId: input.batch.id,
        sourceAttachmentId: item.id,
        sourceUrl,
        targetMediaPath: installed.mediaId,
        targetMediaId: installed.mediaId,
        status: "downloaded",
        contentType: installed.contentType,
        sizeBytes: installed.sizeBytes,
        sha256: installed.sha256,
        alt: item.title,
        caption: item.excerpt ?? null,
        errorMessage: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    } catch (error) {
      batchStore.saveWordPressImportMedia(input.projectPath, {
        id: randomUUID(),
        batchId: input.batch.id,
        sourceAttachmentId: item.id,
        sourceUrl,
        targetMediaPath: null,
        targetMediaId: null,
        status: "skipped",
        contentType: null,
        sizeBytes: null,
        sha256: null,
        alt: item.title,
        caption: item.excerpt ?? null,
        errorMessage: error instanceof Error ? error.message : String(error),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }
  }

  return mediaByAttachmentId;
}

export async function analyzeWordPressImport(input: {
  projectPath: string;
  batch: WordPressImportBatch;
  sourceText: string;
  sourceType: WordPressImportBatch["sourceType"];
}): Promise<{ batch: WordPressImportBatch; graph: WordPressSourceGraph }> {
  let batch = await recordJourney({
    projectPath: input.projectPath,
    batch: input.batch,
    phase: "reading-source",
    message: "Reading WordPress source...",
    progressPercent: 15,
  });
  const graph = await parseWordPressSource({
    sourceType: input.sourceType,
    text: input.sourceText,
  });
  batch = WordPressImportBatchSchema.parse({
    ...batch,
    sourceSiteUrl: graph.site.siteUrl ?? graph.site.link ?? null,
    sourceHomeUrl: graph.site.homeUrl ?? null,
    sourceWpVersion: graph.site.wpVersion ?? null,
    tablePrefix: graph.site.tablePrefix ?? null,
    status: "planned",
    currentPhase: "finalizing-report",
    currentMessage: "Preparing import report...",
    progressPercent: 100,
    counts: graph.counts,
    summary: {
      imported: 0,
      skipped: graph.items.filter((item) => !targetTypeForItem(item)).length,
      failed: 0,
      warnings: visibleImportWarnings(graph.warnings),
      nextSteps: ["Review the mapping, then run the import as drafts."],
    },
    updatedAt: nowIso(),
    completedAt: nowIso(),
  });
  batchStore.saveWordPressImportBatch(input.projectPath, batch);

  for (const item of graph.items) {
    batchStore.saveWordPressImportItem(
      input.projectPath,
      createPlanItem({ batchId: batch.id, item }),
    );
  }
  for (const author of graph.authors) {
    batchStore.saveWordPressImportItem(
      input.projectPath,
      createPlanItem({
        batchId: batch.id,
        item: {
          kind: "author",
          id: author.id,
          title: author.displayName,
          sourceChecksum: authorChecksum(author),
        },
        targetType: targetTypeForCollectionEntry("authors"),
      }),
    );
  }
  for (const term of graph.terms) {
    const collectionName = slugify(term.domain || "tags") || "tags";
    batchStore.saveWordPressImportItem(
      input.projectPath,
      createPlanItem({
        batchId: batch.id,
        item: {
          kind: "term",
          id: `${term.domain}:${term.slug || term.name}`,
          title: term.name,
          sourceChecksum: termChecksum(term),
        },
        targetType: targetTypeForCollectionEntry(collectionName),
      }),
    );
  }
  for (const item of graph.items.filter((item) => item.kind === "attachment")) {
    const media: WordPressImportMedia = {
      id: randomUUID(),
      batchId: batch.id,
      sourceAttachmentId: item.id,
      sourceUrl: item.attachmentUrl || item.content || item.slug,
      targetMediaPath: null,
      targetMediaId: null,
      status: "planned",
      contentType: null,
      sizeBytes: null,
      sha256: null,
      alt: item.title,
      caption: item.excerpt ?? null,
      errorMessage: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    batchStore.saveWordPressImportMedia(input.projectPath, media);
  }
  batchStore.appendWordPressImportEvent(
    input.projectPath,
    createWordPressImportEvent({
      batchId: batch.id,
      phase: "complete",
      message: "WordPress source analyzed.",
      payload: { counts: graph.counts },
    }),
  );
  return { batch, graph };
}

export async function applyWxrWordPressImport(input: {
  projectPath: string;
  batch: WordPressImportBatch;
  sourceText: string;
  scope?: Partial<WordPressImportScope> | null;
}): Promise<WordPressImportBatch> {
  const scope = normalizeWordPressImportScope(input.scope);
  if (input.batch.status === "cancelled") {
    return input.batch;
  }
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  let batch = WordPressImportBatchSchema.parse({
    ...input.batch,
    mode: "apply",
    status: "applying",
    startedAt: input.batch.startedAt ?? nowIso(),
    completedAt: null,
    updatedAt: nowIso(),
  });
  batchStore.saveWordPressImportBatch(input.projectPath, batch);
  const graph = await parseWordPressSource({
    sourceType: "wxr",
    text: input.sourceText,
  });
  if (!graph.applySupported) {
    throw new Error("This WordPress source cannot be applied yet.");
  }
  try {
    const siteHash = sourceSiteHash(graph);

    batch = await recordJourney({
      projectPath: input.projectPath,
      batch,
      phase: "creating-collections",
      message: "Creating post type collections...",
      progressPercent: 20,
    });

    const mediaByAttachmentId = await importMediaAttachments({
      projectPath: input.projectPath,
      graph,
      batch,
      sourceSiteHash: siteHash,
      scope,
    });

    if (scope.authors && graph.authors.length > 0) {
      assertNotCancelled(input.projectPath, batch.id);
      batch = await recordJourney({
        projectPath: input.projectPath,
        batch,
        phase: "importing-users",
        message: "Importing authors...",
        progressPercent: 32,
        completedCount: 0,
        totalCount: graph.authors.length,
      });
      const authorsCollection = ensureDataCollection({
        projectPath: input.projectPath,
        name: "authors",
        label: "Authors",
        fields: [
          { key: "login", label: "Login", type: "string", searchable: true },
          { key: "email", label: "Email", type: "string" },
          { key: "first_name", label: "First Name", type: "string" },
          { key: "last_name", label: "Last Name", type: "string" },
        ],
      });
      for (const [authorIndex, author] of graph.authors.entries()) {
        assertNotCancelled(input.projectPath, batch.id);
        batch = await recordJourney({
          projectPath: input.projectPath,
          batch,
          phase: "importing-users",
          message: `Importing author ${author.displayName || author.login}...`,
          progressPercent:
            32 +
            Math.round(
              (authorIndex / Math.max(graph.authors.length, 1)) * 4,
            ),
          completedCount: authorIndex,
          totalCount: graph.authors.length,
        });
        try {
          const result = upsertCollectionEntry({
            projectPath: input.projectPath,
            collectionId: authorsCollection.id,
            collectionName: "authors",
            slug: slugify(author.login || author.displayName) || author.id,
            title: author.displayName,
            status: batch.defaultEntryStatus,
            frontmatter: {
              login: author.login,
              email: author.email ?? "",
              first_name: author.firstName ?? "",
              last_name: author.lastName ?? "",
            },
            sourceSiteHash: siteHash,
            sourceKind: "author",
            sourceId: author.id,
            sourceChecksum: authorChecksum(author),
            batchId: batch.id,
          });
          batchStore.saveWordPressImportItem(
            input.projectPath,
            createPlanItem({
              batchId: batch.id,
              item: {
                kind: "author",
                id: author.id,
                title: author.displayName,
                sourceChecksum: authorChecksum(author),
              },
              action: result.action,
              status: "imported",
              targetType: targetTypeForCollectionEntry("authors"),
              targetId: result.targetId,
            }),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          batchStore.saveWordPressImportItem(
            input.projectPath,
            createPlanItem({
              batchId: batch.id,
              item: {
                kind: "author",
                id: author.id,
                title: author.displayName,
                sourceChecksum: authorChecksum(author),
              },
              action: "fail",
              status: "failed",
              targetType: targetTypeForCollectionEntry("authors"),
              targetId: null,
              skipReason: message,
            }),
          );
          batchStore.appendWordPressImportEvent(
            input.projectPath,
            createWordPressImportEvent({
              batchId: batch.id,
              phase: "importing-users",
              level: "error",
              message: `Failed to import author ${author.displayName || author.login}: ${message}`,
              completedCount: authorIndex,
              totalCount: graph.authors.length,
            }),
          );
        }
      }
    }

    const termTargetIds = new Map<string, string>();
    const taxonomyCollectionsByName = new Map<string, AriaCollectionDef>();

    if (scope.terms && graph.terms.length > 0) {
      assertNotCancelled(input.projectPath, batch.id);
      batch = await recordJourney({
        projectPath: input.projectPath,
        batch,
        phase: "importing-taxonomies",
        message: "Importing taxonomies...",
        progressPercent: 38,
        completedCount: 0,
        totalCount: graph.terms.length,
      });
      const termsByDomain = new Map<string, WordPressSourceTerm[]>();
      for (const term of graph.terms) {
        const domain = taxonomyCollectionName(term.domain);
        termsByDomain.set(domain, [...(termsByDomain.get(domain) ?? []), term]);
      }
      for (const [domain, terms] of termsByDomain) {
        const collection = ensureDataCollection({
          projectPath: input.projectPath,
          name: domain,
          label: humanizeSlug(domain),
          kind: "tags",
          fields: [
            { key: "taxonomy", label: "Taxonomy", type: "string" },
            { key: "source_slug", label: "Source Slug", type: "string" },
          ],
        });
        taxonomyCollectionsByName.set(domain, collection);
        for (const term of terms) {
          const result = upsertCollectionEntry({
            projectPath: input.projectPath,
            collectionId: collection.id,
            collectionName: domain,
            slug: term.slug || slugify(term.name),
            title: term.name,
            status: batch.defaultEntryStatus,
            frontmatter: {
              taxonomy: term.domain,
              source_slug: term.slug,
            },
            sourceSiteHash: siteHash,
            sourceKind: "term",
            sourceId: termSourceId(term),
            sourceChecksum: termChecksum(term),
            batchId: batch.id,
          });
          termTargetIds.set(termSourceId(term), result.targetId);
          batchStore.saveWordPressImportItem(
            input.projectPath,
            createPlanItem({
              batchId: batch.id,
              item: {
                kind: "term",
                id: termSourceId(term),
                title: term.name,
                sourceChecksum: termChecksum(term),
              },
              action: result.action,
              status: "imported",
              targetType: targetTypeForCollectionEntry(domain),
              targetId: result.targetId,
            }),
          );
        }
      }
    }

    const importableItems = graph.items.filter(
      (item) =>
        ["post", "page", "custom-post-type"].includes(item.kind) &&
        isItemIncludedByScope(item, scope),
    );
    const itemsByCollection = new Map<string, WordPressSourceItem[]>();
    for (const item of importableItems) {
      const collectionName = collectionNameForWordPressItem(item);
      itemsByCollection.set(collectionName, [
        ...(itemsByCollection.get(collectionName) ?? []),
        item,
      ]);
    }

    const collections = new Map<string, AriaCollectionDef>();
    for (const [name, items] of itemsByCollection) {
      const label = name
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      collections.set(
        name,
        ensureCollection({
          projectPath: input.projectPath,
          name,
          label,
          items,
          scope,
          taxonomyCollectionsByName,
        }),
      );
    }

    for (const [index, item] of importableItems.entries()) {
      const phase = phaseForItem(item);
      batch = await recordJourney({
        projectPath: input.projectPath,
        batch,
        phase,
        message: `Importing ${item.title}...`,
        progressPercent:
          25 + Math.round((index / Math.max(importableItems.length, 1)) * 65),
        completedCount: index,
        totalCount: importableItems.length,
      });

      const collection = collections.get(collectionNameForWordPressItem(item));
      if (!collection) {
        failed += 1;
        batchStore.saveWordPressImportItem(
          input.projectPath,
          createPlanItem({
            batchId: batch.id,
            item,
            action: "fail",
            status: "failed",
            skipReason: "Target collection was not created.",
          }),
        );
        continue;
      }

      try {
        assertNotCancelled(input.projectPath, batch.id);
        const relations = scope.terms
          ? buildTaxonomyRelations({
              item,
              collection,
              termTargetIds,
            })
          : undefined;
        const record = upsertCollectionEntry({
          projectPath: input.projectPath,
          collectionId: collection.id,
          collectionName: collectionNameForWordPressItem(item),
          slug: item.slug,
          title: item.title,
          status: batch.defaultEntryStatus,
          frontmatter: buildFrontmatter(item, scope, mediaByAttachmentId),
          body: cleanHtmlBody(item.content),
          relations,
          replaceRelationFieldKeys: scope.terms
            ? taxonomyRelationFieldKeys(collection)
            : undefined,
          sourceSiteHash: siteHash,
          sourceKind: item.kind,
          sourceId: item.id,
          sourceChecksum: item.sourceChecksum,
          batchId: batch.id,
        });
        imported += 1;
        batchStore.saveWordPressImportItem(
          input.projectPath,
          createPlanItem({
            batchId: batch.id,
            item,
            action: record.action,
            status: "imported",
            targetType: targetTypeForCollectionEntry(
              collectionNameForWordPressItem(item),
            ),
            targetId: record.targetId,
          }),
        );
      } catch (error) {
        if (isWordPressImportCancelledError(error)) {
          throw error;
        }
        failed += 1;
        batchStore.saveWordPressImportItem(
          input.projectPath,
          createPlanItem({
            batchId: batch.id,
            item,
            action: "fail",
            status: "failed",
            skipReason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    if (scope.menus) {
      const menuItems = graph.items.filter((item) => item.kind === "menu-item");
      if (menuItems.length > 0) {
        assertNotCancelled(input.projectPath, batch.id);
        batch = await recordJourney({
          projectPath: input.projectPath,
          batch,
          phase: "creating-menus",
          message: "Importing menus...",
          progressPercent: 92,
          completedCount: 0,
          totalCount: menuItems.length,
        });
        const navCollection = ensureDataCollection({
          projectPath: input.projectPath,
          name: "main-nav",
          label: "Main Navigation",
          fields: [
            { key: "url", label: "URL", type: "string" },
            {
              key: "target_object_id",
              label: "Target Object ID",
              type: "string",
            },
            { key: "target_type", label: "Target Type", type: "string" },
            { key: "order", label: "Order", type: "integer" },
          ],
        });
        for (const [index, item] of menuItems.entries()) {
          const url =
            item.meta.find((meta) => meta.key === "_menu_item_url")?.value ??
            "";
          const targetObjectId =
            item.meta.find((meta) => meta.key === "_menu_item_object_id")
              ?.value ?? "";
          const targetType =
            item.meta.find((meta) => meta.key === "_menu_item_object")?.value ??
            "";
          const result = upsertCollectionEntry({
            projectPath: input.projectPath,
            collectionId: navCollection.id,
            collectionName: "main-nav",
            slug: item.slug || `menu-item-${item.id}`,
            title: item.title,
            status: batch.defaultEntryStatus,
            frontmatter: {
              url,
              target_object_id: targetObjectId,
              target_type: targetType,
              order: index,
            },
            sourceSiteHash: siteHash,
            sourceKind: "menu-item",
            sourceId: item.id,
            sourceChecksum: item.sourceChecksum,
            batchId: batch.id,
          });
          batchStore.saveWordPressImportItem(
            input.projectPath,
            createPlanItem({
              batchId: batch.id,
              item,
              action: result.action,
              status: "imported",
              targetType: targetTypeForCollectionEntry("main-nav"),
              targetId: result.targetId,
            }),
          );
          imported += 1;
        }
      }
    }

    const finalItems = batchStore.listWordPressImportItems(
      input.projectPath,
      batch.id,
    );
    const finalMedia = batchStore.listWordPressImportMedia(
      input.projectPath,
      batch.id,
    );
    imported =
      finalItems.filter((item) => item.status === "imported").length +
      finalMedia.filter((media) =>
        ["downloaded", "referenced"].includes(media.status),
      ).length;
    failed =
      finalItems.filter((item) => item.status === "failed").length +
      finalMedia.filter((media) => media.status === "failed").length;
    skipped =
      finalItems.filter((item) => item.status === "skipped").length +
      finalMedia.filter((media) => media.status === "skipped").length;
    const skippedMediaFailures = finalMedia.filter(
      (media) => media.status === "skipped" && media.errorMessage,
    ).length;

    batch = WordPressImportBatchSchema.parse({
      ...batch,
      status: failed > 0 ? "failed" : "completed",
      currentPhase: failed > 0 ? "failed" : "complete",
      currentMessage:
        failed > 0
          ? "Import finished with failures."
          : "WordPress import completed.",
      progressPercent: 100,
      counts: graph.counts,
      summary: {
        imported,
        skipped,
        failed,
        warnings: [
          ...visibleImportWarnings(graph.warnings),
          ...(skippedMediaFailures > 0
            ? [
                `Skipped ${skippedMediaFailures} media file(s) because the source URLs could not be reached.`,
              ]
            : []),
          ...disabledScopeWarnings(scope),
        ],
        nextSteps: [
          "Review imported draft entries in CMS collections.",
          "Design Aria templates and bind collection fields.",
        ],
      },
      errorMessage: failed > 0 ? `${failed} item(s) failed to import.` : null,
      updatedAt: nowIso(),
      completedAt: nowIso(),
    });
    batchStore.saveWordPressImportBatch(input.projectPath, batch);
    batchStore.appendWordPressImportEvent(
      input.projectPath,
      createWordPressImportEvent({
        batchId: batch.id,
        phase: batch.currentPhase ?? "complete",
        level: failed > 0 ? "warn" : "info",
        message: batch.currentMessage ?? "Import finished.",
        completedCount: imported,
        totalCount: importableItems.length,
        payload: { ...batch.summary, scope },
      }),
    );
    if (batch.status === "completed") {
      try {
        const sourceCleanup = discardSuccessfulWordPressImportSources({
          projectPath: input.projectPath,
          batchId: batch.id,
        });
        if (sourceCleanup.discarded > 0 || sourceCleanup.retained > 0) {
          batchStore.appendWordPressImportEvent(
            input.projectPath,
            createWordPressImportEvent({
              batchId: batch.id,
              phase: "complete",
              level: sourceCleanup.retained > 0 ? "warn" : "info",
              message:
                sourceCleanup.retained > 0
                  ? "WordPress import source cleanup is pending."
                  : "Discarded temporary WordPress import source file(s).",
              payload: sourceCleanup,
            }),
          );
        }
      } catch {
        // The import itself is complete. Leave any source record in place for
        // expiry cleanup rather than reporting a failed import.
      }
    }
    return batch;
  } catch (error) {
    if (isWordPressImportCancelledError(error)) {
      const cancelled = WordPressImportBatchSchema.parse({
        ...batch,
        status: "cancelled",
        currentPhase: "failed",
        currentMessage: "Import cancelled.",
        progressPercent: batch.progressPercent,
        errorMessage: null,
        updatedAt: nowIso(),
        completedAt: nowIso(),
      });
      batchStore.saveWordPressImportBatch(input.projectPath, cancelled);
      batchStore.appendWordPressImportEvent(
        input.projectPath,
        createWordPressImportEvent({
          batchId: cancelled.id,
          phase: "failed",
          level: "warn",
          message: "WordPress import cancelled.",
        }),
      );
      return cancelled;
    }

    const message =
      error instanceof Error ? error.message : String(error);
    const failedBatch = WordPressImportBatchSchema.parse({
      ...batch,
      status: "failed",
      currentPhase: "failed",
      currentMessage: "WordPress import failed.",
      errorMessage: message,
      updatedAt: nowIso(),
      completedAt: nowIso(),
    });
    batchStore.saveWordPressImportBatch(input.projectPath, failedBatch);
    batchStore.appendWordPressImportEvent(
      input.projectPath,
      createWordPressImportEvent({
        batchId: failedBatch.id,
        phase: "failed",
        level: "error",
        message: `WordPress import failed: ${message}`,
      }),
    );
    return failedBatch;
  }
}

function discardSuccessfulWordPressImportSources(input: {
  projectPath: string;
  batchId: string;
}): { discarded: number; retained: number } {
  const files = batchStore.listWordPressImportFiles(
    input.projectPath,
    input.batchId,
  );
  let discarded = 0;
  let retained = 0;

  for (const file of files) {
    try {
      batchStore.deleteWordPressImportSourceBytes(
        input.projectPath,
        file.objectKey,
      );
      batchStore.deleteWordPressImportFile(
        input.projectPath,
        input.batchId,
        file.id,
      );
      discarded += 1;
    } catch {
      retained += 1;
    }
  }

  return { discarded, retained };
}

async function loadBatchSource(
  projectPath: string,
  batchId: string,
): Promise<{ sourceText: string; sourceType: "wxr"; file: WordPressImportFile }> {
  const batch = batchStore.getWordPressImportBatch(projectPath, batchId);
  const files = batchStore.listWordPressImportFiles(projectPath, batchId);
  const file = files[0];
  if (!batch || !file) {
    throw new Error("WordPress import batch not found.");
  }
  const bytes = batchStore.readWordPressImportSourceBytes(
    projectPath,
    file.objectKey,
  );
  if (!bytes) {
    throw new Error("WordPress import source file expired or was removed.");
  }
  const extracted = await extractImportSource({
    filename: file.filename,
    bytes,
  });
  return {
    sourceText: extracted.text,
    sourceType: extracted.sourceType,
    file,
  };
}

/** IPC helper: persist uploaded WXR bytes, analyze, and return batch + file. */
export async function uploadAndAnalyzeWordPressImport(input: {
  projectPath: string;
  filename: string;
  bytes: Uint8Array;
  contentType?: string | null;
  actorId?: string;
}): Promise<{ batch: WordPressImportBatch; file: WordPressImportFile }> {
  const extracted = await extractImportSource({
    filename: input.filename,
    bytes: input.bytes,
  });
  const batch = createWordPressImportBatch({
    sourceType: extracted.sourceType,
    actorId: input.actorId,
  });
  const objectKey = batchStore.wordpressImportObjectKey(
    batch.id,
    input.filename,
  );
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  batchStore.writeWordPressImportSourceBytes(
    input.projectPath,
    objectKey,
    input.bytes,
  );
  batchStore.saveWordPressImportBatch(input.projectPath, batch);
  const file = batchStore.saveWordPressImportFile(
    input.projectPath,
    buildWordPressImportFile({
      batchId: batch.id,
      filename: input.filename,
      objectKey,
      contentType: input.contentType ?? null,
      sizeBytes: input.bytes.byteLength,
      sha256,
    }),
  );
  batchStore.appendWordPressImportEvent(
    input.projectPath,
    createWordPressImportEvent({
      batchId: batch.id,
      phase: "uploading",
      message: "WordPress source uploaded.",
      payload: {
        filename: input.filename,
        sizeBytes: input.bytes.byteLength,
        sourceType: extracted.sourceType,
      },
    }),
  );

  const analyzed = await analyzeWordPressImport({
    projectPath: input.projectPath,
    batch,
    sourceText: extracted.text,
    sourceType: extracted.sourceType,
  });

  return {
    batch: analyzed.batch,
    file:
      batchStore.listWordPressImportFiles(input.projectPath, batch.id)[0] ??
      file,
  };
}

export function cancelWordPressImportApply(
  projectPath: string,
  batchId: string,
): WordPressImportBatch {
  const batch = batchStore.getWordPressImportBatch(projectPath, batchId);
  if (!batch) {
    throw new Error("WordPress import batch not found.");
  }
  const next = WordPressImportBatchSchema.parse({
    ...batch,
    status: "cancelled",
    currentMessage: "Import cancelled.",
    updatedAt: nowIso(),
    completedAt: nowIso(),
  });
  batchStore.saveWordPressImportBatch(projectPath, next);
  batchStore.appendWordPressImportEvent(
    projectPath,
    createWordPressImportEvent({
      batchId,
      phase: "failed",
      level: "warn",
      message: "WordPress import cancelled.",
    }),
  );
  return next;
}

/** Alias matching the IPC-oriented cancelApply name. */
export const cancelApply = cancelWordPressImportApply;

/** Alias matching the IPC-oriented uploadAndAnalyze name. */
export const uploadAndAnalyze = uploadAndAnalyzeWordPressImport;

/** Alias matching the IPC-oriented getReport name. */
export const getReport = getWordPressImportReport;

export function getWordPressImportReport(
  projectPath: string,
  batchId: string,
): WordPressImportReport {
  const batch = batchStore.getWordPressImportBatch(projectPath, batchId);
  if (!batch) {
    throw new Error("WordPress import batch not found.");
  }
  const siteHash = stableHash({
    siteUrl: batch.sourceSiteUrl,
    homeUrl: batch.sourceHomeUrl,
    link: batch.sourceSiteUrl,
  });
  const mappings = batchStore
    .listWordPressImportMappings(projectPath)
    .filter(
      (mapping) =>
        mapping.lastBatchId === batchId ||
        mapping.sourceSiteHash === siteHash,
    );
  return WordPressImportReportSchema.parse({
    batch,
    items: batchStore.listWordPressImportItems(projectPath, batchId),
    media: batchStore.listWordPressImportMedia(projectPath, batchId),
    mappings,
    events: batchStore.listWordPressImportEvents(projectPath, batchId),
  });
}

export function getWordPressImportBatchOrThrow(
  projectPath: string,
  batchId: string,
): WordPressImportBatch {
  const batch = batchStore.getWordPressImportBatch(projectPath, batchId);
  if (!batch) {
    throw new Error("WordPress import batch not found.");
  }
  return batch;
}

export async function applyWordPressImportBatch(input: {
  projectPath: string;
  batchId: string;
  scope?: Partial<WordPressImportScope> | null;
}): Promise<WordPressImportBatch> {
  const batch = getWordPressImportBatchOrThrow(
    input.projectPath,
    input.batchId,
  );
  const { sourceText } = await loadBatchSource(
    input.projectPath,
    input.batchId,
  );
  const root = input.projectPath;
  const key = `${root}\0${input.batchId}`;
  const operation = runProjectMutation(
    root,
    {
      actor: "user",
      surface: "cms",
      operation: "apply WordPress import",
      targets: [input.batchId],
    },
    () => runCmsTransaction(root, "apply WordPress import", () =>
      applyWxrWordPressImport({
        projectPath: root,
        batch,
        sourceText,
        scope: input.scope,
      }),
    ),
  );
  activeWordPressImports.set(key, {
    projectPath: root,
    batchId: input.batchId,
    done: operation.then(() => undefined, () => undefined),
  });
  try {
    return await operation;
  } finally {
    activeWordPressImports.delete(key);
  }
}

const activeWordPressImports = new Map<
  string,
  { projectPath: string; batchId: string; done: Promise<void> }
>();

export async function cancelAllWordPressImports(): Promise<void> {
  const active = [...activeWordPressImports.values()];
  for (const operation of active) {
    cancelWordPressImportApply(operation.projectPath, operation.batchId);
  }
  await Promise.all(active.map((operation) => operation.done));
}

export function cleanupExpiredWordPressImportFiles(
  projectPath: string,
): { deleted: number } {
  const expired = batchStore.listExpiredWordPressImportFiles(
    projectPath,
    nowIso(),
  );
  let deleted = 0;
  for (const file of expired) {
    batchStore.deleteWordPressImportSourceBytes(projectPath, file.objectKey);
    batchStore.deleteWordPressImportFile(projectPath, file.batchId, file.id);
    deleted += 1;
  }
  return { deleted };
}

export async function reanalyzeWordPressImportBatch(input: {
  projectPath: string;
  batchId: string;
}): Promise<WordPressImportBatch> {
  const batch = getWordPressImportBatchOrThrow(
    input.projectPath,
    input.batchId,
  );
  const { sourceText, sourceType } = await loadBatchSource(
    input.projectPath,
    input.batchId,
  );
  const analyzed = await analyzeWordPressImport({
    projectPath: input.projectPath,
    batch,
    sourceText,
    sourceType,
  });
  return analyzed.batch;
}
