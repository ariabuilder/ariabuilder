import { z } from "zod";

/**
 * Site export selection + CMS export option schemas.
 * Ported from aria-demo selection surface (not the full CMS archive serializers).
 */

export const CmsExportLocaleFilterSchema = z.union([
  z.literal("all"),
  z.literal("source"),
  z.array(z.string().trim().min(1)).min(1),
]);

export const CmsExportOptionsSchema = z
  .object({
    includeCollections: z.boolean().default(true),
    includeDrafts: z.boolean().default(false),
    locales: CmsExportLocaleFilterSchema.default("source"),
    renderBodiesToHtml: z.boolean().default(false),
    includeStructuredTextRenderer: z.boolean().default(true),
    includeMarkdown: z.boolean().default(true),
    includeMonolithicCmsJson: z.boolean().default(true),
    includeCanonicalJson: z.boolean().default(true),
    includeQueryLib: z.boolean().default(true),
    includeSeedManifest: z.boolean().default(true),
  })
  .strict();

export const SiteExportSectionSchema = z.enum([
  "pages",
  "layouts",
  "components",
  "designSystem",
  "siteSettings",
  "media",
  "cms",
  "redirects",
  "discovery",
  "contentState",
  "pageMetadata",
]);

export const SiteExportMediaModeSchema = z.enum([
  "bundle",
  "omit",
  "manifestOnly",
]);

export const SiteExportPresetSchema = z.enum([
  "full",
  "dataOnly",
  "codeOnly",
  "mediaOnly",
  "custom",
]);

export const SiteExportSectionsOverrideSchema = z
  .object({
    pages: z.boolean().optional(),
    layouts: z.boolean().optional(),
    components: z.boolean().optional(),
    designSystem: z.boolean().optional(),
    siteSettings: z.boolean().optional(),
    media: z.boolean().optional(),
    cms: z.boolean().optional(),
    redirects: z.boolean().optional(),
    discovery: z.boolean().optional(),
    contentState: z.boolean().optional(),
    pageMetadata: z.boolean().optional(),
  })
  .strict();

export const SiteExportSelectionSchema = z
  .object({
    preset: SiteExportPresetSchema.default("full"),
    sections: SiteExportSectionsOverrideSchema.optional(),
    mediaMode: SiteExportMediaModeSchema.default("bundle"),
    cms: CmsExportOptionsSchema.optional(),
  })
  .strict();

export type CmsExportOptions = z.infer<typeof CmsExportOptionsSchema>;
export type CmsExportLocaleFilter = z.infer<typeof CmsExportLocaleFilterSchema>;
export type SiteExportSection = z.infer<typeof SiteExportSectionSchema>;
export type SiteExportMediaMode = z.infer<typeof SiteExportMediaModeSchema>;
export type SiteExportPreset = z.infer<typeof SiteExportPresetSchema>;
export type SiteExportSelection = z.infer<typeof SiteExportSelectionSchema>;
export type SiteExportSelectionInput = z.input<typeof SiteExportSelectionSchema>;

export type ResolvedSiteExportSections = Record<SiteExportSection, boolean>;

export const SITE_EXPORT_SECTIONS = SiteExportSectionSchema.options;
