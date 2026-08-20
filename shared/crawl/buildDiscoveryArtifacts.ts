import type { SiteSettings } from "../types";
import { buildLlmsTxt } from "./buildLlmsTxt";
import { buildRobotsTxt } from "./buildRobotsTxt";
import { buildSitemapXml } from "./buildSitemapXml";
import {
  DiscoveryArtifactsSchema,
  type DiscoveryArtifacts,
  type DiscoverableCmsEntry,
  type PageForDiscovery,
} from "./schemas";

export function buildDiscoveryArtifacts(input: {
  siteSettings: SiteSettings | null | undefined;
  pages: readonly PageForDiscovery[];
  cmsEntries?: readonly DiscoverableCmsEntry[];
}): DiscoveryArtifacts {
  const generatedAt = new Date().toISOString();
  return DiscoveryArtifactsSchema.parse({
    robots: buildRobotsTxt({ siteSettings: input.siteSettings }),
    sitemap: buildSitemapXml({
      siteSettings: input.siteSettings,
      pages: input.pages,
      cmsEntries: input.cmsEntries,
    }),
    llms: buildLlmsTxt({
      siteSettings: input.siteSettings,
      pages: input.pages,
    }),
    generatedAt,
  });
}
