import { z } from "zod";
import {
  CmsExportOptionsSchema,
  SiteExportMediaModeSchema,
  SiteExportPresetSchema,
  SiteExportSectionSchema,
  SiteExportSelectionSchema,
} from "./cmsTypes";

/**
 * Desktop archive metadata for `.aria/exports/{id}/`.
 * Cloud R2 keys / multi-user ownership from aria-demo are omitted.
 */
export const SiteExportRecordSchema = z.object({
  id: z.string().uuid(),
  filename: z.string().min(1),
  /** Project-relative directory: `.aria/exports/{id}` */
  exportDir: z.string().min(1),
  /** Project-relative zip path under exportDir */
  artifactPath: z.string().min(1),
  /** Project-relative meta.json path under exportDir */
  metadataPath: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  pageCount: z.number().int().nonnegative(),
  layoutCount: z.number().int().nonnegative().default(0),
  componentCount: z.number().int().nonnegative().default(0),
  mediaCount: z.number().int().nonnegative(),
  cmsCollectionCount: z.number().int().nonnegative().default(0),
  cmsEntryCount: z.number().int().nonnegative().default(0),
  redirectCount: z.number().int().nonnegative().default(0),
  sizeBytes: z.number().int().nonnegative(),
  estimatedMediaBytes: z.number().int().nonnegative().default(0),
  selection: SiteExportSelectionSchema.optional(),
});

export type SiteExportRecord = z.infer<typeof SiteExportRecordSchema>;

export {
  CmsExportOptionsSchema,
  SiteExportMediaModeSchema,
  SiteExportPresetSchema,
  SiteExportSectionSchema,
  SiteExportSelectionSchema,
};

export type {
  CmsExportOptions,
  SiteExportMediaMode,
  SiteExportPreset,
  SiteExportSection,
  SiteExportSelection,
  SiteExportSelectionInput,
} from "./cmsTypes";

export const CreateSiteExportInputSchema = z.object({
  ttlMinutes: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(15),
  selection: SiteExportSelectionSchema.optional(),
});

export type CreateSiteExportInput = z.infer<typeof CreateSiteExportInputSchema>;

export const DeleteSiteExportInputSchema = z.object({
  id: z.string().uuid(),
});

export type DeleteSiteExportInput = z.infer<typeof DeleteSiteExportInputSchema>;

export const SiteExportActionPayloadSchema = z.object({
  export: SiteExportRecordSchema.nullable(),
  estimatedMediaBytes: z.number().int().nonnegative().optional(),
});

export type SiteExportActionPayload = z.infer<
  typeof SiteExportActionPayloadSchema
>;

export const SiteExportListPayloadSchema = z.object({
  exports: z.array(SiteExportRecordSchema),
});

export type SiteExportListPayload = z.infer<typeof SiteExportListPayloadSchema>;

export const SiteExportInventorySchema = z.object({
  pages: z.number().int().nonnegative(),
  layouts: z.number().int().nonnegative(),
  components: z.number().int().nonnegative(),
  media: z.number().int().nonnegative(),
  cmsCollections: z.number().int().nonnegative(),
  cmsEntries: z.number().int().nonnegative(),
  redirects: z.number().int().nonnegative(),
  estimatedMediaBytes: z.number().int().nonnegative(),
});

export type SiteExportInventory = z.infer<typeof SiteExportInventorySchema>;
