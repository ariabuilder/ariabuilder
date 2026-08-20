import { randomUUID } from "node:crypto";
import {
  CreateSiteExportInputSchema,
  DeleteSiteExportInputSchema,
  type CreateSiteExportInput,
  type SiteExportActionPayload,
  type SiteExportInventory,
  type SiteExportListPayload,
  type SiteExportRecord,
} from "../../shared/export";
import {
  buildSiteExportRecord,
  cleanupExpiredSiteExports,
  deleteSiteExport as deleteStoredExport,
  listSiteExports as listStoredExports,
  revealSiteExport as revealStoredExport,
  saveSiteExport,
} from "./storage";

export type {
  CreateSiteExportInput,
  SiteExportActionPayload,
  SiteExportInventory,
  SiteExportListPayload,
  SiteExportRecord,
};

export {
  buildSiteExportRecord,
  cleanupExpiredSiteExports,
  getLatestSiteExport,
  getSiteExport,
  getSiteExportBytes,
  resolveSiteExportArtifactPath,
} from "./storage";

function createId(): string {
  return randomUUID();
}

/**
 * Create a site export archive:
 * cleanup expired → pack zip → register under `.aria/exports/{id}/`.
 */
export async function createSiteExport(
  projectPath: string,
  input?: CreateSiteExportInput,
): Promise<SiteExportActionPayload> {
  const parsed = CreateSiteExportInputSchema.parse(input ?? {});

  cleanupExpiredSiteExports(projectPath);

  const { packSiteExport } = await import("./packProject");
  const packed = await packSiteExport(projectPath, parsed.selection);
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + parsed.ttlMinutes * 60_000,
  );

  const record = buildSiteExportRecord({
    id: createId(),
    filename: packed.filename,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    pageCount: packed.pageCount,
    layoutCount: packed.layoutCount,
    componentCount: packed.componentCount,
    mediaCount: packed.mediaCount,
    cmsCollectionCount: packed.cmsCollectionCount,
    cmsEntryCount: packed.cmsEntryCount,
    redirectCount: packed.redirectCount,
    sizeBytes: packed.bytes.byteLength,
    estimatedMediaBytes: packed.estimatedMediaBytes,
    selection: packed.selection,
  });

  saveSiteExport(projectPath, record, packed.bytes);

  return {
    export: record,
    estimatedMediaBytes: packed.estimatedMediaBytes,
  };
}

export function listSiteExports(
  projectPath: string,
): SiteExportListPayload {
  cleanupExpiredSiteExports(projectPath);
  return { exports: listStoredExports(projectPath) };
}

export function deleteSiteExport(
  projectPath: string,
  input: { id: string },
): { deleted: boolean } {
  const parsed = DeleteSiteExportInputSchema.parse(input);
  const deleted = deleteStoredExport(projectPath, parsed.id);
  return { deleted };
}

export function revealSiteExport(
  projectPath: string,
  input: { id: string },
): { path: string } {
  const parsed = DeleteSiteExportInputSchema.parse(input);
  return revealStoredExport(projectPath, parsed.id);
}

/** Inventory for export UI section counts. */
export async function inventorySiteExport(
  projectPath: string,
): Promise<SiteExportInventory> {
  const { getSiteExportInventory } = await import("./packProject");
  return getSiteExportInventory(projectPath);
}
