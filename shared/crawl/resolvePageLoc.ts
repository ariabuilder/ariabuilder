import type { SiteSettings } from "../types";
import { normalizeBaseUrl } from "./normalizeBaseUrl";
import type { PageForDiscovery } from "./schemas";

/** Public path for a page. Electron pages use route-as-slug (e.g. `/about`). */
export function resolvePagePublicPath(page: PageForDiscovery): string {
  const slug = page.slug?.trim() || "/";
  if (slug === "/" || slug === "index" || slug === "") return "/";
  return slug.startsWith("/") ? slug : `/${slug}`;
}

export function resolvePageSelfAbsoluteUrl(input: {
  siteUrl: string;
  page: PageForDiscovery;
}): string | undefined {
  const baseUrl = normalizeBaseUrl(input.siteUrl);
  if (!baseUrl) return undefined;
  const publicPath = resolvePagePublicPath(input.page);
  return publicPath === "/" ? `${baseUrl}/` : `${baseUrl}${publicPath}`;
}

export function isPageSelfCanonical(input: {
  siteUrl: string;
  page: PageForDiscovery;
}): boolean {
  const self = resolvePageSelfAbsoluteUrl(input);
  if (!self) return false;
  const configured = input.page.settings?.seo?.canonical?.trim();
  if (!configured) return true;
  try {
    return new URL(configured, input.siteUrl).toString() === self;
  } catch {
    return false;
  }
}

function pickFirstNonEmpty(
  ...values: Array<string | undefined | null>
): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function buildCanonicalFromSiteUrl(
  siteUrl: string | undefined,
  pathOrSlug: string | undefined,
): string | undefined {
  const normalizedBase = siteUrl?.trim().replace(/\/+$/, "");
  if (!normalizedBase) return undefined;
  const normalizedPath = pathOrSlug?.trim() || "/";
  if (normalizedPath === "/") return normalizedBase;
  const pathWithLeadingSlash = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;
  return `${normalizedBase}${pathWithLeadingSlash}`;
}

export function resolvePageAbsoluteUrl(input: {
  siteUrl: string;
  page: PageForDiscovery;
  siteSettings?: SiteSettings | null;
}): string | undefined {
  const baseUrl = normalizeBaseUrl(input.siteUrl);
  if (!baseUrl) return undefined;

  const publicPath = resolvePagePublicPath(input.page);
  const pageSeo = input.page.settings?.seo;
  const canonical = pickFirstNonEmpty(
    pageSeo?.canonical,
    buildCanonicalFromSiteUrl(input.siteSettings?.siteUrl ?? input.siteUrl, publicPath),
  );

  if (canonical) {
    try {
      return new URL(canonical, baseUrl).toString();
    } catch {
      return undefined;
    }
  }
  return resolvePageSelfAbsoluteUrl(input);
}

/** Resolve document metadata for SEO injection (site + page precedence). */
export function resolveSiteMetadata(params: {
  siteSettings?: SiteSettings | null;
  pageTitle?: string;
  pageDescription?: string;
  pageSeo?: {
    title?: string;
    description?: string;
    canonical?: string;
    noindex?: boolean;
    nofollow?: boolean;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    twitterCard?: string;
  };
  pathOrSlug?: string;
}): {
  title?: string;
  description?: string;
  canonical?: string;
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
  twitterCard?: string;
  noindex?: boolean;
  nofollow?: boolean;
  favicon?: string;
} {
  const siteSettings = params.siteSettings;
  const pageSeo = params.pageSeo ?? {};

  const title = pickFirstNonEmpty(
    pageSeo.title,
    params.pageTitle,
    siteSettings?.seoTitle,
    siteSettings?.siteName,
  );

  const description = pickFirstNonEmpty(
    pageSeo.description,
    params.pageDescription,
    siteSettings?.seoDescription,
    siteSettings?.siteDescription,
  );

  const canonical = pickFirstNonEmpty(
    pageSeo.canonical,
    buildCanonicalFromSiteUrl(siteSettings?.siteUrl, params.pathOrSlug),
  );

  const ogImage = pickFirstNonEmpty(pageSeo.ogImage, siteSettings?.ogImage);
  const ogTitle = pickFirstNonEmpty(pageSeo.ogTitle, title);
  const ogDescription = pickFirstNonEmpty(pageSeo.ogDescription, description);
  const twitterCard = pickFirstNonEmpty(
    pageSeo.twitterCard,
    siteSettings?.twitterCard,
  );

  return {
    title,
    description,
    canonical,
    ogImage,
    ogTitle,
    ogDescription,
    twitterCard,
    noindex: pageSeo.noindex,
    nofollow: pageSeo.nofollow,
    favicon: siteSettings?.favicon?.trim() || undefined,
  };
}
