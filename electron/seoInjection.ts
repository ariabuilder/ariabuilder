import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SiteSettings, PageSeoMeta, PagesMetaState } from "../shared/types";
import { resolveSiteMetadata } from "../shared/crawl";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";
import { readPagesMeta } from "./pagesMeta";
import { scanProject } from "./workspace";

/** Bump when middleware semantics change — triggers overwrite of the stable file. */
export const SEO_MIDDLEWARE_VERSION = 2;

const ARIA_DIR_REL = path.join("src", "aria");
const GENERATED_REL = path.join(ARIA_DIR_REL, "seo.generated.ts");
const MIDDLEWARE_REL = path.join(ARIA_DIR_REL, "seo-middleware.ts");

export const SEO_VERSION_MARKER = `@aria-seo-middleware v${SEO_MIDDLEWARE_VERSION}`;
export const SEO_WIRED_MARKER = "aria/seo-middleware";

const MIDDLEWARE_CANDIDATES = [
  path.join("src", "middleware.ts"),
  path.join("src", "middleware.js"),
  path.join("src", "middleware.mjs"),
] as const;

export type SeoRouteMeta = {
  title?: string;
  description?: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  twitterCard?: string;
  noindex?: boolean;
  nofollow?: boolean;
  favicon?: string;
};

export type SeoGeneratedPayload = {
  siteDefaults: SeoRouteMeta;
  byRoute: Record<string, SeoRouteMeta>;
  verification: {
    google?: string;
    bing?: string;
  };
  discourageSearchEngines: boolean;
};

function projectFile(root: string, relativePosixOrNative: string): string {
  return resolveWithinRoot(
    root,
    path.join(root, ...relativePosixOrNative.split(/[/\\]/).filter(Boolean)),
    { allowMissing: true, rejectFinalSymlink: true },
  );
}

function buildRouteMeta(
  siteSettings: SiteSettings,
  route: string,
  pageTitle?: string,
  pageDescription?: string,
  pageSeo?: PageSeoMeta,
): SeoRouteMeta {
  return resolveSiteMetadata({
    siteSettings,
    pageTitle,
    pageDescription,
    pageSeo,
    pathOrSlug: route,
  });
}

export async function compileSeoPayload(
  projectPath: string,
  siteSettings: SiteSettings,
  pagesMeta?: PagesMetaState,
): Promise<SeoGeneratedPayload> {
  const root = canonicalDirectory(projectPath);
  const meta = pagesMeta ?? readPagesMeta(root);
  const scan = await scanProject(root);

  const byRoute: Record<string, SeoRouteMeta> = {};
  for (const page of scan.pages) {
    const record = meta.pages[page.file];
    byRoute[page.route || "/"] = buildRouteMeta(
      siteSettings,
      page.route || "/",
      record?.title ?? page.title,
      record?.description,
      record?.seo,
    );
  }

  const siteDefaults = buildRouteMeta(siteSettings, "/");

  return {
    siteDefaults,
    byRoute,
    verification: {
      google: siteSettings.discovery?.googleSiteVerification?.trim() || undefined,
      bing: siteSettings.discovery?.bingSiteVerification?.trim() || undefined,
    },
    discourageSearchEngines: Boolean(
      siteSettings.discovery?.discourageSearchEngines,
    ),
  };
}

function buildGeneratedSource(payload: SeoGeneratedPayload): string {
  return [
    "/**",
    " * Aria-generated SEO payload — do not edit.",
    " * Regenerated when site SEO or page meta is saved.",
    " */",
    `export const ariaSeoPayload = ${JSON.stringify(payload, null, 2)} as const;`,
    "",
  ].join("\n");
}

function buildMiddlewareSource(): string {
  return [
    `/** ${SEO_VERSION_MARKER} */`,
    `import { defineMiddleware } from "astro:middleware";`,
    `import { ariaSeoPayload } from "./seo.generated";`,
    ``,
    `type SeoMeta = {`,
    `  title?: string;`,
    `  description?: string;`,
    `  canonical?: string;`,
    `  ogTitle?: string;`,
    `  ogDescription?: string;`,
    `  ogImage?: string;`,
    `  twitterCard?: string;`,
    `  noindex?: boolean;`,
    `  nofollow?: boolean;`,
    `  favicon?: string;`,
    `};`,
    ``,
    `function escapeAttr(value: string): string {`,
    `  return value`,
    `    .replace(/&/g, "&amp;")`,
    `    .replace(/"/g, "&quot;")`,
    `    .replace(/</g, "&lt;")`,
    `    .replace(/>/g, "&gt;");`,
    `}`,
    ``,
    `function escapeText(value: string): string {`,
    `  return value`,
    `    .replace(/&/g, "&amp;")`,
    `    .replace(/</g, "&lt;")`,
    `    .replace(/>/g, "&gt;");`,
    `}`,
    ``,
    `function resolveMeta(pathname: string): SeoMeta {`,
    `  const byRoute = ariaSeoPayload.byRoute as Record<string, SeoMeta>;`,
    `  const exact = byRoute[pathname];`,
    `  if (exact) return { ...ariaSeoPayload.siteDefaults, ...exact };`,
    `  const trimmed = pathname.endsWith("/") && pathname.length > 1`,
    `    ? pathname.slice(0, -1)`,
    `    : pathname;`,
    `  const alt = byRoute[trimmed] ?? byRoute[\`\${trimmed}/\`] ;`,
    `  if (alt) return { ...ariaSeoPayload.siteDefaults, ...alt };`,
    `  return { ...ariaSeoPayload.siteDefaults };`,
    `}`,
    ``,
    `function stripCompetingHead(html: string): string {`,
    `  let out = html;`,
    `  out = out.replace(/<title\\b[^>]*>[\\s\\S]*?<\\/title>/gi, "");`,
    `  out = out.replace(/<meta\\b[^>]*\\bname\\s*=\\s*["']description["'][^>]*\\/?>/gi, "");`,
    `  out = out.replace(/<meta\\b[^>]*\\bproperty\\s*=\\s*["']og:[^"']+["'][^>]*\\/?>/gi, "");`,
    `  out = out.replace(/<meta\\b[^>]*\\bname\\s*=\\s*["']twitter:[^"']+["'][^>]*\\/?>/gi, "");`,
    `  out = out.replace(/<link\\b[^>]*\\brel\\s*=\\s*["']canonical["'][^>]*\\/?>/gi, "");`,
    `  out = out.replace(/<meta\\b[^>]*\\bname\\s*=\\s*["']robots["'][^>]*\\/?>/gi, "");`,
    `  out = out.replace(/<meta\\b[^>]*\\bname\\s*=\\s*["']google-site-verification["'][^>]*\\/?>/gi, "");`,
    `  out = out.replace(/<meta\\b[^>]*\\bname\\s*=\\s*["']msvalidate\\.01["'][^>]*\\/?>/gi, "");`,
    `  out = out.replace(/<link\\b[^>]*\\brel\\s*=\\s*["']icon["'][^>]*\\/?>/gi, "");`,
    `  return out;`,
    `}`,
    ``,
    `function buildHeadTags(meta: SeoMeta): string {`,
    `  const tags: string[] = [];`,
    `  tags.push("<!-- aria:seo-begin -->");`,
    `  if (meta.title) tags.push(\`<title>\${escapeText(meta.title)}</title>\`);`,
    `  if (meta.description) {`,
    `    tags.push(\`<meta name="description" content="\${escapeAttr(meta.description)}" />\`);`,
    `  }`,
    `  if (meta.canonical) {`,
    `    tags.push(\`<link rel="canonical" href="\${escapeAttr(meta.canonical)}" />\`);`,
    `  }`,
    `  const robotsParts: string[] = [];`,
    `  if (ariaSeoPayload.discourageSearchEngines || meta.noindex) robotsParts.push("noindex");`,
    `  if (ariaSeoPayload.discourageSearchEngines || meta.nofollow) robotsParts.push("nofollow");`,
    `  if (robotsParts.length) {`,
    `    tags.push(\`<meta name="robots" content="\${robotsParts.join(",")}" />\`);`,
    `  }`,
    `  const ogTitle = meta.ogTitle ?? meta.title;`,
    `  const ogDescription = meta.ogDescription ?? meta.description;`,
    `  if (ogTitle) tags.push(\`<meta property="og:title" content="\${escapeAttr(ogTitle)}" />\`);`,
    `  if (ogDescription) tags.push(\`<meta property="og:description" content="\${escapeAttr(ogDescription)}" />\`);`,
    `  if (meta.ogImage) tags.push(\`<meta property="og:image" content="\${escapeAttr(meta.ogImage)}" />\`);`,
    `  if (meta.twitterCard) {`,
    `    tags.push(\`<meta name="twitter:card" content="\${escapeAttr(meta.twitterCard)}" />\`);`,
    `  }`,
    `  const google = ariaSeoPayload.verification.google;`,
    `  if (google) {`,
    `    tags.push(\`<meta name="google-site-verification" content="\${escapeAttr(google)}" />\`);`,
    `  }`,
    `  const bing = ariaSeoPayload.verification.bing;`,
    `  if (bing) {`,
    `    tags.push(\`<meta name="msvalidate.01" content="\${escapeAttr(bing)}" />\`);`,
    `  }`,
    `  if (meta.favicon) {`,
    `    tags.push(\`<link rel="icon" href="\${escapeAttr(meta.favicon)}" />\`);`,
    `  }`,
    `  tags.push("<!-- aria:seo-end -->");`,
    `  return tags.join("\\n");`,
    `}`,
    ``,
    `function injectSeoHead(html: string, headHtml: string): string {`,
    `  const cleaned = stripCompetingHead(html);`,
    `  const withoutAria = cleaned.replace(`,
    `    /<!--\\s*aria:seo-begin\\s*-->[\\s\\S]*?<!--\\s*aria:seo-end\\s*-->\\n?/g,`,
    `    "",`,
    `  );`,
    `  const headClose = withoutAria.search(/<\\/head>/i);`,
    `  if (headClose < 0) return withoutAria;`,
    `  return withoutAria.slice(0, headClose) + headHtml + "\\n" + withoutAria.slice(headClose);`,
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
    `  const response = await next();`,
    `  const contentType = response.headers.get("content-type") ?? "";`,
    `  if (!contentType.includes("text/html")) return response;`,
    `  const meta = resolveMeta(pathname);`,
    `  const headHtml = buildHeadTags(meta);`,
    `  if (!headHtml.includes("<title>") && !headHtml.includes("meta")) {`,
    `    // Still strip competing tags when discourage is on`,
    `    if (!ariaSeoPayload.discourageSearchEngines) return response;`,
    `  }`,
    `  const html = await response.text();`,
    `  const nextHtml = injectSeoHead(html, headHtml);`,
    `  if (nextHtml === html) return new Response(html, response);`,
    `  const headers = new Headers(response.headers);`,
    `  headers.delete("content-length");`,
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
    if (current.includes(SEO_VERSION_MARKER)) return;
  }
  writeTextFileAtomic(target, buildMiddlewareSource());
}

function writeGenerated(root: string, payload: SeoGeneratedPayload): void {
  const target = projectFile(root, GENERATED_REL);
  mkdirSync(path.dirname(target), { recursive: true });
  writeTextFileAtomic(target, buildGeneratedSource(payload));
}

/**
 * Bake SEO generated payload + middleware module.
 * Root middleware sequencing is handled by unifyAriaMiddleware.
 */
export async function syncSeoInjection(
  projectPath: string,
  siteSettings: SiteSettings,
): Promise<void> {
  const root = canonicalDirectory(projectPath);
  if (siteSettings.seoManagement?.status !== "managed") {
    return;
  }
  const payload = await compileSeoPayload(root, siteSettings);
  writeGenerated(root, payload);
  ensureMiddlewareModule(root);
}

export function findExistingMiddleware(root: string): string | null {
  for (const rel of MIDDLEWARE_CANDIDATES) {
    const absolute = projectFile(root, rel);
    if (existsSync(absolute)) return absolute;
  }
  return null;
}

export { MIDDLEWARE_CANDIDATES };
