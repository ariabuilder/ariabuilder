import { contextBridge, ipcRenderer } from "electron";
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
} from "../shared/design";
import type { CreateAstroOpts, DialogOutcome, RecentProject } from "./project";
import type {
  CollectionMigrationAssessment,
  CollectionMigrationResult,
  ExternalEntryDetailResult,
  ExternalEntryListRequest,
  ExternalEntryListResult,
  LayoutPreviewManifest,
  ComponentDetailManifest,
  ScanComponent,
  StudioDocumentDeleteResult,
  StudioDocumentKind,
  ProjectCreationJob,
} from "../shared/types";
import type { ProjectRuntimeSession } from "./sessions";
import type { ProjectChange, GitDiffResult, GitStatus } from "../shared/types";
import type { SiteSettings } from "./siteSettings";
import type {
  CreateComponentResult,
  CreateLayoutResult,
  CreatePageOptions,
  CreatePageResult,
  ComponentFolderMutationResult,
  ScanResult,
} from "./workspace";
import type { ComponentGroupingState } from "../shared/types";
import type {
  CollectionsState,
  MediaAsset,
  MediaAssetUsage,
  MediaAssetProfile,
  MediaFocalPoint,
  MediaGroupingState,
  MediaTransformState,
  MediaTransformVariant,
  MediaCropRect,
  MediaAspectRatio,
  MediaTransformOutput,
  PagesMetaState,
} from "../shared/types";
import type {
  AriaEntryRecord,
  AriaEntryRelation,
  AriaEntryRevision,
  EntryListResult,
  EntrySort,
  EntryStatus,
} from "../shared/cms";
import type {
  HistoryListResult,
  HistoryMutationResult,
  HistoryRestoreDirection,
} from "../shared/history";
import type { GlobalSearchResponse } from "../shared/search";
import type { ContentLocalizationSettings } from "../shared/localization";
import type {
  UtilityActionProgress,
  UtilityActionResult,
  UtilityLibraryId,
  UtilityManagerInspection,
} from "../shared/utilities";

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
  usages: (projectPath: string, assetId: string) => Promise<MediaAssetUsage[]>;
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
  ) => Promise<{ batch: unknown }>;
  analyzeWordpressImport: (
    projectPath: string,
    input: { batchId: string },
  ) => Promise<unknown>;
  applyWordpressImport: (
    projectPath: string,
    input: { batchId: string; scope: Record<string, boolean> },
  ) => Promise<unknown>;
  cancelWordpressImport: (
    projectPath: string,
    input: { batchId: string },
  ) => Promise<unknown>;
  getWordpressImportBatch: (
    projectPath: string,
    input: { batchId: string },
  ) => Promise<unknown>;
  getWordpressImportEvents: (
    projectPath: string,
    input: { batchId: string; limit?: number },
  ) => Promise<unknown[]>;
  getWordpressImportReport: (
    projectPath: string,
    input: { batchId: string },
  ) => Promise<unknown>;
  listWordpressImportBatches: (
    projectPath: string,
    input?: { limit?: number },
  ) => Promise<unknown[]>;
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
  ) => Promise<unknown>;
  importMarkdownImportBatch: (
    projectPath: string,
    input: {
      collectionId: string;
      files: Array<{ path: string; content: string }>;
      mode: "create" | "update";
      selectedFieldKeys?: string[];
      addFields?: Array<{ key: string; type: string }>;
    },
  ) => Promise<unknown>;
};

export type AriaSiteExportApi = {
  create: (
    projectPath: string,
    input?: { ttlMinutes?: number; selection?: unknown },
  ) => Promise<unknown>;
  list: (projectPath: string) => Promise<unknown>;
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
  inventory: (projectPath: string) => Promise<unknown>;
};

export type AriaWorkspaceApi = {
  scan: (projectPath: string) => Promise<ScanResult>;
  inspectLayouts: (projectPath: string) => Promise<LayoutPreviewManifest[]>;
  inspectComponent: (
    projectPath: string,
    relativeFile: string,
  ) => Promise<ComponentDetailManifest>;
  duplicateStudioDocument: (
    projectPath: string,
    input: { kind: StudioDocumentKind; file: string; name: string },
  ) => Promise<ScanComponent>;
  deleteStudioDocument: (
    projectPath: string,
    input: { kind: StudioDocumentKind; file: string },
  ) => Promise<StudioDocumentDeleteResult>;
  resolveStudioDocument: (
    projectPath: string,
    input: { kind: StudioDocumentKind; file: string },
  ) => Promise<{ path: string }>;
  revealStudioDocument: (
    projectPath: string,
    input: { kind: StudioDocumentKind; file: string },
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
    analytics: import("../shared/types").AnalyticsSettings,
  ) => Promise<SiteSettings>;
  scanInjections: (
    projectPath: string,
  ) => Promise<import("../shared/injections").InjectionScanResult>;
  updateSourceInjection: (
    projectPath: string,
    input: import("../shared/injections").UpdateSourceInjectionInput,
  ) => Promise<import("../shared/injections").UpdateSourceInjectionResult>;
  updateDiscovery: (
    projectPath: string,
    patch: Partial<import("../shared/types").DiscoverySettings>,
  ) => Promise<SiteSettings>;
  listRedirects: (
    projectPath: string,
    options?: { includeDisabled?: boolean },
  ) => Promise<{ redirects: import("../shared/redirects").RedirectRule[] }>;
  listRedirectTargets: (
    projectPath: string,
  ) => Promise<{ targets: import("../shared/redirects").RedirectTarget[] }>;
  createRedirect: (
    projectPath: string,
    input: {
      fromPath: string;
      toPath: string;
      statusCode?: 301 | 302;
      enabled?: boolean;
      note?: string;
    },
  ) => Promise<import("../shared/redirects").RedirectRule>;
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
  ) => Promise<import("../shared/redirects").RedirectRule>;
  deleteRedirect: (
    projectPath: string,
    id: string,
  ) => Promise<{ ok: true }>;
  flattenRedirectChain: (
    projectPath: string,
    id: string,
  ) => Promise<import("../shared/redirects").RedirectRule>;
  importRedirectsCsv: (
    projectPath: string,
    input: { csv: string; replaceExisting?: boolean },
  ) => Promise<import("../shared/redirects").ImportRedirectsCsvResponse>;
  getDiscoveryReport: (projectPath: string) => Promise<unknown>;
  getDiscoveryArtifacts: (projectPath: string) => Promise<unknown>;
  getDiscoveryBaseline: (
    projectPath: string,
    artifact: "robots" | "sitemap" | "llms",
  ) => Promise<unknown>;
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
    formats: import("../shared/composer").ComposerClipboardFormats,
  ) => Promise<{ ok: true }>;
  readComposer: () => Promise<
    import("../shared/composer").ComposerClipboardFormats
  >;
};

export type AriaShellApi = {
  revealPath: (targetPath: string) => Promise<{ path: string }>;
};

export type AriaSessionsApi = {
  list: () => Promise<ProjectRuntimeSession[]>;
  open: (projectPath: string) => Promise<import("../shared/types").ProjectOpenResult>;
  confirmTrustAndOpen: (
    challengeId: string,
  ) => Promise<import("../shared/types").ProjectOpenResult>;
  revokeTrust: (
    projectPath: string,
  ) => Promise<import("../shared/types").ProjectTrustRevocationResult>;
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

export type AriaAgentApi = {
  getAvailability: (
    projectPath: string,
  ) => Promise<import("../shared/agent").AgentAvailability>;
  getSettings: (
    projectPath: string,
  ) => Promise<import("../shared/agent").AgentSettings>;
  patchSettings: (
    projectPath: string,
    patch: import("../shared/agent").AgentSettingsPatch,
  ) => Promise<import("../shared/agent").AgentSettings>;
  setProviderCredentials: (
    input: import("../shared/agent").UpdateAgentProviderInput,
  ) => Promise<{
    configured: true;
    storage: import("../shared/agent").CredentialStorageKind;
  }>;
  confirmInsecureProviderCredentials: (
    backend: import("../shared/agent").CredentialBackendId,
    instanceId: string | undefined,
    confirmation: "PERSIST_INSECURELY",
  ) => Promise<{ configured: true; storage: "insecure" }>;
  clearProviderCredentials: (
    backend: import("../shared/agent").CredentialBackendId,
    instanceId?: string,
  ) => Promise<{ removed: true }>;
  removeInferenceProvider: (
    projectPath: string,
    instanceId: string,
  ) => Promise<import("../shared/agent").AgentSettings>;
  getCredentialStatuses: () => Promise<{
    backends: import("../shared/agent").ConfiguredBackends;
    statuses: Record<
      import("../shared/agent").CredentialBackendId,
      {
        configured: boolean;
        storage?: import("../shared/agent").CredentialStorageKind;
        legacyInsecure?: boolean;
        baseUrl?: string;
        updatedAt?: string;
      }
    >;
    capability: import("../shared/agent").CredentialStorageCapability;
  }>;
  listCatalogModels: (
    projectPath: string,
    instanceId: string,
  ) => Promise<{ models: import("../shared/agent").CatalogModel[] }>;
  startChat: (
    projectPath: string,
    streamId: string,
    body: import("../shared/agent").AgentChatInput,
  ) => Promise<{ streamId: string }>;
  cancelChat: (
    projectPath: string,
    streamId: string,
  ) => Promise<{ canceled: true }>;
  registerRendererHost: (
    projectPath: string,
    active: boolean,
    scope?: import("../shared/agent").AgentRendererHostScope,
    registrationId?: string,
  ) => Promise<{ registered: boolean }>;
  resolveRendererTool: (
    response: import("../shared/agent").AgentRendererToolResponse,
  ) => Promise<{ accepted: true }>;
  onRendererToolRequest: (
    handler: (
      request: import("../shared/agent").AgentRendererToolRequest,
    ) => void,
  ) => () => void;
  onStream: (
    handler: (payload: {
      streamId: string;
      event: import("../shared/agent").AgentStreamEvent;
    }) => void,
  ) => () => void;
};

export type AriaWindowApi = {
  close: () => Promise<void>;
  isFullscreen: () => Promise<boolean>;
  setFullscreen: (fullscreen: boolean) => Promise<boolean>;
  onFullscreenChange: (handler: (fullscreen: boolean) => void) => () => void;
  onShortcut: (handler: (id: string) => void) => () => void;
  onMenuCommand: (
    handler: (command: import("../shared/appMenu").AppMenuCommand) => void,
  ) => () => void;
  onPrimaryModifierChange: (handler: (held: boolean) => void) => () => void;
};

export type AriaComposerApi = {
  parsePage: (
    projectPath: string,
    relativeFile: string,
    collectionProps?: Record<string, import("../shared/composer").AstroCollectionBinding>,
  ) => Promise<
    import("../shared/composer").ParseAstroResult & {
      relativeFile: string;
      mtimeMs: number | null;
    }
  >;
  analyzeSource: (
    projectPath: string,
    relativeFile: string,
    source: string,
    collectionProps?: Record<string, import("../shared/composer").AstroCollectionBinding>,
  ) => Promise<import("../shared/composer").ParseAstroResult>;
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
    position: import("../shared/composer").ComposerCodePosition,
  ) => Promise<import("../shared/composer").ComposerCodeLanguageResult>;
  listTranslationCatalogs: (
    projectPath: string,
    refresh?: boolean,
  ) => Promise<import("../shared/composer").ProjectTranslationCatalogResult>;
  editTranslationValue: (
    projectPath: string,
    input: import("../shared/composer").ProjectTranslationEditInput,
  ) => Promise<import("../shared/composer").ProjectTranslationEditResult>;
  assessTranslationAdoption: (
    projectPath: string,
    input: import("../shared/composer").ProjectTranslationAdoptionInput,
  ) => Promise<import("../shared/composer").ProjectTranslationAdoptionAssessment>;
  createTranslationDrafts: (
    projectPath: string,
    input: import("../shared/composer").ProjectTranslationAdoptionInput & { expectedPreviewHash: string },
  ) => Promise<import("../shared/composer").ProjectTranslationAdoptionResult>;
  applyTranslationCutover: (
    projectPath: string,
    input: import("../shared/composer").ProjectTranslationCutoverInput,
  ) => Promise<import("../shared/composer").ProjectTranslationCutoverResult>;
  inspectProjectData: (
    projectPath: string,
    input: import("../shared/composer").ComposerDataInspectionInput,
  ) => Promise<import("../shared/composer").ComposerDataInspectionResult>;
  assessProjectDataAdoption: (
    projectPath: string,
    input: import("../shared/composer").ProjectDataAdoptionInput,
  ) => Promise<import("../shared/composer").ProjectDataAdoptionAssessment>;
  editProjectData: (
    projectPath: string,
    input: import("../shared/composer").ComposerProjectDataEditInput,
  ) => Promise<import("../shared/composer").ComposerProjectDataEditResult>;
  createProjectDataDraft: (
    projectPath: string,
    input: import("../shared/composer").ProjectDataAdoptionInput,
  ) => Promise<import("../shared/composer").ProjectDataAdoptionResult>;
  applyProjectDataCutover: (
    projectPath: string,
    input: import("../shared/composer").ProjectDataCutoverInput,
  ) => Promise<import("../shared/composer").ProjectDataCutoverResult>;
  revealProjectData: (
    projectPath: string,
    relativeFile: string,
  ) => Promise<{ path: string }>;
  /** Serialize editable model to clean `.astro` and write (marks self-write). */
  writePage: (
    projectPath: string,
    relativeFile: string,
    model: import("../shared/composer").AstroDocumentModel,
    expectedMtimeMs?: number | null,
  ) => Promise<{
    ok: true;
    relativeFile: string;
    mtimeMs: number;
  }>;
  commitTransaction: (
    transaction: import("../shared/composer").ComposerEditTransaction,
  ) => Promise<import("../shared/composer").ComposerEditTransactionResult>;
  /**
   * Resolve a component import from a page/layout file and extract its
   * `interface Props` / Astro.props schema for the inspector.
   */
  extractPropSchema: (
    projectPath: string,
    fromRelativeFile: string,
    importSpec: string,
  ) => Promise<{
    fields: import("../shared/composer").PropField[];
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
    metadata: import("../shared/conditions").ComponentControlMetadata,
    expectedMtimeMs?: number | null,
  ) => Promise<{ ok: true; relativeFile: string; mtimeMs: number }>;
  detectFrameworks: (
    projectPath: string,
  ) => Promise<import("../shared/composer").ComposerFrameworkCapabilities>;
  prepareComponentPreview: (
    projectPath: string,
    componentFile: string,
    override?: Partial<
      Pick<
        import("../shared/composer").ComposerComponentPreviewData,
        "props" | "slots"
      >
    > | null,
  ) => Promise<import("../shared/composer").ComposerComponentPreviewSession>;
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
  ) => Promise<
    { canceled: true } | { family: string; file: string }
  >;
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

export type AriaUtilitiesApi = {
  inspect: (projectPath: string) => Promise<UtilityManagerInspection>;
  activate: (
    projectPath: string,
    library: UtilityLibraryId,
  ) => Promise<UtilityActionResult>;
  disable: (
    projectPath: string,
    library: UtilityLibraryId,
  ) => Promise<UtilityActionResult>;
  onProgress: (
    handler: (progress: UtilityActionProgress) => void,
  ) => () => void;
};

export type AriaApi = {
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
  getAppearance: () => Promise<import("../shared/appearance").AppAppearancePrefs>;
  setAppearance: (
    prefs: import("../shared/appearance").AppAppearancePrefs,
  ) => Promise<import("../shared/appearance").AppAppearancePrefs>;
  window: AriaWindowApi;
  workspace: AriaWorkspaceApi;
  composer: AriaComposerApi;
  design: AriaDesignApi;
  utilities: AriaUtilitiesApi;
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

const aria: AriaApi = {
  markReady: (token) => ipcRenderer.invoke("renderer:ready", token),
  openProjectDialog: () => ipcRenderer.invoke("open_project_dialog"),
  pickNewProjectDir: () => ipcRenderer.invoke("pick_new_project_dir"),
  createAstroProject: (opts) => ipcRenderer.invoke("create_astro_project", opts),
  cancelAstroProject: (jobId) =>
    ipcRenderer.invoke("cancel_create_astro_project", jobId),
  listRecents: () => ipcRenderer.invoke("list_recents"),
  addRecent: (projectPath) => ipcRenderer.invoke("add_recent", projectPath),
  removeRecent: (projectPath) =>
    ipcRenderer.invoke("remove_recent", projectPath),
  openProjectWindow: (projectPath) =>
    ipcRenderer.invoke("open_project_window", projectPath),
  getVersion: () => ipcRenderer.invoke("get_version"),
  openUrl: (url) => ipcRenderer.invoke("open_url", url),
  getAppearance: () => ipcRenderer.invoke("appearance:get"),
  setAppearance: (prefs) => ipcRenderer.invoke("appearance:set", prefs),
  onCreateAstroLog: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, chunk: string) => {
      handler(chunk);
    };
    ipcRenderer.on("create-astro-log", listener);
    return () => {
      ipcRenderer.removeListener("create-astro-log", listener);
    };
  },
  onProjectCreationJob: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      job: ProjectCreationJob,
    ) => handler(job);
    ipcRenderer.on("create-astro-job", listener);
    return () => ipcRenderer.removeListener("create-astro-job", listener);
  },
  window: {
    close: () => ipcRenderer.invoke("window:close"),
    isFullscreen: () => ipcRenderer.invoke("window:is_fullscreen"),
    setFullscreen: (fullscreen) => ipcRenderer.invoke("window:set_fullscreen", fullscreen),
    onFullscreenChange: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        fullscreen: boolean,
      ) => {
        handler(Boolean(fullscreen));
      };
      ipcRenderer.on("window:fullscreen", listener);
      return () => {
        ipcRenderer.removeListener("window:fullscreen", listener);
      };
    },
    onShortcut: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, id: string) => {
        if (typeof id === "string" && id) handler(id);
      };
      ipcRenderer.on("window:shortcut", listener);
      return () => {
        ipcRenderer.removeListener("window:shortcut", listener);
      };
    },
    onMenuCommand: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        command: import("../shared/appMenu").AppMenuCommand,
      ) => {
        if (!command || typeof command !== "object") return;
        if (
          command.type === "new-project" ||
          command.type === "open-project" ||
          command.type === "close-context"
        ) {
          handler(command);
          return;
        }
        if (
          command.type === "open-recent" &&
          typeof command.projectPath === "string" &&
          command.projectPath
        ) handler(command);
      };
      ipcRenderer.on("app:menu-command", listener);
      return () => {
        ipcRenderer.removeListener("app:menu-command", listener);
      };
    },
    onPrimaryModifierChange: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, held: boolean) => {
        handler(Boolean(held));
      };
      ipcRenderer.on("window:primary-modifier", listener);
      return () => {
        ipcRenderer.removeListener("window:primary-modifier", listener);
      };
    },
  },
  workspace: {
    scan: (projectPath) => ipcRenderer.invoke("workspace:scan", projectPath),
    inspectLayouts: (projectPath) =>
      ipcRenderer.invoke("workspace:inspect_layouts", projectPath),
    inspectComponent: (projectPath, relativeFile) =>
      ipcRenderer.invoke("workspace:inspect_component", projectPath, relativeFile),
    duplicateStudioDocument: (projectPath, input) =>
      ipcRenderer.invoke("workspace:duplicate_studio_document", projectPath, input),
    deleteStudioDocument: (projectPath, input) =>
      ipcRenderer.invoke("workspace:delete_studio_document", projectPath, input),
    resolveStudioDocument: (projectPath, input) =>
      ipcRenderer.invoke("workspace:resolve_studio_document", projectPath, input),
    revealStudioDocument: (projectPath, input) =>
      ipcRenderer.invoke("workspace:reveal_studio_document", projectPath, input),
    createPage: (projectPath, name, options) =>
      ipcRenderer.invoke("workspace:create_page", projectPath, name, options),
    deletePage: (projectPath, relativeFile, options) =>
      ipcRenderer.invoke(
        "workspace:delete_page",
        projectPath,
        relativeFile,
        options,
      ),
    revealPage: (projectPath, relativeFile) =>
      ipcRenderer.invoke("workspace:reveal_page", projectPath, relativeFile),
    resolvePage: (projectPath, relativeFile) =>
      ipcRenderer.invoke("workspace:resolve_page", projectPath, relativeFile),
    createComponent: (projectPath, name) =>
      ipcRenderer.invoke("workspace:create_component", projectPath, name),
    createLayout: (projectPath, name) =>
      ipcRenderer.invoke("workspace:create_layout", projectPath, name),
    deleteComponent: (projectPath, relativeFile) =>
      ipcRenderer.invoke(
        "workspace:delete_component",
        projectPath,
        relativeFile,
      ),
    renameComponentFolder: (projectPath, folderRel, nextNameOrPath) =>
      ipcRenderer.invoke(
        "workspace:rename_component_folder",
        projectPath,
        folderRel,
        nextNameOrPath,
      ),
    deleteComponentFolder: (projectPath, folderRel) =>
      ipcRenderer.invoke(
        "workspace:delete_component_folder",
        projectPath,
        folderRel,
      ),
    revealComponent: (projectPath, relativeFile) =>
      ipcRenderer.invoke(
        "workspace:reveal_component",
        projectPath,
        relativeFile,
      ),
    resolveComponent: (projectPath, relativeFile) =>
      ipcRenderer.invoke(
        "workspace:resolve_component",
        projectPath,
        relativeFile,
      ),
    getComponentGrouping: (projectPath) =>
      ipcRenderer.invoke("workspace:get_component_grouping", projectPath),
    updateComponentGrouping: (projectPath, grouping) =>
      ipcRenderer.invoke(
        "workspace:update_component_grouping",
        projectPath,
        grouping,
      ),
    getPagesMeta: (projectPath) =>
      ipcRenderer.invoke("workspace:get_pages_meta", projectPath),
    updatePagesMeta: (projectPath, meta) =>
      ipcRenderer.invoke("workspace:update_pages_meta", projectPath, meta),
    updatePageConfig: (projectPath, input) =>
      ipcRenderer.invoke("workspace:update_page_config", projectPath, input),
    getCollections: (projectPath) =>
      ipcRenderer.invoke("workspace:get_collections", projectPath),
    listExternalEntries: (projectPath, input) =>
      ipcRenderer.invoke("workspace:list_external_entries", projectPath, input),
    getExternalEntry: (projectPath, collectionId, entryId) =>
      ipcRenderer.invoke("workspace:get_external_entry", projectPath, collectionId, entryId),
    refreshCollectionSource: (projectPath, collectionId) =>
      ipcRenderer.invoke("workspace:refresh_collection_source", projectPath, collectionId),
    assessCollectionMigration: (projectPath, collectionId) =>
      ipcRenderer.invoke("workspace:assess_collection_migration", projectPath, collectionId),
    migrateCollectionToAria: (projectPath, collectionId, previewHash) =>
      ipcRenderer.invoke("cms:migrate_collection", projectPath, collectionId, previewHash),
    cancelCollectionRefresh: (projectPath, collectionId) =>
      ipcRenderer.invoke("workspace:cancel_collection_refresh", projectPath, collectionId),
    updateCollections: (projectPath, collections) =>
      ipcRenderer.invoke(
        "workspace:update_collections",
        projectPath,
        collections,
      ),
    getSiteSettings: (projectPath) =>
      ipcRenderer.invoke("workspace:get_site_settings", projectPath),
    setSiteSettings: (projectPath, settings) =>
      ipcRenderer.invoke("workspace:set_site_settings", projectPath, settings),
    updateContentLocalization: (projectPath, content) =>
      ipcRenderer.invoke("workspace:update_content_localization", projectPath, content),
    updateSeoDefaults: (projectPath, patch) =>
      ipcRenderer.invoke("workspace:update_seo_defaults", projectPath, patch),
    updateAnalytics: (projectPath, analytics) =>
      ipcRenderer.invoke("workspace:update_analytics", projectPath, analytics),
    scanInjections: (projectPath) =>
      ipcRenderer.invoke("workspace:scan_injections", projectPath),
    updateSourceInjection: (projectPath, input) =>
      ipcRenderer.invoke("workspace:update_source_injection", projectPath, input),
    updateDiscovery: (projectPath, patch) =>
      ipcRenderer.invoke("workspace:update_discovery", projectPath, patch),
    listRedirects: (projectPath, options) =>
      ipcRenderer.invoke("workspace:list_redirects", projectPath, options),
    listRedirectTargets: (projectPath) =>
      ipcRenderer.invoke("workspace:list_redirect_targets", projectPath),
    createRedirect: (projectPath, input) =>
      ipcRenderer.invoke("workspace:create_redirect", projectPath, input),
    updateRedirect: (projectPath, input) =>
      ipcRenderer.invoke("workspace:update_redirect", projectPath, input),
    deleteRedirect: (projectPath, id) =>
      ipcRenderer.invoke("workspace:delete_redirect", projectPath, id),
    flattenRedirectChain: (projectPath, id) =>
      ipcRenderer.invoke("workspace:flatten_redirect_chain", projectPath, id),
    importRedirectsCsv: (projectPath, input) =>
      ipcRenderer.invoke("workspace:import_redirects_csv", projectPath, input),
    getDiscoveryReport: (projectPath) =>
      ipcRenderer.invoke("workspace:get_discovery_report", projectPath),
    getDiscoveryArtifacts: (projectPath) =>
      ipcRenderer.invoke("workspace:get_discovery_artifacts", projectPath),
    getDiscoveryBaseline: (projectPath, artifact) =>
      ipcRenderer.invoke(
        "workspace:get_discovery_baseline",
        projectPath,
        artifact,
      ),
    scanSeoSources: (projectPath) =>
      ipcRenderer.invoke("workspace:scan_seo_sources", projectPath),
    confirmSeoTakeover: (projectPath) =>
      ipcRenderer.invoke("workspace:confirm_seo_takeover", projectPath),
    seoTakeoverChecklist: (projectPath) =>
      ipcRenderer.invoke("workspace:seo_takeover_checklist", projectPath),
    pickFavicon: (projectPath) =>
      ipcRenderer.invoke("workspace:pick_favicon", projectPath),
    faviconPreview: (projectPath, faviconPath) =>
      ipcRenderer.invoke(
        "workspace:favicon_preview",
        projectPath,
        faviconPath,
      ),
  },
  composer: {
    parsePage: (projectPath, relativeFile, collectionProps) =>
      ipcRenderer.invoke("composer:parse_page", projectPath, relativeFile, collectionProps),
    analyzeSource: (projectPath, relativeFile, source, collectionProps) =>
      ipcRenderer.invoke(
        "composer:analyze_source",
        projectPath,
        relativeFile,
        source,
        collectionProps,
      ),
    setPreviewDraft: (projectPath, relativeFile, source, leaseId, revision) =>
      ipcRenderer.invoke(
        "composer:set_preview_draft",
        projectPath,
        relativeFile,
        source,
        leaseId,
        revision,
      ),
    clearPreviewDraft: (projectPath, leaseId) =>
      ipcRenderer.invoke("composer:clear_preview_draft", projectPath, leaseId),
    completeCode: (projectPath, relativeFile, source, position) =>
      ipcRenderer.invoke(
        "composer:complete_code",
        projectPath,
        relativeFile,
        source,
        position,
      ),
    listTranslationCatalogs: (projectPath, refresh) =>
      ipcRenderer.invoke("composer:list_translation_catalogs", projectPath, refresh),
    editTranslationValue: (projectPath, input) =>
      ipcRenderer.invoke("composer:edit_translation_value", projectPath, input),
    assessTranslationAdoption: (projectPath, input) =>
      ipcRenderer.invoke("composer:assess_translation_adoption", projectPath, input),
    createTranslationDrafts: (projectPath, input) =>
      ipcRenderer.invoke("cms:create_translation_drafts", projectPath, input),
    applyTranslationCutover: (projectPath, input) =>
      ipcRenderer.invoke("composer:apply_translation_cutover", projectPath, input),
    inspectProjectData: (projectPath, input) =>
      ipcRenderer.invoke("composer:inspect_project_data", projectPath, input),
    assessProjectDataAdoption: (projectPath, input) =>
      ipcRenderer.invoke("composer:assess_project_data_adoption", projectPath, input),
    editProjectData: (projectPath, input) =>
      ipcRenderer.invoke("composer:edit_project_data", projectPath, input),
    createProjectDataDraft: (projectPath, input) =>
      ipcRenderer.invoke("composer:create_project_data_draft", projectPath, input),
    applyProjectDataCutover: (projectPath, input) =>
      ipcRenderer.invoke("composer:apply_project_data_cutover", projectPath, input),
    revealProjectData: (projectPath, relativeFile) =>
      ipcRenderer.invoke("composer:reveal_project_data", projectPath, relativeFile),
    writePage: (projectPath, relativeFile, model, expectedMtimeMs) =>
      ipcRenderer.invoke(
        "composer:write_page",
        projectPath,
        relativeFile,
        model,
        expectedMtimeMs,
      ),
    commitTransaction: (transaction) =>
      ipcRenderer.invoke("composer:commit_transaction", transaction),
    extractPropSchema: (projectPath, fromRelativeFile, importSpec) =>
      ipcRenderer.invoke(
        "composer:extract_prop_schema",
        projectPath,
        fromRelativeFile,
        importSpec,
      ),
    writeComponentControlMetadata: (projectPath, relativeFile, metadata, expectedMtimeMs) =>
      ipcRenderer.invoke(
        "composer:write_component_control_metadata",
        projectPath,
        relativeFile,
        metadata,
        expectedMtimeMs,
      ),
    detectFrameworks: (projectPath) =>
      ipcRenderer.invoke("composer:detect_frameworks", projectPath),
    prepareComponentPreview: (projectPath, componentFile, override) =>
      ipcRenderer.invoke(
        "composer:prepare_component_preview",
        projectPath,
        componentFile,
        override,
      ),
  },
  design: {
    getSnapshot: (projectPath) =>
      ipcRenderer.invoke("design:get_snapshot", projectPath),
    detectIconRuntime: (projectPath) =>
      ipcRenderer.invoke("design:detect_icon_runtime", projectPath),
    detectFontsourceRuntime: (projectPath) =>
      ipcRenderer.invoke("design:detect_fontsource_runtime", projectPath),
    searchIcons: (projectPath, request) =>
      ipcRenderer.invoke("design:search_icons", projectPath, request),
    resolveIcons: (projectPath, ids) =>
      ipcRenderer.invoke("design:resolve_icons", projectPath, ids),
    patch: (projectPath, patch, expectedRevision) =>
      ipcRenderer.invoke("design:patch", projectPath, patch, expectedRevision),
    previewTokenMutation: (projectPath, input) =>
      ipcRenderer.invoke("design:preview_token_mutation", projectPath, input),
    applyTokenMutation: (projectPath, input) =>
      ipcRenderer.invoke("design:apply_token_mutation", projectPath, input),
    selectTokenSource: (projectPath, input) =>
      ipcRenderer.invoke("design:select_token_source", projectPath, input),
    ensureEntry: (projectPath) =>
      ipcRenderer.invoke("design:ensure_entry", projectPath),
    listStylesheets: (projectPath) =>
      ipcRenderer.invoke("design:list_stylesheets", projectPath),
    readStylesheet: (projectPath, relativePath) =>
      ipcRenderer.invoke("design:read_stylesheet", projectPath, relativePath),
    writeStylesheet: (projectPath, relativePath, content, expectedMtimeMs) =>
      ipcRenderer.invoke(
        "design:write_stylesheet",
        projectPath,
        relativePath,
        content,
        expectedMtimeMs,
      ),
    createStylesheet: (projectPath, name) =>
      ipcRenderer.invoke("design:create_stylesheet", projectPath, name),
    deleteStylesheet: (projectPath, relativePath) =>
      ipcRenderer.invoke("design:delete_stylesheet", projectPath, relativePath),
    revealStylesheet: (projectPath, relativePath) =>
      ipcRenderer.invoke("design:reveal_stylesheet", projectPath, relativePath),
    uploadFont: (projectPath) =>
      ipcRenderer.invoke("design:upload_font", projectPath),
    revealFont: (projectPath, relativeFile) =>
      ipcRenderer.invoke("design:reveal_font", projectPath, relativeFile),
    deleteFont: (projectPath, relativeFile) =>
      ipcRenderer.invoke("design:delete_font", projectPath, relativeFile),
    scanClassUsage: (projectPath, classNames) =>
      ipcRenderer.invoke("design:scan_class_usage", projectPath, classNames),
    renameClass: (projectPath, from, to) =>
      ipcRenderer.invoke("design:rename_class", projectPath, from, to),
  },
  utilities: {
    inspect: (projectPath) =>
      ipcRenderer.invoke("utilities:inspect", projectPath),
    activate: (projectPath, library) =>
      ipcRenderer.invoke("utilities:activate", projectPath, library),
    disable: (projectPath, library) =>
      ipcRenderer.invoke("utilities:disable", projectPath, library),
    onProgress: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: UtilityActionProgress,
      ) => handler(progress);
      ipcRenderer.on("utilities:progress", listener);
      return () => ipcRenderer.removeListener("utilities:progress", listener);
    },
  },
  media: {
    list: (projectPath) => ipcRenderer.invoke("media:list", projectPath),
    usages: (projectPath, assetId) =>
      ipcRenderer.invoke("media:usages", projectPath, assetId),
    upload: (projectPath) => ipcRenderer.invoke("media:upload", projectPath),
    delete: (projectPath, assetId) =>
      ipcRenderer.invoke("media:delete", projectPath, assetId),
    rename: (projectPath, assetId, nextName) =>
      ipcRenderer.invoke("media:rename", projectPath, assetId, nextName),
    duplicate: (projectPath, assetId) =>
      ipcRenderer.invoke("media:duplicate", projectPath, assetId),
    reveal: (projectPath, assetId) =>
      ipcRenderer.invoke("media:reveal", projectPath, assetId),
    resolve: (projectPath, assetId) =>
      ipcRenderer.invoke("media:resolve", projectPath, assetId),
    preview: (projectPath, assetId) =>
      ipcRenderer.invoke("media:preview", projectPath, assetId),
    getPlayableUrl: (projectPath, assetId) =>
      ipcRenderer.invoke("media:get_playable_url", projectPath, assetId),
    getGrouping: (projectPath) =>
      ipcRenderer.invoke("media:get_grouping", projectPath),
    updateGrouping: (projectPath, grouping) =>
      ipcRenderer.invoke("media:update_grouping", projectPath, grouping),
    getTransformState: (projectPath, assetId) =>
      ipcRenderer.invoke("media:get_transform_state", projectPath, assetId),
    saveProfile: (projectPath, input) =>
      ipcRenderer.invoke("media:save_profile", projectPath, input),
    saveVariant: (projectPath, input) =>
      ipcRenderer.invoke("media:save_variant", projectPath, input),
    saveVariantWithProfile: (projectPath, input) =>
      ipcRenderer.invoke("media:save_variant_with_profile", projectPath, input),
    deleteVariant: (projectPath, assetId, variantId) =>
      ipcRenderer.invoke(
        "media:delete_variant",
        projectPath,
        assetId,
        variantId,
      ),
  },
  cms: {
    listEntries: (projectPath, params) =>
      ipcRenderer.invoke("cms:list_entries", projectPath, params),
    getEntry: (projectPath, collectionId, entryIdOrSlug) =>
      ipcRenderer.invoke(
        "cms:get_entry",
        projectPath,
        collectionId,
        entryIdOrSlug,
      ),
    createEntry: (projectPath, input) =>
      ipcRenderer.invoke("cms:create_entry", projectPath, input),
    updateEntry: (projectPath, input) =>
      ipcRenderer.invoke("cms:update_entry", projectPath, input),
    deleteEntry: (projectPath, collectionId, entryId, version) =>
      ipcRenderer.invoke(
        "cms:delete_entry",
        projectPath,
        collectionId,
        entryId,
        version,
      ),
    deleteCollectionEntries: (projectPath, collectionId) =>
      ipcRenderer.invoke(
        "cms:delete_collection_entries",
        projectPath,
        collectionId,
      ),
    deleteCollections: (projectPath, collectionIds, expectedRevision, options) =>
      ipcRenderer.invoke(
        "cms:delete_collections",
        projectPath,
        collectionIds,
        expectedRevision,
        options,
      ),
    duplicateEntry: (projectPath, collectionId, entryId, version) =>
      ipcRenderer.invoke(
        "cms:duplicate_entry",
        projectPath,
        collectionId,
        entryId,
        version,
      ),
    publishEntry: (projectPath, collectionId, entryId, opts) =>
      ipcRenderer.invoke(
        "cms:publish_entry",
        projectPath,
        collectionId,
        entryId,
        opts,
      ),
    unpublishEntry: (projectPath, collectionId, entryId, opts) =>
      ipcRenderer.invoke(
        "cms:unpublish_entry",
        projectPath,
        collectionId,
        entryId,
        opts,
      ),
    archiveEntry: (projectPath, collectionId, entryId, opts) =>
      ipcRenderer.invoke(
        "cms:archive_entry",
        projectPath,
        collectionId,
        entryId,
        opts,
      ),
    listRevisions: (projectPath, entryId) =>
      ipcRenderer.invoke("cms:list_revisions", projectPath, entryId),
    restoreRevision: (projectPath, entryId, revisionId, version) =>
      ipcRenderer.invoke(
        "cms:restore_revision",
        projectPath,
        entryId,
        revisionId,
        version,
      ),
    checkSlug: (projectPath, collectionId, slug, locale, excludeEntryId) =>
      ipcRenderer.invoke(
        "cms:check_slug",
        projectPath,
        collectionId,
        slug,
        locale,
        excludeEntryId,
      ),
    seedBlogCms: (projectPath) =>
      ipcRenderer.invoke("cms:seed_blog", projectPath),
    importMarkdown: (projectPath, collectionId, markdown, opts) =>
      ipcRenderer.invoke(
        "cms:import_markdown",
        projectPath,
        collectionId,
        markdown,
        opts,
      ),
    previewMarkdownImport: (projectPath, collectionId, markdown) =>
      ipcRenderer.invoke(
        "cms:preview_markdown_import",
        projectPath,
        collectionId,
        markdown,
      ),
    uploadWordpressImport: (projectPath, input) =>
      ipcRenderer.invoke("cms:wordpress_import_upload", projectPath, input),
    analyzeWordpressImport: (projectPath, input) =>
      ipcRenderer.invoke("cms:wordpress_import_analyze", projectPath, input),
    applyWordpressImport: (projectPath, input) =>
      ipcRenderer.invoke("cms:wordpress_import_apply", projectPath, input),
    cancelWordpressImport: (projectPath, input) =>
      ipcRenderer.invoke("cms:wordpress_import_cancel", projectPath, input),
    getWordpressImportBatch: (projectPath, input) =>
      ipcRenderer.invoke("cms:wordpress_import_get_batch", projectPath, input),
    getWordpressImportEvents: (projectPath, input) =>
      ipcRenderer.invoke("cms:wordpress_import_get_events", projectPath, input),
    getWordpressImportReport: (projectPath, input) =>
      ipcRenderer.invoke("cms:wordpress_import_get_report", projectPath, input),
    listWordpressImportBatches: (projectPath, input) =>
      ipcRenderer.invoke(
        "cms:wordpress_import_list_batches",
        projectPath,
        input ?? {},
      ),
    deleteWordpressImportBatch: (projectPath, input) =>
      ipcRenderer.invoke("cms:wordpress_import_delete_batch", projectPath, input),
    previewMarkdownImportBatch: (projectPath, input) =>
      ipcRenderer.invoke(
        "cms:preview_markdown_import_batch",
        projectPath,
        input,
      ),
    importMarkdownImportBatch: (projectPath, input) =>
      ipcRenderer.invoke("cms:import_markdown_batch", projectPath, input),
  },
  siteExport: {
    create: (projectPath, input) =>
      ipcRenderer.invoke("workspace:site_export_create", projectPath, input),
    list: (projectPath) =>
      ipcRenderer.invoke("workspace:site_export_list", projectPath),
    delete: (projectPath, input) =>
      ipcRenderer.invoke("workspace:site_export_delete", projectPath, input),
    reveal: (projectPath, input) =>
      ipcRenderer.invoke("workspace:site_export_reveal", projectPath, input),
    saveAs: (projectPath, input) =>
      ipcRenderer.invoke("workspace:site_export_save_as", projectPath, input),
    inventory: (projectPath) =>
      ipcRenderer.invoke("workspace:site_export_inventory", projectPath),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke("clipboard:write_text", text),
    writeComposer: (formats) =>
      ipcRenderer.invoke("clipboard:write_composer", formats),
    readComposer: () => ipcRenderer.invoke("clipboard:read_composer"),
  },
  shell: {
    revealPath: (targetPath) =>
      ipcRenderer.invoke("shell:reveal_path", targetPath),
  },
  sessions: {
    list: () => ipcRenderer.invoke("sessions:list"),
    open: (projectPath) => ipcRenderer.invoke("sessions:open", projectPath),
    confirmTrustAndOpen: (challengeId) =>
      ipcRenderer.invoke("sessions:confirmTrustAndOpen", challengeId),
    revokeTrust: (projectPath) =>
      ipcRenderer.invoke("sessions:revokeTrust", projectPath),
    close: (projectPath) => ipcRenderer.invoke("sessions:close", projectPath),
    start: (projectPath) => ipcRenderer.invoke("sessions:start", projectPath),
    stop: (projectPath) => ipcRenderer.invoke("sessions:stop", projectPath),
    restart: (projectPath) => ipcRenderer.invoke("sessions:restart", projectPath),
    replaceExternal: (projectPath) =>
      ipcRenderer.invoke("sessions:replaceExternal", projectPath),
    installDeps: (projectPath) =>
      ipcRenderer.invoke("sessions:installDeps", projectPath),
    onUpdate: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        session: ProjectRuntimeSession,
      ) => handler(session);
      ipcRenderer.on("session:updated", listener);
      return () => ipcRenderer.removeListener("session:updated", listener);
    },
  },
  project: {
    onChange: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        projectPath: string,
        change: ProjectChange,
      ) => handler(projectPath, change);
      ipcRenderer.on("project:changed", listener);
      return () => ipcRenderer.removeListener("project:changed", listener);
    },
  },
  git: {
    status: (projectPath) => ipcRenderer.invoke("git:status", projectPath),
    commit: (projectPath, message) =>
      ipcRenderer.invoke("git:commit", projectPath, message),
    push: (projectPath) => ipcRenderer.invoke("git:push", projectPath),
    listBranches: (projectPath) =>
      ipcRenderer.invoke("git:listBranches", projectPath),
    checkout: (projectPath, branch) =>
      ipcRenderer.invoke("git:checkout", projectPath, branch),
    createBranch: (projectPath, branch) =>
      ipcRenderer.invoke("git:createBranch", projectPath, branch),
    init: (projectPath) => ipcRenderer.invoke("git:init", projectPath),
    diffFile: (projectPath, filePath) =>
      ipcRenderer.invoke("git:diffFile", projectPath, filePath),
  },
  terminal: {
    create: (projectPath, cols, rows) =>
      ipcRenderer.invoke("terminal:create", projectPath, cols, rows),
    write: (id, data) => ipcRenderer.invoke("terminal:write", id, data),
    resize: (id, cols, rows) =>
      ipcRenderer.invoke("terminal:resize", id, cols, rows),
    dispose: (id) => ipcRenderer.invoke("terminal:dispose", id),
    restart: (id, cols, rows) =>
      ipcRenderer.invoke("terminal:restart", id, cols, rows),
    onData: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { id: string; data: string },
      ) => handler(payload);
      ipcRenderer.on("terminal:data", listener);
      return () => ipcRenderer.removeListener("terminal:data", listener);
    },
    onExit: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { id: string; exitCode: number },
      ) => handler(payload);
      ipcRenderer.on("terminal:exit", listener);
      return () => ipcRenderer.removeListener("terminal:exit", listener);
    },
  },
  thumbs: {
    capture: (opts) => ipcRenderer.invoke("thumbs:capture", opts),
    getPage: (opts) => ipcRenderer.invoke("thumbs:getPage", opts),
    getComponent: (opts) => ipcRenderer.invoke("thumbs:getComponent", opts),
    getLayout: (opts) => ipcRenderer.invoke("thumbs:getLayout", opts),
    getProject: (projectPath) =>
      ipcRenderer.invoke("thumbs:getProject", projectPath),
    warmPages: (opts) => ipcRenderer.invoke("thumbs:warmPages", opts),
    warmComponents: (opts) =>
      ipcRenderer.invoke("thumbs:warmComponents", opts),
    prioritizeComponents: (opts) =>
      ipcRenderer.invoke("thumbs:prioritizeComponents", opts),
    warmLayouts: (opts) => ipcRenderer.invoke("thumbs:warmLayouts", opts),
    cancelWarm: () => ipcRenderer.invoke("thumbs:cancelWarm"),
    onPageReady: (handler) => {
      const listener = (_event: unknown, payload: PageThumbReadyPayload) => {
        handler(payload);
      };
      ipcRenderer.on("thumbs:pageReady", listener);
      return () => ipcRenderer.removeListener("thumbs:pageReady", listener);
    },
    onComponentReady: (handler) => {
      const listener = (
        _event: unknown,
        payload: ComponentThumbReadyPayload,
      ) => {
        handler(payload);
      };
      ipcRenderer.on("thumbs:componentReady", listener);
      return () =>
        ipcRenderer.removeListener("thumbs:componentReady", listener);
    },
    onLayoutReady: (handler) => {
      const listener = (_event: unknown, payload: LayoutThumbReadyPayload) => {
        handler(payload);
      };
      ipcRenderer.on("thumbs:layoutReady", listener);
      return () => ipcRenderer.removeListener("thumbs:layoutReady", listener);
    },
  },
  agent: {
    getAvailability: (projectPath) =>
      ipcRenderer.invoke("agent:getAvailability", projectPath),
    getSettings: (projectPath) =>
      ipcRenderer.invoke("agent:getSettings", projectPath),
    patchSettings: (projectPath, patch) =>
      ipcRenderer.invoke("agent:patchSettings", projectPath, patch),
    setProviderCredentials: (input) =>
      ipcRenderer.invoke("agent:setProviderCredentials", input),
    confirmInsecureProviderCredentials: (backend, instanceId, confirmation) =>
      ipcRenderer.invoke(
        "agent:confirmInsecureProviderCredentials",
        backend,
        instanceId,
        confirmation,
      ),
    clearProviderCredentials: (backend, instanceId) =>
      ipcRenderer.invoke("agent:clearProviderCredentials", backend, instanceId),
    removeInferenceProvider: (projectPath, instanceId) =>
      ipcRenderer.invoke(
        "agent:removeInferenceProvider",
        projectPath,
        instanceId,
      ),
    getCredentialStatuses: () =>
      ipcRenderer.invoke("agent:getCredentialStatuses"),
    listCatalogModels: (projectPath, instanceId) =>
      ipcRenderer.invoke("agent:listCatalogModels", projectPath, instanceId),
    startChat: (projectPath, streamId, body) =>
      ipcRenderer.invoke("agent:startChat", projectPath, streamId, body),
    cancelChat: (projectPath, streamId) =>
      ipcRenderer.invoke("agent:cancelChat", projectPath, streamId),
    registerRendererHost: (projectPath, active, scope, registrationId) =>
      ipcRenderer.invoke(
        "agent:registerRendererHost",
        projectPath,
        active,
        scope,
        registrationId,
      ),
    resolveRendererTool: (response) =>
      ipcRenderer.invoke("agent:rendererToolResult", response),
    onRendererToolRequest: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        request: import("../shared/agent").AgentRendererToolRequest,
      ) => handler(request);
      ipcRenderer.on("agent:rendererToolRequest", listener);
      return () =>
        ipcRenderer.removeListener("agent:rendererToolRequest", listener);
    },
    onStream: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: {
          streamId: string;
          event: import("../shared/agent").AgentStreamEvent;
        },
      ) => handler(payload);
      ipcRenderer.on("agent:stream", listener);
      return () => ipcRenderer.removeListener("agent:stream", listener);
    },
  },
  history: {
    list: (projectPath) => ipcRenderer.invoke("history:list", projectPath),
    undo: (projectPath) => ipcRenderer.invoke("history:undo", projectPath),
    redo: (projectPath) => ipcRenderer.invoke("history:redo", projectPath),
    restore: (projectPath, recordId, direction) =>
      ipcRenderer.invoke("history:restore", projectPath, recordId, direction),
  },
  search: {
    project: (projectPath, input) =>
      ipcRenderer.invoke("search:project", projectPath, input),
  },
};

contextBridge.exposeInMainWorld("aria", aria);
