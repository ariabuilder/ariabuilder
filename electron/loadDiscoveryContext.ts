import type { SiteSettings } from "../shared/types";
import {
  parseDiscoverableCmsEntry,
  parsePageForDiscovery,
  type DiscoverableCmsEntry,
  type PageForDiscovery,
} from "../shared/crawl";
import { buildCmsEntryPublicPath } from "../shared/cms";
import { localeUrlPrefix } from "../shared/localization";
import { readCollections } from "./collections";
import * as cmsStore from "./cms/store";
import { readPagesMeta } from "./pagesMeta";
import { scanProject } from "./workspace";

/**
 * Load discovery context from the open Astro project (file scan + pages-meta).
 * Adapts Electron page inventory into the shared crawl `PageForDiscovery` shape.
 */
export async function loadDiscoveryContext(
  projectPath: string,
  siteSettings: SiteSettings,
): Promise<{
  siteSettings: SiteSettings;
  pages: PageForDiscovery[];
  cmsEntries: DiscoverableCmsEntry[];
}> {
  const pagesMeta = readPagesMeta(projectPath);
  const scan = await scanProject(projectPath);

  const pages: PageForDiscovery[] = scan.pages.map((page) => {
    const meta = pagesMeta.pages[page.file];
    const role = meta?.role ?? page.role ?? "standard";
    const systemRole =
      role === "not-found" ||
      role === "cms-collection" ||
      role === "cms-entry"
        ? role
        : "standard";

    return parsePageForDiscovery({
      id: page.file,
      slug: page.route || "/",
      parent: null,
      title: meta?.title ?? page.title,
      description: meta?.description,
      status: "published",
      systemRole,
      accessMode: "public",
      updatedAt: new Date(page.mtimeMs).toISOString(),
      publishedAt: new Date(page.mtimeMs).toISOString(),
      settings: meta?.seo ? { seo: meta.seo } : undefined,
    });
  });

  const cmsEntries = loadDiscoverableCmsEntries(projectPath, siteSettings);

  return { siteSettings, pages, cmsEntries };
}

function pickSourceLocale(record: {
  locales: readonly {
    locale: string;
    slug: string;
    isSource?: boolean;
  }[];
}): { locale: string; slug: string } | null {
  const source =
    record.locales.find((item) => item.isSource) ?? record.locales[0];
  if (!source?.slug?.trim()) return null;
  return { locale: source.locale, slug: source.slug.trim() };
}

/** Published CMS entries with a resolvable public pathname from collection urlPattern. */
function loadDiscoverableCmsEntries(
  projectPath: string,
  siteSettings: SiteSettings,
): DiscoverableCmsEntry[] {
  const { collections } = readCollections(projectPath);
  const out: DiscoverableCmsEntry[] = [];

  for (const collection of collections) {
    const pattern = collection.urlPattern?.trim();
    if (!pattern) continue;

    for (const record of cmsStore.listEntries(projectPath, collection.id)) {
      if (record.entry.status !== "published") continue;
      const source = pickSourceLocale(record);
      if (!source) continue;
      const localization = siteSettings.localization?.content;
      for (const locale of record.locales) {
        const isSource = locale.locale === source.locale;
        const isPublished = isSource
          ? record.entry.status === "published"
          : locale.status === "published";
        if (!isPublished) continue;
        const basePath = buildCmsEntryPublicPath(pattern, locale.slug);
        if (!basePath) continue;
        const pathname = !localization || locale.locale === localization.defaultLocale
          ? basePath
          : `/${localeUrlPrefix(localization, locale.locale)}/${basePath.replace(/^\//, "")}`;
        out.push(parseDiscoverableCmsEntry({
          collectionId: collection.id,
          entryId: record.entry.id,
          locale: locale.locale,
          slug: locale.slug,
          pathname,
          updatedAt: record.entry.updatedAt,
          publishedAt: isSource ? record.entry.publishedAt : locale.publishedAt ?? null,
        }));
      }
    }
  }

  return out;
}
