import { createHash } from "node:crypto";
import { marked, type Token } from "marked";
import {
  ENTRY_STATUSES,
  StructuredTextDocumentSchema,
  type AriaEntryRecord,
  type EntryStatus,
  type FieldType,
  type StructuredTextDocument,
  type StructuredTextMarkDef,
  type StructuredTextSpan,
} from "../../shared/cms";
import { readCollections, writeCollections } from "../collections";
import { regenerateContentConfig } from "./contentSync";
import { createEntry, slugify } from "./services";
import { parseDocument } from "yaml";

const RESERVED_KEYS = new Set(["title", "slug", "locale", "status", "body"]);

const ENTRY_STATUS_SET = new Set<string>(ENTRY_STATUSES);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[Tt ][\d:.+-Zz]+)?$/;

export type ParsedMarkdownEntry = {
  frontmatter: Record<string, unknown>;
  body: string;
  title?: string;
  slug?: string;
};

export type SuggestedMarkdownField = {
  key: string;
  label: string;
  type: FieldType;
};

export type MarkdownImportPreview = {
  previewHash: string;
  title?: string;
  slug?: string;
  frontmatterKeys: string[];
  bodyPreview: string;
  /** Reserved FM keys present in the document (title, slug, locale, status, body). */
  reservedMapped: string[];
  /** Non-reserved keys not present on the collection schema. */
  unknownKeys: string[];
  /** Typed suggestions for unknown keys (heuristic). */
  suggestedNewFields: SuggestedMarkdownField[];
  /** Non-reserved keys that already map to schema fields. */
  mappedFieldKeys: string[];
  /** Keys with nested or unsupported values that cannot become schema fields. */
  unsupportedKeys: string[];
  diagnostics: MarkdownImportDiagnostic[];
  normalizedEntryPlan: {
    title?: string;
    slug?: string;
    locale?: string;
    status: EntryStatus;
    frontmatter: Record<string, unknown>;
    body: StructuredTextDocument;
  };
  proposedSchemaChanges: SuggestedMarkdownField[];
  warnings: MarkdownImportDiagnostic[];
  blockingDiagnostics: MarkdownImportDiagnostic[];
};

export type MarkdownImportDiagnostic = {
  code: string;
  severity: "warning" | "error";
  message: string;
  remediation?: string;
};

const MAX_MARKDOWN_IMPORT_BYTES = 1024 * 1024;

function parseYamlFrontmatter(text: string): Record<string, unknown> {
  const document = parseDocument(text, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(`MARKDOWN_YAML_INVALID: ${document.errors[0]!.message}`);
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 }) as unknown;
  } catch (error) {
    throw new Error(
      `MARKDOWN_YAML_INVALID: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MARKDOWN_YAML_ROOT: Frontmatter must be a key-value object");
  }
  return value as Record<string, unknown>;
}

function splitFrontmatter(markdown: string): {
  frontmatterText: string | null;
  body: string;
} {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n") && normalized !== "---") {
    return { frontmatterText: null, body: normalized };
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing === -1) {
    // Allow trailing fence at EOF: ---\n...\n---
    const endFence = normalized.indexOf("\n---", 4);
    if (endFence !== -1 && normalized.slice(endFence + 4).trim() === "") {
      return {
        frontmatterText: normalized.slice(4, endFence),
        body: "",
      };
    }
    return { frontmatterText: null, body: normalized };
  }
  return {
    frontmatterText: normalized.slice(4, closing),
    body: normalized.slice(closing + 5),
  };
}

/**
 * Parse Markdown with optional YAML frontmatter between `---` fences.
 * Nested objects and arrays are preserved. YAML aliases are rejected.
 */
export function parseMarkdownEntry(markdown: string): ParsedMarkdownEntry {
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_IMPORT_BYTES) {
    throw new Error("MARKDOWN_TOO_LARGE: Markdown imports are limited to 1 MB");
  }
  const split = splitFrontmatter(markdown);
  const frontmatter =
    split.frontmatterText === null ? {} : parseYamlFrontmatter(split.frontmatterText);
  const body = split.body.replace(/^\n+/, "");

  const title =
    typeof frontmatter.title === "string" && frontmatter.title.trim()
      ? frontmatter.title.trim()
      : undefined;
  const slug =
    typeof frontmatter.slug === "string" && frontmatter.slug.trim()
      ? slugify(frontmatter.slug)
      : undefined;

  return {
    frontmatter,
    body,
    ...(title ? { title } : {}),
    ...(slug ? { slug } : {}),
  };
}

function asEntryStatus(value: unknown): EntryStatus | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return ENTRY_STATUS_SET.has(trimmed) ? (trimmed as EntryStatus) : undefined;
}

function humanizeFieldKey(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function looksLikeDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value.trim())) return false;
  const parsed = Date.parse(value.trim());
  return !Number.isNaN(parsed);
}

/** Suggest a field type from a parsed frontmatter value. */
export function suggestFieldTypeFromValue(value: unknown): FieldType | null {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "string";
    if (looksLikeDate(trimmed)) {
      return /[Tt ]\d/.test(trimmed) || /[Zz]|[+-]\d{2}:?\d{2}$/.test(trimmed)
        ? "datetime"
        : "date";
    }
    return "string";
  }
  return null;
}

function collectionFieldKeys(
  projectPath: string,
  collectionId: string,
): Set<string> {
  const state = readCollections(projectPath);
  const collection = state.collections.find((item) => item.id === collectionId);
  if (!collection) {
    throw new Error(`Collection not found: ${collectionId}`);
  }
  return new Set((collection.schema?.fields ?? []).map((field) => field.key));
}

function buildSuggestedFields(
  frontmatter: Record<string, unknown>,
  existingKeys: Set<string>,
): SuggestedMarkdownField[] {
  const suggestions: SuggestedMarkdownField[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (RESERVED_KEYS.has(key) || existingKeys.has(key)) continue;
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key)) continue;
    const type = suggestFieldTypeFromValue(value);
    if (!type) continue;
    suggestions.push({
      key,
      label: humanizeFieldKey(key),
      type,
    });
  }
  return suggestions.sort((a, b) => a.key.localeCompare(b.key));
}

function bodyPreviewText(body: string, max = 280): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function safeLink(href: string): boolean {
  return /^(?:https?:|mailto:|tel:|\/|#)/i.test(href);
}

function appendInlineTokens(
  tokens: readonly Token[],
  marks: readonly string[],
  markDefs: StructuredTextMarkDef[],
  diagnostics: MarkdownImportDiagnostic[],
  nextKey: () => string,
): StructuredTextSpan[] {
  const spans: StructuredTextSpan[] = [];
  const appendText = (text: string, nextMarks = marks): void => {
    if (!text) return;
    spans.push({ _type: "span", _key: nextKey(), text, marks: [...nextMarks] });
  };
  for (const token of tokens) {
    switch (token.type) {
      case "text":
      case "escape":
      case "codespan":
        appendText(token.text, token.type === "codespan" ? [...marks, "code"] : marks);
        break;
      case "br":
        appendText("\n");
        break;
      case "strong":
        spans.push(...appendInlineTokens(token.tokens ?? [], [...marks, "strong"], markDefs, diagnostics, nextKey));
        break;
      case "em":
        spans.push(...appendInlineTokens(token.tokens ?? [], [...marks, "em"], markDefs, diagnostics, nextKey));
        break;
      case "del":
        spans.push(...appendInlineTokens(token.tokens ?? [], [...marks, "strike"], markDefs, diagnostics, nextKey));
        break;
      case "link": {
        if (!safeLink(token.href)) {
          diagnostics.push({
            code: "unsafe-link",
            severity: "error",
            message: `Unsafe link is not allowed: ${token.href}`,
            remediation: "Use https, mailto, tel, a site-relative URL, or an anchor.",
          });
          spans.push(...appendInlineTokens(token.tokens ?? [], marks, markDefs, diagnostics, nextKey));
          break;
        }
        const key = nextKey();
        markDefs.push({ _key: key, _type: "link", href: token.href });
        spans.push(...appendInlineTokens(token.tokens ?? [], [...marks, key], markDefs, diagnostics, nextKey));
        break;
      }
      case "image":
        diagnostics.push({
          code: "image-not-imported",
          severity: "warning",
          message: `Image was not imported: ${token.href}`,
          remediation: "Upload it to Media and insert it in the entry editor.",
        });
        appendText(token.text);
        break;
      case "html":
        diagnostics.push({
          code: "html-not-supported",
          severity: "error",
          message: "Raw HTML is not supported in Markdown imports.",
        });
        break;
      default:
        if ("text" in token && typeof token.text === "string") appendText(token.text);
    }
  }
  return spans;
}

function createTextBlock(input: {
  style: "normal" | "h2" | "h3" | "h4" | "blockquote";
  tokens: readonly Token[];
  diagnostics: MarkdownImportDiagnostic[];
  listItem?: "bullet" | "number";
  nextKey: () => string;
}) {
  const markDefs: StructuredTextMarkDef[] = [];
  const children = appendInlineTokens(input.tokens, [], markDefs, input.diagnostics, input.nextKey);
  return {
    _type: "block" as const,
    _key: input.nextKey(),
    style: input.style,
    ...(input.listItem ? { listItem: input.listItem, level: 1 } : {}),
    markDefs,
    children: children.length > 0
      ? children
      : [{ _type: "span" as const, _key: input.nextKey(), text: "", marks: [] }],
  };
}

function markdownToStructuredText(markdown: string): {
  body: StructuredTextDocument;
  diagnostics: MarkdownImportDiagnostic[];
} {
  const diagnostics: MarkdownImportDiagnostic[] = [];
  const blocks: StructuredTextDocument = [];
  let keyIndex = 0;
  const keySeed = createHash("sha256").update(markdown).digest("hex");
  const nextKey = () =>
    `md-${createHash("sha256").update(`${keySeed}:${keyIndex++}`).digest("hex").slice(0, 16)}`;
  const tokens = marked.lexer(markdown, { gfm: true, breaks: false });
  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break;
      case "paragraph":
      case "text":
        blocks.push(createTextBlock({ style: "normal", tokens: token.tokens ?? [], diagnostics, nextKey }));
        break;
      case "heading":
        if (token.depth === 1) {
          diagnostics.push({
            code: "heading-level-normalized",
            severity: "warning",
            message: "H1 was imported as H2.",
          });
        }
        blocks.push(createTextBlock({
          style: token.depth >= 4 ? "h4" : token.depth === 3 ? "h3" : "h2",
          tokens: token.tokens ?? [],
          diagnostics,
          nextKey,
        }));
        break;
      case "blockquote":
        blocks.push(createTextBlock({ style: "blockquote", tokens: token.tokens ?? [], diagnostics, nextKey }));
        break;
      case "list":
        for (const item of token.items) {
          blocks.push(createTextBlock({
            style: "normal",
            tokens: item.tokens,
            diagnostics,
            listItem: token.ordered ? "number" : "bullet",
            nextKey,
          }));
        }
        break;
      case "hr":
        blocks.push({ _type: "divider", _key: nextKey() });
        break;
      case "code":
        blocks.push(createTextBlock({
          style: "normal",
          tokens: [{ type: "codespan", raw: token.raw, text: token.text } as Token],
          diagnostics,
          nextKey,
        }));
        break;
      case "html":
        diagnostics.push({ code: "html-not-supported", severity: "error", message: "Raw HTML is not supported in Markdown imports." });
        break;
      case "table":
        diagnostics.push({
          code: "table-not-supported",
          severity: "warning",
          message: "Markdown tables are not supported and were skipped.",
          remediation: "Convert the table to a list or add it manually after import.",
        });
        break;
      default:
        diagnostics.push({
          code: "markdown-node-not-supported",
          severity: "warning",
          message: `Unsupported Markdown node was skipped: ${token.type}`,
        });
    }
  }
  return { body: StructuredTextDocumentSchema.parse(blocks), diagnostics };
}

function previewHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Preview a Markdown import against a collection without mutating data.
 */
export function previewImportMarkdown(
  projectPath: string,
  collectionId: string,
  markdown: string,
): MarkdownImportPreview {
  const existingKeys = collectionFieldKeys(projectPath, collectionId);
  const parsed = parseMarkdownEntry(markdown);
  const frontmatterKeys = Object.keys(parsed.frontmatter);
  const reservedMapped = frontmatterKeys.filter((key) => RESERVED_KEYS.has(key));
  const unknownKeys = frontmatterKeys.filter(
    (key) => !RESERVED_KEYS.has(key) && !existingKeys.has(key),
  );
  const mappedFieldKeys = frontmatterKeys.filter(
    (key) => !RESERVED_KEYS.has(key) && existingKeys.has(key),
  );
  const suggestedNewFields = buildSuggestedFields(
    parsed.frontmatter,
    existingKeys,
  );
  const suggestedKeys = new Set(suggestedNewFields.map((field) => field.key));
  const unsupportedKeys = unknownKeys.filter((key) => !suggestedKeys.has(key));

  const bodyText =
    typeof parsed.frontmatter.body === "string" && parsed.frontmatter.body.trim()
      ? parsed.frontmatter.body
      : parsed.body;
  const structured = markdownToStructuredText(bodyText);
  const requestedStatus = asEntryStatus(parsed.frontmatter.status);
  const diagnostics = [
    ...structured.diagnostics,
    ...(requestedStatus && requestedStatus !== "draft"
      ? [
          {
            code: "lifecycle-imported-as-draft",
            severity: "warning" as const,
            message: `Imported status “${requestedStatus}” is ignored; imports are created as drafts.`,
            remediation: "Review the imported entry, then publish or archive it explicitly.",
          },
        ]
      : []),
  ];
  const normalizedFrontmatter = Object.fromEntries(
    Object.entries(parsed.frontmatter).filter(([key]) => !RESERVED_KEYS.has(key)),
  );
  const locale =
    typeof parsed.frontmatter.locale === "string" &&
    parsed.frontmatter.locale.trim()
      ? parsed.frontmatter.locale.trim()
      : undefined;
  const normalizedEntryPlan = {
    ...(parsed.title ? { title: parsed.title } : {}),
    ...(parsed.slug ? { slug: parsed.slug } : {}),
    ...(locale ? { locale } : {}),
    status: "draft" as const,
    frontmatter: normalizedFrontmatter,
    body: structured.body,
  };

  const immutablePlan = {
    collectionId,
    existingFieldKeys: [...existingKeys].sort(),
    normalizedEntryPlan,
    proposedSchemaChanges: suggestedNewFields,
    mappedFieldKeys,
    unsupportedKeys,
    diagnostics,
  };

  return {
    previewHash: previewHash(immutablePlan),
    ...(parsed.title ? { title: parsed.title } : {}),
    ...(parsed.slug ? { slug: parsed.slug } : {}),
    frontmatterKeys,
    bodyPreview: bodyPreviewText(bodyText),
    reservedMapped,
    unknownKeys,
    suggestedNewFields,
    mappedFieldKeys,
    unsupportedKeys,
    diagnostics,
    normalizedEntryPlan,
    proposedSchemaChanges: suggestedNewFields,
    warnings: diagnostics.filter((item) => item.severity === "warning"),
    blockingDiagnostics: diagnostics.filter(
      (item) => item.severity === "error",
    ),
  };
}

function addSuggestedFieldsToCollection(
  projectPath: string,
  collectionId: string,
  fields: readonly SuggestedMarkdownField[],
): void {
  if (fields.length === 0) return;
  const state = readCollections(projectPath);
  const index = state.collections.findIndex((item) => item.id === collectionId);
  if (index < 0) {
    throw new Error(`Collection not found: ${collectionId}`);
  }
  const collection = state.collections[index]!;
  const existing = new Set(
    (collection.schema?.fields ?? []).map((field) => field.key),
  );
  const toAdd = fields.filter((field) => !existing.has(field.key));
  if (toAdd.length === 0) return;

  const nextFields = [
    ...(collection.schema?.fields ?? []),
    ...toAdd.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
    })),
  ];
  const nextVersion = (collection.schema?.version ?? 0) + 1;
  const collections = state.collections.map((item, i) =>
    i === index
      ? {
          ...item,
          schema: {
            fields: nextFields,
            version: nextVersion,
            ...(item.schema?.entryFieldOrder
              ? { entryFieldOrder: item.schema.entryFieldOrder }
              : {}),
            ...(item.schema?.icon ? { icon: item.schema.icon } : {}),
          },
        }
      : item,
  );
  writeCollections(projectPath, { collections });
  regenerateContentConfig(projectPath);
}

/**
 * Import a Markdown document into a CMS entry.
 * Reserved FM keys: title, slug, locale, status, body.
 * Remaining keys land in entry frontmatter; body becomes structured text.
 * When `opts.addMissingFields` is true, unknown scalar keys are added to the
 * collection schema before the entry is created.
 */
export function importMarkdownToEntry(
  projectPath: string,
  collectionId: string,
  markdown: string,
  opts?: {
    addMissingFields?: boolean;
    selectedFieldKeys?: string[];
    previewHash: string;
  },
): AriaEntryRecord {
  const parsed = parseMarkdownEntry(markdown);
  const preview = previewImportMarkdown(projectPath, collectionId, markdown);
  if (!opts?.previewHash || opts.previewHash !== preview.previewHash) {
    throw new Error("MARKDOWN_PREVIEW_MISMATCH: Preview this Markdown again before importing");
  }
  const blockingDiagnostic = preview.diagnostics.find((item) => item.severity === "error");
  if (blockingDiagnostic) {
    throw new Error(`MARKDOWN_UNSAFE: ${blockingDiagnostic.message}`);
  }

  if (opts?.addMissingFields) {
    const existingKeys = collectionFieldKeys(projectPath, collectionId);
    const selected = new Set(opts.selectedFieldKeys ?? []);
    const suggestions = buildSuggestedFields(parsed.frontmatter, existingKeys)
      .filter((field) => selected.has(field.key));
    addSuggestedFieldsToCollection(projectPath, collectionId, suggestions);
  }

  const frontmatter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.frontmatter)) {
    if (RESERVED_KEYS.has(key)) continue;
    frontmatter[key] = value;
  }

  const title =
    parsed.title ??
    (typeof parsed.frontmatter.title === "string"
      ? parsed.frontmatter.title
      : undefined);
  const slug = parsed.slug;
  const locale =
    typeof parsed.frontmatter.locale === "string" &&
    parsed.frontmatter.locale.trim()
      ? parsed.frontmatter.locale.trim()
      : undefined;
  const bodyText =
    typeof parsed.frontmatter.body === "string" && parsed.frontmatter.body.trim()
      ? parsed.frontmatter.body
      : parsed.body;

  const structured = markdownToStructuredText(bodyText);
  return createEntry(projectPath, {
    collectionId,
    ...(title ? { title } : {}),
    ...(slug ? { slug } : {}),
    ...(locale ? { locale } : {}),
    status: preview.normalizedEntryPlan.status,
    frontmatter,
    body: structured.body,
  });
}
