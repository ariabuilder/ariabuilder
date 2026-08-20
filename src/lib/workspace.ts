import type {
  CreateComponentResult,
  CreateLayoutResult,
  CreatePageResult,
  CreatePageOptions,
  ComponentFolderMutationResult,
  ComponentGroupingState,
  CollectionsState,
  CollectionMigrationAssessment,
  CollectionMigrationResult,
  PagesMetaState,
} from "@/types/aria";
import type {
  ExternalEntryDetailResult,
  ExternalEntryListRequest,
  ExternalEntryListResult,
  LayoutPreviewManifest,
  ComponentDetailManifest,
  ScanComponent,
  StudioDocumentDeleteResult,
  StudioDocumentKind,
} from "../../shared/types";
import type { SiteSettings } from "@/workspace/settings/types";
import type { ScanResult } from "@/workspace/types";
import type { ContentLocalizationSettings } from "../../shared/localization";

function api() {
  if (!window.aria) {
    throw new Error(
      "Aria desktop bridge is unavailable. Restart the app with npm run dev.",
    );
  }
  if (!window.aria.workspace) {
    throw new Error(
      "Workspace API missing from preload. Stop the app and run npm run dev again.",
    );
  }
  return window.aria.workspace;
}

/**
 * Electron IPC uses structured clone. Vue reactive Proxies are not cloneable —
 * strip to plain JSON before invoke.
 */
function toIpcPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function scanWorkspace(projectPath: string): Promise<ScanResult> {
  return api().scan(projectPath);
}

export function inspectWorkspaceLayouts(
  projectPath: string,
): Promise<LayoutPreviewManifest[]> {
  return api().inspectLayouts(projectPath);
}

export function inspectWorkspaceComponent(
  projectPath: string,
  relativeFile: string,
): Promise<ComponentDetailManifest> {
  return api().inspectComponent(projectPath, relativeFile);
}

export function duplicateWorkspaceStudioDocument(
  projectPath: string,
  input: { kind: StudioDocumentKind; file: string; name: string },
): Promise<ScanComponent> {
  return api().duplicateStudioDocument(projectPath, toIpcPayload(input));
}

export function deleteWorkspaceStudioDocument(
  projectPath: string,
  input: { kind: StudioDocumentKind; file: string },
): Promise<StudioDocumentDeleteResult> {
  return api().deleteStudioDocument(projectPath, toIpcPayload(input));
}

export function resolveWorkspaceStudioDocument(
  projectPath: string,
  input: { kind: StudioDocumentKind; file: string },
): Promise<{ path: string }> {
  return api().resolveStudioDocument(projectPath, toIpcPayload(input));
}

export function revealWorkspaceStudioDocument(
  projectPath: string,
  input: { kind: StudioDocumentKind; file: string },
): Promise<{ path: string }> {
  return api().revealStudioDocument(projectPath, toIpcPayload(input));
}

export function createWorkspacePage(
  projectPath: string,
  name: string,
  options?: CreatePageOptions,
): Promise<CreatePageResult> {
  return api().createPage(projectPath, name, options);
}

export function deleteWorkspacePage(
  projectPath: string,
  relativeFile: string,
  options?: { unassignCms?: boolean },
): Promise<{ ok: true }> {
  return api().deletePage(projectPath, relativeFile, options);
}

export function revealWorkspacePage(
  projectPath: string,
  relativeFile: string,
): Promise<{ path: string }> {
  return api().revealPage(projectPath, relativeFile);
}

export function resolveWorkspacePage(
  projectPath: string,
  relativeFile: string,
): Promise<{ path: string }> {
  return api().resolvePage(projectPath, relativeFile);
}

export function createWorkspaceComponent(
  projectPath: string,
  name: string,
): Promise<CreateComponentResult> {
  return api().createComponent(projectPath, name);
}

export function createWorkspaceLayout(
  projectPath: string,
  name: string,
): Promise<CreateLayoutResult> {
  return api().createLayout(projectPath, name);
}

export function deleteWorkspaceComponent(
  projectPath: string,
  relativeFile: string,
): Promise<{ ok: true }> {
  return api().deleteComponent(projectPath, relativeFile);
}

export function renameWorkspaceComponentFolder(
  projectPath: string,
  folderRel: string,
  nextNameOrPath: string,
): Promise<ComponentFolderMutationResult> {
  return api().renameComponentFolder(projectPath, folderRel, nextNameOrPath);
}

export function deleteWorkspaceComponentFolder(
  projectPath: string,
  folderRel: string,
): Promise<ComponentFolderMutationResult> {
  return api().deleteComponentFolder(projectPath, folderRel);
}

export function revealWorkspaceComponent(
  projectPath: string,
  relativeFile: string,
): Promise<{ path: string }> {
  return api().revealComponent(projectPath, relativeFile);
}

export function resolveWorkspaceComponent(
  projectPath: string,
  relativeFile: string,
): Promise<{ path: string }> {
  return api().resolveComponent(projectPath, relativeFile);
}

export function getComponentGrouping(
  projectPath: string,
): Promise<ComponentGroupingState> {
  return api().getComponentGrouping(projectPath);
}

export function updateComponentGrouping(
  projectPath: string,
  grouping: ComponentGroupingState,
): Promise<ComponentGroupingState> {
  return api().updateComponentGrouping(projectPath, grouping);
}

export function getPagesMeta(projectPath: string): Promise<PagesMetaState> {
  return api().getPagesMeta(projectPath);
}

export function updatePagesMeta(
  projectPath: string,
  meta: PagesMetaState,
): Promise<PagesMetaState> {
  return api().updatePagesMeta(projectPath, toIpcPayload(meta));
}

export function updatePageConfig(
  projectPath: string,
  input: { pagesMeta: PagesMetaState; collections: CollectionsState },
): Promise<{ meta: PagesMetaState; collections: CollectionsState }> {
  return api().updatePageConfig(projectPath, toIpcPayload(input));
}

export function getCollections(
  projectPath: string,
): Promise<CollectionsState> {
  return api().getCollections(projectPath);
}

export function listExternalEntries(
  projectPath: string,
  input: ExternalEntryListRequest,
): Promise<ExternalEntryListResult> {
  return api().listExternalEntries(projectPath, toIpcPayload(input));
}

export function getExternalEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
): Promise<ExternalEntryDetailResult | null> {
  return api().getExternalEntry(projectPath, collectionId, entryId);
}

export function refreshCollectionSource(projectPath: string, collectionId: string) {
  return api().refreshCollectionSource(projectPath, collectionId);
}

export function assessCollectionMigration(
  projectPath: string,
  collectionId: string,
): Promise<CollectionMigrationAssessment> {
  return api().assessCollectionMigration(projectPath, collectionId);
}

export function migrateCollectionToAria(
  projectPath: string,
  collectionId: string,
  previewHash: string,
): Promise<CollectionMigrationResult> {
  return api().migrateCollectionToAria(projectPath, collectionId, previewHash);
}

export function cancelCollectionRefresh(projectPath: string, collectionId: string) {
  return api().cancelCollectionRefresh(projectPath, collectionId);
}

export function updateCollections(
  projectPath: string,
  collections: CollectionsState,
): Promise<CollectionsState> {
  return api().updateCollections(projectPath, toIpcPayload(collections));
}

export function getSiteSettings(projectPath: string): Promise<SiteSettings> {
  return api().getSiteSettings(projectPath);
}

export function setSiteSettings(
  projectPath: string,
  next: SiteSettings,
): Promise<SiteSettings> {
  return api().setSiteSettings(projectPath, toIpcPayload(next));
}

export function updateContentLocalization(
  projectPath: string,
  content: ContentLocalizationSettings,
): Promise<SiteSettings> {
  return api().updateContentLocalization(projectPath, toIpcPayload(content));
}

export function updateSeoDefaults(
  projectPath: string,
  patch: {
    seoTitle?: string;
    seoDescription?: string;
    ogImage?: string;
    seoKeywords?: string;
    twitterCard?: string;
  },
): Promise<SiteSettings> {
  return api().updateSeoDefaults(projectPath, patch);
}

export function updateAnalytics(
  projectPath: string,
  analytics: import("../../shared/types").AnalyticsSettings,
): Promise<SiteSettings> {
  return api().updateAnalytics(projectPath, analytics);
}

export function scanInjections(projectPath: string) {
  return api().scanInjections(projectPath);
}

export function updateSourceInjection(
  projectPath: string,
  input: import("../../shared/injections").UpdateSourceInjectionInput,
) {
  return api().updateSourceInjection(projectPath, toIpcPayload(input));
}

export function updateDiscovery(
  projectPath: string,
  patch: Partial<import("../../shared/types").DiscoverySettings>,
): Promise<SiteSettings> {
  return api().updateDiscovery(projectPath, patch);
}

export function listRedirects(
  projectPath: string,
  options?: { includeDisabled?: boolean },
) {
  return api().listRedirects(projectPath, options);
}

export function listRedirectTargets(projectPath: string) {
  return api().listRedirectTargets(projectPath);
}

export function createRedirect(
  projectPath: string,
  input: {
    fromPath: string;
    toPath: string;
    statusCode?: 301 | 302;
    enabled?: boolean;
    note?: string;
  },
) {
  return api().createRedirect(projectPath, input);
}

export function updateRedirect(
  projectPath: string,
  input: {
    id: string;
    fromPath?: string;
    toPath?: string;
    statusCode?: 301 | 302;
    enabled?: boolean;
    note?: string | null;
  },
) {
  return api().updateRedirect(projectPath, input);
}

export function deleteRedirect(projectPath: string, id: string) {
  return api().deleteRedirect(projectPath, id);
}

export function flattenRedirectChain(projectPath: string, id: string) {
  return api().flattenRedirectChain(projectPath, id);
}

export function importRedirectsCsv(
  projectPath: string,
  input: { csv: string; replaceExisting?: boolean },
) {
  return api().importRedirectsCsv(projectPath, input);
}

export function getDiscoveryReport(projectPath: string) {
  return api().getDiscoveryReport(projectPath);
}

export function getDiscoveryArtifacts(projectPath: string) {
  return api().getDiscoveryArtifacts(projectPath);
}

export function getDiscoveryBaseline(
  projectPath: string,
  artifact: "robots" | "sitemap" | "llms",
) {
  return api().getDiscoveryBaseline(projectPath, artifact);
}

export function scanSeoSources(projectPath: string): Promise<SiteSettings> {
  return api().scanSeoSources(projectPath);
}

export function confirmSeoTakeover(projectPath: string): Promise<SiteSettings> {
  return api().confirmSeoTakeover(projectPath);
}

export function seoTakeoverChecklist(projectPath: string): Promise<string[]> {
  return api().seoTakeoverChecklist(projectPath);
}

export function pickFavicon(
  projectPath: string,
): Promise<{ favicon: string } | { canceled: true }> {
  return api().pickFavicon(projectPath);
}

export function faviconPreview(
  projectPath: string,
  faviconPath: string,
): Promise<{ dataUrl: string | null }> {
  return api().faviconPreview(projectPath, faviconPath);
}

export type {
  CreateComponentResult,
  CreatePageResult,
  ComponentFolderMutationResult,
  ComponentGroupingState,
  ScanResult,
  SiteSettings,
};
