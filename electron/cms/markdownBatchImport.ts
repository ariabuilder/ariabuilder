import type { FieldType } from "../../shared/cms";
import { findEntryBySlug } from "./store";
import {
  slugify,
  updateEntry,
} from "./services";
import {
  importMarkdownToEntry,
  parseMarkdownEntry,
  previewImportMarkdown,
  suggestFieldTypeFromValue,
  type SuggestedMarkdownField,
} from "./markdownImport";
import { readCollections, writeCollections } from "../collections";
import { regenerateContentConfig } from "./contentSync";

export type MarkdownBatchSourceFile = {
  path: string;
  content: string;
};

export type MarkdownBatchMode = "create" | "update";

export type MarkdownBatchSuggestedField = SuggestedMarkdownField & {
  allowedTypes: FieldType[];
  sourcePaths: string[];
  sample?: unknown;
  options?: string[];
};

export type MarkdownBatchItemAction = "create" | "update" | "skip" | "fail";

export type MarkdownBatchItem = {
  sourcePath: string;
  title: string | null;
  slug: string | null;
  locale: string | null;
  action: MarkdownBatchItemAction;
  diagnostics: Array<{
    code: string;
    severity: "warning" | "error";
    message: string;
    remediation?: string;
  }>;
};

export type MarkdownBatchPreview = {
  canApply: boolean;
  applied?: boolean;
  addedFieldKeys?: string[];
  items: MarkdownBatchItem[];
  fieldSuggestions: MarkdownBatchSuggestedField[];
  summary: {
    creates: number;
    updates: number;
    skips: number;
    errors: number;
    warnings: number;
  };
};

const ALLOWED_SUGGESTED_TYPES: FieldType[] = [
  "string",
  "text",
  "slug",
  "number",
  "integer",
  "boolean",
  "select",
  "multiSelect",
  "date",
  "datetime",
];

const RESERVED_KEYS = new Set(["title", "slug", "locale", "status", "body"]);
const MAX_FILES = 250;
const MAX_FILE_BYTES = 1_000_000;

function assertSafePath(path: string): string {
  const value = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !value ||
    value.startsWith("/") ||
    value.split("/").some((part) => part === ".." || part.length === 0)
  ) {
    throw new Error(`Invalid markdown import path: ${path}`);
  }
  return value;
}

function collectionFieldKeys(
  projectPath: string,
  collectionId: string,
): Set<string> {
  const state = readCollections(projectPath);
  const collection = state.collections.find((item) => item.id === collectionId);
  return new Set((collection?.schema?.fields ?? []).map((field) => field.key));
}

function mergeFieldSuggestions(
  files: MarkdownBatchSourceFile[],
  existingKeys: Set<string>,
): MarkdownBatchSuggestedField[] {
  const byKey = new Map<string, MarkdownBatchSuggestedField>();
  for (const file of files) {
    let parsed;
    try {
      parsed = parseMarkdownEntry(file.content);
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parsed.frontmatter)) {
      if (RESERVED_KEYS.has(key) || existingKeys.has(key)) continue;
      if (value == null || typeof value === "object") continue;
      const inferred = suggestFieldTypeFromValue(value);
      const type = inferred ?? "string";
      const existing = byKey.get(key);
      if (existing) {
        existing.sourcePaths.push(file.path);
        continue;
      }
      byKey.set(key, {
        key,
        label: key
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (ch) => ch.toUpperCase()),
        type,
        allowedTypes: ALLOWED_SUGGESTED_TYPES,
        sourcePaths: [file.path],
        sample: value,
      });
    }
  }
  return [...byKey.values()].slice(0, 64);
}

function summaryFromItems(items: MarkdownBatchItem[]): MarkdownBatchPreview["summary"] {
  let creates = 0;
  let updates = 0;
  let skips = 0;
  let errors = 0;
  let warnings = 0;
  for (const item of items) {
    if (item.action === "create") creates += 1;
    else if (item.action === "update") updates += 1;
    else if (item.action === "skip") skips += 1;
    else if (item.action === "fail") errors += 1;
    warnings += item.diagnostics.filter((d) => d.severity === "warning").length;
    errors += item.diagnostics.filter((d) => d.severity === "error").length;
  }
  return { creates, updates, skips, errors, warnings };
}

export function previewMarkdownImportBatch(
  projectPath: string,
  input: {
    collectionId: string;
    files: MarkdownBatchSourceFile[];
    mode: MarkdownBatchMode;
    selectedFieldKeys?: string[];
  },
): MarkdownBatchPreview {
  if (!input.collectionId.trim()) {
    throw new Error("Collection id is required");
  }
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new Error("At least one Markdown file is required");
  }
  if (input.files.length > MAX_FILES) {
    throw new Error(`Markdown import supports at most ${MAX_FILES} files`);
  }

  const existingKeys = collectionFieldKeys(projectPath, input.collectionId);
  const items: MarkdownBatchItem[] = [];

  for (const file of input.files) {
    const sourcePath = assertSafePath(file.path);
    if (Buffer.byteLength(file.content, "utf8") > MAX_FILE_BYTES) {
      items.push({
        sourcePath,
        title: null,
        slug: null,
        locale: null,
        action: "fail",
        diagnostics: [
          {
            code: "file-too-large",
            severity: "error",
            message: `Markdown files must be ${MAX_FILE_BYTES} bytes or smaller.`,
          },
        ],
      });
      continue;
    }

    try {
      const parsed = parseMarkdownEntry(file.content);
      const preview = previewImportMarkdown(
        projectPath,
        input.collectionId,
        file.content,
      );
      const title =
        parsed.title ??
        (typeof parsed.frontmatter.title === "string"
          ? parsed.frontmatter.title
          : null);
      const slug =
        parsed.slug ??
        (title ? slugify(title) : slugify(sourcePath.split("/").at(-1) ?? "entry"));
      const locale =
        typeof parsed.frontmatter.locale === "string" &&
        parsed.frontmatter.locale.trim()
          ? parsed.frontmatter.locale.trim()
          : "en";

      const existing = findEntryBySlug(
        projectPath,
        input.collectionId,
        slug,
        locale,
      );

      let action: MarkdownBatchItemAction = "create";
      if (existing) {
        action = input.mode === "update" ? "update" : "skip";
      }

      const blocking = preview.diagnostics.filter((d) => d.severity === "error");
      if (blocking.length > 0) {
        action = "fail";
      }

      items.push({
        sourcePath,
        title,
        slug,
        locale,
        action,
        diagnostics: preview.diagnostics,
      });
    } catch (error) {
      items.push({
        sourcePath,
        title: null,
        slug: null,
        locale: null,
        action: "fail",
        diagnostics: [
          {
            code: "parse-failed",
            severity: "error",
            message:
              error instanceof Error ? error.message : "Failed to parse Markdown",
          },
        ],
      });
    }
  }

  const fieldSuggestions = mergeFieldSuggestions(input.files, existingKeys);
  const summary = summaryFromItems(items);
  const canApply =
    summary.errors === 0 &&
    (summary.creates > 0 || summary.updates > 0);

  return {
    canApply,
    items,
    fieldSuggestions,
    summary,
  };
}

function addFieldsToCollection(
  projectPath: string,
  collectionId: string,
  addFields: Array<{ key: string; type: string }>,
): string[] {
  if (addFields.length === 0) return [];
  const state = readCollections(projectPath);
  const index = state.collections.findIndex((item) => item.id === collectionId);
  if (index < 0) throw new Error("Collection not found");
  const collection = state.collections[index]!;
  const existing = new Set(
    (collection.schema?.fields ?? []).map((field) => field.key),
  );
  const added: string[] = [];
  const nextFields = [...(collection.schema?.fields ?? [])];
  for (const field of addFields) {
    const key = field.key.trim();
    if (!key || existing.has(key) || RESERVED_KEYS.has(key)) continue;
    const type = (ALLOWED_SUGGESTED_TYPES.includes(field.type as FieldType)
      ? field.type
      : "string") as FieldType;
    nextFields.push({
      key,
      label: key
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (ch) => ch.toUpperCase()),
      type,
    });
    existing.add(key);
    added.push(key);
  }
  if (added.length === 0) return [];
  state.collections[index] = {
    ...collection,
    schema: {
      ...(collection.schema ?? { fields: [], version: 1 }),
      fields: nextFields,
      version: Math.max(1, collection.schema?.version ?? 1),
    },
  };
  writeCollections(projectPath, state);
  regenerateContentConfig(projectPath);
  return added;
}

export function importMarkdownImportBatch(
  projectPath: string,
  input: {
    collectionId: string;
    files: MarkdownBatchSourceFile[];
    mode: MarkdownBatchMode;
    selectedFieldKeys?: string[];
    addFields?: Array<{ key: string; type: string }>;
  },
): MarkdownBatchPreview {
  const preview = previewMarkdownImportBatch(projectPath, input);
  if (!preview.canApply) {
    return preview;
  }

  const selectedKeys = new Set(input.selectedFieldKeys ?? []);
  const addFields = (input.addFields ?? []).filter((field) =>
    selectedKeys.size === 0 ? true : selectedKeys.has(field.key),
  );
  const addedFieldKeys = addFieldsToCollection(
    projectPath,
    input.collectionId,
    addFields.length > 0
      ? addFields
      : preview.fieldSuggestions
          .filter((field) => selectedKeys.has(field.key))
          .map((field) => ({ key: field.key, type: field.type })),
  );

  for (const item of preview.items) {
    if (item.action !== "create" && item.action !== "update") continue;
    const file = input.files.find((candidate) => candidate.path === item.sourcePath);
    if (!file) continue;

    if (item.action === "create") {
      const single = previewImportMarkdown(
        projectPath,
        input.collectionId,
        file.content,
      );
      importMarkdownToEntry(projectPath, input.collectionId, file.content, {
        addMissingFields: false,
        previewHash: single.previewHash,
      });
      continue;
    }

    const existing = findEntryBySlug(
      projectPath,
      input.collectionId,
      item.slug ?? "",
      item.locale ?? "en",
    );
    if (!existing) continue;

    const parsed = parseMarkdownEntry(file.content);
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
    const bodyText =
      typeof parsed.frontmatter.body === "string" &&
      parsed.frontmatter.body.trim()
        ? parsed.frontmatter.body
        : parsed.body;
    const single = previewImportMarkdown(
      projectPath,
      input.collectionId,
      file.content,
    );

    updateEntry(projectPath, {
      collectionId: input.collectionId,
      id: existing.entry.id,
      version: existing.entry.version,
      patch: {
        ...(title ? { title } : {}),
        ...(item.slug ? { slug: item.slug } : {}),
        frontmatter,
        body: single.normalizedEntryPlan.body,
        locale: item.locale ?? "en",
        status: "draft",
      },
    });
    void bodyText;
  }

  return {
    ...preview,
    applied: true,
    addedFieldKeys,
    canApply: false,
  };
}
