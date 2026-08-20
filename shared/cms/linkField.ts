import { z } from "zod";
import { buildCmsEntryPublicPath } from "./publicPaths";
import { validateCmsUrlPattern } from "./routing";

export const CmsLinkFieldTypeSchema = z.enum([
  "page",
  "entry",
  "external",
  "email",
  "phone",
  "internal",
]);
export type CmsLinkFieldType = z.infer<typeof CmsLinkFieldTypeSchema>;

export const CmsLinkFieldValueSchema = z
  .object({
    type: CmsLinkFieldTypeSchema,
    url: z.string().trim().optional(),
    pageId: z.string().trim().optional(),
    entryId: z.string().trim().optional(),
    collectionId: z.string().trim().optional(),
    slug: z.string().trim().optional(),
    label: z.string().trim().optional(),
    openInNewTab: z.boolean().optional(),
  })
  .strict();
export type CmsLinkFieldValue = z.infer<typeof CmsLinkFieldValueSchema>;

export const ResolveCmsLinkOptionsSchema = z
  .object({
    preview: z.boolean().default(false),
  })
  .strict();
export type ResolveCmsLinkOptions = z.infer<typeof ResolveCmsLinkOptionsSchema>;

export const ResolvedCmsLinkSchema = z
  .object({
    href: z.string().trim().min(1),
    label: z.string().trim().optional(),
    openInNewTab: z.boolean().optional(),
  })
  .strict();
export type ResolvedCmsLink = z.infer<typeof ResolvedCmsLinkSchema>;

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeExternalUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function buildPageHref(slug: string): string {
  return slug === "index" ? "/" : `/${slug}`;
}

function withPreviewQuery(href: string, preview: boolean): string {
  if (!preview) {
    return href;
  }

  const url = new URL(href, "https://aria.local");
  url.searchParams.set("preview", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function parseCmsLinkFieldValue(value: unknown): CmsLinkFieldValue | null {
  const parsed = CmsLinkFieldValueSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Resolve a link value without a storage adapter.
 * Page/entry refs resolve from embedded slug/url fields only.
 */
export function resolveCmsLinkValueSync(
  value: unknown,
  options: ResolveCmsLinkOptions = ResolveCmsLinkOptionsSchema.parse({}),
  context: {
    entryUrlPattern?: string | null;
  } = {},
): ResolvedCmsLink | null {
  const link = parseCmsLinkFieldValue(value);
  if (!link) {
    return null;
  }

  const parsedOptions = ResolveCmsLinkOptionsSchema.parse(options);
  const common = {
    ...(optionalTrimmed(link.label) ? { label: optionalTrimmed(link.label) } : {}),
    ...(link.openInNewTab ? { openInNewTab: true } : {}),
  };

  switch (link.type) {
    case "internal": {
      const url = optionalTrimmed(link.url);
      if (!url) return null;
      return ResolvedCmsLinkSchema.parse({ href: url, ...common });
    }
    case "page": {
      const slug = optionalTrimmed(link.slug);
      const directUrl = optionalTrimmed(link.url);
      if (slug) {
        return ResolvedCmsLinkSchema.parse({
          href: withPreviewQuery(buildPageHref(slug), parsedOptions.preview),
          ...common,
        });
      }
      if (directUrl) {
        const href =
          directUrl.startsWith("/") || directUrl.startsWith("#")
            ? directUrl
            : normalizeExternalUrl(directUrl);
        return ResolvedCmsLinkSchema.parse({
          href: withPreviewQuery(href, parsedOptions.preview),
          ...common,
        });
      }
      return null;
    }
    case "entry": {
      const entrySlug = optionalTrimmed(link.slug);
      const urlPattern = context.entryUrlPattern ?? null;
      if (!entrySlug || !urlPattern) return null;
      if (!validateCmsUrlPattern(urlPattern).valid) return null;
      const pathname = buildCmsEntryPublicPath(urlPattern, entrySlug);
      if (!pathname) return null;
      return ResolvedCmsLinkSchema.parse({
        href: withPreviewQuery(pathname, parsedOptions.preview),
        ...common,
      });
    }
    case "email": {
      const raw = optionalTrimmed(link.url);
      if (!raw) return null;
      const href = raw.startsWith("mailto:") ? raw : `mailto:${raw}`;
      return ResolvedCmsLinkSchema.parse({ href, ...common });
    }
    case "phone": {
      const raw = optionalTrimmed(link.url);
      if (!raw) return null;
      const href = raw.startsWith("tel:") ? raw : `tel:${raw}`;
      return ResolvedCmsLinkSchema.parse({ href, ...common });
    }
    case "external":
    default: {
      const href = normalizeExternalUrl(link.url ?? "");
      if (!href) return null;
      return ResolvedCmsLinkSchema.parse({ href, ...common });
    }
  }
}

export function resolveCmsLinkHrefSync(
  value: unknown,
  options?: ResolveCmsLinkOptions,
  context?: { entryUrlPattern?: string | null },
): string | null {
  return resolveCmsLinkValueSync(value, options, context)?.href ?? null;
}
