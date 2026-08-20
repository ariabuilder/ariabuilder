import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SiteSettings } from "../shared/types";
import {
  buildDiscoveryArtifacts,
  type DiscoveryArtifacts,
  type PageForDiscovery,
  type DiscoverableCmsEntry,
} from "../shared/crawl";
import {
  canonicalDirectory,
  removePathTracked,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";
import { loadDiscoveryContext } from "./loadDiscoveryContext";

/** Bump when discovery route semantics change. */
export const DISCOVERY_ROUTES_VERSION = 1;

export const DISCOVERY_MARKER = `@aria-managed-discovery v${DISCOVERY_ROUTES_VERSION}`;

const GENERATED_REL = path.join("src", "aria", "discovery.generated.ts");

/** Core artifacts Aria manages today (no stub image/full variants). */
const ROUTE_FILES = [
  { rel: path.join("src", "pages", "robots.txt.ts"), kind: "robots" as const },
  { rel: path.join("src", "pages", "sitemap.xml.ts"), kind: "sitemap" as const },
  { rel: path.join("src", "pages", "llms.txt.ts"), kind: "llms" as const },
] as const;

/** Legacy stub routes from earlier builds — remove on sync/teardown. */
const LEGACY_STUB_ROUTES = [
  path.join("src", "pages", "sitemap-images.xml.ts"),
  path.join("src", "pages", "llms-full.txt.ts"),
] as const;

function projectFile(root: string, relativePosixOrNative: string): string {
  return resolveWithinRoot(
    root,
    path.join(root, ...relativePosixOrNative.split(/[/\\]/).filter(Boolean)),
    { allowMissing: true, rejectFinalSymlink: true },
  );
}

function buildGeneratedSource(artifacts: DiscoveryArtifacts): string {
  return [
    "/**",
    " * Aria-generated discovery artifacts — do not edit.",
    ` * ${DISCOVERY_MARKER}`,
    " */",
    `export const ariaDiscoveryArtifacts = ${JSON.stringify(
      {
        robots: artifacts.robots,
        sitemap: artifacts.sitemap,
        llms: artifacts.llms,
        generatedAt: artifacts.generatedAt,
      },
      null,
      2,
    )} as const;`,
    "",
  ].join("\n");
}

function buildRouteSource(
  kind: (typeof ROUTE_FILES)[number]["kind"],
): string {
  const contentType =
    kind === "sitemap"
      ? "application/xml; charset=utf-8"
      : "text/plain; charset=utf-8";

  const bodyExpr =
    kind === "robots"
      ? "ariaDiscoveryArtifacts.robots"
      : kind === "sitemap"
        ? "ariaDiscoveryArtifacts.sitemap"
        : "ariaDiscoveryArtifacts.llms";

  return [
    `/** ${DISCOVERY_MARKER} */`,
    `import type { APIRoute } from "astro";`,
    `import { ariaDiscoveryArtifacts } from "../aria/discovery.generated";`,
    ``,
    `export const prerender = true;`,
    ``,
    `export const GET: APIRoute = () => {`,
    `  const body = ${bodyExpr};`,
    `  if (body == null) {`,
    `    return new Response("Not Found", { status: 404 });`,
    `  }`,
    `  return new Response(body, {`,
    `    status: 200,`,
    `    headers: {`,
    `      "Content-Type": "${contentType}",`,
    `      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",`,
    `    },`,
    `  });`,
    `};`,
    ``,
  ].join("\n");
}

function writeRoute(
  root: string,
  rel: string,
  kind: (typeof ROUTE_FILES)[number]["kind"],
): void {
  const target = projectFile(root, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) {
    const current = readFileSync(target, "utf8");
    if (current.includes(DISCOVERY_MARKER)) {
      writeTextFileAtomic(target, buildRouteSource(kind));
      return;
    }
    return;
  }
  writeTextFileAtomic(target, buildRouteSource(kind));
}

function removeManagedRoute(root: string, rel: string): void {
  const target = projectFile(root, rel);
  if (!existsSync(target)) return;
  try {
    const current = readFileSync(target, "utf8");
    if (current.includes(DISCOVERY_MARKER)) {
      removePathTracked(target, { force: true });
    }
  } catch {
    // ignore
  }
}

export function buildArtifactsFromContext(input: {
  siteSettings: SiteSettings;
  pages: readonly PageForDiscovery[];
  cmsEntries?: readonly DiscoverableCmsEntry[];
}): DiscoveryArtifacts {
  return buildDiscoveryArtifacts(input);
}

/** Remove all Aria-managed discovery routes + generated payload. */
export function removeManagedDiscoveryArtifacts(projectPath: string): void {
  const root = canonicalDirectory(projectPath);
  for (const route of ROUTE_FILES) {
    removeManagedRoute(root, route.rel);
  }
  for (const rel of LEGACY_STUB_ROUTES) {
    removeManagedRoute(root, rel);
  }
  const generated = projectFile(root, GENERATED_REL);
  if (existsSync(generated)) {
    try {
      const body = readFileSync(generated, "utf8");
      if (body.includes(DISCOVERY_MARKER) || body.includes("Aria-generated discovery")) {
        removePathTracked(generated, { force: true });
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Bake discovery artifact routes into the Astro project when Aria manages SEO.
 */
export async function syncDiscoveryArtifacts(
  projectPath: string,
  siteSettings: SiteSettings,
): Promise<void> {
  const root = canonicalDirectory(projectPath);
  if (siteSettings.seoManagement?.status !== "managed") {
    return;
  }

  const { pages, cmsEntries } = await loadDiscoveryContext(root, siteSettings);
  const artifacts = buildDiscoveryArtifacts({
    siteSettings,
    pages,
    cmsEntries,
  });

  const generated = projectFile(root, GENERATED_REL);
  mkdirSync(path.dirname(generated), { recursive: true });
  writeTextFileAtomic(generated, buildGeneratedSource(artifacts));

  // Drop legacy stub endpoints if present from earlier builds.
  for (const rel of LEGACY_STUB_ROUTES) {
    removeManagedRoute(root, rel);
  }

  for (const route of ROUTE_FILES) {
    const discovery = siteSettings.discovery;
    if (route.kind === "sitemap" && discovery?.sitemapMode === "off") {
      removeManagedRoute(root, route.rel);
      continue;
    }
    if (route.kind === "llms" && discovery?.llmsMode === "off") {
      removeManagedRoute(root, route.rel);
      continue;
    }
    writeRoute(root, route.rel, route.kind);
  }
}

/** Paths that page scan should ignore (managed discovery endpoints). */
export const MANAGED_DISCOVERY_PAGE_BASENAMES = new Set([
  "robots.txt.ts",
  "sitemap.xml.ts",
  "llms.txt.ts",
  "sitemap-images.xml.ts",
  "llms-full.txt.ts",
]);
