import type {
  CollectionsState,
  PageMetaRecord,
  PageRole,
  PagesMetaState,
} from "./types";

export type { PageRole, PageMetaRecord, PagesMetaState, CollectionsState };

export const PAGE_ROLES = [
  "standard",
  "not-found",
  "cms-collection",
  "cms-entry",
] as const satisfies readonly PageRole[];

export function isPageRole(value: unknown): value is PageRole {
  return (
    typeof value === "string" &&
    (PAGE_ROLES as readonly string[]).includes(value)
  );
}

/** Astro dynamic segments (`[slug]`, `[...id]`, etc.). */
export function isDynamicAstroRoute(routeOrPath: string): boolean {
  return routeOrPath.includes("[") || routeOrPath.includes("]");
}

/**
 * Infer a page role from the filesystem route/file alone.
 * Used when `.aria` meta / collections have no explicit binding.
 */
export function inferPageRole(route: string, file: string): PageRole {
  if (isDynamicAstroRoute(route) || isDynamicAstroRoute(file)) {
    return "cms-entry";
  }
  const base = file.split("/").pop() ?? "";
  if (route === "/404" || /^404\.(astro|md|mdx)$/i.test(base)) {
    return "not-found";
  }
  return "standard";
}

/**
 * Resolve page role with overlay + collection bindings.
 *
 * Order:
 * 1. Explicit pages-meta.pages[file].role
 * 2. Collection templatePageFile → cms-entry
 * 3. Collection listPageFile → cms-collection
 * 4. Infer from route/file (brackets → cms-entry, 404 → not-found, else standard)
 */
export function resolvePageRole(
  page: { route: string; file: string },
  meta?: PagesMetaState | null,
  collections?: CollectionsState | null,
): PageRole {
  const file = page.file;
  const explicit = meta?.pages?.[file]?.role;
  if (isPageRole(explicit)) return explicit;

  const defs = collections?.collections ?? [];
  for (const collection of defs) {
    if (collection.templatePageFile === file) return "cms-entry";
  }
  for (const collection of defs) {
    if (collection.listPageFile === file) return "cms-collection";
  }

  return inferPageRole(page.route, page.file);
}

export function getPageMetaRecord(
  meta: PagesMetaState | null | undefined,
  file: string,
): PageMetaRecord | undefined {
  return meta?.pages?.[file];
}

/** Entry templates are not directly navigable (404 without params). */
export function isNavigablePageRole(role: PageRole): boolean {
  return role !== "cms-entry";
}

/**
 * Whether a route can be opened directly in preview.
 * Prefer {@link isNavigableScanPage} when a resolved `ScanPage.role` is available.
 */
export function isNavigablePageRoute(route: string, file = ""): boolean {
  return isNavigablePageRole(inferPageRole(route, file));
}

export function isNavigableScanPage(page: {
  route: string;
  file: string;
  role?: PageRole;
}): boolean {
  const role = page.role ?? inferPageRole(page.route, page.file);
  return isNavigablePageRole(role);
}
