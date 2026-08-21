import type {
  DesignFontsourceRuntimeStatus,
  DesignIconRuntimeStatus,
  DesignIconResolveResult,
  DesignIconSearchRequest,
  DesignIconSearchResult,
  DesignPatch,
  DesignClassRenameResult,
  DesignSnapshot,
  DesignTokenMutationInput,
  DesignTokenMutationPreview,
  DesignTokenMutationResult,
  DesignTokenSourceSelectionInput,
  StylesheetInfo,
  StylesheetReadResult,
  StylesheetWriteResult,
} from "../../shared/design";
import type {
  CreateAstroOpts,
  DialogOutcome,
  RecentProject,
} from "@/lib/project";
import type { ProjectChange, ProjectRuntimeSession } from "@/lib/sessions";
import type { GitDiffResult, GitStatus } from "@/lib/git";
import type { SiteSettings } from "@/workspace/settings/types";
import type { ScanResult } from "@/workspace/types";
import type {
  DiscoverySettings,
  DiscoveryReport,
  DiscoveryArtifacts,
  DiscoveryGeneratedBaseline,
} from "../../shared/crawl";
import type {
  ImportRedirectsCsvResponse,
  RedirectRule,
  RedirectTarget,
} from "../../shared/redirects";
import type {
  AriaEntryRecord,
  AriaEntryRelation,
  AriaEntryRevision,
  EntryListResult,
  EntrySort,
  EntryStatus,
} from "../../shared/cms";
import type {
  HistoryListResult,
  HistoryMutationResult,
  HistoryRestoreDirection,
} from "../../shared/history";
import type { GlobalSearchResponse } from "../../shared/search";
import type { ContentLocalizationSettings } from "../../shared/localization";
import type {
  InjectionScanResult,
  UpdateSourceInjectionInput,
  UpdateSourceInjectionResult,
} from "../../shared/injections";
import type {
  ExternalEntryDetailResult,
  ExternalEntryListRequest,
  ExternalEntryListResult,
  LayoutPreviewManifest,
  ProjectCreationJob,
} from "../../shared/types";

export type CreatePageResult = {
  route: string;
  file: string;
};
export type CreatePageOptions = import("../../shared/types").CreatePageOptions;

export type CreateComponentResult = {
  id: string;
  name: string;
  file: string;
};

export type CreateLayoutResult = CreateComponentResult;

export type ComponentFolderMutationResult = {
  ok: true;
  from: string;
  to: string;
  movedFiles: Record<string, string>;
};

export type ComponentGroup = {
  id: string;
  name: string;
};

export type ComponentGroupingState = {
  groups: ComponentGroup[];
  assignments: Record<string, string>;
};

export type PageRole =
  | "standard"
  | "not-found"
  | "cms-collection"
  | "cms-entry";

export type PageSeoMeta = {
  title?: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
  nofollow?: boolean;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
};

export type PageMetaRecord = {
  role?: PageRole;
  title?: string;
  description?: string;
  seo?: PageSeoMeta;
};

export type PagesMetaState = {
  pages: Record<string, PageMetaRecord>;
};

export type {
  AriaCollectionKind,
  AriaCollectionSchemaDef,
  AriaCollectionDef,
  CollectionsState,
  CollectionMigrationAssessment,
  CollectionMigrationResult,
} from "../../shared/types";
import type {
  AriaCollectionDef,
  CollectionsState,
  CollectionMigrationAssessment,
  CollectionMigrationResult,
} from "../../shared/types";

export type MediaGroup = {
  id: string;
  name: string;
};

export type MediaGroupingState = {
  groups: MediaGroup[];
  assignments: Record<string, string>;
};

export type MediaAssetType =
  | "image"
  | "video"
  | "audio"
  | "font"
  | "document"
  | "other";

export type MediaAsset = {
  id: string;
  name: string;
  type: MediaAssetType;
  file: string;
  url: string;
  size: number;
  mimeType: string | null;
  mtimeMs: number;
  dimensions: { width: number; height: number } | null;
  cropCount: number;
  folder?: string;
};

export type MediaCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MediaFocalPoint = {
  x: number;
  y: number;
};

export type MediaAspectRatio = {
  width: number;
  height: number;
};

export type MediaTransformOutput = {
  width: number | null;
  height: number | null;
  format: "auto" | "jpeg" | "png" | "webp" | "avif";
  quality: number;
};

export type MediaAssetProfile = {
  assetPath: string;
  currentSourceVersion: number;
  altText: string | null;
  title: string | null;
  caption: string | null;
  credit: string | null;
  copyright: string | null;
  focalPoint: MediaFocalPoint | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaTransformVariant = {
  id: string;
  assetPath: string;
  name: string;
  sourceVersion: number;
  crop: MediaCropRect;
  focalPoint: MediaFocalPoint | null;
  aspectRatio: MediaAspectRatio | null;
  output: MediaTransformOutput;
  url: string;
  file: string;
  createdAt: string;
  updatedAt: string;
};

export type MediaTransformState = {
  profile: MediaAssetProfile | null;
  variants: MediaTransformVariant[];
};

export type SaveMediaVariantInput = {
  id: string;
  assetPath: string;
  name: string;
  sourceVersion?: number;
  crop: MediaCropRect;
  focalPoint?: MediaFocalPoint | null;
  aspectRatio?: MediaAspectRatio | null;
  output: MediaTransformOutput;
  bytes: Uint8Array;
};

export type SaveMediaProfileInput = {
  assetPath: string;
  currentSourceVersion?: number;
  altText?: string | null;
  title?: string | null;
  caption?: string | null;
  credit?: string | null;
  copyright?: string | null;
  focalPoint?: MediaFocalPoint | null;
};

export type AriaMediaApi = {
  list: (projectPath: string) => Promise<MediaAsset[]>;
  usages: (
    projectPath: string,
    assetId: string,
  ) => Promise<import("../../shared/types").MediaAssetUsage[]>;
  upload: (
    projectPath: string,
  ) => Promise<{ assets: MediaAsset[] } | { canceled: true }>;
  delete: (projectPath: string, assetId: string) => Promise<{ ok: true }>;
  rename: (
    projectPath: string,
    assetId: string,
    nextName: string,
  ) => Promise<MediaAsset>;
  duplicate: (projectPath: string, assetId: string) => Promise<MediaAsset>;
  reveal: (
    projectPath: string,
    assetId: string,
  ) => Promise<{ path: string }>;
  resolve: (
    projectPath: string,
    assetId: string,
  ) => Promise<{ path: string }>;
  preview: (
    projectPath: string,
    assetId: string,
  ) => Promise<{ dataUrl: string | null }>;
  getPlayableUrl: (
    projectPath: string,
    assetId: string,
  ) => Promise<{ url: string; mimeType: string | null }>;
  getGrouping: (projectPath: string) => Promise<MediaGroupingState>;
  updateGrouping: (
    projectPath: string,
    grouping: MediaGroupingState,
  ) => Promise<MediaGroupingState>;
  getTransformState: (
    projectPath: string,
    assetId: string,
  ) => Promise<MediaTransformState>;
  saveProfile: (
    projectPath: string,
    input: SaveMediaProfileInput,
  ) => Promise<MediaAssetProfile>;
  saveVariant: (
    projectPath: string,
    input: SaveMediaVariantInput,
  ) => Promise<{ profile: MediaAssetProfile; variant: MediaTransformVariant }>;
  saveVariantWithProfile: (
    projectPath: string,
    input: { variant: SaveMediaVariantInput; profile: SaveMediaProfileInput },
  ) => Promise<{ profile: MediaAssetProfile; variant: MediaTransformVariant }>;
  deleteVariant: (
    projectPath: string,
    assetId: string,
    variantId: string,
  ) => Promise<MediaTransformState>;
};

export type AriaCmsApi = {
  listEntries: (
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
  ) => Promise<EntryListResult>;
  getEntry: (
    projectPath: string,
    collectionId: string,
    entryIdOrSlug: string,
  ) => Promise<AriaEntryRecord | null>;
  createEntry: (
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
  ) => Promise<AriaEntryRecord>;
  updateEntry: (
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
  ) => Promise<AriaEntryRecord>;
  deleteEntry: (
    projectPath: string,
    collectionId: string,
    entryId: string,
    version: string,
  ) => Promise<{ ok: true }>;
  deleteCollectionEntries: (
    projectPath: string,
    collectionId: string,
  ) => Promise<{ ok: true; deleted: number }>;
  deleteCollections: (
    projectPath: string,
    collectionIds: string[],
    expectedRevision: string,
    options?: { deleteEntries?: boolean },
  ) => Promise<{ deleted: string[] }>;
  duplicateEntry: (
    projectPath: string,
    collectionId: string,
    entryId: string,
    version: string,
  ) => Promise<AriaEntryRecord>;
  publishEntry: (
    projectPath: string,
    collectionId: string,
    entryId: string,
    opts: { version: string },
  ) => Promise<AriaEntryRecord>;
  unpublishEntry: (
    projectPath: string,
    collectionId: string,
    entryId: string,
    opts: { version: string },
  ) => Promise<AriaEntryRecord>;
  archiveEntry: (
    projectPath: string,
    collectionId: string,
    entryId: string,
    opts: { version: string },
  ) => Promise<AriaEntryRecord>;
  listRevisions: (
    projectPath: string,
    entryId: string,
  ) => Promise<AriaEntryRevision[]>;
  restoreRevision: (
    projectPath: string,
    entryId: string,
    revisionId: string,
    version: string,
  ) => Promise<AriaEntryRecord>;
  checkSlug: (
    projectPath: string,
    collectionId: string,
    slug: string,
    locale?: string,
    excludeEntryId?: string,
  ) => Promise<boolean>;
  seedBlogCms: (
    projectPath: string,
  ) => Promise<{ collections: number; entries: number }>;
  importMarkdown: (
    projectPath: string,
    collectionId: string,
    markdown: string,
    opts: {
      addMissingFields?: boolean;
      selectedFieldKeys?: string[];
      previewHash: string;
    },
  ) => Promise<AriaEntryRecord>;
  previewMarkdownImport: (
    projectPath: string,
    collectionId: string,
    markdown: string,
  ) => Promise<{
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
    warnings: Array<{ code: string; severity: "warning" | "error"; message: string; remediation?: string }>;
    blockingDiagnostics: Array<{ code: string; severity: "warning" | "error"; message: string; remediation?: string }>;
  }>;
  uploadWordpressImport: (
    projectPath: string,
    input: { filename: string; bytes: ArrayBuffer },
  ) => Promise<{ batch: WordpressImportBatchDto }>;
  analyzeWordpressImport: (
    projectPath: string,
    input: { batchId: string },
  ) => Promise<WordpressImportBatchDto>;
  applyWordpressImport: (
    projectPath: string,
    input: {
      batchId: string;
      scope: WordpressImportScopeDto;
    },
  ) => Promise<WordpressImportBatchDto>;
  cancelWordpressImport: (
    projectPath: string,
    input: { batchId: string },
  ) => Promise<WordpressImportBatchDto>;
  getWordpressImportBatch: (
    projectPath: string,
    input: { batchId: string },
  ) => Promise<WordpressImportBatchDto>;
  getWordpressImportEvents: (
    projectPath: string,
    input: { batchId: string; limit?: number },
  ) => Promise<WordpressImportEventDto[]>;
  getWordpressImportReport: (
    projectPath: string,
    input: { batchId: string },
  ) => Promise<WordpressImportReportDto>;
  listWordpressImportBatches: (
    projectPath: string,
    input?: { limit?: number },
  ) => Promise<WordpressImportBatchDto[]>;
  deleteWordpressImportBatch: (
    projectPath: string,
    input: { batchId: string },
  ) => Promise<{ ok: true }>;
  previewMarkdownImportBatch: (
    projectPath: string,
    input: {
      collectionId: string;
      files: Array<{ path: string; content: string }>;
      mode: "create" | "update";
      selectedFieldKeys?: string[];
    },
  ) => Promise<MarkdownImportPreviewDto>;
  importMarkdownImportBatch: (
    projectPath: string,
    input: {
      collectionId: string;
      files: Array<{ path: string; content: string }>;
      mode: "create" | "update";
      selectedFieldKeys?: string[];
      addFields?: Array<{ key: string; type: string }>;
    },
  ) => Promise<MarkdownImportPreviewDto>;
};

export type WordpressImportScopeDto = {
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

export type WordpressImportBatchDto = {
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

export type WordpressImportEventDto = {
  id: string;
  phase: string;
  level: "info" | "warn" | "error";
  message: string;
  completedCount?: number | null;
  totalCount?: number | null;
  createdAt: string;
};

export type WordpressImportReportDto = {
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

export type MarkdownImportPreviewDto = {
  canApply: boolean;
  applied?: boolean;
  addedFieldKeys?: string[];
  fieldSuggestions: Array<{
    key: string;
    label: string;
    type: string;
    allowedTypes: string[];
    sourcePaths: string[];
    sample?: unknown;
    options?: string[];
  }>;
  summary: {
    creates: number;
    updates: number;
    skips: number;
    errors: number;
    warnings: number;
  };
};

export type AriaSiteExportApi = {
  create: (
    projectPath: string,
    input?: {
      ttlMinutes?: number;
      selection?: import("../../shared/export").SiteExportSelection;
    },
  ) => Promise<import("../../shared/export").SiteExportActionPayload>;
  list: (
    projectPath: string,
  ) => Promise<import("../../shared/export").SiteExportListPayload>;
  delete: (
    projectPath: string,
    input: { id: string },
  ) => Promise<{ ok: true }>;
  reveal: (
    projectPath: string,
    input: { id: string },
  ) => Promise<{ ok: true }>;
  saveAs: (
    projectPath: string,
    input: { id: string },
  ) => Promise<{ ok: true; path?: string }>;
  inventory: (
    projectPath: string,
  ) => Promise<import("../../shared/export").SiteExportInventory>;
};

export type AriaWorkspaceApi = {
  scan: (projectPath: string) => Promise<ScanResult>;
  inspectLayouts: (projectPath: string) => Promise<LayoutPreviewManifest[]>;
  inspectComponent: (
    projectPath: string,
    relativeFile: string,
  ) => Promise<import("../../shared/types").ComponentDetailManifest>;
  duplicateStudioDocument: (
    projectPath: string,
    input: {
      kind: import("../../shared/types").StudioDocumentKind;
      file: string;
      name: string;
    },
  ) => Promise<import("../../shared/types").ScanComponent>;
  deleteStudioDocument: (
    projectPath: string,
    input: {
      kind: import("../../shared/types").StudioDocumentKind;
      file: string;
    },
  ) => Promise<import("../../shared/types").StudioDocumentDeleteResult>;
  resolveStudioDocument: (
    projectPath: string,
    input: {
      kind: import("../../shared/types").StudioDocumentKind;
      file: string;
    },
  ) => Promise<{ path: string }>;
  revealStudioDocument: (
    projectPath: string,
    input: {
      kind: import("../../shared/types").StudioDocumentKind;
      file: string;
    },
  ) => Promise<{ path: string }>;
  createPage: (
    projectPath: string,
    name: string,
    options?: CreatePageOptions,
  ) => Promise<CreatePageResult>;
  deletePage: (
    projectPath: string,
    relativeFile: string,
    options?: { unassignCms?: boolean },
  ) => Promise<{ ok: true }>;
  revealPage: (
    projectPath: string,
    relativeFile: string,
  ) => Promise<{ path: string }>;
  resolvePage: (
    projectPath: string,
    relativeFile: string,
  ) => Promise<{ path: string }>;
  createComponent: (
    projectPath: string,
    name: string,
  ) => Promise<CreateComponentResult>;
  createLayout: (
    projectPath: string,
    name: string,
  ) => Promise<CreateLayoutResult>;
  deleteComponent: (
    projectPath: string,
    relativeFile: string,
  ) => Promise<{ ok: true }>;
  renameComponentFolder: (
    projectPath: string,
    folderRel: string,
    nextNameOrPath: string,
  ) => Promise<ComponentFolderMutationResult>;
  deleteComponentFolder: (
    projectPath: string,
    folderRel: string,
  ) => Promise<ComponentFolderMutationResult>;
  revealComponent: (
    projectPath: string,
    relativeFile: string,
  ) => Promise<{ path: string }>;
  resolveComponent: (
    projectPath: string,
    relativeFile: string,
  ) => Promise<{ path: string }>;
  getComponentGrouping: (
    projectPath: string,
  ) => Promise<ComponentGroupingState>;
  updateComponentGrouping: (
    projectPath: string,
    grouping: ComponentGroupingState,
  ) => Promise<ComponentGroupingState>;
  getPagesMeta: (projectPath: string) => Promise<PagesMetaState>;
  updatePagesMeta: (
    projectPath: string,
    meta: PagesMetaState,
  ) => Promise<PagesMetaState>;
  updatePageConfig: (
    projectPath: string,
    input: { pagesMeta: PagesMetaState; collections: CollectionsState },
  ) => Promise<{ meta: PagesMetaState; collections: CollectionsState }>;
  getCollections: (projectPath: string) => Promise<CollectionsState>;
  listExternalEntries: (projectPath: string, input: ExternalEntryListRequest) => Promise<ExternalEntryListResult>;
  getExternalEntry: (projectPath: string, collectionId: string, entryId: string) => Promise<ExternalEntryDetailResult | null>;
  refreshCollectionSource: (projectPath: string, collectionId: string) => Promise<{ refreshedAt: string; collectionId: string }>;
  assessCollectionMigration: (projectPath: string, collectionId: string) => Promise<CollectionMigrationAssessment>;
  migrateCollectionToAria: (
    projectPath: string,
    collectionId: string,
    previewHash: string,
  ) => Promise<CollectionMigrationResult>;
  cancelCollectionRefresh: (projectPath: string, collectionId: string) => Promise<boolean>;
  updateCollections: (
    projectPath: string,
    collections: CollectionsState,
  ) => Promise<CollectionsState>;
  getSiteSettings: (projectPath: string) => Promise<SiteSettings>;
  setSiteSettings: (
    projectPath: string,
    settings: SiteSettings,
  ) => Promise<SiteSettings>;
  updateContentLocalization: (
    projectPath: string,
    content: ContentLocalizationSettings,
  ) => Promise<SiteSettings>;
  updateSeoDefaults: (
    projectPath: string,
    patch: {
      seoTitle?: string;
      seoDescription?: string;
      ogImage?: string;
      seoKeywords?: string;
      twitterCard?: string;
    },
  ) => Promise<SiteSettings>;
  updateAnalytics: (
    projectPath: string,
    analytics: import("../../shared/types").AnalyticsSettings,
  ) => Promise<SiteSettings>;
  scanInjections: (projectPath: string) => Promise<InjectionScanResult>;
  updateSourceInjection: (
    projectPath: string,
    input: UpdateSourceInjectionInput,
  ) => Promise<UpdateSourceInjectionResult>;
  updateDiscovery: (
    projectPath: string,
    patch: Partial<DiscoverySettings>,
  ) => Promise<SiteSettings>;
  listRedirects: (
    projectPath: string,
    options?: { includeDisabled?: boolean },
  ) => Promise<{ redirects: RedirectRule[] }>;
  listRedirectTargets: (
    projectPath: string,
  ) => Promise<{ targets: RedirectTarget[] }>;
  createRedirect: (
    projectPath: string,
    input: {
      fromPath: string;
      toPath: string;
      statusCode?: 301 | 302;
      enabled?: boolean;
      note?: string;
    },
  ) => Promise<RedirectRule>;
  updateRedirect: (
    projectPath: string,
    input: {
      id: string;
      fromPath?: string;
      toPath?: string;
      statusCode?: 301 | 302;
      enabled?: boolean;
      note?: string | null;
    },
  ) => Promise<RedirectRule>;
  deleteRedirect: (projectPath: string, id: string) => Promise<{ ok: true }>;
  flattenRedirectChain: (
    projectPath: string,
    id: string,
  ) => Promise<RedirectRule>;
  importRedirectsCsv: (
    projectPath: string,
    input: { csv: string; replaceExisting?: boolean },
  ) => Promise<ImportRedirectsCsvResponse>;
  getDiscoveryReport: (projectPath: string) => Promise<DiscoveryReport>;
  getDiscoveryArtifacts: (projectPath: string) => Promise<DiscoveryArtifacts>;
  getDiscoveryBaseline: (
    projectPath: string,
    artifact: "robots" | "sitemap" | "llms",
  ) => Promise<DiscoveryGeneratedBaseline>;
  scanSeoSources: (projectPath: string) => Promise<SiteSettings>;
  confirmSeoTakeover: (projectPath: string) => Promise<SiteSettings>;
  seoTakeoverChecklist: (projectPath: string) => Promise<string[]>;
  pickFavicon: (
    projectPath: string,
  ) => Promise<{ favicon: string } | { canceled: true }>;
  faviconPreview: (
    projectPath: string,
    faviconPath: string,
  ) => Promise<{ dataUrl: string | null }>;
};

export type AriaClipboardApi = {
  writeText: (text: string) => Promise<{ ok: true }>;
  writeComposer: (
    formats: import("../../shared/composer").ComposerClipboardFormats,
  ) => Promise<{ ok: true }>;
  readComposer: () => Promise<
    import("../../shared/composer").ComposerClipboardFormats
  >;
};

export type AriaShellApi = {
  revealPath: (targetPath: string) => Promise<{ path: string }>;
};

export type AriaSessionsApi = {
  list: () => Promise<ProjectRuntimeSession[]>;
  open: (projectPath: string) => Promise<import("../../shared/types").ProjectOpenResult>;
  confirmTrustAndOpen: (
    challengeId: string,
  ) => Promise<import("../../shared/types").ProjectOpenResult>;
  revokeTrust: (
    projectPath: string,
  ) => Promise<import("../../shared/types").ProjectTrustRevocationResult>;
  close: (projectPath: string) => Promise<boolean>;
  start: (projectPath: string) => Promise<ProjectRuntimeSession>;
  stop: (projectPath: string) => Promise<ProjectRuntimeSession | null>;
  restart: (projectPath: string) => Promise<ProjectRuntimeSession>;
  replaceExternal: (projectPath: string) => Promise<ProjectRuntimeSession>;
  installDeps: (projectPath: string) => Promise<ProjectRuntimeSession>;
  onUpdate: (handler: (session: ProjectRuntimeSession) => void) => () => void;
};

export type AriaProjectApi = {
  onChange: (
    handler: (projectPath: string, change: ProjectChange) => void,
  ) => () => void;
};

export type AriaGitApi = {
  status: (projectPath: string) => Promise<GitStatus>;
  commit: (projectPath: string, message: string) => Promise<GitStatus>;
  push: (projectPath: string) => Promise<GitStatus>;
  listBranches: (projectPath: string) => Promise<string[]>;
  checkout: (projectPath: string, branch: string) => Promise<GitStatus>;
  createBranch: (projectPath: string, branch: string) => Promise<GitStatus>;
  init: (projectPath: string) => Promise<GitStatus>;
  diffFile: (projectPath: string, filePath: string) => Promise<GitDiffResult>;
};

export type TerminalSessionInfo = {
  id: string;
  cwd: string;
};

export type AriaTerminalApi = {
  create: (
    projectPath: string,
    cols?: number,
    rows?: number,
  ) => Promise<TerminalSessionInfo>;
  write: (id: string, data: string) => Promise<{ ok: true }>;
  resize: (
    id: string,
    cols: number,
    rows: number,
  ) => Promise<{ ok: true }>;
  dispose: (id: string) => Promise<{ ok: true }>;
  restart: (
    id: string,
    cols?: number,
    rows?: number,
  ) => Promise<TerminalSessionInfo>;
  onData: (
    handler: (payload: { id: string; data: string }) => void,
  ) => () => void;
  onExit: (
    handler: (payload: { id: string; exitCode: number }) => void,
  ) => () => void;
};

export type CaptureRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ThumbCaptureResult =
  | { ok: true }
  | { ok: false; error?: string };

export type ThumbGetResult = { dataUrl: string } | null;

export type WarmPagesResult = {
  ok: true;
};

export type PageThumbReadyPayload = {
  projectPath: string;
  route: string;
};

export type ComponentThumbReadyPayload = {
  projectPath: string;
  id: string;
  dataUrl?: string;
  mtimeMs?: number | null;
};

export type LayoutThumbReadyPayload = ComponentThumbReadyPayload;

export type AriaThumbsApi = {
  capture: (opts: {
    projectPath: string;
    route: string;
    rect: CaptureRect;
    mtimeMs?: number | null;
  }) => Promise<ThumbCaptureResult>;
  getPage: (opts: {
    projectPath: string;
    route: string;
    mtimeMs?: number | null;
  }) => Promise<ThumbGetResult>;
  getComponent: (opts: {
    projectPath: string;
    id: string;
    mtimeMs?: number | null;
  }) => Promise<ThumbGetResult>;
  getLayout: (opts: {
    projectPath: string;
    id: string;
    mtimeMs?: number | null;
  }) => Promise<ThumbGetResult>;
  getProject: (projectPath: string) => Promise<ThumbGetResult>;
  warmPages: (opts: {
    projectPath: string;
    baseUrl: string;
    pages: Array<{ route: string; mtimeMs?: number | null }>;
  }) => Promise<WarmPagesResult>;
  warmComponents: (opts: {
    projectPath: string;
    baseUrl: string;
    components: Array<{ id: string; mtimeMs?: number | null }>;
  }) => Promise<WarmPagesResult>;
  prioritizeComponents: (opts: {
    projectPath: string;
    ids: string[];
  }) => Promise<{ ok: true }>;
  warmLayouts: (opts: {
    projectPath: string;
    baseUrl: string;
    pages: Array<{ route: string; mtimeMs?: number | null }>;
    layouts: Array<{ id: string; mtimeMs?: number | null }>;
  }) => Promise<WarmPagesResult>;
  cancelWarm: () => Promise<{ ok: true }>;
  onPageReady: (
    handler: (payload: PageThumbReadyPayload) => void,
  ) => () => void;
  onComponentReady: (
    handler: (payload: ComponentThumbReadyPayload) => void,
  ) => () => void;
  onLayoutReady: (
    handler: (payload: LayoutThumbReadyPayload) => void,
  ) => () => void;
};

export type AriaWindowApi = {
  close: () => Promise<void>;
  isFullscreen: () => Promise<boolean>;
  setFullscreen: (fullscreen: boolean) => Promise<boolean>;
  onFullscreenChange: (handler: (fullscreen: boolean) => void) => () => void;
  /**
   * App shortcuts forwarded from Electron `before-input-event`
   * (works even when the Composer preview iframe has focus).
   */
  onShortcut: (handler: (id: string) => void) => () => void;
  /** Native application-menu commands forwarded by Electron. */
  onMenuCommand: (
    handler: (command: import("../../shared/appMenu").AppMenuCommand) => void,
  ) => () => void;
  /** Primary modifier state, including while the Composer iframe has focus. */
  onPrimaryModifierChange: (handler: (held: boolean) => void) => () => void;
};

export type AriaComposerApi = {
  /**
   * Parse a project `.astro` page into the editable Composer model
   * (or a bail result). Used for structure tree + selection sync.
   */
  parsePage: (
    projectPath: string,
    relativeFile: string,
    collectionProps?: Record<string, import("../../shared/composer").AstroCollectionBinding>,
  ) => Promise<import("../../shared/composer").ParseAstroResult & {
    relativeFile: string;
    mtimeMs: number | null;
  }>;
  analyzeSource: (
    projectPath: string,
    relativeFile: string,
    source: string,
    collectionProps?: Record<string, import("../../shared/composer").AstroCollectionBinding>,
  ) => Promise<import("../../shared/composer").ParseAstroResult>;
  setPreviewDraft: (
    projectPath: string,
    relativeFile: string,
    source: string,
    leaseId: string,
    revision?: number,
  ) => Promise<{ ok: true; revision: number }>;
  clearPreviewDraft: (
    projectPath: string,
    leaseId: string,
  ) => Promise<{ ok: true; cleared: boolean }>;
  completeCode: (
    projectPath: string,
    relativeFile: string,
    source: string,
    position: import("../../shared/composer").ComposerCodePosition,
  ) => Promise<import("../../shared/composer").ComposerCodeLanguageResult>;
  listTranslationCatalogs: (
    projectPath: string,
    refresh?: boolean,
  ) => Promise<import("../../shared/composer").ProjectTranslationCatalogResult>;
  editTranslationValue: (
    projectPath: string,
    input: import("../../shared/composer").ProjectTranslationEditInput,
  ) => Promise<import("../../shared/composer").ProjectTranslationEditResult>;
  assessTranslationAdoption: (
    projectPath: string,
    input: import("../../shared/composer").ProjectTranslationAdoptionInput,
  ) => Promise<import("../../shared/composer").ProjectTranslationAdoptionAssessment>;
  createTranslationDrafts: (
    projectPath: string,
    input: import("../../shared/composer").ProjectTranslationAdoptionInput & { expectedPreviewHash: string },
  ) => Promise<import("../../shared/composer").ProjectTranslationAdoptionResult>;
  applyTranslationCutover: (
    projectPath: string,
    input: import("../../shared/composer").ProjectTranslationCutoverInput,
  ) => Promise<import("../../shared/composer").ProjectTranslationCutoverResult>;
  inspectProjectData: (
    projectPath: string,
    input: import("../../shared/composer").ComposerDataInspectionInput,
  ) => Promise<import("../../shared/composer").ComposerDataInspectionResult>;
  assessProjectDataAdoption: (
    projectPath: string,
    input: import("../../shared/composer").ProjectDataAdoptionInput,
  ) => Promise<import("../../shared/composer").ProjectDataAdoptionAssessment>;
  editProjectData: (
    projectPath: string,
    input: import("../../shared/composer").ComposerProjectDataEditInput,
  ) => Promise<import("../../shared/composer").ComposerProjectDataEditResult>;
  createProjectDataDraft: (
    projectPath: string,
    input: import("../../shared/composer").ProjectDataAdoptionInput,
  ) => Promise<import("../../shared/composer").ProjectDataAdoptionResult>;
  applyProjectDataCutover: (
    projectPath: string,
    input: import("../../shared/composer").ProjectDataCutoverInput,
  ) => Promise<import("../../shared/composer").ProjectDataCutoverResult>;
  revealProjectData: (
    projectPath: string,
    relativeFile: string,
  ) => Promise<{ path: string }>;
  /**
   * Serialize the editable model via `serializeAstro` (clean source — never
   * marked) and write to disk. Marks a self-write so the project watcher
   * does not thrash a rescan/reload.
   */
  writePage: (
    projectPath: string,
    relativeFile: string,
    model: import("../../shared/composer").AstroDocumentModel,
    expectedMtimeMs?: number | null,
  ) => Promise<{
    ok: true;
    relativeFile: string;
    mtimeMs: number;
  }>;
  commitTransaction: (
    transaction: import("../../shared/composer").ComposerEditTransaction,
  ) => Promise<
    import("../../shared/composer").ComposerEditTransactionResult
  >;
  /**
   * Resolve a component import and extract prop schema for the inspector.
   */
  extractPropSchema: (
    projectPath: string,
    fromRelativeFile: string,
    importSpec: string,
  ) => Promise<{
    fields: import("../../shared/composer").PropField[];
    extendsTag: string | null;
    slots: string[];
    hasRest: boolean;
    relativeFile: string | null;
    resolved: boolean;
    mtimeMs: number | null;
    controlMetadataFound?: boolean;
    controlMetadataValid?: boolean;
    controlMetadataError?: string;
  }>;
  writeComponentControlMetadata: (
    projectPath: string,
    relativeFile: string,
    metadata: import("../../shared/conditions").ComponentControlMetadata,
    expectedMtimeMs?: number | null,
  ) => Promise<{ ok: true; relativeFile: string; mtimeMs: number }>;
  detectFrameworks: (
    projectPath: string,
  ) => Promise<
    import("../../shared/composer").ComposerFrameworkCapabilities
  >;
  prepareComponentPreview: (
    projectPath: string,
    componentFile: string,
    override?: Partial<
      Pick<
        import("../../shared/composer").ComposerComponentPreviewData,
        "props" | "slots"
      >
    > | null,
  ) => Promise<
    import("../../shared/composer").ComposerComponentPreviewSession
  >;
};

export type AriaDesignApi = {
  getSnapshot: (projectPath: string) => Promise<DesignSnapshot>;
  detectIconRuntime: (
    projectPath: string,
  ) => Promise<DesignIconRuntimeStatus>;
  detectFontsourceRuntime: (
    projectPath: string,
  ) => Promise<DesignFontsourceRuntimeStatus>;
  searchIcons: (
    projectPath: string,
    request: DesignIconSearchRequest,
  ) => Promise<DesignIconSearchResult>;
  resolveIcons: (
    projectPath: string,
    ids: readonly string[],
  ) => Promise<DesignIconResolveResult>;
  patch: (
    projectPath: string,
    patch: DesignPatch,
    expectedRevision?: string,
  ) => Promise<DesignSnapshot>;
  previewTokenMutation: (
    projectPath: string,
    input: DesignTokenMutationInput,
  ) => Promise<DesignTokenMutationPreview>;
  applyTokenMutation: (
    projectPath: string,
    input: DesignTokenMutationInput,
  ) => Promise<DesignTokenMutationResult>;
  selectTokenSource: (
    projectPath: string,
    input: DesignTokenSourceSelectionInput,
  ) => Promise<DesignTokenMutationResult>;
  ensureEntry: (
    projectPath: string,
  ) => Promise<{ relativePath: string; created: boolean }>;
  listStylesheets: (projectPath: string) => Promise<StylesheetInfo[]>;
  readStylesheet: (
    projectPath: string,
    relativePath: string,
  ) => Promise<StylesheetReadResult>;
  writeStylesheet: (
    projectPath: string,
    relativePath: string,
    content: string,
    expectedMtimeMs?: number | null,
  ) => Promise<StylesheetWriteResult>;
  createStylesheet: (
    projectPath: string,
    name: string,
  ) => Promise<StylesheetReadResult>;
  deleteStylesheet: (
    projectPath: string,
    relativePath: string,
  ) => Promise<{ ok: true }>;
  revealStylesheet: (
    projectPath: string,
    relativePath: string,
  ) => Promise<{ path: string }>;
  uploadFont: (
    projectPath: string,
  ) => Promise<{ canceled: true } | { family: string; file: string }>;
  revealFont: (
    projectPath: string,
    relativeFile: string,
  ) => Promise<{ path: string }>;
  deleteFont: (
    projectPath: string,
    relativeFile: string,
  ) => Promise<{ ok: true }>;
  scanClassUsage: (
    projectPath: string,
    classNames: string[],
  ) => Promise<Record<string, number>>;
  renameClass: (
    projectPath: string,
    from: string,
    to: string,
  ) => Promise<DesignClassRenameResult>;
};

export type AriaAgentApi = {
  getAvailability: (
    projectPath: string,
  ) => Promise<import("../../shared/agent").AgentAvailability>;
  getSettings: (
    projectPath: string,
  ) => Promise<import("../../shared/agent").AgentSettings>;
  patchSettings: (
    projectPath: string,
    patch: import("../../shared/agent").AgentSettingsPatch,
  ) => Promise<import("../../shared/agent").AgentSettings>;
  setProviderCredentials: (
    input: import("../../shared/agent").UpdateAgentProviderInput,
  ) => Promise<{
    configured: true;
    storage: import("../../shared/agent").CredentialStorageKind;
  }>;
  confirmInsecureProviderCredentials: (
    backend: import("../../shared/agent").CredentialBackendId,
    instanceId: string | undefined,
    confirmation: "PERSIST_INSECURELY",
  ) => Promise<{ configured: true; storage: "insecure" }>;
  clearProviderCredentials: (
    backend: import("../../shared/agent").CredentialBackendId,
    instanceId?: string,
  ) => Promise<{ removed: true }>;
  removeInferenceProvider: (
    projectPath: string,
    instanceId: string,
  ) => Promise<import("../../shared/agent").AgentSettings>;
  getCredentialStatuses: () => Promise<{
    backends: import("../../shared/agent").ConfiguredBackends;
    statuses: Record<
      import("../../shared/agent").CredentialBackendId,
      {
        configured: boolean;
        storage?: import("../../shared/agent").CredentialStorageKind;
        legacyInsecure?: boolean;
        baseUrl?: string;
        updatedAt?: string;
      }
    >;
    capability: import("../../shared/agent").CredentialStorageCapability;
  }>;
  listCatalogModels: (
    projectPath: string,
    instanceId: string,
  ) => Promise<{ models: import("../../shared/agent").CatalogModel[] }>;
  startChat: (
    projectPath: string,
    streamId: string,
    body: import("../../shared/agent").AgentChatInput,
  ) => Promise<{ streamId: string }>;
  cancelChat: (
    projectPath: string,
    streamId: string,
  ) => Promise<{ canceled: true }>;
  registerRendererHost: (
    projectPath: string,
    active: boolean,
    scope?: import("../../shared/agent").AgentRendererHostScope,
    registrationId?: string,
  ) => Promise<{ registered: boolean }>;
  resolveRendererTool: (
    response: import("../../shared/agent").AgentRendererToolResponse,
  ) => Promise<{ accepted: true }>;
  onRendererToolRequest: (
    handler: (
      request: import("../../shared/agent").AgentRendererToolRequest,
    ) => void,
  ) => () => void;
  onStream: (
    handler: (payload: {
      streamId: string;
      event: import("../../shared/agent").AgentStreamEvent;
    }) => void,
  ) => () => void;
};

export type AriaDesktopApi = {
  markReady: (token: string) => Promise<{ ok: true }>;
  openProjectDialog: () => Promise<DialogOutcome>;
  pickNewProjectDir: () => Promise<DialogOutcome>;
  createAstroProject: (opts: CreateAstroOpts) => Promise<void>;
  cancelAstroProject: (jobId?: string) => Promise<void>;
  listRecents: () => Promise<RecentProject[]>;
  addRecent: (projectPath: string) => Promise<void>;
  removeRecent: (projectPath: string) => Promise<void>;
  openProjectWindow: (projectPath: string) => Promise<{ ok: true }>;
  getVersion: () => Promise<string>;
  openUrl: (url: string) => Promise<void>;
  onCreateAstroLog: (handler: (chunk: string) => void) => () => void;
  onProjectCreationJob: (
    handler: (job: ProjectCreationJob) => void,
  ) => () => void;
  getAppearance: () => Promise<
    import("../../shared/appearance").AppAppearancePrefs
  >;
  setAppearance: (
    prefs: import("../../shared/appearance").AppAppearancePrefs,
  ) => Promise<import("../../shared/appearance").AppAppearancePrefs>;
  window: AriaWindowApi;
  workspace: AriaWorkspaceApi;
  composer: AriaComposerApi;
  design: AriaDesignApi;
  media: AriaMediaApi;
  cms: AriaCmsApi;
  siteExport: AriaSiteExportApi;
  clipboard: AriaClipboardApi;
  shell: AriaShellApi;
  sessions: AriaSessionsApi;
  project: AriaProjectApi;
  git: AriaGitApi;
  terminal: AriaTerminalApi;
  thumbs: AriaThumbsApi;
  agent: AriaAgentApi;
  history: AriaHistoryApi;
  search: AriaSearchApi;
};

export type AriaHistoryApi = {
  list: (projectPath: string) => Promise<HistoryListResult>;
  undo: (projectPath: string) => Promise<HistoryMutationResult>;
  redo: (projectPath: string) => Promise<HistoryMutationResult>;
  restore: (
    projectPath: string,
    recordId: string,
    direction: HistoryRestoreDirection,
  ) => Promise<HistoryMutationResult>;
};

export type AriaSearchApi = {
  project: (
    projectPath: string,
    input: { query: string; limit?: number },
  ) => Promise<GlobalSearchResponse>;
};

declare global {
  interface Window {
    aria?: AriaDesktopApi;
  }
}

export {};
