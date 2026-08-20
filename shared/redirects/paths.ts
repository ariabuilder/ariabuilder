import {
  RedirectRuleSchema,
  type CreateRedirectInput,
  type RedirectRule,
  type UpdateRedirectInput,
} from "./schemas";

/** Paths that must not be redirect sources or destinations. */
export const PROTECTED_PATH_PREFIXES = [
  "/admin",
  "/_actions",
  "/uploads",
  "/_astro",
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt",
  "/llms-full.txt",
  "/feed.xml",
  "/favicon.ico",
  "/styles/",
  "/api",
] as const;

/**
 * Middleware skip list (wider than validate protected prefixes).
 * Used by baked redirects middleware and shouldSkipRedirectLookup.
 */
export const REDIRECT_SKIP_PREFIXES = [
  "/admin",
  "/_actions",
  "/api/",
  "/uploads",
  "/_astro",
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt",
  "/llms-full.txt",
  "/feed.xml",
  "/sitemap-images.xml",
  "/favicon.ico",
  "/styles/",
] as const;

/** Leading-slash normalize only — does not strip/add trailing slashes. */
export function normalizeRedirectPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function isProtectedRedirectPath(path: string): boolean {
  const normalized = normalizeRedirectPath(path);
  return PROTECTED_PATH_PREFIXES.some((prefix) => {
    if (prefix === "/api") {
      return normalized === "/api" || normalized.startsWith("/api/");
    }
    return normalized === prefix || normalized.startsWith(prefix);
  });
}

export function isUnsafeRedirectDestination(path: string): boolean {
  const trimmed = path.trim();
  return (
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith("//") ||
    /^(javascript|data):/i.test(trimmed)
  );
}

export function shouldSkipRedirectLookup(pathname: string): boolean {
  if (pathname === "/") {
    return false;
  }
  if (pathname === "/api") {
    return true;
  }
  if (/^\/sitemap-\d+\.xml$/u.test(pathname)) {
    return true;
  }
  return REDIRECT_SKIP_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

export function buildRedirectUpdateFields(
  current: RedirectRule,
  input: UpdateRedirectInput,
): RedirectRule {
  return RedirectRuleSchema.parse({
    ...current,
    fromPath:
      input.fromPath !== undefined
        ? normalizeRedirectPath(input.fromPath)
        : current.fromPath,
    toPath:
      input.toPath !== undefined
        ? normalizeRedirectPath(input.toPath)
        : current.toPath,
    statusCode: input.statusCode ?? current.statusCode,
    enabled: input.enabled ?? current.enabled,
    note:
      input.note === null
        ? undefined
        : input.note !== undefined
          ? input.note
          : current.note,
    updatedAt: new Date().toISOString(),
  });
}

export function buildRedirectCreateFields(
  input: CreateRedirectInput,
  id: string,
): RedirectRule {
  const now = new Date().toISOString();
  return RedirectRuleSchema.parse({
    id,
    fromPath: normalizeRedirectPath(input.fromPath),
    toPath: normalizeRedirectPath(input.toPath),
    statusCode: input.statusCode ?? 301,
    enabled: input.enabled ?? true,
    note: input.note,
    createdAt: now,
    updatedAt: now,
  });
}
