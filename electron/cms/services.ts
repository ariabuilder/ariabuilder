import {
  collectionSchemaForEntryFrontmatter,
  entryFieldsForCollection,
  generateId,
  StructuredTextDocumentSchema,
  validateEntryFrontmatter,
  type AriaCollection,
  type AriaEntryRecord,
  type AriaEntryRelation,
  type AriaEntryRevision,
  type AriaEntrySnapshot,
  type CollectionSchema,
  type CollectionSupport,
  type CmsDeletionUsage,
  type EntryListResult,
  type EntrySort,
  type EntryStatus,
  type FieldSchema,
} from "../../shared/cms";
import {
  readCollections,
  writeCollections,
  type AriaCollectionDef,
} from "../collections";
import { readSiteSettings } from "../siteSettings";
import { syncLocalizationManifest } from "../snippetsInjection";
import { regenerateContentConfig } from "./contentSync";
import { syncAfterEntryMutation } from "./contentSync";
import { normalizeEntryMediaReferences } from "./mediaReferences";
import * as store from "./store";

const LOCAL_AUTHOR_ID = "local";
const DEFAULT_LOCALE = "en";
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export type CreateEntryInput = {
  collectionId: string;
  title?: string;
  slug?: string;
  locale?: string;
  frontmatter?: Record<string, unknown>;
  body?: unknown;
  status?: EntryStatus;
};

export type UpsertLocalePatch = {
  locale: string;
  title?: string;
  slug?: string;
  frontmatter?: Record<string, unknown>;
  body?: unknown;
  isSource?: boolean;
  status?: EntryStatus;
  publishedAt?: string | null;
  translationMeta?: AriaEntryRecord["locales"][number]["translationMeta"];
};

export type UpdateEntryPatch = {
  title?: string;
  slug?: string;
  frontmatter?: Record<string, unknown>;
  body?: unknown;
  locale?: string;
  status?: EntryStatus;
  relations?: AriaEntryRelation[];
  /** Add or replace a locale variant on the entry. */
  upsertLocale?: UpsertLocalePatch;
  /** Replace the full locales array (must include at least one source). */
  locales?: AriaEntryRecord["locales"];
};

export type UpdateEntryInput = {
  collectionId: string;
  id: string;
  version: string;
  patch: UpdateEntryPatch;
};

export type ListEntriesParams = {
  collectionId: string;
  status?: EntryStatus | EntryStatus[];
  query?: string;
  page?: number;
  limit?: number;
  sort?: EntrySort[];
  locale?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function persistEntry(
  projectPath: string,
  collection: AriaCollectionDef,
  record: AriaEntryRecord,
  previousSlug?: string,
  previousRecord?: AriaEntryRecord,
): AriaEntryRecord {
  const normalized = normalizeEntryMediaReferences(projectPath, collection, record);
  store.writeEntry(projectPath, collection.id, normalized);
  syncAfterEntryMutation(projectPath, collection.id, normalized, previousSlug, previousRecord);
  const settings = readSiteSettings(projectPath);
  syncLocalizationManifest(projectPath, settings.localization, settings.siteUrl);
  return normalized;
}

/** Persist a trusted import through the same validation, media, projection, and locale hooks as Studio edits. */
export function importEntryRecord(
  projectPath: string,
  collection: AriaCollectionDef,
  record: AriaEntryRecord,
): AriaEntryRecord {
  if (record.entry.collectionId !== collection.id || record.entry.status !== "draft") {
    throw new Error("Imported entries must be drafts in the target collection");
  }
  for (const locale of record.locales) {
    assertValidLeavingDraft(
      projectPath,
      collection,
      locale.frontmatter,
      "draft",
      null,
      record.relations,
    );
  }
  return persistEntry(projectPath, collection, record);
}

export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "untitled";
}

function requireCollection(
  projectPath: string,
  collectionId: string,
): AriaCollectionDef {
  const state = readCollections(projectPath);
  const collection = state.collections.find((item) => item.id === collectionId);
  if (!collection) {
    throw new Error(`Collection not found: ${collectionId}`);
  }
  return collection;
}

function collectionSupports(
  collection: AriaCollectionDef,
  support: CollectionSupport,
): boolean {
  return (collection.supports ?? []).includes(support);
}

function toCollectionSchema(
  collection: AriaCollectionDef,
): CollectionSchema {
  const schema = collection.schema;
  return {
    id: collection.id,
    label: collection.label,
    kind: collection.kind,
    fields: schema?.fields ?? [],
    version: schema?.version ?? 1,
    ...(schema?.entryFieldOrder
      ? { entryFieldOrder: schema.entryFieldOrder }
      : {}),
    ...(schema?.icon ? { icon: schema.icon } : {}),
  };
}

/**
 * Adapt a file-backed collection def into the portable shape expected by
 * `collectionSchemaForEntryFrontmatter` / `entryFieldsForCollection`
 * (cover system field injection, etc.).
 */
function toPortableCollection(collection: AriaCollectionDef): AriaCollection {
  // Only schema.fields + supports are read by the shared helpers.
  return {
    id: collection.id,
    name: collection.name,
    label: collection.label,
    kind: collection.kind,
    schema: toCollectionSchema(collection),
    scope: collection.scope ?? "global",
    urlPattern: collection.urlPattern,
    supports: collection.supports ?? [],
    createdAt: "",
    updatedAt: "",
  } as AriaCollection;
}

function frontmatterSchemaForCollection(
  collection: AriaCollectionDef,
): CollectionSchema {
  return collectionSchemaForEntryFrontmatter(toPortableCollection(collection));
}

function allowsIncompleteFrontmatter(status: EntryStatus): boolean {
  return status === "draft" || status === "archived";
}

function validateRelationsForStatus(
  projectPath: string,
  collection: AriaCollectionDef,
  relations: readonly AriaEntryRelation[] | undefined,
  status: EntryStatus,
): void {
  const relationFields = entryFieldsForCollection(
    toPortableCollection(collection),
  ).filter((field) => field.type === "relation");
  const fieldsByKey = new Map(relationFields.map((field) => [field.key, field]));

  const relationCounts = new Map<string, number>();
  for (const relation of relations ?? []) {
    const field = fieldsByKey.get(relation.fieldKey);
    if (!field) {
      throw new Error(`VALIDATION_ERROR: Unknown relation field ${relation.fieldKey}`);
    }
    const target = store.findEntryByIdAcrossCollections(projectPath, relation.targetEntryId);
    if (!target || (field.targetCollection && target.collectionId !== field.targetCollection)) {
      throw new Error(
        `VALIDATION_ERROR: ${relation.fieldKey} references missing entry ${relation.targetEntryId}`,
      );
    }
    relationCounts.set(
      relation.fieldKey,
      (relationCounts.get(relation.fieldKey) ?? 0) + 1,
    );
  }

  if (allowsIncompleteFrontmatter(status)) return;
  const missing = relationFields.filter(
    (field) =>
      field.required === true && (relationCounts.get(field.key) ?? 0) === 0,
  );
  if (missing.length > 0) {
    throw new Error(
      `VALIDATION_ERROR: ${missing
        .map((field) => `${field.key}: Relation requires at least one entry`)
        .join("; ")}`,
    );
  }
}

/**
 * Validate frontmatter (+ required relations) for the target status.
 * Draft/archived allow missing required fields; published entries do not.
 */
function assertValidLeavingDraft(
  projectPath: string,
  collection: AriaCollectionDef,
  frontmatter: Record<string, unknown>,
  nextStatus: EntryStatus,
  _previousStatus: EntryStatus | null,
  relations?: readonly AriaEntryRelation[] | undefined,
): void {
  const schema = frontmatterSchemaForCollection(collection);
  const allowMissing = allowsIncompleteFrontmatter(nextStatus);

  if (schema.fields.length > 0) {
    const result = validateEntryFrontmatter(schema, frontmatter, {
      allowMissingRequired: allowMissing,
    });
    if (!result.success) {
      throw new Error(`VALIDATION_ERROR: ${result.errors.join("; ")}`);
    }
  }

  if (!allowMissing) {
    validateRelationsForStatus(projectPath, collection, relations, nextStatus);
    for (const reference of collectReferencedEntryIds(
      entryFieldsForCollection(collection),
      frontmatter,
    )) {
      const target = store.findEntryByIdAcrossCollections(
        projectPath,
        reference.entryId,
      );
      if (
        !target ||
        (reference.targetCollection &&
          target.collectionId !== reference.targetCollection)
      ) {
        throw new Error(
          `VALIDATION_ERROR: ${reference.fieldKey} references missing entry ${reference.entryId}`,
        );
      }
    }
  }
}

function collectReferencedEntryIds(
  fields: readonly FieldSchema[],
  frontmatter: Record<string, unknown>,
  prefix = "",
): Array<{ fieldKey: string; entryId: string; targetCollection?: string }> {
  const refs: Array<{ fieldKey: string; entryId: string; targetCollection?: string }> = [];
  for (const field of fields) {
    const fieldKey = prefix ? `${prefix}.${field.key}` : field.key;
    const value = frontmatter[field.key];
    if (field.type === "reference" && typeof value === "string" && value.trim()) {
      refs.push({
        fieldKey,
        entryId: value.trim(),
        ...(field.targetCollection
          ? { targetCollection: field.targetCollection }
          : {}),
      });
    } else if (
      field.type === "link" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).type === "entry" &&
      typeof (value as Record<string, unknown>).entryId === "string"
    ) {
      refs.push({
        fieldKey,
        entryId: String((value as Record<string, unknown>).entryId).trim(),
      });
    } else if (
      field.type === "object" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      refs.push(...collectReferencedEntryIds(
        field.fields ?? [],
        value as Record<string, unknown>,
        fieldKey,
      ));
    } else if (field.type === "repeater" && Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          refs.push(...collectReferencedEntryIds(
            field.fields ?? [],
            item as Record<string, unknown>,
            `${fieldKey}[${index}]`,
          ));
        }
      });
    }
  }
  return refs.filter((item) => item.entryId.length > 0);
}

function collectStructuredEntryLinks(
  value: unknown,
  fieldKey: string,
): Array<{ fieldKey: string; entryId: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectStructuredEntryLinks(item, `${fieldKey}[${index}]`),
    );
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const current =
    record._type === "entryLink" &&
    typeof record.entryId === "string" &&
    record.entryId.trim()
      ? [{ fieldKey, entryId: record.entryId.trim() }]
      : [];
  return [
    ...current,
    ...Object.entries(record).flatMap(([key, item]) =>
      collectStructuredEntryLinks(item, `${fieldKey}.${key}`),
    ),
  ];
}

function collectStructuredFieldValues(
  fields: readonly FieldSchema[],
  frontmatter: Record<string, unknown>,
  prefix = "",
): Array<{ fieldKey: string; value: unknown }> {
  const values: Array<{ fieldKey: string; value: unknown }> = [];
  for (const field of fields) {
    const fieldKey = prefix ? `${prefix}.${field.key}` : field.key;
    const value = frontmatter[field.key];
    if (
      (field.type === "structuredText" || field.type === "richtext") &&
      value != null
    ) {
      values.push({ fieldKey, value });
    } else if (
      field.type === "object" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      values.push(
        ...collectStructuredFieldValues(
          field.fields ?? [],
          value as Record<string, unknown>,
          fieldKey,
        ),
      );
    } else if (field.type === "repeater" && Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          values.push(
            ...collectStructuredFieldValues(
              field.fields ?? [],
              item as Record<string, unknown>,
              `${fieldKey}[${index}]`,
            ),
          );
        }
      });
    }
  }
  return values;
}

function assertStructuredEntryLinksExist(
  projectPath: string,
  value: unknown,
  fieldKey: string,
): void {
  for (const reference of collectStructuredEntryLinks(value, fieldKey)) {
    if (!store.findEntryByIdAcrossCollections(projectPath, reference.entryId)) {
      throw new Error(
        `VALIDATION_ERROR: ${reference.fieldKey} references missing entry ${reference.entryId}`,
      );
    }
  }
}

function assertPublishableStructuredText(
  projectPath: string,
  value: unknown,
  fieldKey: string,
  options?: { allowLegacyString?: boolean },
): void {
  if (value == null || (options?.allowLegacyString && typeof value === "string")) {
    return;
  }
  const parsed = StructuredTextDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`VALIDATION_ERROR: ${fieldKey}: Invalid structured text`);
  }
  assertStructuredEntryLinksExist(projectPath, parsed.data, fieldKey);
}

function assertPublishableLocaleContent(
  projectPath: string,
  collection: AriaCollectionDef,
  locale: AriaEntryRecord["locales"][number],
): void {
  assertPublishableStructuredText(projectPath, locale.body, "body", {
    allowLegacyString: true,
  });
  for (const field of collectStructuredFieldValues(
    entryFieldsForCollection(collection),
    locale.frontmatter,
  )) {
    assertPublishableStructuredText(
      projectPath,
      field.value,
      field.fieldKey,
    );
  }
}

export function findInboundEntryUsages(
  projectPath: string,
  targetEntryId: string,
): CmsDeletionUsage[] {
  const usages: CmsDeletionUsage[] = [];
  for (const collection of readCollections(projectPath).collections) {
    const fields = entryFieldsForCollection(collection);
    for (const record of store.listEntries(projectPath, collection.id)) {
      if (record.entry.id === targetEntryId) continue;
      for (const relation of record.relations ?? []) {
        if (relation.targetEntryId === targetEntryId) {
          usages.push({
            kind: "relation",
            sourceCollectionId: collection.id,
            sourceEntryId: record.entry.id,
            fieldKey: relation.fieldKey,
          });
        }
      }
      for (const locale of record.locales) {
        for (const ref of collectReferencedEntryIds(fields, locale.frontmatter)) {
          if (ref.entryId === targetEntryId) {
            usages.push({
              kind: "reference",
              sourceCollectionId: collection.id,
              sourceEntryId: record.entry.id,
              fieldKey: ref.fieldKey,
              locale: locale.locale,
            });
          }
        }
        for (const ref of collectStructuredEntryLinks(locale.body, "body")) {
          if (ref.entryId === targetEntryId) {
            usages.push({
              kind: "reference",
              sourceCollectionId: collection.id,
              sourceEntryId: record.entry.id,
              fieldKey: ref.fieldKey,
              locale: locale.locale,
            });
          }
        }
        for (const field of collectStructuredFieldValues(
          fields,
          locale.frontmatter,
        )) {
          for (const ref of collectStructuredEntryLinks(
            field.value,
            field.fieldKey,
          )) {
            if (ref.entryId === targetEntryId) {
              usages.push({
                kind: "reference",
                sourceCollectionId: collection.id,
                sourceEntryId: record.entry.id,
                fieldKey: ref.fieldKey,
                locale: locale.locale,
              });
            }
          }
        }
      }
    }
  }
  return usages;
}

function collectionTargetFields(
  fields: readonly FieldSchema[],
  targetCollectionId: string,
  prefix = "",
): string[] {
  const matches: string[] = [];
  for (const field of fields) {
    const key = prefix ? `${prefix}.${field.key}` : field.key;
    if (
      (field.type === "reference" || field.type === "relation") &&
      field.targetCollection === targetCollectionId
    ) {
      matches.push(key);
    }
    if (field.fields) {
      matches.push(...collectionTargetFields(field.fields, targetCollectionId, key));
    }
  }
  return matches;
}

export function findInboundCollectionUsages(
  projectPath: string,
  targetCollectionId: string,
): CmsDeletionUsage[] {
  return readCollections(projectPath).collections.flatMap((collection) =>
    collection.id === targetCollectionId
      ? []
      : collectionTargetFields(
          collection.schema?.fields ?? [],
          targetCollectionId,
        ).map((fieldKey) => ({
          kind: "collection-schema" as const,
          sourceCollectionId: collection.id,
          fieldKey,
        })),
  );
}
function pickLocale(
  record: AriaEntryRecord,
  locale?: string,
): AriaEntryRecord["locales"][number] {
  if (locale) {
    const match = record.locales.find((item) => item.locale === locale);
    if (match) return match;
  }
  return (
    record.locales.find((item) => item.isSource) ??
    record.locales[0]!
  );
}

function sourceSlug(record: AriaEntryRecord): string | undefined {
  return pickLocale(record).slug;
}

function ensureUniqueSlug(
  projectPath: string,
  collectionId: string,
  baseSlug: string,
  locale: string,
  excludeEntryId?: string,
): string {
  let candidate = slugify(baseSlug);
  let suffix = 2;
  while (
    !checkSlugAvailable(
      projectPath,
      collectionId,
      candidate,
      locale,
      excludeEntryId,
    )
  ) {
    candidate = `${slugify(baseSlug)}-${suffix}`;
    suffix += 1;
    if (suffix > 10_000) {
      throw new Error("Unable to allocate unique slug");
    }
  }
  return candidate;
}

function toSnapshot(record: AriaEntryRecord): AriaEntrySnapshot {
  return {
    entry: record.entry,
    locales: record.locales,
    ...(record.relations ? { relations: record.relations } : {}),
  };
}

function maybeWriteRevision(
  projectPath: string,
  collection: AriaCollectionDef,
  record: AriaEntryRecord,
  message?: string,
): void {
  if (!collectionSupports(collection, "revisions")) return;
  const revision: AriaEntryRevision = {
    id: generateId(),
    entryId: record.entry.id,
    locale: pickLocale(record).locale,
    version: record.entry.version,
    snapshot: toSnapshot(record),
    actorId: LOCAL_AUTHOR_ID,
    ...(message ? { message } : {}),
    createdAt: nowIso(),
  };
  store.writeRevision(projectPath, revision);
}

function assertVersion(
  record: AriaEntryRecord,
  expectedVersion: string,
): void {
  if (record.entry.version !== expectedVersion) {
    throw new Error(`VERSION_CONFLICT:${record.entry.version}`);
  }
}

export function checkSlugAvailable(
  projectPath: string,
  collectionId: string,
  slug: string,
  locale?: string,
  excludeEntryId?: string,
): boolean {
  const normalized = slugify(slug);
  if (!normalized) return false;
  const existing = store.findEntryBySlug(
    projectPath,
    collectionId,
    normalized,
    locale,
  );
  if (!existing) return true;
  if (excludeEntryId && existing.entry.id === excludeEntryId) return true;
  return false;
}

export function createEntry(
  projectPath: string,
  input: CreateEntryInput,
): AriaEntryRecord {
  const collection = requireCollection(projectPath, input.collectionId);
  const locale = (
    input.locale?.trim()
    || readSiteSettings(projectPath).localization?.content.defaultLocale
    || DEFAULT_LOCALE
  ).trim();
  const title = (input.title ?? "Untitled").trim() || "Untitled";
  const slug = ensureUniqueSlug(
    projectPath,
    input.collectionId,
    input.slug?.trim() || slugify(title),
    locale,
  );
  const status: EntryStatus = input.status ?? "draft";
  const now = nowIso();
  const entryId = generateId();
  const frontmatter = { ...(input.frontmatter ?? {}) };

  assertValidLeavingDraft(projectPath, collection, frontmatter, status, null, []);
  if (status === "published") {
    assertPublishableLocaleContent(projectPath, collection, {
      entryId,
      collectionId: input.collectionId,
      locale,
      slug,
      title,
      frontmatter,
      body: input.body ?? null,
      isSource: true,
    });
  }

  const record: AriaEntryRecord = {
    entry: {
      id: entryId,
      collectionId: input.collectionId,
      status,
      version: generateId(),
      authorId: LOCAL_AUTHOR_ID,
      createdAt: now,
      updatedAt: now,
      publishedAt: status === "published" ? now : null,
    },
    locales: [
      {
        entryId,
        collectionId: input.collectionId,
        locale,
        slug,
        title,
        frontmatter,
        body: input.body ?? null,
        isSource: true,
      },
    ],
    relations: [],
  };

  return persistEntry(projectPath, collection, record);
}

function applyUpsertLocale(
  projectPath: string,
  collectionId: string,
  entryId: string,
  locales: AriaEntryRecord["locales"],
  upsert: UpsertLocalePatch,
): AriaEntryRecord["locales"] {
  const localeCode = upsert.locale.trim();
  if (!localeCode) {
    throw new Error("Locale code is required");
  }

  const source =
    locales.find((item) => item.isSource) ?? locales[0];
  if (!source) {
    throw new Error("Entry has no locales");
  }

  const existingIndex = locales.findIndex(
    (item) => item.locale === localeCode,
  );
  const base =
    existingIndex >= 0
      ? { ...locales[existingIndex]! }
      : {
          entryId,
          collectionId,
          locale: localeCode,
          title: source.title,
          slug: source.slug,
          frontmatter: { ...source.frontmatter },
          body: source.body,
          isSource: false,
          status: "draft" as const,
          publishedAt: null,
        };

  if (upsert.title !== undefined) {
    base.title = upsert.title.trim() || base.title;
  }
  if (upsert.slug !== undefined) {
    const nextSlug = slugify(upsert.slug);
    if (
      !checkSlugAvailable(
        projectPath,
        collectionId,
        nextSlug,
        localeCode,
        entryId,
      )
    ) {
      throw new Error(`Slug already in use: ${nextSlug}`);
    }
    base.slug = nextSlug;
  } else if (existingIndex < 0) {
    base.slug = ensureUniqueSlug(
      projectPath,
      collectionId,
      base.slug,
      localeCode,
      entryId,
    );
  }
  if (upsert.frontmatter !== undefined) {
    base.frontmatter = { ...upsert.frontmatter };
  }
  if (upsert.body !== undefined) {
    base.body = upsert.body;
  }
  if (upsert.isSource !== undefined) {
    base.isSource = upsert.isSource;
  }
  if (upsert.status !== undefined) {
    base.status = upsert.status;
    base.publishedAt = upsert.status === "published"
      ? upsert.publishedAt ?? base.publishedAt ?? nowIso()
      : null;
  }
  if (upsert.translationMeta !== undefined) {
    base.translationMeta = upsert.translationMeta;
  }
  base.locale = localeCode;
  base.entryId = entryId;
  base.collectionId = collectionId;

  const next =
    existingIndex >= 0
      ? locales.map((item, index) =>
          index === existingIndex ? base : { ...item },
        )
      : [...locales.map((item) => ({ ...item })), base];

  if (base.isSource) {
    return next.map((item) =>
      item.locale === localeCode
        ? { ...item, isSource: true }
        : { ...item, isSource: false },
    );
  }

  if (!next.some((item) => item.isSource) && next[0]) {
    next[0] = { ...next[0], isSource: true };
  }
  return next;
}

export function updateEntry(
  projectPath: string,
  input: UpdateEntryInput,
): AriaEntryRecord {
  const collection = requireCollection(projectPath, input.collectionId);
  const existing = store.readEntry(
    projectPath,
    input.collectionId,
    input.id,
  );
  if (!existing) {
    throw new Error(`Entry not found: ${input.id}`);
  }
  assertVersion(existing, input.version);
  const previousSlug = sourceSlug(existing);

  const patch = input.patch;
  let nextLocales = existing.locales.map((item) => ({ ...item }));

  if (patch.locales !== undefined) {
    if (patch.locales.length === 0) {
      throw new Error("Entry must have at least one locale");
    }
    const reserved = new Set<string>();
    nextLocales = patch.locales.map((item) => {
      const locale = item.locale.trim();
      let candidate = slugify(item.slug);
      if (!candidate) {
        throw new Error(`Invalid slug for locale ${locale}`);
      }
      let suffix = 2;
      while (
        reserved.has(`${locale}::${candidate}`) ||
        !checkSlugAvailable(
          projectPath,
          input.collectionId,
          candidate,
          locale,
          existing.entry.id,
        )
      ) {
        candidate = `${slugify(item.slug)}-${suffix}`;
        suffix += 1;
        if (suffix > 10_000) {
          throw new Error("Unable to allocate unique slug");
        }
      }
      reserved.add(`${locale}::${candidate}`);
      return {
        ...item,
        entryId: existing.entry.id,
        collectionId: input.collectionId,
        locale,
        slug: candidate,
        title: typeof item.title === "string" ? item.title : "",
        frontmatter:
          item.frontmatter && typeof item.frontmatter === "object"
            ? { ...item.frontmatter }
            : {},
      };
    });
    if (!nextLocales.some((item) => item.isSource) && nextLocales[0]) {
      nextLocales[0] = { ...nextLocales[0], isSource: true };
    }
  }

  if (patch.upsertLocale) {
    nextLocales = applyUpsertLocale(
      projectPath,
      input.collectionId,
      existing.entry.id,
      nextLocales,
      patch.upsertLocale,
    );
  }

  const hasFieldPatch =
    patch.title !== undefined ||
    patch.slug !== undefined ||
    patch.frontmatter !== undefined ||
    patch.body !== undefined;

  if (hasFieldPatch) {
    const localeCode =
      patch.locale?.trim() ||
      pickLocale({ ...existing, locales: nextLocales }).locale;
    let localeIndex = nextLocales.findIndex(
      (item) => item.locale === localeCode,
    );

    // Creating a brand-new locale via patch.locale + content fields.
    if (localeIndex < 0 && patch.locale?.trim()) {
      nextLocales = applyUpsertLocale(
        projectPath,
        input.collectionId,
        existing.entry.id,
        nextLocales,
        {
          locale: patch.locale.trim(),
          title: patch.title,
          slug: patch.slug,
          frontmatter: patch.frontmatter,
          body: patch.body,
          isSource: false,
        },
      );
    } else {
      if (localeIndex < 0) {
        localeIndex = nextLocales.findIndex((item) => item.isSource);
      }
      if (localeIndex < 0) localeIndex = 0;

      const currentLocale = { ...nextLocales[localeIndex]! };
      if (patch.title !== undefined) {
        currentLocale.title = patch.title.trim() || currentLocale.title;
      }
      if (patch.slug !== undefined) {
        const nextSlug = slugify(patch.slug);
        if (
          !checkSlugAvailable(
            projectPath,
            input.collectionId,
            nextSlug,
            currentLocale.locale,
            existing.entry.id,
          )
        ) {
          throw new Error(`Slug already in use: ${nextSlug}`);
        }
        currentLocale.slug = nextSlug;
      }
      if (patch.frontmatter !== undefined) {
        currentLocale.frontmatter = { ...patch.frontmatter };
      }
      if (patch.body !== undefined) {
        currentLocale.body = patch.body;
      }
      nextLocales[localeIndex] = currentLocale;
    }
  }

  const activeLocale = pickLocale(
    { ...existing, locales: nextLocales },
    patch.locale?.trim() || patch.upsertLocale?.locale?.trim(),
  );
  const nextStatus = patch.status ?? existing.entry.status;
  const activeLocaleStatus = activeLocale.isSource
    ? nextStatus
    : activeLocale.status ?? "draft";
  const previousActiveLocale = existing.locales.find(
    (locale) => locale.locale === activeLocale.locale,
  );
  const previousActiveLocaleStatus = activeLocale.isSource
    ? existing.entry.status
    : previousActiveLocale?.status ?? null;
  const nextRelations =
    patch.relations !== undefined
      ? patch.relations
      : (existing.relations ?? []);
  assertValidLeavingDraft(
    projectPath,
    collection,
    activeLocale.frontmatter,
    activeLocaleStatus,
    previousActiveLocaleStatus,
    nextRelations,
  );
  if (activeLocaleStatus === "published") {
    assertPublishableLocaleContent(projectPath, collection, activeLocale);
  }

  const contentChanging =
    hasFieldPatch ||
    patch.relations !== undefined ||
    patch.status !== undefined ||
    patch.locale !== undefined ||
    patch.upsertLocale !== undefined ||
    patch.locales !== undefined;

  if (contentChanging) {
    maybeWriteRevision(projectPath, collection, existing, "before update");
  }

  const now = nowIso();
  let publishedAt = existing.entry.publishedAt;

  if (nextStatus === "published" && existing.entry.status !== "published") {
    publishedAt = now;
  } else if (nextStatus === "draft" || nextStatus === "archived") {
    if (nextStatus === "draft") {
      publishedAt = null;
    }
  }

  const next: AriaEntryRecord = {
    entry: {
      ...existing.entry,
      status: nextStatus,
      version: generateId(),
      updatedAt: now,
      publishedAt,
    },
    locales: nextLocales,
    relations: nextRelations,
    ...(existing.authorship ? { authorship: existing.authorship } : {}),
  };

  return persistEntry(projectPath, collection, next, previousSlug, existing);
}

export function deleteEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
  expectedVersion: string,
): void {
  requireCollection(projectPath, collectionId);
  const existing = store.readEntry(projectPath, collectionId, entryId);
  if (!existing) {
    throw new Error(`Entry not found: ${entryId}`);
  }
  assertVersion(existing, expectedVersion);
  const usages = findInboundEntryUsages(projectPath, entryId);
  if (usages.length > 0) {
    const locations = usages
      .slice(0, 5)
      .map((usage) =>
        `${usage.sourceCollectionId}/${usage.sourceEntryId ?? "schema"}:${usage.fieldKey}`,
      )
      .join(", ");
    throw new Error(
      `CONTENT_IN_USE: Entry is referenced in ${usages.length} location${usages.length === 1 ? "" : "s"} (${locations}). Remove those references before deleting it.`,
    );
  }
  const previousSlug = sourceSlug(existing);
  store.deleteEntry(projectPath, collectionId, entryId);
  syncAfterEntryMutation(projectPath, collectionId, null, previousSlug, existing);
  const settings = readSiteSettings(projectPath);
  syncLocalizationManifest(projectPath, settings.localization, settings.siteUrl);
}

export function duplicateEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
  expectedVersion: string,
): AriaEntryRecord {
  const collection = requireCollection(projectPath, collectionId);
  const existing = store.readEntry(projectPath, collectionId, entryId);
  if (!existing) {
    throw new Error(`Entry not found: ${entryId}`);
  }
  assertVersion(existing, expectedVersion);

  const sourceLocale = pickLocale(existing);
  const now = nowIso();
  const newId = generateId();
  const title = `${sourceLocale.title} (copy)`.trim();
  const locales = existing.locales.map((loc) => {
    const isPrimary = loc.locale === sourceLocale.locale;
    return {
      ...loc,
      entryId: newId,
      collectionId,
      title: isPrimary ? title : loc.title,
      slug: ensureUniqueSlug(
        projectPath,
        collectionId,
        `${loc.slug}-copy`,
        loc.locale,
      ),
      isSource: isPrimary,
    };
  });

  if (!locales.some((loc) => loc.isSource) && locales[0]) {
    locales[0] = { ...locales[0], isSource: true };
  }

  const record: AriaEntryRecord = {
    entry: {
      id: newId,
      collectionId,
      status: "draft",
      version: generateId(),
      authorId: LOCAL_AUTHOR_ID,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    },
    locales,
    relations: (existing.relations ?? []).map((rel) => ({
      ...rel,
      sourceEntryId: newId,
    })),
  };

  return persistEntry(projectPath, collection, record);
}

export function publishEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
  opts: { version: string },
): AriaEntryRecord {
  const collection = requireCollection(projectPath, collectionId);
  const existing = store.readEntry(projectPath, collectionId, entryId);
  if (!existing) {
    throw new Error(`Entry not found: ${entryId}`);
  }
  assertVersion(existing, opts.version);

  const locale = pickLocale(existing);
  assertValidLeavingDraft(
    projectPath,
    collection,
    locale.frontmatter,
    "published",
    existing.entry.status,
    existing.relations ?? [],
  );
  assertPublishableLocaleContent(projectPath, collection, locale);

  maybeWriteRevision(projectPath, collection, existing, "before publish");

  const now = nowIso();
  const next: AriaEntryRecord = {
    ...existing,
    entry: {
      ...existing.entry,
      status: "published",
      version: generateId(),
      updatedAt: now,
      publishedAt: now,
    },
  };

  return persistEntry(projectPath, collection, next);
}

export function unpublishEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
  opts: { version: string },
): AriaEntryRecord {
  const collection = requireCollection(projectPath, collectionId);
  const existing = store.readEntry(projectPath, collectionId, entryId);
  if (!existing) {
    throw new Error(`Entry not found: ${entryId}`);
  }
  assertVersion(existing, opts.version);

  maybeWriteRevision(projectPath, collection, existing, "before unpublish");

  const now = nowIso();
  const next: AriaEntryRecord = {
    ...existing,
    entry: {
      ...existing.entry,
      status: "draft",
      version: generateId(),
      updatedAt: now,
      publishedAt: null,
    },
  };
  return persistEntry(projectPath, collection, next);
}

export function archiveEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
  opts: { version: string },
): AriaEntryRecord {
  const collection = requireCollection(projectPath, collectionId);
  const existing = store.readEntry(projectPath, collectionId, entryId);
  if (!existing) {
    throw new Error(`Entry not found: ${entryId}`);
  }
  assertVersion(existing, opts.version);

  maybeWriteRevision(projectPath, collection, existing, "before archive");

  const now = nowIso();
  const next: AriaEntryRecord = {
    ...existing,
    entry: {
      ...existing.entry,
      status: "archived",
      version: generateId(),
      updatedAt: now,
    },
  };
  return persistEntry(projectPath, collection, next);
}

function compareEntries(
  a: AriaEntryRecord,
  b: AriaEntryRecord,
  sort: EntrySort,
  locale?: string,
): number {
  const localeA = pickLocale(a, locale);
  const localeB = pickLocale(b, locale);
  let left: string | null = null;
  let right: string | null = null;
  switch (sort.field) {
    case "title":
      left = localeA.title;
      right = localeB.title;
      break;
    case "slug":
      left = localeA.slug;
      right = localeB.slug;
      break;
    case "updatedAt":
      left = a.entry.updatedAt;
      right = b.entry.updatedAt;
      break;
    case "createdAt":
      left = a.entry.createdAt;
      right = b.entry.createdAt;
      break;
    case "publishedAt":
      left = a.entry.publishedAt;
      right = b.entry.publishedAt;
      break;
  }
  const aMissing = left == null || left === "";
  const bMissing = right == null || right === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const cmp = left!.localeCompare(right!, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  return sort.direction === "asc" ? cmp : -cmp;
}

export function listEntries(
  projectPath: string,
  params: ListEntriesParams,
): EntryListResult {
  requireCollection(projectPath, params.collectionId);
  let items = store.listEntries(projectPath, params.collectionId);

  if (params.status !== undefined) {
    const statuses = Array.isArray(params.status)
      ? new Set(params.status)
      : new Set([params.status]);
    items = items.filter((item) => statuses.has(item.entry.status));
  }

  if (params.locale) {
    const locale = params.locale.trim();
    items = items.filter((item) =>
      item.locales.some((loc) => loc.locale === locale),
    );
  }

  const query = params.query?.trim().toLowerCase();
  if (query) {
    items = items.filter((item) => {
      const locale = pickLocale(item, params.locale);
      return (
        locale.title.toLowerCase().includes(query) ||
        locale.slug.toLowerCase().includes(query)
      );
    });
  }

  const sorts =
    params.sort && params.sort.length > 0
      ? params.sort
      : ([{ field: "updatedAt", direction: "desc" }] as EntrySort[]);

  items = [...items].sort((a, b) => {
    for (const sort of sorts) {
      const cmp = compareEntries(a, b, sort, params.locale);
      if (cmp !== 0) return cmp;
    }
    return a.entry.id.localeCompare(b.entry.id);
  });

  const page = Math.max(1, Math.floor(params.page ?? 1));
  const limit = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Math.floor(params.limit ?? DEFAULT_LIST_LIMIT)),
  );
  const total = items.length;
  const start = (page - 1) * limit;
  const pageItems = items.slice(start, start + limit);

  return { items: pageItems, total, page, limit };
}

/** Delete collection data and configuration inside the caller's project mutation. */
export function deleteCollections(
  projectPath: string,
  collectionIds: readonly string[],
  expectedRevision: string,
  options?: { deleteEntries?: boolean },
): { deleted: string[] } {
  const ids = [...new Set(collectionIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error("At least one collection id is required");
  const state = readCollections(projectPath);
  if (!state.revision || state.revision !== expectedRevision) {
    throw new Error("CONFLICT");
  }
  const existing = new Set(state.collections.map((collection) => collection.id));
  const missing = ids.filter((id) => !existing.has(id));
  if (missing.length > 0) {
    throw new Error(`Collection not found: ${missing.join(", ")}`);
  }
  for (const id of ids) {
    const entryCount = store.listEntryFiles(projectPath, id).length;
    if (entryCount > 0 && !options?.deleteEntries) {
      throw new Error(
        `CONTENT_IN_USE: Collection ${id} contains ${entryCount} entr${entryCount === 1 ? "y" : "ies"}. Delete its entries explicitly first.`,
      );
    }
    const usages = findInboundCollectionUsages(projectPath, id)
      .filter(
        (usage) =>
          !usage.sourceCollectionId || !ids.includes(usage.sourceCollectionId),
      );
    if (usages.length > 0) {
      throw new Error(
        `CONTENT_IN_USE: Collection ${id} is targeted by ${usages.map((usage) => `${usage.sourceCollectionId}:${usage.fieldKey}`).join(", ")}.`,
      );
    }
  }
  if (options?.deleteEntries) {
    for (const id of ids) {
      for (const record of store.listEntries(projectPath, id)) {
        const externalUsages = findInboundEntryUsages(
          projectPath,
          record.entry.id,
        ).filter(
          (usage) =>
            !usage.sourceCollectionId ||
            !ids.includes(usage.sourceCollectionId),
        );
        if (externalUsages.length > 0) {
          throw new Error(
            `CONTENT_IN_USE: Collection ${id} contains entries referenced outside the selected collections. Remove those references before deleting it.`,
          );
        }
      }
    }
    for (const id of ids) {
      deleteCollectionEntries(projectPath, id);
    }
  }
  writeCollections(projectPath, {
    collections: state.collections.filter((collection) => !ids.includes(collection.id)),
  });
  regenerateContentConfig(projectPath);
  return { deleted: ids };
}

export function getEntry(
  projectPath: string,
  collectionId: string,
  entryIdOrSlug: string,
): AriaEntryRecord | null {
  requireCollection(projectPath, collectionId);
  const key = entryIdOrSlug.trim();
  if (!key) return null;
  const byId = store.readEntry(projectPath, collectionId, key);
  if (byId) return byId;
  return store.findEntryBySlug(projectPath, collectionId, slugify(key));
}

export function listRevisions(
  projectPath: string,
  entryId: string,
): AriaEntryRevision[] {
  const found = store.findEntryByIdAcrossCollections(projectPath, entryId);
  if (!found) {
    throw new Error(`Entry not found: ${entryId}`);
  }
  return store.listRevisions(projectPath, entryId);
}

export function restoreRevision(
  projectPath: string,
  entryId: string,
  revisionId: string,
  expectedVersion: string,
): AriaEntryRecord {
  const found = store.findEntryByIdAcrossCollections(projectPath, entryId);
  if (!found) {
    throw new Error(`Entry not found: ${entryId}`);
  }
  assertVersion(found.record, expectedVersion);
  const collection = requireCollection(projectPath, found.collectionId);
  const revision = store.readRevision(projectPath, entryId, revisionId);
  if (!revision) {
    throw new Error(`Revision not found: ${revisionId}`);
  }

  maybeWriteRevision(projectPath, collection, found.record, "before restore");

  const previousSlug = sourceSlug(found.record);
  const now = nowIso();
  const snapshot = revision.snapshot;
  const reserved = new Set<string>();
  const locales = snapshot.locales.map((loc) => {
    const locale = loc.locale.trim();
    let candidate = slugify(loc.slug);
    if (!candidate) candidate = "entry";
    let suffix = 2;
    while (
      reserved.has(`${locale}::${candidate}`) ||
      !checkSlugAvailable(
        projectPath,
        found.collectionId,
        candidate,
        locale,
        found.record.entry.id,
      )
    ) {
      candidate = `${slugify(loc.slug) || "entry"}-${suffix}`;
      suffix += 1;
      if (suffix > 10_000) {
        throw new Error("Unable to allocate unique slug during restore");
      }
    }
    reserved.add(`${locale}::${candidate}`);
    return {
      ...loc,
      entryId: found.record.entry.id,
      collectionId: found.collectionId,
      locale,
      slug: candidate,
    };
  });

  const restored: AriaEntryRecord = {
    entry: {
      ...snapshot.entry,
      id: found.record.entry.id,
      collectionId: found.collectionId,
      version: generateId(),
      authorId: LOCAL_AUTHOR_ID,
      updatedAt: now,
      createdAt: found.record.entry.createdAt,
    },
    locales,
    relations: (snapshot.relations ?? []).map((rel) => ({
      ...rel,
      sourceEntryId: found.record.entry.id,
    })),
    ...(found.record.authorship
      ? { authorship: found.record.authorship }
      : {}),
  };

  if (restored.entry.status === "published") {
    const locale = pickLocale(restored);
    assertValidLeavingDraft(
      projectPath,
      collection,
      locale.frontmatter,
      "published",
      found.record.entry.status,
      restored.relations ?? [],
    );
    assertPublishableLocaleContent(projectPath, collection, locale);
  }

  return persistEntry(projectPath, collection, restored, previousSlug, found.record);
}

/**
 * Delete every entry (JSON, revisions, derived markdown) for a collection.
 * Does not remove the collection def from collections.json.
 */
export function deleteCollectionEntries(
  projectPath: string,
  collectionId: string,
): number {
  requireCollection(projectPath, collectionId);
  const records = store.deleteAllEntriesForCollection(projectPath, collectionId);
  for (const record of records) {
    const slug = sourceSlug(record);
    syncAfterEntryMutation(projectPath, collectionId, null, slug, record);
  }
  const settings = readSiteSettings(projectPath);
  syncLocalizationManifest(projectPath, settings.localization, settings.siteUrl);
  return records.length;
}
