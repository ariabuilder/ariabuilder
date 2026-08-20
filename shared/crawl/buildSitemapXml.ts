import type { SiteSettings } from "../types";
import { isPageDiscoverable } from "./discoverability";
import { normalizeBaseUrl } from "./normalizeBaseUrl";
import { isPageSelfCanonical, resolvePageAbsoluteUrl } from "./resolvePageLoc";
import {
  DiscoverySettingsSchema,
  type DiscoverableCmsEntry,
  type DiscoverySettings,
  type PageForDiscovery,
} from "./schemas";
import { validateSitemapCustom } from "./validateCustomArtifacts";
import { escapeXml } from "./xml";

function resolveDiscoverySettings(
  siteSettings: SiteSettings | null | undefined,
): DiscoverySettings {
  return DiscoverySettingsSchema.parse(siteSettings?.discovery ?? {});
}

function formatLastModValue(raw: string | null | undefined): string {
  if (typeof raw === "string" && raw.length > 0) {
    return new Date(raw).toISOString();
  }
  return new Date().toISOString();
}

function formatLastMod(page: PageForDiscovery): string {
  return formatLastModValue(page.publishedAt ?? page.updatedAt);
}

function formatCmsEntryLastMod(entry: DiscoverableCmsEntry): string {
  return formatLastModValue(entry.publishedAt ?? entry.updatedAt);
}

function joinBaseUrl(baseUrl: string, pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${baseUrl.replace(/\/+$/, "")}${normalizedPath}`;
}

type SitemapUrlEntry = {
  loc: string;
  lastmod: string;
};

function buildSitemapUrlEntries(input: {
  baseUrl: string;
  pages: readonly PageForDiscovery[];
  cmsEntries?: readonly DiscoverableCmsEntry[];
  allPages: readonly PageForDiscovery[];
  siteSettings: SiteSettings | null | undefined;
}): SitemapUrlEntry[] {
  const pageUrls = input.pages.flatMap((page) => {
    if (
      !isPageSelfCanonical({
        siteUrl: input.baseUrl,
        page,
      })
    ) {
      return [];
    }
    const loc =
      resolvePageAbsoluteUrl({
        siteUrl: input.baseUrl,
        page,
        siteSettings: input.siteSettings,
      }) ?? input.baseUrl;
    return [{ loc, lastmod: formatLastMod(page) }];
  });

  const cmsUrls = (input.cmsEntries ?? []).map((entry) => ({
    loc: joinBaseUrl(input.baseUrl, entry.pathname),
    lastmod: formatCmsEntryLastMod(entry),
  }));

  return [...pageUrls, ...cmsUrls];
}

export const MAX_URLS_PER_SITEMAP = 50_000;

export function buildSitemapXml(input: {
  siteSettings: SiteSettings | null | undefined;
  pages: readonly PageForDiscovery[];
  cmsEntries?: readonly DiscoverableCmsEntry[];
}): string | null {
  const discovery = resolveDiscoverySettings(input.siteSettings);
  const baseUrl = normalizeBaseUrl(input.siteSettings?.siteUrl);

  if (discovery.discourageSearchEngines || discovery.sitemapMode === "off") {
    return null;
  }

  if (discovery.sitemapMode === "custom" && discovery.sitemapCustom?.trim()) {
    const custom = discovery.sitemapCustom.trim();
    if (!baseUrl) return null;
    const validationErrors = validateSitemapCustom(custom, {
      siteUrl: baseUrl,
    });
    if (validationErrors.length > 0) return null;
    return custom;
  }

  if (!baseUrl) return null;

  const discoverablePages = input.pages.filter(isPageDiscoverable);
  const urlEntries = buildSitemapUrlEntries({
    baseUrl,
    pages: discoverablePages,
    cmsEntries: input.cmsEntries,
    allPages: input.pages,
    siteSettings: input.siteSettings,
  });

  if (urlEntries.length > MAX_URLS_PER_SITEMAP) {
    // Chunked sitemap index is not wired in Electron yet — emit a capped urlset
    // so crawlers get a valid single document instead of broken chunk links.
    return buildUrlsetXmlFromEntries(
      urlEntries.slice(0, MAX_URLS_PER_SITEMAP),
    );
  }

  return buildUrlsetXmlFromEntries(urlEntries);
}

function buildUrlsetXmlFromEntries(
  entries: readonly SitemapUrlEntry[],
): string {
  const urls = entries.map(
    (entry) =>
      `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>\n  </url>`,
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
