import { z } from "zod";
import type { DiscoverySettings as DiscoverySettingsType } from "../types";

export const DISCOVERY_SITEMAP_CUSTOM_MAX_BYTES = 1_048_576;
export const DISCOVERY_ROBOTS_CUSTOM_MAX_BYTES = 65_536;
export const DISCOVERY_LLMS_CUSTOM_MAX_BYTES = 65_536;

export const DiscoverySitemapModeSchema = z.enum(["auto", "custom", "off"]);
export type DiscoverySitemapMode = z.infer<typeof DiscoverySitemapModeSchema>;

export const DiscoveryRobotsModeSchema = z.enum(["auto", "custom"]);
export type DiscoveryRobotsMode = z.infer<typeof DiscoveryRobotsModeSchema>;

export const DiscoveryLlmsModeSchema = z.enum(["auto", "custom", "off"]);
export type DiscoveryLlmsMode = z.infer<typeof DiscoveryLlmsModeSchema>;

export const TrailingSlashPolicySchema = z.enum(["strip", "add", "none"]);
export type TrailingSlashPolicy = z.infer<typeof TrailingSlashPolicySchema>;

export const PageSeoForDiscoverySchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    canonical: z.string().optional(),
    noindex: z.boolean().optional(),
    nofollow: z.boolean().optional(),
    ogTitle: z.string().optional(),
    ogDescription: z.string().optional(),
    ogImage: z.string().optional(),
    ogType: z.string().optional(),
    twitterCard: z
      .enum(["summary", "summary_large_image", "app", "player"])
      .optional(),
    twitterSite: z.string().optional(),
    twitterCreator: z.string().optional(),
    structuredData: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .optional();

export const PageForDiscoverySchema = z
  .object({
    id: z.string().min(1),
    slug: z.string(),
    parent: z.string().nullable().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(["draft", "published", "archived"]),
    systemRole: z.enum([
      "standard",
      "not-found",
      "cms-collection",
      "cms-entry",
    ]),
    accessMode: z.enum(["public", "unlisted", "password", "private"]),
    updatedAt: z.string().optional(),
    publishedAt: z.string().nullable().optional(),
    settings: z
      .object({
        seo: PageSeoForDiscoverySchema,
      })
      .passthrough()
      .optional(),
  })
  .strict();

export type PageForDiscovery = z.infer<typeof PageForDiscoverySchema>;

export const LocalizedPageForDiscoverySchema = z
  .object({
    pageId: z.string().min(1),
    locale: z.string().min(2),
    pathname: z.string().startsWith("/"),
    publishedAt: z.string(),
    noindex: z.boolean(),
  })
  .strict();
export type LocalizedPageForDiscovery = z.infer<
  typeof LocalizedPageForDiscoverySchema
>;

export const DiscoverableCmsEntrySchema = z
  .object({
    collectionId: z.string().trim().min(1),
    entryId: z.string().trim().min(1),
    locale: z.string().trim().min(1).optional(),
    slug: z.string().trim().min(1),
    pathname: z.string().trim().min(1),
    updatedAt: z.string().optional(),
    publishedAt: z.string().nullable().optional(),
  })
  .strict();

export type DiscoverableCmsEntry = z.infer<typeof DiscoverableCmsEntrySchema>;

export function parsePageForDiscovery(input: unknown): PageForDiscovery {
  return PageForDiscoverySchema.parse(input);
}

export function parseDiscoverableCmsEntry(input: unknown): DiscoverableCmsEntry {
  return DiscoverableCmsEntrySchema.parse(input);
}

export const ExclusionReasonSchema = z.enum([
  "included",
  "draft",
  "archived",
  "not-found",
  "cms-entry",
  "password",
  "private",
  "unlisted",
  "noindex",
]);

export type ExclusionReason = z.infer<typeof ExclusionReasonSchema>;

export const DiscoverySettingsSchema = z
  .object({
    sitemapMode: DiscoverySitemapModeSchema.default("auto"),
    sitemapCustom: z.string().max(DISCOVERY_SITEMAP_CUSTOM_MAX_BYTES).optional(),
    robotsMode: DiscoveryRobotsModeSchema.default("auto"),
    robotsCustom: z.string().max(DISCOVERY_ROBOTS_CUSTOM_MAX_BYTES).optional(),
    includeSitemapInRobots: z.boolean().default(true),
    llmsMode: DiscoveryLlmsModeSchema.default("auto"),
    llmsCustom: z.string().max(DISCOVERY_LLMS_CUSTOM_MAX_BYTES).optional(),
    discourageSearchEngines: z.boolean().default(false),
    googleSiteVerification: z.string().max(256).optional(),
    bingSiteVerification: z.string().max(256).optional(),
    trailingSlashPolicy: TrailingSlashPolicySchema.default("strip"),
    sitemapPingOnPublish: z.boolean().default(false),
    llmsAiPolicy: z.string().max(4096).optional(),
    aiBotPolicy: z.enum(["allow-all", "block-training", "custom"]).optional(),
  })
  .strict();

export type DiscoverySettings = z.infer<typeof DiscoverySettingsSchema>;

export function parseDiscoverySettings(input: unknown): DiscoverySettings {
  return DiscoverySettingsSchema.parse(input);
}

export function mergeDiscoverySettings(
  current: DiscoverySettings | DiscoverySettingsType | undefined,
  patch: Partial<DiscoverySettings>,
): DiscoverySettings {
  const base = DiscoverySettingsSchema.parse(current ?? {});
  return DiscoverySettingsSchema.parse({ ...base, ...patch });
}

export const DEFAULT_DISCOVERY_SETTINGS: DiscoverySettings =
  DiscoverySettingsSchema.parse({});

export const DiscoveryArtifactsSchema = z
  .object({
    robots: z.string(),
    sitemap: z.string().nullable(),
    llms: z.string().nullable(),
    generatedAt: z.string(),
  })
  .strict();

export type DiscoveryArtifacts = z.infer<typeof DiscoveryArtifactsSchema>;

export const DiscoveryGeneratedBaselineSchema = z
  .object({
    artifact: z.enum(["robots", "sitemap", "llms"]),
    content: z.string().nullable(),
    generatedAt: z.string(),
  })
  .strict();

export type DiscoveryGeneratedBaseline = z.infer<
  typeof DiscoveryGeneratedBaselineSchema
>;

export const DiscoveryReportRowSchema = z
  .object({
    pageId: z.string().min(1),
    slug: z.string(),
    title: z.string(),
    publicPath: z.string(),
    absoluteUrl: z.string().optional(),
    inSitemap: z.boolean(),
    inLlms: z.boolean(),
    canonicalOk: z.boolean(),
    exclusionReason: ExclusionReasonSchema,
    hasActiveRedirect: z.boolean().optional(),
  })
  .strict();

export type DiscoveryReportRow = z.infer<typeof DiscoveryReportRowSchema>;

export const SiteSeoAuditSchema = z
  .object({
    id: z.string().min(1),
    severity: z.enum(["warning", "error"]),
    message: z.string().min(1),
    pageIds: z.array(z.string()).optional(),
  })
  .strict();

export type SiteSeoAudit = z.infer<typeof SiteSeoAuditSchema>;

export const SiteHealthCheckSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    status: z.enum(["pass", "warning", "error"]),
    message: z.string().optional(),
  })
  .strict();

export type SiteHealthCheck = z.infer<typeof SiteHealthCheckSchema>;

export const SiteHealthSummarySchema = z
  .object({
    score: z.number().int().min(0).max(100),
    checks: z.array(SiteHealthCheckSchema),
  })
  .strict();

export type SiteHealthSummary = z.infer<typeof SiteHealthSummarySchema>;

export const DiscoveryReportSchema = z
  .object({
    generatedAt: z.string(),
    siteUrl: z.string().optional(),
    discoverySettings: DiscoverySettingsSchema,
    rows: z.array(DiscoveryReportRowSchema),
    audits: z.array(SiteSeoAuditSchema),
    health: SiteHealthSummarySchema,
  })
  .strict();

export type DiscoveryReport = z.infer<typeof DiscoveryReportSchema>;

export function parseDiscoveryReport(input: unknown): DiscoveryReport {
  return DiscoveryReportSchema.parse(input);
}
