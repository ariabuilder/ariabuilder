import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type {
  SeoManualTagFinding,
  SeoPluginFinding,
  SeoSourceScanResult,
  SeoStaticArtifactFinding,
} from "../shared/types";
import { canonicalDirectory, isPathInside } from "./pathSafety";

const SOURCE_EXTS = new Set([".astro", ".md", ".mdx", ".tsx", ".jsx", ".vue"]);
const CONFIG_NAMES = [
  "astro.config.mjs",
  "astro.config.js",
  "astro.config.ts",
  "astro.config.mts",
  "astro.config.cjs",
];

const SEO_PACKAGES = [
  "astro-seo",
  "@astrolib/seo",
  "astro-seo-schema",
  "astro-sitemap",
  "@astrojs/sitemap",
  "astro-robots-txt",
  "astro-seo-meta",
];

const SEO_COMPONENT_RE =
  /<(?:SEO|Seo|SEOHead|AstroSeo|HeadSEO|OpenGraph)\b/i;
const TITLE_RE = /<title\b[^>]*>[\s\S]*?<\/title>/i;
const META_DESC_RE = /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/i;
const OG_RE = /<meta\b[^>]*\bproperty\s*=\s*["']og:[^"']+["'][^>]*>/i;
const TWITTER_RE = /<meta\b[^>]*\bname\s*=\s*["']twitter:[^"']+["'][^>]*>/i;
const CANONICAL_RE = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i;
const ROBOTS_META_RE = /<meta\b[^>]*\bname\s*=\s*["']robots["'][^>]*>/i;

const MAX_FILES = 400;
const MAX_DEPTH = 12;
const MAX_FILE_BYTES = 512 * 1024;

const ARIA_SEO_MARKER = "@aria-seo-middleware";
const ARIA_DISCOVERY_MARKER = "@aria-managed-discovery";
const ARIA_DISABLED_BEGIN = "aria:seo-disabled-begin";

function walkFiles(
  dir: string,
  root: string,
  exts: Set<string>,
  out: string[],
  depth = 0,
): void {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (!isPathInside(root, full)) continue;
    if (entry.isDirectory()) {
      walkFiles(full, root, exts, out, depth + 1);
      continue;
    }
    if (exts.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

function relPosix(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function readSafe(file: string): string | null {
  try {
    if (!statSync(file).isFile() || statSync(file).size > MAX_FILE_BYTES) {
      return null;
    }
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function scanPackageJson(root: string): SeoPluginFinding[] {
  const findings: SeoPluginFinding[] = [];
  const pkgPath = path.join(root, "package.json");
  const raw = readSafe(pkgPath);
  if (!raw) return findings;
  try {
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    for (const name of SEO_PACKAGES) {
      if (name in deps) {
        findings.push({
          name,
          source: "package.json",
          detail: deps[name],
        });
      }
    }
  } catch {
    // ignore malformed package.json
  }
  return findings;
}

function scanAstroConfig(root: string): SeoPluginFinding[] {
  const findings: SeoPluginFinding[] = [];
  for (const name of CONFIG_NAMES) {
    const file = path.join(root, name);
    const raw = readSafe(file);
    if (!raw) continue;
    for (const pkg of SEO_PACKAGES) {
      if (raw.includes(pkg) || raw.includes("sitemap")) {
        if (raw.includes(pkg)) {
          findings.push({
            name: pkg,
            source: "astro.config",
            detail: name,
          });
        }
      }
    }
    if (
      /\bsitemap\b/i.test(raw) &&
      !findings.some((f) => f.source === "astro.config" && f.name.includes("sitemap"))
    ) {
      findings.push({
        name: "sitemap-integration",
        source: "astro.config",
        detail: name,
      });
    }
  }
  return findings;
}

function scanManualTags(
  root: string,
  files: string[],
): SeoManualTagFinding[] {
  const findings: SeoManualTagFinding[] = [];
  for (const absolute of files) {
    const raw = readSafe(absolute);
    if (!raw) continue;
    // Skip regions Aria already disabled.
    const searchable = raw.includes(ARIA_DISABLED_BEGIN)
      ? raw.replace(
          /<!--\s*aria:seo-disabled-begin\s*-->[\s\S]*?<!--\s*aria:seo-disabled-end\s*-->/g,
          "",
        )
      : raw;
    const file = relPosix(root, absolute);
    const checks: Array<{
      kind: SeoManualTagFinding["kind"];
      re: RegExp;
    }> = [
      { kind: "title", re: TITLE_RE },
      { kind: "description", re: META_DESC_RE },
      { kind: "og", re: OG_RE },
      { kind: "twitter", re: TWITTER_RE },
      { kind: "canonical", re: CANONICAL_RE },
      { kind: "robots", re: ROBOTS_META_RE },
      { kind: "seo-component", re: SEO_COMPONENT_RE },
    ];
    for (const { kind, re } of checks) {
      const match = searchable.match(re);
      if (match) {
        findings.push({
          file,
          kind,
          snippet: match[0].slice(0, 160),
        });
      }
    }
  }
  return findings;
}

function scanStaticArtifacts(root: string): SeoStaticArtifactFinding[] {
  const findings: SeoStaticArtifactFinding[] = [];
  const publicDir = path.join(root, "public");
  if (!existsSync(publicDir)) return findings;

  const candidates: Array<{ name: string; kind: SeoStaticArtifactFinding["kind"] }> = [
    { name: "robots.txt", kind: "robots" },
    { name: "sitemap.xml", kind: "sitemap" },
    { name: "sitemap_index.xml", kind: "sitemap" },
    { name: "llms.txt", kind: "llms" },
  ];
  for (const { name, kind } of candidates) {
    const file = path.join(publicDir, name);
    if (existsSync(file) && !existsSync(`${file}.aria-bak`)) {
      findings.push({ file: `public/${name}`, kind });
    }
  }

  // sitemap-*.xml
  try {
    for (const entry of readdirSync(publicDir)) {
      if (/^sitemap.*\.xml$/i.test(entry) && !entry.endsWith(".aria-bak")) {
        const key = `public/${entry}`;
        if (!findings.some((f) => f.file === key)) {
          findings.push({ file: key, kind: "sitemap" });
        }
      }
    }
  } catch {
    // ignore
  }

  return findings;
}

function detectAriaManaged(root: string): boolean {
  const markers = [
    path.join(root, "src", "aria", "seo-middleware.ts"),
    path.join(root, "src", "aria", "seo.generated.ts"),
    path.join(root, "src", "pages", "robots.txt.ts"),
  ];
  for (const file of markers) {
    const raw = readSafe(file);
    if (
      raw &&
      (raw.includes(ARIA_SEO_MARKER) || raw.includes(ARIA_DISCOVERY_MARKER))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Scan the project for competing SEO plugins, manual head tags, and static artifacts.
 */
export function scanSeoSources(projectPath: string): SeoSourceScanResult {
  const root = canonicalDirectory(projectPath);
  const plugins = [
    ...scanPackageJson(root),
    ...scanAstroConfig(root),
  ];
  // Dedupe plugins by name+source
  const seen = new Set<string>();
  const uniquePlugins = plugins.filter((p) => {
    const key = `${p.source}:${p.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const sourceFiles: string[] = [];
  walkFiles(path.join(root, "src", "layouts"), root, SOURCE_EXTS, sourceFiles);
  const indexCandidates = [
    path.join(root, "src", "pages", "index.astro"),
    path.join(root, "src", "pages", "index.md"),
    path.join(root, "src", "pages", "index.mdx"),
  ];
  for (const candidate of indexCandidates) {
    if (existsSync(candidate)) sourceFiles.push(candidate);
  }
  // Also scan BaseLayout-style components often used for head
  walkFiles(path.join(root, "src", "components"), root, SOURCE_EXTS, sourceFiles);

  const manualTags = scanManualTags(root, sourceFiles);
  const staticArtifacts = scanStaticArtifacts(root);
  const ariaManagedPresent = detectAriaManaged(root);
  const hasConflicts =
    uniquePlugins.length > 0 ||
    manualTags.length > 0 ||
    staticArtifacts.length > 0;

  return {
    scannedAt: new Date().toISOString(),
    plugins: uniquePlugins,
    manualTags,
    staticArtifacts,
    ariaManagedPresent,
    hasConflicts,
  };
}
