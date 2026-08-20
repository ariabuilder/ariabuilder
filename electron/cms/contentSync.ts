import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  StructuredTextDocumentSchema,
  entryFieldsForCollection,
  type StructuredTextBlock,
  type StructuredTextMarkDef,
  type StructuredTextSpan,
  type AriaEntryRecord,
  type FieldSchema,
} from "../../shared/cms";
import type { AriaCollectionDef } from "../../shared/types";
import {
  normalizeCollectionsForPersistence,
  readCollections,
  writeCollections,
} from "../collections";
import {
  canonicalDirectory,
  removePathTracked,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "../pathSafety";
import { listEntries } from "./store";
import { cmsMediaPublicUrl } from "./mediaReferences";

export const CONTENT_CONFIG_BEGIN = "/* aria:content-config-begin */";
export const CONTENT_CONFIG_END = "/* aria:content-config-end */";
const COLLECTION_CONFIG_MARKER_PREFIX = "aria:collection-config";

const RESERVED_FRONTMATTER_KEYS = new Set(["title", "slug", "draft", "locale", "translationKey", "ariaEntryId"]);

/** Sanitize a single path segment for content filenames / folders. */
export function sanitizeContentSegment(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = (value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

/**
 * Stable content folder for a collection. Valid Aria names are already unique
 * kebab-case; otherwise sanitize and append a short id to avoid collisions.
 */
export function contentFolderForCollection(collection: {
  id: string;
  name: string;
}): string {
  const name = collection.name.trim();
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    return name;
  }
  const base = sanitizeContentSegment(name, "collection");
  const suffix = collection.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "x";
  return `${base}-${suffix.toLowerCase()}`;
}

function contentCollectionDir(
  projectPath: string,
  collection: { id: string; name: string; contentDirectory?: string } | string,
): string {
  const root = canonicalDirectory(projectPath);
  const relativeDirectory = typeof collection !== "string" && collection.contentDirectory
    ? collection.contentDirectory.replace(/\\/g, "/").replace(/^\.\//, "")
    : path.posix.join(
        "src/content",
        typeof collection === "string"
          ? sanitizeContentSegment(collection, "collection")
          : contentFolderForCollection(collection),
      );
  if (
    path.posix.isAbsolute(relativeDirectory)
    || relativeDirectory === ".."
    || relativeDirectory.startsWith("../")
    || !relativeDirectory.startsWith("src/")
  ) {
    throw new Error("Collection content directory must stay inside src");
  }
  return resolveWithinRoot(
    root,
    path.join(root, relativeDirectory),
    { allowMissing: true, rejectFinalSymlink: true },
  );
}

function entryMarkdownPath(
  projectPath: string,
  collection: { id: string; name: string; contentDirectory?: string } | string,
  slug: string,
): string {
  const root = canonicalDirectory(projectPath);
  const safeSlug = sanitizeContentSegment(slug, "entry");
  return resolveWithinRoot(
    root,
    path.join(contentCollectionDir(projectPath, collection), `${safeSlug}.md`),
    { allowMissing: true, rejectFinalSymlink: true },
  );
}

function localizedEntryMarkdownPath(
  projectPath: string,
  collection: { id: string; name: string; contentDirectory?: string } | string,
  locale: string,
  slug: string,
): string {
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(
    root,
    path.join(
      contentCollectionDir(projectPath, collection),
      sanitizeContentSegment(locale, "locale"),
      `${sanitizeContentSegment(slug, "entry")}.md`,
    ),
    { allowMissing: true, rejectFinalSymlink: true },
  );
}

function contentConfigPath(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(root, path.join(root, "src", "content.config.ts"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function sourceLocaleForEntry(record: AriaEntryRecord) {
  return record.locales.find((locale) => locale.isSource) ?? record.locales[0];
}

function fieldByKey(
  collection: AriaCollectionDef,
): Map<string, FieldSchema> {
  const fields = entryFieldsForCollection(collection);
  return new Map(fields.map((field) => [field.key, field]));
}

function relationIdsForField(
  record: AriaEntryRecord,
  fieldKey: string,
): string[] {
  const rows = (record.relations ?? [])
    .filter((row) => row.fieldKey === fieldKey)
    .slice()
    .sort((a, b) => a.position - b.position || a.targetEntryId.localeCompare(b.targetEntryId));
  return rows.map((row) => row.targetEntryId);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function yamlNeedsQuotes(value: string): boolean {
  if (value.length === 0) return true;
  if (/[\n\r\t]/.test(value)) return true;
  if (/^\s|\s$/.test(value)) return true;
  if (/[:#{}[\],&*?|<>=!%@`]/.test(value)) return true;
  if (/^['"]/.test(value)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
  if (/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(value)) return true;
  if (/^(0o[0-7]+|0x[0-9a-fA-F]+)$/.test(value)) return true;
  return false;
}

function yamlQuoteString(value: string): string {
  return JSON.stringify(value);
}

/**
 * YAML stringify for flat frontmatter values (scalars, arrays, nested objects).
 * Quotes strings that would be ambiguous or unsafe unquoted.
 */
export function stringifyYaml(
  value: unknown,
  indent = 0,
): string {
  const pad = "  ".repeat(indent);

  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return String(value);
  }
  if (typeof value === "string") {
    return yamlNeedsQuotes(value) ? yamlQuoteString(value) : value;
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (isPlainObject(item)) {
          const nested = stringifyYaml(item, indent + 1);
          const nestedLines = nested.split("\n");
          const firstContent = (nestedLines[0] ?? "").replace(/^\s+/, "");
          const rest = nestedLines.slice(1);
          return [`${pad}- ${firstContent}`, ...rest].join("\n");
        }
        if (Array.isArray(item)) {
          return `${pad}-\n${stringifyYaml(item, indent + 1)}`;
        }
        return `${pad}- ${stringifyYaml(item, 0)}`;
      })
      .join("\n");
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return entries
      .map(([key, child]) => {
        const safeKey = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)
          ? key
          : yamlQuoteString(key);
        if (isPlainObject(child) || Array.isArray(child)) {
          if (Array.isArray(child) && child.length === 0) {
            return `${pad}${safeKey}: []`;
          }
          if (isPlainObject(child) && Object.keys(child).length === 0) {
            return `${pad}${safeKey}: {}`;
          }
          return `${pad}${safeKey}:\n${stringifyYaml(child, indent + 1)}`;
        }
        return `${pad}${safeKey}: ${stringifyYaml(child, 0)}`;
      })
      .join("\n");
  }

  // Fallback for unexpected values (dates, etc.)
  if (value instanceof Date) {
    return yamlNeedsQuotes(value.toISOString())
      ? yamlQuoteString(value.toISOString())
      : value.toISOString();
  }
  return yamlQuoteString(String(value));
}

function buildFlatFrontmatter(
  collection: AriaCollectionDef,
  record: AriaEntryRecord,
  locale = sourceLocaleForEntry(record),
  status = locale?.isSource ? record.entry.status : locale?.status ?? "draft",
): Record<string, unknown> {
  const draft = status !== "published";
  const fields = fieldByKey(collection);
  const out: Record<string, unknown> = {
    title: locale?.title ?? "",
    slug: locale?.slug ?? "",
    draft,
    locale: locale?.locale ?? "",
    translationKey: record.entry.id,
    ariaEntryId: record.entry.id,
  };

  const frontmatter = locale?.frontmatter ?? {};
  for (const [key, rawValue] of Object.entries(frontmatter)) {
    if (RESERVED_FRONTMATTER_KEYS.has(key)) continue;
    const field = fields.get(key);
    if (field?.type === "relation") {
      out[key] = relationIdsForField(record, key);
      continue;
    }
    if (field?.type === "reference") {
      out[key] =
        typeof rawValue === "string"
          ? rawValue
          : rawValue == null
            ? null
            : String(rawValue);
      continue;
    }
    if (
      (field?.type === "image" || field?.type === "file") &&
      isPlainObject(rawValue)
    ) {
      out[key] = typeof rawValue.mediaId === "string"
        ? cmsMediaPublicUrl(rawValue.mediaId)
        : rawValue;
      continue;
    }
    if (rawValue === undefined) continue;
    out[key] = rawValue;
  }

  // Ensure relation fields appear even when absent from frontmatter bag.
  for (const field of entryFieldsForCollection(collection)) {
    if (field.type !== "relation") continue;
    if (Object.prototype.hasOwnProperty.call(out, field.key)) continue;
    out[field.key] = relationIdsForField(record, field.key);
  }

  return out;
}

function renderFrontmatterYaml(values: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(values)) {
    const safeKey = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)
      ? key
      : yamlQuoteString(key);
    if (isPlainObject(value) || Array.isArray(value)) {
      if (Array.isArray(value) && value.length === 0) {
        lines.push(`${safeKey}: []`);
        continue;
      }
      if (isPlainObject(value) && Object.keys(value).length === 0) {
        lines.push(`${safeKey}: {}`);
        continue;
      }
      lines.push(`${safeKey}:`);
      lines.push(stringifyYaml(value, 1));
      continue;
    }
    lines.push(`${safeKey}: ${stringifyYaml(value, 0)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function markdownEscape(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

function markdownInlineCode(value: string): string {
  return `\`${value.replace(/`/g, "\\`")}\``;
}

function markDefByKey(
  markDefs: readonly StructuredTextMarkDef[],
): Map<string, StructuredTextMarkDef> {
  return new Map(markDefs.map((markDef) => [markDef._key, markDef]));
}

function renderMarkdownSpan(
  span: StructuredTextSpan,
  markDefs: ReadonlyMap<string, StructuredTextMarkDef>,
): string {
  return span.marks.reduce((text, mark) => {
    const markDef = markDefs.get(mark);
    if (markDef?._type === "link") {
      return `[${text}](${markDef.href})`;
    }
    if (markDef?._type === "entryLink") {
      return `[${text}](entry://${markDef.collectionId}/${markDef.entryId})`;
    }
    if (markDef?._type === "pageLink") {
      return `[${text}](page://${markDef.pageId})`;
    }

    switch (mark) {
      case "strong":
      case "bold":
        return `**${text}**`;
      case "em":
      case "italic":
        return `_${text}_`;
      case "code":
        return markdownInlineCode(text);
      case "strike":
        return `~~${text}~~`;
      case "underline":
        return `<u>${text}</u>`;
      default:
        return text;
    }
  }, markdownEscape(span.text));
}

function renderMarkdownBlockChildren(
  block: Extract<StructuredTextBlock, { _type: "block" }>,
): string {
  const markDefs = markDefByKey(block.markDefs);
  return block.children
    .map((span) => renderMarkdownSpan(span, markDefs))
    .join("");
}

function renderMarkdownTextBlock(
  block: Extract<StructuredTextBlock, { _type: "block" }>,
  listIndex: number,
): string {
  const content = renderMarkdownBlockChildren(block);
  if (block.listItem === "bullet") {
    return `- ${content}`;
  }
  if (block.listItem === "number") {
    return `${listIndex}. ${content}`;
  }

  switch (block.style) {
    case "h2":
      return `## ${content}`;
    case "h3":
      return `### ${content}`;
    case "h4":
      return `#### ${content}`;
    case "blockquote":
      return content
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "normal":
    default:
      return content;
  }
}

function renderMarkdownNonTextBlock(
  block: Exclude<StructuredTextBlock, { _type: "block" }>,
  resolveMediaUrl: (mediaId: string) => string,
): string {
  switch (block._type) {
    case "image": {
      const caption =
        block.caption?.map((span) => markdownEscape(span.text)).join("") ?? "";
      const alt = markdownEscape(block.alt || caption || block.mediaId);
      return `![${alt}](${resolveMediaUrl(block.mediaId)})`;
    }
    case "embed":
      return `[${block.provider}](${block.url})`;
    case "divider":
      return "---";
  }
}

/** Convert structured text / string body to Markdown for Astro content files. */
export function renderUnknownBodyToMarkdown(
  body: unknown,
  resolveMediaUrl: (mediaId: string) => string = cmsMediaPublicUrl,
): string {
  if (body == null) return "";
  if (typeof body === "string") return body.trim();

  const parsed = StructuredTextDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return `\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``;
  }

  let orderedListIndex = 1;
  const lines = parsed.data.map((block) => {
    if (block._type !== "block") {
      orderedListIndex = 1;
      return renderMarkdownNonTextBlock(block, resolveMediaUrl);
    }
    if (block.listItem === "number") {
      return renderMarkdownTextBlock(block, orderedListIndex++);
    }
    orderedListIndex = 1;
    return renderMarkdownTextBlock(block, 1);
  });

  return lines
    .filter((line) => line.trim().length > 0)
    .join("\n\n")
    .trim();
}

function deleteMarkdownIfExists(file: string): void {
  if (existsSync(file)) {
    removePathTracked(file, { force: true });
  }
}

/**
 * Sync one entry to `src/content/{collection}/{slug}.md`.
 * Archived entries remove the derived file.
 */
export function syncEntryToMarkdown(
  projectPath: string,
  collection: AriaCollectionDef,
  record: AriaEntryRecord,
): void {
  const sourceLocale = sourceLocaleForEntry(record);
  if (!sourceLocale) return;

  const mdPath = entryMarkdownPath(
    projectPath,
    collection,
    sourceLocale.slug,
  );

  if (record.entry.status === "archived") {
    deleteMarkdownIfExists(mdPath);
    for (const locale of record.locales) {
      if (locale.isSource) continue;
      deleteMarkdownIfExists(localizedEntryMarkdownPath(projectPath, collection, locale.locale, locale.slug));
    }
    return;
  }

  const writeLocale = (
    locale: AriaEntryRecord["locales"][number],
    file: string,
    status: "draft" | "published" | "archived",
  ) => {
    if (status === "archived") {
      deleteMarkdownIfExists(file);
      return;
    }
    const frontmatter = renderFrontmatterYaml(buildFlatFrontmatter(collection, record, locale, status));
    const body = renderUnknownBodyToMarkdown(locale.body);
    mkdirSync(path.dirname(file), { recursive: true });
    writeTextFileAtomic(file, body ? `${frontmatter}\n\n${body}\n` : `${frontmatter}\n`);
  };

  writeLocale(sourceLocale, mdPath, record.entry.status);
  for (const locale of record.locales) {
    if (locale.isSource) continue;
    const file = localizedEntryMarkdownPath(projectPath, collection, locale.locale, locale.slug);
    // Legacy translations have no locale lifecycle and remain private by default.
    const localeStatus = locale.status ?? "draft";
    const deliveryStatus = localeStatus === "archived"
      ? "archived"
      : record.entry.status === "published"
        ? localeStatus
        : "draft";
    writeLocale(locale, file, deliveryStatus);
  }
}

/** Remove a derived markdown file for a collection slug. */
export function removeEntryMarkdown(
  projectPath: string,
  collection: { id: string; name: string; contentDirectory?: string } | string,
  slug: string,
): void {
  const mdPath = entryMarkdownPath(projectPath, collection, slug);
  deleteMarkdownIfExists(mdPath);
}

/** Sync every stored entry in a collection to Markdown. */
export function syncAllCollectionEntries(
  projectPath: string,
  collectionId: string,
): void {
  const { collections } = readCollections(projectPath);
  const collection = collections.find((item) => item.id === collectionId);
  if (!collection) {
    throw new Error(`Collection not found: ${collectionId}`);
  }
  for (const record of listEntries(projectPath, collectionId)) {
    syncEntryToMarkdown(projectPath, collection, record);
  }
}

function zodObjectFields(fields: readonly FieldSchema[]): string {
  if (fields.length === 0) return "{}";
  return `{ ${fields.map((field) => {
    const optional = field.required ? "" : ".optional()";
    return `${fieldKeyLiteral(field.key)}: ${zodExprForField(field)}${optional}`;
  }).join(", ")} }`;
}

function zodExprForField(field: FieldSchema): string {
  switch (field.type) {
    case "string":
    case "slug":
    case "text":
    case "color":
    case "icon":
    case "reference":
      return "z.string()";
    case "number":
    case "integer":
      return "z.number()";
    case "boolean":
      return "z.boolean()";
    case "date":
    case "datetime":
      return "z.coerce.date()";
    case "select": {
      const unique = [...new Set((field.options ?? []).map((o) => o.trim()).filter(Boolean))];
      if (unique.length === 0) return "z.string()";
      return `z.enum([${unique.map((o) => JSON.stringify(o)).join(", ")}])`;
    }
    case "multiSelect":
      return "z.array(z.string())";
    case "relation":
      return "z.array(z.string())";
    case "repeater":
      return field.fields?.length
        ? `z.array(z.object(${zodObjectFields(field.fields)}))`
        : "z.array(z.unknown())";
    case "image":
    case "file":
      return "z.string()";
    case "link":
      return "z.record(z.string(), z.unknown())";
    case "object":
      return field.fields?.length
        ? `z.object(${zodObjectFields(field.fields)})`
        : "z.record(z.string(), z.unknown())";
    case "json":
    case "structuredText":
    case "richtext":
      return "z.unknown()";
    default:
      return "z.unknown()";
  }
}

function collectionConstName(name: string): string {
  const safe = sanitizeContentSegment(name, "collection").replace(/[^A-Za-z0-9_]/g, "_");
  if (/^[A-Za-z_]/.test(safe)) return safe;
  return `c_${safe}`;
}

function fieldKeyLiteral(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key);
}

function fieldDataAccess(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? `data.${key}`
    : `data[${JSON.stringify(key)}]`;
}

/**
 * Aria allows incomplete drafts; Astro still loads those Markdown files.
 * Keep required fields optional at the Zod property level and only enforce
 * them when `draft` is false, matching CMS publish rules.
 */
export function buildCollectionDefineInitializer(collection: AriaCollectionDef): string {
  const contentDirectory = collection.contentDirectory?.replace(/\\/g, "/").replace(/^\.\//, "")
    ?? `src/content/${contentFolderForCollection(collection)}`;
  const schemaLines: string[] = [
    "    title: z.string(),",
    "    slug: z.string(),",
    "    draft: z.boolean().default(false),",
    "    locale: z.string(),",
    "    translationKey: z.string(),",
    "    ariaEntryId: z.string(),",
  ];
  const requiredWhenPublished: string[] = [];

  for (const field of entryFieldsForCollection(collection)) {
    if (RESERVED_FRONTMATTER_KEYS.has(field.key)) continue;
    const keyLiteral = fieldKeyLiteral(field.key);
    let expr = zodExprForField(field);
    // Always optional at the field level — drafts may omit required values.
    expr = `${expr}.optional()`;
    if (field.required) {
      requiredWhenPublished.push(field.key);
    }
    schemaLines.push(`    ${keyLiteral}: ${expr},`);
  }

  const schemaExpr =
    requiredWhenPublished.length === 0
      ? [`  schema: z.object({`, ...schemaLines, `  }),`].join("\n")
      : [
          `  schema: z.object({`,
          ...schemaLines,
          `  }).superRefine((data, ctx) => {`,
          `    if (data.draft) return;`,
          ...requiredWhenPublished.flatMap((key) => [
            `    if (${fieldDataAccess(key)} === undefined) {`,
            `      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Required", path: [${JSON.stringify(key)}] });`,
            `    }`,
          ]),
          `  }),`,
        ].join("\n");

  return [
    `defineCollection({`,
    `  loader: glob({ pattern: "**/*.md", base: "./${contentDirectory}" }),`,
    schemaExpr,
    `})`,
  ].join("\n");
}

function buildCollectionDefineSource(collection: AriaCollectionDef): string {
  return `const ${collectionConstName(collection.name)} = ${buildCollectionDefineInitializer(collection)};`;
}

export function collectionConfigMarkers(name: string): { begin: string; end: string } {
  const safeName = sanitizeContentSegment(name, "collection");
  return {
    begin: `/* ${COLLECTION_CONFIG_MARKER_PREFIX}-begin ${safeName} */`,
    end: `/* ${COLLECTION_CONFIG_MARKER_PREFIX}-end ${safeName} */`,
  };
}

function buildContentConfigGeneratedSource(
  collections: AriaCollectionDef[],
): string {
  // Include all kinds for simplicity (content | data | config | tags).
  const included = collections
    .filter((c) => c.name.trim().length > 0)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const defines = included.map((collection) =>
    buildCollectionDefineSource(collection),
  );
  const exportEntries = included.map((collection) => {
    const key = contentFolderForCollection(collection);
    const constName = collectionConstName(collection.name);
    const keyLiteral = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
      ? key
      : JSON.stringify(key);
    if (keyLiteral === constName) {
      return `  ${constName},`;
    }
    return `  ${keyLiteral}: ${constName},`;
  });

  return [
    `import { defineCollection, z } from "astro:content";`,
    `import { glob } from "astro/loaders";`,
    ``,
    ...defines,
    ``,
    `export const collections = {`,
    ...exportEntries,
    `};`,
  ].join("\n");
}

function applyManagedContentConfig(
  existing: string | null,
  generated: string,
  collections: readonly AriaCollectionDef[],
): string {
  const block = `${CONTENT_CONFIG_BEGIN}\n${generated.trim()}\n${CONTENT_CONFIG_END}\n`;
  if (existing == null || existing.trim().length === 0) {
    return block;
  }

  const begin = existing.indexOf(CONTENT_CONFIG_BEGIN);
  const end = existing.indexOf(CONTENT_CONFIG_END);
  if (begin !== -1 && end !== -1 && end > begin) {
    const before = existing.slice(0, begin);
    const after = existing.slice(end + CONTENT_CONFIG_END.length);
    return `${before}${CONTENT_CONFIG_BEGIN}\n${generated.trim()}\n${CONTENT_CONFIG_END}${after.replace(/^\n/, "\n")}`;
  }

  if (collections.length === 0 && existing.includes(`/* ${COLLECTION_CONFIG_MARKER_PREFIX}-begin `)) {
    return existing;
  }

  let next = existing;
  let replaced = 0;
  for (const collection of collections) {
    const markers = collectionConfigMarkers(collection.name);
    const markerBegin = next.indexOf(markers.begin);
    const markerEnd = next.indexOf(markers.end, markerBegin + markers.begin.length);
    if (markerBegin < 0 || markerEnd < 0) continue;
    next = `${next.slice(0, markerBegin)}${markers.begin}\n${buildCollectionDefineInitializer(collection)}\n${next.slice(markerEnd)}`;
    replaced += 1;
  }
  if (replaced === collections.length && collections.length > 0) return next;

  throw new Error(
    "Aria will not replace an existing unmarked content.config file. Add the Aria managed markers or approve a dedicated integration first.",
  );
}

/**
 * Regenerate `src/content.config.ts` from current collection schemas.
 * Call this after collection schema saves (not on every entry mutation).
 */
export function regenerateContentConfig(projectPath: string): void {
  const root = canonicalDirectory(projectPath);
  const { collections } = readCollections(root);
  const prepared = prepareContentConfigUpdate(root, collections);
  mkdirSync(path.dirname(prepared.file), { recursive: true });
  writeTextFileAtomic(prepared.file, prepared.next);
}

function prepareContentConfigUpdate(
  projectPath: string,
  collections: AriaCollectionDef[],
): { file: string; next: string } {
  const root = canonicalDirectory(projectPath);
  const file = contentConfigPath(root);
  const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
  const generated = buildContentConfigGeneratedSource(collections);
  const next = applyManagedContentConfig(existing, generated, collections);
  return { file, next: next.endsWith("\n") ? next : `${next}\n` };
}

/**
 * Persist Aria collection definitions and their generated Astro config as one
 * coordinated mutation. Known integration failures are detected before either
 * file changes; an unexpected config write failure restores collection state.
 */
export function writeCollectionsWithContentConfig(
  projectPath: string,
  next: unknown,
) {
  const root = canonicalDirectory(projectPath);
  const previous = readCollections(root);
  const normalized = normalizeCollectionsForPersistence(next);
  const prepared = prepareContentConfigUpdate(root, normalized.collections);
  const state = writeCollections(root, normalized);
  try {
    mkdirSync(path.dirname(prepared.file), { recursive: true });
    writeTextFileAtomic(prepared.file, prepared.next);
    return state;
  } catch (error) {
    writeCollections(root, previous);
    throw error;
  }
}

/**
 * After create / update / delete / publish / archive / etc.:
 * sync (or remove) the derived Markdown file.
 * Does **not** regenerate `content.config.ts` — call `regenerateContentConfig`
 * from collection schema update paths.
 */
export function syncAfterEntryMutation(
  projectPath: string,
  collectionId: string,
  record: AriaEntryRecord | null,
  previousSlug?: string,
  previousRecord?: AriaEntryRecord,
): void {
  const root = canonicalDirectory(projectPath);
  const { collections } = readCollections(root);
  const collection = collections.find((item) => item.id === collectionId);
  if (!collection) {
    return;
  }

  if (record == null) {
    if (previousSlug) {
      removeEntryMarkdown(root, collection, previousSlug);
    }
    for (const locale of previousRecord?.locales ?? []) {
      if (locale.isSource) continue;
      deleteMarkdownIfExists(localizedEntryMarkdownPath(root, collection, locale.locale, locale.slug));
    }
    return;
  }

  for (const previous of previousRecord?.locales ?? []) {
    if (previous.isSource) continue;
    const current = record.locales.find((locale) => locale.locale === previous.locale);
    if (!current || current.slug !== previous.slug || current.status === "archived" || record.entry.status === "archived") {
      deleteMarkdownIfExists(localizedEntryMarkdownPath(root, collection, previous.locale, previous.slug));
    }
  }

  const locale = sourceLocaleForEntry(record);
  const nextSlug = locale?.slug;
  syncEntryToMarkdown(root, collection, record);

  if (
    previousSlug &&
    nextSlug &&
    sanitizeContentSegment(previousSlug, "entry") !==
      sanitizeContentSegment(nextSlug, "entry")
  ) {
    removeEntryMarkdown(root, collection, previousSlug);
  }
}
