import type {
  CollectionScope,
  CollectionSupport,
  EntryFieldOrderItem,
  FieldSchema,
  FieldType,
} from "./cms";

export type RuntimeStatus =
  | "stopped"
  | "starting"
  | "live"
  | "failed"
  | "stopping"
  | "needs_install"
  | "installing";

export type ProjectRuntimeSession = {
  path: string;
  name: string;
  live: boolean;
  previewUrl: string | null;
  /** Whether the preview process belongs to Aria or was observed externally. */
  previewOwnership?: "aria" | "external" | null;
  status: RuntimeStatus;
  error: string | null;
  logs: string[];
  openedAt: number;
  /**
   * True when the live preview HTML includes Aria selection markers
   * (or was spawned with Aria's marker config). Null while unknown.
   */
  markersPresent?: boolean | null;
  /** Non-fatal Composer warning (e.g. adopted foreign server without markers). */
  composerWarning?: string | null;
};

export type ProjectTrustOrigin = "user-approved" | "aria-created" | "smoke";

export type ProjectTrustChallenge = {
  id: string;
  projectPath: string;
  projectName: string;
};

export type ProjectOpenResult =
  | { status: "opened"; session: ProjectRuntimeSession }
  | { status: "trust_required"; challenge: ProjectTrustChallenge };

export type ProjectTrustRevocationResult =
  | { status: "revoked"; projectPath: string }
  | { status: "not_trusted"; projectPath: string }
  | { status: "in_use"; projectPath: string };

export type ProjectChange = {
  path: string;
  kind: "source" | "asset";
};

export type CreateAstroOpts = {
  jobId?: string;
  retryJobId?: string;
  dir: string;
  template: string;
  install: boolean;
  git: boolean;
  ai: boolean;
};

export type ProjectCreationJobStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type ProjectCreationJob = {
  id: string;
  destination: string;
  step: string;
  progress: number;
  logs: string;
  status: ProjectCreationJobStatus;
  error?: string;
};

export type DialogOutcome = {
  canceled: boolean;
  projectPath?: string;
  error?: string;
};

export type RecentProject = {
  path: string;
  name: string;
  openedAt: number;
};

export type ComponentGroup = {
  id: string;
  name: string;
};

export type ComponentGroupingState = {
  groups: ComponentGroup[];
  assignments: Record<string, string>;
};

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
  /** Stable id = project-relative posix path (e.g. public/uploads/hero.jpg). */
  id: string;
  name: string;
  type: MediaAssetType;
  /** Project-relative posix path. */
  file: string;
  /** Public or import-style URL path. */
  url: string;
  size: number;
  mimeType: string | null;
  mtimeMs: number;
  dimensions: { width: number; height: number } | null;
  cropCount: number;
  /** Relative folder within the media root when nested. */
  folder?: string;
};

export type MediaAssetUsage = {
  file: string;
  line: number;
  reference: string;
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
  /** Public URL of the baked file (/uploads/variants/…). */
  url: string;
  /** Project-relative posix path of the baked file. */
  file: string;
  createdAt: string;
  updatedAt: string;
};

export type MediaTransformState = {
  profile: MediaAssetProfile | null;
  variants: MediaTransformVariant[];
};

/** Where a site-wide code snippet is injected in the document. */
export type CodeSnippetPlacement = "header" | "body" | "footer";

/** Reusable site-wide custom code piece (Settings → Snippets). */
export type CodeSnippet = {
  id: string;
  name: string;
  placement: CodeSnippetPlacement;
  code: string;
  enabled: boolean;
};

export type DiscoverySitemapMode = "auto" | "custom" | "off";
export type DiscoveryRobotsMode = "auto" | "custom";
export type DiscoveryLlmsMode = "auto" | "custom" | "off";
export type TrailingSlashPolicy = "strip" | "add" | "none";
export type AiBotPolicy = "allow-all" | "block-training" | "custom";

/** Site-wide discovery / crawl artifact settings (Settings → Discovery). */
export type DiscoverySettings = {
  sitemapMode: DiscoverySitemapMode;
  sitemapCustom?: string;
  robotsMode: DiscoveryRobotsMode;
  robotsCustom?: string;
  includeSitemapInRobots: boolean;
  llmsMode: DiscoveryLlmsMode;
  llmsCustom?: string;
  discourageSearchEngines: boolean;
  googleSiteVerification?: string;
  bingSiteVerification?: string;
  trailingSlashPolicy: TrailingSlashPolicy;
  sitemapPingOnPublish: boolean;
  llmsAiPolicy?: string;
  aiBotPolicy?: AiBotPolicy;
};

export type SeoPluginFinding = {
  name: string;
  source: "package.json" | "astro.config";
  detail?: string;
};

export type SeoManualTagFinding = {
  file: string;
  kind:
    | "title"
    | "description"
    | "og"
    | "twitter"
    | "canonical"
    | "robots"
    | "seo-component";
  snippet?: string;
};

export type SeoStaticArtifactFinding = {
  file: string;
  kind: "robots" | "sitemap" | "llms";
};

/** Result of scanning the project for competing SEO sources. */
export type SeoSourceScanResult = {
  scannedAt: string;
  plugins: SeoPluginFinding[];
  manualTags: SeoManualTagFinding[];
  staticArtifacts: SeoStaticArtifactFinding[];
  /** True when Aria-managed markers/routes are already present. */
  ariaManagedPresent: boolean;
  hasConflicts: boolean;
};

export type SeoManagementStatus = "unmanaged" | "managed";

/** Whether Aria owns head meta + discovery artifacts for this project. */
export type SeoManagementState = {
  status: SeoManagementStatus;
  detectedAt?: string;
  managedAt?: string;
  lastScan?: SeoSourceScanResult;
};

export const ANALYTICS_PROVIDER_IDS = [
  "plausible",
  "fathom",
  "simple-analytics",
  "matomo",
  "umami",
  "tiktok-pixel",
  "linkedin-insight-tag",
  "meta-pixel",
  "google-analytics",
  "google-tag-manager",
  "cloudflare-web-analytics",
] as const;

export type AnalyticsProviderId = (typeof ANALYTICS_PROVIDER_IDS)[number];

export type AnalyticsSettings = {
  version: 1;
  activeProviders: AnalyticsProviderId[];
  providers: Partial<Record<AnalyticsProviderId, Record<string, string>>>;
};

export type SiteSettings = {
  siteName: string;
  siteDescription: string;
  siteUrl: string;
  timeZone: string;
  favicon: string;
  /** Site-wide SEO title default (falls back to siteName). */
  seoTitle?: string;
  /** Site-wide SEO description default (falls back to siteDescription). */
  seoDescription?: string;
  seoKeywords?: string;
  /** Default Open Graph image URL/path. */
  ogImage?: string;
  twitterCard?: string;
  /** Optional custom domain for health alignment checks. */
  customDomain?: string;
  discovery?: DiscoverySettings;
  seoManagement?: SeoManagementState;
  componentGrouping?: ComponentGroupingState;
  mediaGrouping?: MediaGroupingState;
  /** Site-wide Header/Body/Footer code snippets. */
  snippets?: CodeSnippet[];
  /** Visitor analytics script providers. */
  analytics?: AnalyticsSettings;
  /** Public site content locale policy. Separate from the Studio UI language. */
  localization?: {
    content: import("./localization").ContentLocalizationSettings;
  };
  /**
   * Aria Engineer settings (provider instances, skills, instructions).
   * API keys are never stored here — only in Electron safeStorage.
   */
  agent?: import("./agent").AgentSettings;
};

/**
 * Aria page system role (adapted from aria-demo DSL `systemRole`).
 * Overlay + collection bindings live in `.aria/pages-meta.json` / `.aria/collections.json`.
 */
export type PageRole =
  | "standard"
  | "not-found"
  | "cms-collection"
  | "cms-entry";

/** Per-page SEO fields stored in `.aria/pages-meta.json`. */
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

/** Per-file page overlay (role, display, SEO). */
export type PageMetaRecord = {
  role?: PageRole;
  /** Studio display / default document title */
  title?: string;
  description?: string;
  seo?: PageSeoMeta;
};

/**
 * Page meta overlay keyed by project-relative file path.
 * Legacy `roles` map is accepted on read and migrated into `pages[file].role`.
 */
export type PagesMetaState = {
  pages: Record<string, PageMetaRecord>;
};

export type AriaCollectionKind = "content" | "data" | "config" | "tags";

/**
 * Embedded field schema on an aria-app collection def (file-backed CMS).
 * Leaner than the full portable `CollectionSchema` (which also carries id/label/kind).
 */
export type AriaCollectionSchemaDef = {
  fields: FieldSchema[];
  version: number;
  entryFieldOrder?: EntryFieldOrderItem[];
  icon?: string;
};

export type CollectionSourceKind =
  | "aria-managed"
  | "astro-local"
  | "external-build"
  | "external-live";

export type CollectionSourceAdapter =
  | "aria-managed"
  | "legacy-directory"
  | "astro-glob"
  | "astro-file"
  | "astro-store"
  | "astro-live"
  | "unsupported";

export type CollectionSourceFormat =
  | "markdown"
  | "mdx"
  | "markdoc"
  | "json"
  | "yaml"
  | "toml"
  | "custom";

export type CollectionSourceAvailability =
  | "ready"
  | "needs-refresh"
  | "unavailable";

export type CollectionMigrationMode = "automatic" | "assisted" | "unavailable";

export type CollectionSourceProvider =
  | "aria"
  | "astro"
  | "payload"
  | "sanity"
  | "external";

export type CollectionCapabilities = {
  read: boolean;
  refresh: boolean;
  writeEntry: boolean;
  createEntry: boolean;
  translate: boolean;
  publish: boolean;
  writeSchema: boolean;
  migrate: boolean;
};

/** Runtime registry projection. Source metadata is never persisted to collections.json. */
export type CollectionSourceInfo = {
  kind: CollectionSourceKind;
  provider: CollectionSourceProvider;
  label: "Aria CMS" | "Local Astro" | "Payload" | "Sanity" | "External CMS";
  mode: "managed" | "file" | "build-time" | "live";
  readOnly: boolean;
  configFile?: string;
  loaderHint?: string;
  /** Canonical adapter selected for discovery, reads, refreshes, and migration. */
  adapter?: CollectionSourceAdapter;
  /** Entry formats declared or inferred for this source. */
  formats?: CollectionSourceFormat[];
  /** Project-relative source file used by an Astro file() loader. */
  sourceFile?: string;
  /** How entry identifiers are produced by the source. */
  idStrategy?: "path" | "slug" | "field" | "custom" | "astro-store";
  /** Whether the source can be migrated automatically, with assistance, or not at all. */
  migrationMode?: CollectionMigrationMode;
  /** Whether the selected adapter can enumerate entries right now. */
  availability?: CollectionSourceAvailability;
  availabilityReason?: string;
  /** Plain-language reasons for disabled capability flags. */
  capabilityNotes?: Partial<Record<keyof CollectionCapabilities, string>>;
  /** Project-relative directory read by a statically detected Astro glob loader. */
  contentDirectory?: string;
  /** Glob pattern declared by the source collection. */
  filePattern?: string;
  schemaAvailable: boolean;
  cacheState: "fresh" | "stale" | "unavailable";
  lastSuccessfulRefresh?: string;
  discoveredLocales?: string[];
  entryCount?: number;
  inspectionEntries?: ExternalCollectionEntry[];
  error?: string;
};

export type ExternalCollectionEntry = {
  id: string;
  data: Record<string, unknown>;
  body?: string;
  filePath?: string;
  locale?: string;
};

export type ExternalFieldDescriptor = {
  key: string;
  label: string;
  type: FieldType;
  source: "schema" | "inferred";
  sortable: boolean;
  complex: boolean;
  image: boolean;
};

export type ExternalEntrySort = {
  field: string;
  direction: "asc" | "desc";
};

export type ExternalEntryListRequest = {
  collectionId: string;
  query?: string;
  page?: number;
  limit?: number;
  sort?: ExternalEntrySort;
};

export type ExternalEntryListResult = {
  items: ExternalCollectionEntry[];
  fields: ExternalFieldDescriptor[];
  /** Individual source files skipped while valid entries were preserved. */
  issues?: ExternalEntryIssue[];
  total: number;
  filteredTotal: number;
  scannedTotal: number;
  page: number;
  limit: number;
  truncated: boolean;
};

export type ExternalEntryDetailResult = {
  entry: ExternalCollectionEntry;
  fields: ExternalFieldDescriptor[];
};

export type ExternalEntryIssue = {
  /** Project-relative source file that could not be read. */
  filePath: string;
  /** Plain parser or validation message without transport-level prefixes. */
  message: string;
};

/**
 * Collection definition for Collections CMS (Astro file refs, not DSL page ids).
 * `listPageFile` / `templatePageFile` are project-relative paths under `src/pages`.
 */
export type AriaCollectionDef = {
  id: string;
  name: string;
  label: string;
  kind: AriaCollectionKind;
  /** Public entry URL pattern, e.g. `/blog/{slug}`. */
  urlPattern: string | null;
  /** List/archive page file, e.g. `src/pages/blog/index.astro`. */
  listPageFile: string | null;
  /** Entry template file, e.g. `src/pages/blog/[...id].astro`. */
  templatePageFile: string | null;
  /** Custom field schema for entries in this collection. */
  schema?: AriaCollectionSchemaDef;
  /** Project-relative Markdown root used by Astro and Aria for this collection. */
  contentDirectory?: string;
  /** Feature flags (body, cover, drafts, seo, rss, comments, …). */
  supports?: CollectionSupport[];
  /** Ownership scope for nested/tag collections. */
  scope?: CollectionScope;
  /** Sidebar / UI icon key. */
  icon?: string | null;
  /** Public RSS feed settings. */
  rss?: {
    enabled: boolean;
    title?: string;
    description?: string;
    itemLimit?: number;
  };
  /** Public comments opt-in. */
  comments?: { enabled: boolean };
  /** Present on registry reads; stripped before Aria-owned persistence. */
  source?: CollectionSourceInfo;
  /** Present on registry reads; all mutations must be capability-gated. */
  capabilities?: CollectionCapabilities;
};

export type CollectionsState = {
  collections: AriaCollectionDef[];
  /** Derived optimistic-concurrency fence; never persisted in collections.json. */
  revision?: string;
};

export type CollectionMigrationAssessment = {
  previewHash: string;
  generatedAt: string;
  collection: { id: string; name: string; label: string };
  source: CollectionSourceInfo;
  entryCount: number | null;
  locales: string[];
  fields: AriaCollectionSchemaDef["fields"];
  initialImportStatus: "draft";
  mutatesExternalSource: boolean;
  requiresExplicitMapping: boolean;
  configurationFile?: string;
};

export type CollectionMigrationResult = {
  ok: true;
  collectionId: string;
  collectionName: string;
  importedEntries: number;
  initialStatus: "draft";
  sourceChanged: boolean;
  routesChanged: false;
};

export type ScanPage = {
  route: string;
  file: string;
  mtimeMs: number;
  /** Resolved Aria page role (scan attaches via meta + collections + inference). */
  role?: PageRole;
  /** Optional studio title from pages-meta (falls back to path-derived display name). */
  title?: string;
};

export type ScanComponent = {
  /** Project-relative posix path — stable grouping assignment key. */
  id: string;
  name: string;
  file: string;
  mtimeMs: number;
  /**
   * Relative folder path under src/components when nested (e.g. `ui` or `ui/forms`);
   * omitted for files directly in src/components.
   */
  category?: string;
};

export type LayoutPreviewSlot = {
  id: string;
  name: string | null;
  label: string;
  hasFallback: boolean;
  static: boolean;
  mutable: boolean;
};

export type LayoutPreviewConsumer = Pick<
  ScanPage,
  "route" | "file" | "mtimeMs" | "title"
> & {
  previewable: boolean;
};

/** Read-only Studio projection; never persisted into project source. */
export type LayoutPreviewManifest = {
  layout: ScanComponent;
  slots: LayoutPreviewSlot[];
  diagnostics: string[];
  consumers: LayoutPreviewConsumer[];
  representativeRoute: string | null;
};

export type StudioDocumentKind = "component" | "layout";

export type StudioDocumentUsage = {
  kind: "page" | "layout" | "component";
  file: string;
  label: string;
  route?: string;
  referenceCount: number;
};

export type StudioDocumentStructureNode = {
  path: string;
  kind: string;
  label: string;
  sourceLabel: string;
  textPreview?: string;
  children: StudioDocumentStructureNode[];
};

export type ComponentDetailManifest = {
  component: ScanComponent;
  props: import("./composer").PropField[];
  slots: string[];
  structure: StudioDocumentStructureNode[];
  usages: StudioDocumentUsage[];
  diagnostics: string[];
};

export type StudioDocumentDeleteResult =
  | { ok: true }
  | {
      ok: false;
      code: "DOCUMENT_IN_USE";
      usages: StudioDocumentUsage[];
    };

export type ScanResult = {
  name: string;
  root: string;
  pages: ScanPage[];
  components: ScanComponent[];
  /** Astro layouts under `src/layouts` (same shape as components). */
  layouts: ScanComponent[];
  counts: {
    pages: number;
    layouts: number;
    components: number;
  };
};

export type CreatePageLayoutInput = {
  name: string;
  /** Project-relative Astro layout file. */
  file: string;
  props?: import("./composer/types").AstroPropMap;
};

export type CreatePageOptions = {
  layout?: CreatePageLayoutInput | null;
};

export type CreatePageResult = {
  route: string;
  file: string;
};

export type CreateComponentResult = {
  id: string;
  name: string;
  file: string;
};

export type CreateLayoutResult = CreateComponentResult;

/** Result of renaming or dissolving a folder under `src/components`. */
export type ComponentFolderMutationResult = {
  ok: true;
  /** Folder path under src/components before the mutation (posix). */
  from: string;
  /**
   * Folder path under src/components after the mutation (posix).
   * Rename: the new folder path. Delete: the parent folder (`""` = components root).
   */
  to: string;
  /** Project-relative component file path remaps (old id → new id). */
  movedFiles: Record<string, string>;
};

export type GitFileChange = {
  path: string;
  /** Two-letter porcelain status (e.g. "M ", " M", "A ", "??"). */
  code: string;
};

export type GitStatus = {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: GitFileChange[];
  dirty: boolean;
  error: string | null;
};

export type GitDiffResult = {
  path: string;
  text: string;
  binary: boolean;
  truncated: boolean;
};
