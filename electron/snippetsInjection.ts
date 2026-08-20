import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { compileAnalyticsScripts } from "../shared/analytics";
import {
  compileSnippetSlots,
  type SnippetSlots,
} from "../shared/snippets";
import type { AnalyticsSettings, CodeSnippet, SiteSettings } from "../shared/types";
import { buildCmsEntryPublicPath } from "../shared/cms";
import { localeUrlPrefix } from "../shared/localization";
import { readCollections } from "./collections";
import { listEntries } from "./cms/store";
import { syncMotionArtifacts } from "./composer/motionAssets";
import { omitSourceBackedInjections } from "./injectionDedupe";
import { scanInjectionSources } from "./injectionSourceScan";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";

/** Bump when middleware semantics change — triggers overwrite of the stable file. */
export const SNIPPETS_MIDDLEWARE_VERSION = 6;

const ARIA_DIR_REL = path.join("src", "aria");
const GENERATED_REL = path.join(ARIA_DIR_REL, "snippets.generated.ts");
const LOCALIZATION_GENERATED_REL = path.join(ARIA_DIR_REL, "localization.generated.ts");
const MIDDLEWARE_REL = path.join(ARIA_DIR_REL, "snippets-middleware.ts");

const VERSION_MARKER = `@aria-snippets-middleware v${SNIPPETS_MIDDLEWARE_VERSION}`;

function projectFile(root: string, relativePosixOrNative: string): string {
  return resolveWithinRoot(
    root,
    path.join(root, ...relativePosixOrNative.split(/[/\\]/).filter(Boolean)),
    { allowMissing: true, rejectFinalSymlink: true },
  );
}

function joinSlotParts(...parts: string[]): string {
  return parts.filter(Boolean).join("\n");
}

/**
 * Merge snippet + analytics HTML.
 * Order matches aria-demo render: snippets then analytics in head/bodyStart;
 * analytics then snippets in footer/bodyEnd.
 */
export function mergeInjectionSlots(
  snippets: CodeSnippet[] | null | undefined,
  analytics: AnalyticsSettings | null | undefined,
): SnippetSlots {
  const snippetSlots = compileSnippetSlots(snippets ?? undefined);
  const compiled = compileAnalyticsScripts(analytics);
  return {
    header: joinSlotParts(snippetSlots.header, compiled.headHTML),
    body: joinSlotParts(snippetSlots.body, compiled.bodyStartHTML),
    footer: joinSlotParts(compiled.bodyEndHTML, snippetSlots.footer),
  };
}

function buildGeneratedSource(
  slots: SnippetSlots,
): string {
  return [
    "/**",
    " * Aria-generated snippet + analytics slots — do not edit.",
    " * Regenerated when site snippets or analytics are saved.",
    " */",
    "export const ariaSnippetSlots = {",
    `  header: ${JSON.stringify(slots.header)},`,
    `  body: ${JSON.stringify(slots.body)},`,
    `  footer: ${JSON.stringify(slots.footer)},`,
    "} as const;",
    "",
  ].join("\n");
}

function localizationRuntimeData(
  root: string,
  localization?: SiteSettings["localization"],
  siteUrl = "",
) {
  const content = localization?.content;
  const locales = content?.locales.filter((locale) => locale.enabled).map((locale) => ({
    code: locale.code,
    direction: locale.direction,
    prefix: locale.pathPrefix || locale.code,
  })) ?? [{ code: "en", direction: "ltr", prefix: "en" }];
  const defaultLocale = content?.defaultLocale ?? "en";
  const resolver = content?.resolver ?? { kind: "path-prefix" as const };
  const routeGroups: Record<string, Array<{ code: string; pathname: string }>> = {};

  for (const collection of readCollections(root).collections) {
    const pattern = collection.urlPattern?.trim();
    if (!pattern) continue;
    for (const record of listEntries(root, collection.id)) {
      if (record.entry.status !== "published") continue;
      const source = record.locales.find((locale) => locale.isSource) ?? record.locales[0];
      if (!source) continue;
      const variants = record.locales.flatMap((locale) => {
        const published = locale.isSource
          ? record.entry.status === "published"
          : locale.status === "published";
        if (!published || !locales.some((configured) => configured.code === locale.locale)) return [];
        const base = buildCmsEntryPublicPath(pattern, locale.slug);
        if (!base) return [];
        const pathname = resolver.kind === "query-param"
          ? (() => {
              const target = new URL(base, "https://aria.local");
              target.searchParams.set(resolver.parameter, locale.locale);
              return `${target.pathname}${target.search}`;
            })()
          : locale.locale === defaultLocale
            ? base
            : `/${localeUrlPrefix(content!, locale.locale)}/${base.replace(/^\//, "")}`;
        return [{ code: locale.locale, pathname }];
      });
      if (resolver.kind === "query-param") {
        for (const variant of variants) {
          const routeKey = new URL(variant.pathname, "https://aria.local").pathname;
          routeGroups[routeKey] = variants;
        }
      } else {
        for (const variant of variants) routeGroups[variant.pathname] = variants;
      }
    }
  }
  return { siteUrl, defaultLocale, resolver, locales, routes: routeGroups };
}

export function syncLocalizationManifest(
  projectPath: string,
  localization?: SiteSettings["localization"],
  siteUrl = "",
): void {
  const root = canonicalDirectory(projectPath);
  const target = projectFile(root, LOCALIZATION_GENERATED_REL);
  mkdirSync(path.dirname(target), { recursive: true });
  writeTextFileAtomic(
    target,
    `/** Aria-generated published localization manifest — do not edit. */\nexport const ariaLocalization = ${JSON.stringify(localizationRuntimeData(root, localization, siteUrl), null, 2)} as const;\n`,
  );
}

function buildMiddlewareSource(): string {
  return [
    `/** ${VERSION_MARKER} */`,
    `import { defineMiddleware } from "astro:middleware";`,
    `import { ariaSnippetSlots } from "./snippets.generated";`,
    `import { ariaLocalization } from "./localization.generated";`,
    `import { ariaMotionSlots } from "./motion.generated";`,
    ``,
    `function injectSnippetHtml(`,
    `  html: string,`,
    `  slots: { header: string; body: string; footer: string },`,
    `): string {`,
    `  const merged = {`,
    `    header: [slots.header, ariaMotionSlots.header].filter(Boolean).join("\\n"),`,
    `    body: slots.body,`,
    `    footer: [slots.footer, ariaMotionSlots.footer].filter(Boolean).join("\\n"),`,
    `  };`,
    `  let out = html;`,
    `  if (merged.header) {`,
    `    const headClose = out.search(/<\\/head>/i);`,
    `    if (headClose >= 0) {`,
    `      out = out.slice(0, headClose) + \`\${merged.header}\\n\` + out.slice(headClose);`,
    `    }`,
    `  }`,
    `  if (merged.body) {`,
    `    const bodyOpen = out.match(/<body\\b[^>]*>/i);`,
    `    if (bodyOpen && bodyOpen.index !== undefined) {`,
    `      const insertAt = bodyOpen.index + bodyOpen[0].length;`,
    `      out = out.slice(0, insertAt) + \`\\n\${merged.body}\` + out.slice(insertAt);`,
    `    }`,
    `  }`,
    `  if (merged.footer) {`,
    `    const bodyClose = out.search(/<\\/body>/i);`,
    `    if (bodyClose >= 0) {`,
    `      out = out.slice(0, bodyClose) + \`\${merged.footer}\\n\` + out.slice(bodyClose);`,
    `    }`,
    `  }`,
    `  return out;`,
    `}`,
    ``,
    `function resolveContentLocale(url: URL) {`,
    `  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";`,
    `  const requested = ariaLocalization.resolver.kind === "query-param"`,
    `    ? url.searchParams.get(ariaLocalization.resolver.parameter)`,
    `    : first;`,
    `  return ariaLocalization.locales.find((locale) => locale.code === requested || locale.prefix === requested)`,
    `    ?? ariaLocalization.locales.find((locale) => locale.code === ariaLocalization.defaultLocale)`,
    `    ?? ariaLocalization.locales[0];`,
    `}`,
    ``,
    `function injectLocalizationHtml(html: string, url: URL, active: NonNullable<ReturnType<typeof resolveContentLocale>>): string {`,
    `  const pathname = url.pathname;`,
    `  let out = html.replace(/<html\\b([^>]*)>/i, (_match, attrs: string) => {`,
    `    const clean = attrs.replace(/\\s(?:lang|dir)=(?:"[^"]*"|'[^']*')/gi, "");`,
    `    return \`<html\${clean} lang="\${active.code}" dir="\${active.direction}">\`;`,
    `  });`,
    `  const routeKey = pathname.length > 1 ? pathname.replace(/\\/$/, "") : pathname;`,
    `  const publishedVariants = ariaLocalization.routes[routeKey as keyof typeof ariaLocalization.routes] ?? [];`,
    `  const alternates = publishedVariants.map((variant) => {`,
    `    const target = new URL(variant.pathname, ariaLocalization.siteUrl || url.origin);`,
    `    if (ariaLocalization.resolver.kind === "query-param") {`,
    `      for (const [key, value] of url.searchParams) {`,
    `        if (key !== ariaLocalization.resolver.parameter && !target.searchParams.has(key)) target.searchParams.append(key, value);`,
    `      }`,
    `    }`,
    `    const href = ariaLocalization.siteUrl ? target.toString() : target.pathname + target.search + target.hash;`,
    `    return \`<link rel="alternate" hreflang="\${variant.code}" href="\${href}">\`;`,
    `  }).join("\\n");`,
    `  return alternates ? out.replace(/<\\/head>/i, \`\${alternates}\\n</head>\`) : out;`,
    `}`,
    ``,
    `function isAriaManagedPath(pathname: string): boolean {`,
    `  const normalized = (pathname.trim() || "/").replace(/\\/+$/, "") || "/";`,
    `  return normalized === "/aria-preview" || normalized.startsWith("/aria-preview/") || normalized === "/__aria" || normalized.startsWith("/__aria/");`,
    `}`,
    ``,
    `export const onRequest = defineMiddleware(async (context, next) => {`,
    `  const pathname = context.url.pathname;`,
    `  if (isAriaManagedPath(pathname)) {`,
    `    return next();`,
    `  }`,
    ``,
    `  const response = await next();`,
    `  const contentType = response.headers.get("content-type") ?? "";`,
    `  if (!contentType.includes("text/html")) return response;`,
    ``,
    `  const slots = ariaSnippetSlots;`,
    `  const html = await response.text();`,
    `  const locale = resolveContentLocale(context.url);`,
    `  const snippetHtml = injectSnippetHtml(html, slots);`,
    `  const nextHtml = locale ? injectLocalizationHtml(snippetHtml, context.url, locale) : snippetHtml;`,
    ``,
    `  const headers = new Headers(response.headers);`,
    `  headers.delete("content-length");`,
    `  if (locale) headers.set("Content-Language", locale.code);`,
    `  return new Response(nextHtml, {`,
    `    status: response.status,`,
    `    statusText: response.statusText,`,
    `    headers,`,
    `  });`,
    `});`,
    ``,
  ].join("\n");
}

function ensureMiddlewareModule(root: string): void {
  const target = projectFile(root, MIDDLEWARE_REL);
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) {
    const current = readFileSync(target, "utf8");
    if (current.includes(VERSION_MARKER)) return;
  }
  writeTextFileAtomic(target, buildMiddlewareSource());
}

function writeGeneratedSlots(
  root: string,
  slots: SnippetSlots,
): void {
  const target = projectFile(root, GENERATED_REL);
  mkdirSync(path.dirname(target), { recursive: true });
  writeTextFileAtomic(target, buildGeneratedSource(slots));
}

/**
 * Bake enabled snippets + analytics into the Astro project (module + generated slots).
 * Root `src/middleware.ts` sequencing is owned solely by `unifyAriaMiddleware`.
 */
export function syncSnippetsInjection(
  projectPath: string,
  snippets?: CodeSnippet[] | null,
  analytics?: AnalyticsSettings | null,
  localization?: SiteSettings["localization"],
  siteUrl = "",
): void {
  const root = canonicalDirectory(projectPath);
  syncMotionArtifacts(root);
  let nextSnippets = snippets;
  let nextAnalytics = analytics;
  try {
    const omitted = omitSourceBackedInjections(
      snippets,
      analytics,
      scanInjectionSources(root),
    );
    nextSnippets = omitted.snippets;
    nextAnalytics = omitted.analytics;
  } catch {
    // A missing or unreadable src tree must not block middleware bake.
  }
  const slots = mergeInjectionSlots(nextSnippets, nextAnalytics);
  writeGeneratedSlots(root, slots);
  syncLocalizationManifest(root, localization, siteUrl);
  ensureMiddlewareModule(root);
}
