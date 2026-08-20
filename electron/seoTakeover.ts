import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SiteSettings } from "../shared/types";
import { scanSeoSources } from "./seoSourceScan";
import {
  canonicalDirectory,
  renamePathTracked,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";

const DISABLED_BEGIN = "<!-- aria:seo-disabled-begin -->";
const DISABLED_END = "<!-- aria:seo-disabled-end -->";

const TITLE_BLOCK_RE = /<title\b[^>]*>[\s\S]*?<\/title>/gi;
const META_DESC_RE = /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\/?>/gi;
const OG_RE = /<meta\b[^>]*\bproperty\s*=\s*["']og:[^"']+["'][^>]*\/?>/gi;
const TWITTER_RE = /<meta\b[^>]*\bname\s*=\s*["']twitter:[^"']+["'][^>]*\/?>/gi;
const CANONICAL_RE = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*\/?>/gi;
const ROBOTS_META_RE = /<meta\b[^>]*\bname\s*=\s*["']robots["'][^>]*\/?>/gi;
/** Avoid BaseHead — too often a layout shell, not an SEO plugin. */
const SEO_COMPONENT_RE =
  /<(?:SEO|Seo|SEOHead|AstroSeo|HeadSEO|OpenGraph)\b[^>]*(?:\/>|>[\s\S]*?<\/(?:SEO|Seo|SEOHead|AstroSeo|HeadSEO|OpenGraph)>)/gi;

function projectFile(root: string, rel: string): string {
  return resolveWithinRoot(
    root,
    path.join(root, ...rel.split("/").filter(Boolean)),
    { allowMissing: true, rejectFinalSymlink: true },
  );
}

function wrapMatch(match: string): string {
  if (
    match.includes("aria:seo-disabled-begin") ||
    match.includes("aria:seo-disabled-end")
  ) {
    return match;
  }
  return `${DISABLED_BEGIN}${match}${DISABLED_END}`;
}

/**
 * Neutralize competing SEO tags in a source file.
 * Idempotent: skips matches already inside aria:seo-disabled regions by
 * only wrapping fresh matches (wrapMatch no-ops if markers present).
 */
function neutralizeSourceFile(absolute: string): boolean {
  if (!existsSync(absolute)) return false;
  let source = readFileSync(absolute, "utf8");

  const patterns = [
    TITLE_BLOCK_RE,
    META_DESC_RE,
    OG_RE,
    TWITTER_RE,
    CANONICAL_RE,
    ROBOTS_META_RE,
    SEO_COMPONENT_RE,
  ];

  // Work on a copy where existing disabled regions are masked so we don't
  // re-match tags inside them, then restore.
  const maskedRegions: string[] = [];
  const masked = source.replace(
    /<!--\s*aria:seo-disabled-begin\s*-->[\s\S]*?<!--\s*aria:seo-disabled-end\s*-->/g,
    (block) => {
      const token = `__ARIA_SEO_DISABLED_${maskedRegions.length}__`;
      maskedRegions.push(block);
      return token;
    },
  );

  let working = masked;
  let changed = false;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    working = working.replace(pattern, (match) => {
      changed = true;
      return wrapMatch(match);
    });
  }

  if (!changed) return false;

  let restored = working;
  for (let i = 0; i < maskedRegions.length; i++) {
    restored = restored.replace(`__ARIA_SEO_DISABLED_${i}__`, maskedRegions[i]!);
  }

  writeTextFileAtomic(absolute, restored);
  return true;
}

function backupPublicArtifact(root: string, relPublic: string): boolean {
  const absolute = projectFile(root, relPublic);
  if (!existsSync(absolute)) return false;
  const bak = `${absolute}.aria-bak`;
  if (existsSync(bak)) return false;
  renamePathTracked(absolute, bak);
  return true;
}

/**
 * Apply takeover mutations to settings + disk (caller persists via writeSiteSettings).
 * Returns the next SiteSettings object (managed) after neutralizing competitors.
 */
export function prepareSeoTakeover(
  projectPath: string,
  current: SiteSettings,
): SiteSettings {
  const root = canonicalDirectory(projectPath);
  const scan = scanSeoSources(root);

  for (const artifact of scan.staticArtifacts) {
    backupPublicArtifact(root, artifact.file);
  }

  const files = new Set(scan.manualTags.map((t) => t.file));
  for (const rel of files) {
    neutralizeSourceFile(projectFile(root, rel));
  }

  const now = new Date().toISOString();
  return {
    ...current,
    seoManagement: {
      status: "managed",
      detectedAt: current.seoManagement?.detectedAt ?? scan.scannedAt,
      managedAt: now,
      lastScan: scan,
    },
  };
}

/**
 * Refresh scan results onto a settings object (caller persists).
 */
export function withRefreshedSeoScan(
  projectPath: string,
  current: SiteSettings,
): SiteSettings {
  const root = canonicalDirectory(projectPath);
  const scan = scanSeoSources(root);
  return {
    ...current,
    seoManagement: {
      status: current.seoManagement?.status ?? "unmanaged",
      detectedAt: current.seoManagement?.detectedAt ?? scan.scannedAt,
      managedAt: current.seoManagement?.managedAt,
      lastScan: scan,
    },
  };
}

/**
 * Structured checklist items for UI (i18n-friendly keys + params).
 */
export type SeoTakeoverChecklistItem = {
  kind: "npm_package" | "astro_config";
  name: string;
  detail?: string;
};

export function seoTakeoverChecklistItems(
  settings: SiteSettings,
): SeoTakeoverChecklistItem[] {
  const scan = settings.seoManagement?.lastScan;
  if (!scan) return [];
  const items: SeoTakeoverChecklistItem[] = [];
  for (const plugin of scan.plugins) {
    if (plugin.source === "package.json") {
      items.push({ kind: "npm_package", name: plugin.name });
    } else if (plugin.source === "astro.config") {
      items.push({
        kind: "astro_config",
        name: plugin.name,
        detail: plugin.detail,
      });
    }
  }
  return items;
}

/**
 * @deprecated Prefer seoTakeoverChecklistItems for i18n. Kept for IPC compat.
 */
export function seoTakeoverChecklist(settings: SiteSettings): string[] {
  return seoTakeoverChecklistItems(settings).map((item) => {
    if (item.kind === "npm_package") {
      return `Remove npm package "${item.name}" and its astro.config integration if present.`;
    }
    return `Remove "${item.name}" from ${item.detail ?? "astro.config"}.`;
  });
}
