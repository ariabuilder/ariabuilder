import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildNetlifyRedirects,
  resolveTrailingSlashPolicy,
  type RedirectRule,
} from "../shared/redirects";
import type { SiteSettings, TrailingSlashPolicy } from "../shared/types";
import {
  canonicalDirectory,
  removePathTracked,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";
import { unifyAriaMiddleware } from "./seoSync";

/** Bump when redirects middleware semantics change. */
export const REDIRECTS_MIDDLEWARE_VERSION = 2;

export const REDIRECTS_WIRED_MARKER = "aria/redirects-middleware";
export const REDIRECTS_VERSION_MARKER = `@aria-redirects-middleware v${REDIRECTS_MIDDLEWARE_VERSION}`;
export const REDIRECTS_FILE_MARKER = `@aria-managed-redirects v${REDIRECTS_MIDDLEWARE_VERSION}`;

const ARIA_DIR_REL = path.join("src", "aria");
const GENERATED_REL = path.join(ARIA_DIR_REL, "redirects.generated.ts");
const MIDDLEWARE_REL = path.join(ARIA_DIR_REL, "redirects-middleware.ts");
const PUBLIC_REDIRECTS_REL = path.join("public", "_redirects");

function projectFile(root: string, relativePosixOrNative: string): string {
  return resolveWithinRoot(
    root,
    path.join(root, ...relativePosixOrNative.split(/[/\\]/).filter(Boolean)),
    { allowMissing: true, rejectFinalSymlink: true },
  );
}

function buildGeneratedSource(
  rules: readonly RedirectRule[],
  trailingSlashPolicy: TrailingSlashPolicy,
): string {
  const enabled = rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({
      fromPath: rule.fromPath,
      toPath: rule.toPath,
      statusCode: rule.statusCode,
      enabled: true as const,
    }));

  return [
    "/**",
    " * Aria-generated redirects — do not edit.",
    ` * ${REDIRECTS_VERSION_MARKER}`,
    " */",
    `export const ariaTrailingSlashPolicy = ${JSON.stringify(trailingSlashPolicy)} as const;`,
    `export const ariaRedirectRules: ReadonlyArray<{`,
    `  fromPath: string;`,
    `  toPath: string;`,
    `  statusCode: 301 | 302;`,
    `  enabled: boolean;`,
    `}> = ${JSON.stringify(enabled, null, 2)};`,
    "",
  ].join("\n");
}

function buildMiddlewareSource(): string {
  return [
    `/** ${REDIRECTS_VERSION_MARKER} */`,
    `import { defineMiddleware } from "astro:middleware";`,
    `import {`,
    `  ariaRedirectRules,`,
    `  ariaTrailingSlashPolicy,`,
    `} from "./redirects.generated";`,
    ``,
    `const SKIP_PREFIXES = [`,
    `  "/admin",`,
    `  "/_actions",`,
    `  "/api/",`,
    `  "/uploads",`,
    `  "/_astro",`,
    `  "/robots.txt",`,
    `  "/sitemap.xml",`,
    `  "/llms.txt",`,
    `  "/llms-full.txt",`,
    `  "/feed.xml",`,
    `  "/sitemap-images.xml",`,
    `  "/favicon.ico",`,
    `  "/styles/",`,
    `] as const;`,
    ``,
    `function normalizeRedirectPath(pathValue: string): string {`,
    `  const trimmed = pathValue.trim();`,
    `  if (!trimmed) return "/";`,
    `  return trimmed.startsWith("/") ? trimmed : \`/\${trimmed}\`;`,
    `}`,
    ``,
    `function escapeRegex(value: string): string {`,
    `  return value.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");`,
    `}`,
    ``,
    `function shouldSkipRedirectLookup(pathname: string): boolean {`,
    `  if (pathname === "/") return false;`,
    `  if (pathname === "/api") return true;`,
    `  if (/^\\/sitemap-\\d+\\.xml$/u.test(pathname)) return true;`,
    `  return SKIP_PREFIXES.some(`,
    `    (prefix) => pathname === prefix || pathname.startsWith(prefix),`,
    `  );`,
    `}`,
    ``,
    `function normalizeTrailingSlashPath(`,
    `  pathname: string,`,
    `  policy: "strip" | "add" | "none",`,
    `): string | null {`,
    `  if (policy === "none" || pathname === "/") return null;`,
    `  const hasTrailingSlash = pathname.endsWith("/");`,
    `  if (policy === "strip" && hasTrailingSlash) {`,
    `    const stripped = pathname.replace(/\\/+$/, "");`,
    `    return stripped.length > 0 ? stripped : "/";`,
    `  }`,
    `  if (policy === "add" && !hasTrailingSlash) return \`\${pathname}/\`;`,
    `  return null;`,
    `}`,
    ``,
    `function pathsMatchForRedirect(requestPath: string, ruleFromPath: string): boolean {`,
    `  const normalizedRequest = normalizeRedirectPath(requestPath);`,
    `  const normalizedRule = normalizeRedirectPath(ruleFromPath);`,
    `  if (normalizedRule.includes("*")) {`,
    `    const pattern = \`^\${normalizedRule`,
    `      .split("*")`,
    `      .map((segment) => escapeRegex(segment))`,
    `      .join(".*")}$\`;`,
    `    return new RegExp(pattern).test(normalizedRequest);`,
    `  }`,
    `  return normalizedRequest === normalizedRule;`,
    `}`,
    ``,
    `function resolveRedirectTarget(`,
    `  rules: readonly { fromPath: string; toPath: string; statusCode: 301 | 302; enabled: boolean }[],`,
    `  requestPath: string,`,
    `): { toPath: string; statusCode: 301 | 302 } | null {`,
    `  const normalizedPath = normalizeRedirectPath(requestPath);`,
    `  const match = rules.find(`,
    `    (rule) => rule.enabled && pathsMatchForRedirect(normalizedPath, rule.fromPath),`,
    `  );`,
    `  if (!match) return null;`,
    `  return {`,
    `    toPath: normalizeRedirectPath(match.toPath),`,
    `    statusCode: match.statusCode,`,
    `  };`,
    `}`,
    ``,
    `export const onRequest = defineMiddleware(async (context, next) => {`,
    `  const pathname = context.url.pathname;`,
    `  if (shouldSkipRedirectLookup(pathname)) return next();`,
    ``,
    `  const slashTarget = normalizeTrailingSlashPath(`,
    `    pathname,`,
    `    ariaTrailingSlashPolicy,`,
    `  );`,
    `  if (slashTarget && slashTarget !== pathname) {`,
    `    const target = new URL(context.url.toString());`,
    `    target.pathname = slashTarget;`,
    `    return Response.redirect(target.toString(), 301);`,
    `  }`,
    ``,
    `  const match = resolveRedirectTarget(ariaRedirectRules, pathname);`,
    `  if (!match) return next();`,
    ``,
    `  const destination = new URL(match.toPath, context.url.origin).toString();`,
    `  return Response.redirect(destination, match.statusCode);`,
    `});`,
    ``,
  ].join("\n");
}

function ensureMiddlewareModule(root: string): void {
  const target = projectFile(root, MIDDLEWARE_REL);
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) {
    const current = readFileSync(target, "utf8");
    if (current.includes(REDIRECTS_VERSION_MARKER)) return;
  }
  writeTextFileAtomic(target, buildMiddlewareSource());
}

function writeGenerated(
  root: string,
  rules: readonly RedirectRule[],
  trailingSlashPolicy: TrailingSlashPolicy,
): void {
  const target = projectFile(root, GENERATED_REL);
  mkdirSync(path.dirname(target), { recursive: true });
  writeTextFileAtomic(
    target,
    buildGeneratedSource(rules, trailingSlashPolicy),
  );
}

function syncPublicRedirectsFile(
  root: string,
  rules: readonly RedirectRule[],
): void {
  const target = projectFile(root, PUBLIC_REDIRECTS_REL);
  const body = buildNetlifyRedirects(rules);
  const markedBody =
    body.length > 0
      ? `# ${REDIRECTS_FILE_MARKER}\n${body}`
      : "";

  if (existsSync(target)) {
    const current = readFileSync(target, "utf8");
    const isManaged = current.includes(REDIRECTS_FILE_MARKER);
    if (!isManaged) {
      // User-owned — never clobber.
      return;
    }
    if (!markedBody) {
      try {
        removePathTracked(target, { force: true });
      } catch {
        // best-effort
      }
      return;
    }
    writeTextFileAtomic(target, markedBody);
    return;
  }

  if (!markedBody) return;
  mkdirSync(path.dirname(target), { recursive: true });
  writeTextFileAtomic(target, markedBody);
}

/**
 * Bake redirects middleware + host file, then unify root sequence.
 * Always runs (not gated on SEO takeover). Safe with empty rules
 * so trailing-slash policy still applies.
 */
export function syncRedirectsInjection(
  projectPath: string,
  siteSettings: SiteSettings,
  rules: readonly RedirectRule[],
): void {
  const root = canonicalDirectory(projectPath);
  const trailingSlashPolicy = resolveTrailingSlashPolicy(
    siteSettings.discovery?.trailingSlashPolicy,
  );
  writeGenerated(root, rules, trailingSlashPolicy);
  ensureMiddlewareModule(root);
  syncPublicRedirectsFile(root, rules);
  unifyAriaMiddleware(root, siteSettings);
}
