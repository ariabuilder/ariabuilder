import type {
  AriaEntryRecord,
  AriaEntryRelation,
  AriaEntryRevision,
  EntryListResult,
  EntrySort,
  EntryStatus,
} from "../../shared/cms";

function api() {
  if (!window.aria) {
    throw new Error(
      "Aria desktop bridge is unavailable. Restart the app with npm run dev.",
    );
  }
  if (!window.aria.cms) {
    throw new Error(
      "CMS API missing from preload. Stop the app and run npm run dev again.",
    );
  }
  return window.aria.cms;
}

/**
 * Electron IPC uses structured clone. Vue reactive Proxies (and some TipTap
 * / editor values) are not cloneable — strip to plain JSON before invoke.
 */
function toIpcPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function listCmsEntries(
  projectPath: string,
  params: {
    collectionId: string;
    status?: EntryStatus | EntryStatus[];
    query?: string;
    page?: number;
    limit?: number;
    sort?: EntrySort[];
    locale?: string;
  },
): Promise<EntryListResult> {
  return api().listEntries(projectPath, toIpcPayload(params));
}

export function getCmsEntry(
  projectPath: string,
  collectionId: string,
  entryIdOrSlug: string,
): Promise<AriaEntryRecord | null> {
  return api().getEntry(projectPath, collectionId, entryIdOrSlug);
}

export function createCmsEntry(
  projectPath: string,
  input: {
    collectionId: string;
    title?: string;
    slug?: string;
    locale?: string;
    frontmatter?: Record<string, unknown>;
    body?: unknown;
    status?: EntryStatus;
  },
): Promise<AriaEntryRecord> {
  return api().createEntry(projectPath, toIpcPayload(input));
}

export function updateCmsEntry(
  projectPath: string,
  input: {
    collectionId: string;
    id: string;
    version: string;
    patch: {
      title?: string;
      slug?: string;
      frontmatter?: Record<string, unknown>;
      body?: unknown;
      locale?: string;
      status?: EntryStatus;
      relations?: AriaEntryRelation[];
      upsertLocale?: {
        locale: string;
        title?: string;
        slug?: string;
        frontmatter?: Record<string, unknown>;
        body?: unknown;
        isSource?: boolean;
        status?: EntryStatus;
        publishedAt?: string | null;
      };
      locales?: AriaEntryRecord["locales"];
    };
  },
): Promise<AriaEntryRecord> {
  return api().updateEntry(projectPath, toIpcPayload(input));
}

export function deleteCmsEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
  version: string,
): Promise<{ ok: true }> {
  return api().deleteEntry(projectPath, collectionId, entryId, version);
}

export function deleteCmsCollectionEntries(
  projectPath: string,
  collectionId: string,
): Promise<{ ok: true; deleted: number }> {
  return api().deleteCollectionEntries(projectPath, collectionId);
}

export function deleteCmsCollections(
  projectPath: string,
  collectionIds: string[],
  expectedRevision: string,
  options?: { deleteEntries?: boolean },
): Promise<{ deleted: string[] }> {
  return api().deleteCollections(
    projectPath,
    collectionIds,
    expectedRevision,
    options,
  )
}

export function duplicateCmsEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
  version: string,
): Promise<AriaEntryRecord> {
  return api().duplicateEntry(projectPath, collectionId, entryId, version);
}

export function publishCmsEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
  opts: { version: string },
): Promise<AriaEntryRecord> {
  return api().publishEntry(
    projectPath,
    collectionId,
    entryId,
    toIpcPayload(opts),
  );
}

export function unpublishCmsEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
  opts: { version: string },
): Promise<AriaEntryRecord> {
  return api().unpublishEntry(
    projectPath,
    collectionId,
    entryId,
    toIpcPayload(opts),
  );
}

export function archiveCmsEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
  opts: { version: string },
): Promise<AriaEntryRecord> {
  return api().archiveEntry(
    projectPath,
    collectionId,
    entryId,
    toIpcPayload(opts),
  );
}

export function listCmsRevisions(
  projectPath: string,
  entryId: string,
): Promise<AriaEntryRevision[]> {
  return api().listRevisions(projectPath, entryId);
}

export function restoreCmsRevision(
  projectPath: string,
  entryId: string,
  revisionId: string,
  version: string,
): Promise<AriaEntryRecord> {
  return api().restoreRevision(projectPath, entryId, revisionId, version);
}

export function checkCmsSlug(
  projectPath: string,
  collectionId: string,
  slug: string,
  locale?: string,
  excludeEntryId?: string,
): Promise<boolean> {
  return api().checkSlug(
    projectPath,
    collectionId,
    slug,
    locale,
    excludeEntryId,
  );
}

export function seedBlogCms(
  projectPath: string,
): Promise<{ collections: number; entries: number }> {
  return api().seedBlogCms(projectPath);
}

export function importMarkdownToCmsEntry(
  projectPath: string,
  collectionId: string,
  markdown: string,
  opts: {
    addMissingFields?: boolean;
    selectedFieldKeys?: string[];
    previewHash: string;
  },
): Promise<AriaEntryRecord> {
  return api().importMarkdown(
    projectPath,
    collectionId,
    markdown,
    toIpcPayload(opts),
  );
}

export type CmsMarkdownImportPreview = {
  previewHash: string;
  title?: string;
  slug?: string;
  frontmatterKeys: string[];
  bodyPreview: string;
  reservedMapped: string[];
  unknownKeys: string[];
  suggestedNewFields: Array<{ key: string; label: string; type: string }>;
  mappedFieldKeys: string[];
  unsupportedKeys: string[];
  diagnostics: Array<{
    code: string;
    severity: "warning" | "error";
    message: string;
    remediation?: string;
  }>;
  normalizedEntryPlan: {
    title?: string;
    slug?: string;
    locale?: string;
    status: EntryStatus;
    frontmatter: Record<string, unknown>;
    body: unknown;
  };
  proposedSchemaChanges: Array<{ key: string; label: string; type: string }>;
  warnings: CmsMarkdownImportPreview["diagnostics"];
  blockingDiagnostics: CmsMarkdownImportPreview["diagnostics"];
};

export function previewCmsMarkdownImport(
  projectPath: string,
  collectionId: string,
  markdown: string,
): Promise<CmsMarkdownImportPreview> {
  return api().previewMarkdownImport(projectPath, collectionId, markdown);
}

/* -------------------------------------------------------------------------- */
/* WordPress import batch helpers                                              */
/* -------------------------------------------------------------------------- */

export type WordpressImportScope = {
  posts: boolean;
  pages: boolean;
  customPostTypes: boolean;
  attachments: boolean;
  authors: boolean;
  terms: boolean;
  menus: boolean;
  customFields: boolean;
  seoFields: boolean;
  comments?: boolean;
};

export type WordpressImportBatch = {
  id: string;
  sourceType: "wxr";
  status: string;
  currentMessage?: string | null;
  progressPercent?: number;
  counts?: Record<string, number>;
  summary?: {
    imported?: number;
    skipped?: number;
    failed?: number;
    warnings?: string[];
    nextSteps?: string[];
  };
};

export type WordpressImportEvent = {
  id: string;
  phase: string;
  level: "info" | "warn" | "error";
  message: string;
  completedCount?: number | null;
  totalCount?: number | null;
  createdAt: string;
};

export type WordpressImportReport = {
  items?: Array<{
    id: string;
    sourceKind: string;
    sourceLabel?: string | null;
    targetType?: string | null;
    action: "create" | "update" | "skip" | "fail";
    status: "planned" | "imported" | "skipped" | "failed";
    skipReason?: string | null;
  }>;
  media?: Array<{
    id: string;
    sourceAttachmentId?: string | null;
    sourceUrl: string;
    targetMediaPath?: string | null;
    status: "planned" | "downloaded" | "referenced" | "skipped" | "failed";
    errorMessage?: string | null;
  }>;
};

export function uploadWordpressImport(
  projectPath: string,
  input: { filename: string; bytes: ArrayBuffer },
): Promise<{ batch: WordpressImportBatch }> {
  return api().uploadWordpressImport(projectPath, input);
}

export function analyzeWordpressImport(
  projectPath: string,
  input: { batchId: string },
): Promise<WordpressImportBatch> {
  return api().analyzeWordpressImport(projectPath, toIpcPayload(input));
}

export function applyWordpressImport(
  projectPath: string,
  input: { batchId: string; scope: WordpressImportScope },
): Promise<WordpressImportBatch> {
  return api().applyWordpressImport(projectPath, toIpcPayload(input));
}

export function cancelWordpressImport(
  projectPath: string,
  input: { batchId: string },
): Promise<WordpressImportBatch> {
  return api().cancelWordpressImport(projectPath, toIpcPayload(input));
}

export function getWordpressImportBatch(
  projectPath: string,
  input: { batchId: string },
): Promise<WordpressImportBatch> {
  return api().getWordpressImportBatch(projectPath, toIpcPayload(input));
}

export function getWordpressImportEvents(
  projectPath: string,
  input: { batchId: string; limit?: number },
): Promise<WordpressImportEvent[]> {
  return api().getWordpressImportEvents(projectPath, toIpcPayload(input));
}

export function getWordpressImportReport(
  projectPath: string,
  input: { batchId: string },
): Promise<WordpressImportReport> {
  return api().getWordpressImportReport(projectPath, toIpcPayload(input));
}

export function listWordpressImportBatches(
  projectPath: string,
  input?: { limit?: number },
): Promise<WordpressImportBatch[]> {
  return api().listWordpressImportBatches(
    projectPath,
    toIpcPayload(input ?? {}),
  );
}

export function deleteWordpressImportBatch(
  projectPath: string,
  input: { batchId: string },
): Promise<{ ok: true }> {
  return api().deleteWordpressImportBatch(projectPath, toIpcPayload(input));
}

/* -------------------------------------------------------------------------- */
/* Markdown batch import helpers                                               */
/* -------------------------------------------------------------------------- */

export type MarkdownImportSourceFile = {
  path: string;
  content: string;
};

export type MarkdownImportFieldType =
  | "string"
  | "text"
  | "slug"
  | "number"
  | "integer"
  | "boolean"
  | "select"
  | "multiSelect"
  | string;

export type MarkdownImportSuggestedField = {
  key: string;
  label: string;
  type: MarkdownImportFieldType;
  allowedTypes: MarkdownImportFieldType[];
  sourcePaths: string[];
  sample?: unknown;
  options?: string[];
};

export type MarkdownImportPreview = {
  canApply: boolean;
  applied?: boolean;
  addedFieldKeys?: string[];
  fieldSuggestions: MarkdownImportSuggestedField[];
  summary: {
    creates: number;
    updates: number;
    skips: number;
    errors: number;
    warnings: number;
  };
};

export function previewMarkdownImportBatch(
  projectPath: string,
  input: {
    collectionId: string;
    files: MarkdownImportSourceFile[];
    mode: "create" | "update";
    selectedFieldKeys?: string[];
  },
): Promise<MarkdownImportPreview> {
  return api().previewMarkdownImportBatch(projectPath, toIpcPayload(input));
}

export function importMarkdownImportBatch(
  projectPath: string,
  input: {
    collectionId: string;
    files: MarkdownImportSourceFile[];
    mode: "create" | "update";
    selectedFieldKeys?: string[];
    addFields?: Array<{ key: string; type: MarkdownImportFieldType }>;
  },
): Promise<MarkdownImportPreview> {
  return api().importMarkdownImportBatch(projectPath, toIpcPayload(input));
}
