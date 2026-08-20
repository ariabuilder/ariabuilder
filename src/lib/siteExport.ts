import type {
  SiteExportActionPayload,
  SiteExportInventory,
  SiteExportListPayload,
  SiteExportSelection,
} from "../../shared/export";

export type {
  CreateSiteExportInput,
  SiteExportActionPayload,
  SiteExportInventory,
  SiteExportListPayload,
  SiteExportRecord,
  SiteExportSelection,
  SiteExportSection,
  SiteExportPreset,
} from "../../shared/export";

export {
  SITE_EXPORT_SECTIONS,
  SITE_EXPORT_PRESETS,
  createDefaultSiteExportSelection,
  resolveExportSelection,
  getSiteExportSectionLabel,
} from "../../shared/export";

function api() {
  if (!window.aria) {
    throw new Error(
      "Aria desktop bridge is unavailable. Restart the app with npm run dev.",
    );
  }
  if (!window.aria.siteExport) {
    throw new Error(
      "Site export API missing from preload. Stop the app and run npm run dev again.",
    );
  }
  return window.aria.siteExport;
}

function toIpcPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createSiteExport(
  projectPath: string,
  input?: {
    ttlMinutes?: number;
    selection?: SiteExportSelection;
  },
): Promise<SiteExportActionPayload> {
  return api().create(projectPath, toIpcPayload(input ?? {}));
}

export function listSiteExports(
  projectPath: string,
): Promise<SiteExportListPayload> {
  return api().list(projectPath);
}

export function deleteSiteExport(
  projectPath: string,
  input: { id: string },
): Promise<{ ok: true }> {
  return api().delete(projectPath, toIpcPayload(input));
}

export function revealSiteExport(
  projectPath: string,
  input: { id: string },
): Promise<{ ok: true }> {
  return api().reveal(projectPath, toIpcPayload(input));
}

export function saveAsSiteExport(
  projectPath: string,
  input: { id: string },
): Promise<{ ok: true; path?: string }> {
  return api().saveAs(projectPath, toIpcPayload(input));
}

export function inventorySiteExport(
  projectPath: string,
): Promise<SiteExportInventory> {
  return api().inventory(projectPath);
}
