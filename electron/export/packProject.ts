import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  type Dirent,
} from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { buildDiscoveryArtifacts } from "../../shared/crawl";
import { buildNetlifyRedirects } from "../../shared/redirects";
import {
  resolveExportSelection,
  SITE_EXPORT_SECTIONS,
  type ResolvedSiteExportSections,
  type SiteExportSelection,
  type SiteExportSelectionInput,
} from "../../shared/export";
import { resolveDesignEntryRelativePath } from "../design/discovery";
import { loadDiscoveryContext } from "../loadDiscoveryContext";
import { listMedia } from "../media";
import { canonicalDirectory, resolveWithinRoot } from "../pathSafety";
import { listRedirects, readRedirects } from "../redirects";
import { readSiteSettings } from "../siteSettings";
import { scanProject } from "../workspace";
import { readCollections } from "../collections";
import * as cmsStore from "../cms/store";

const MANIFEST_FORMAT = "aria-site-export" as const;
const MANIFEST_VERSION = 1 as const;

/** Paths never included in a site export archive. */
const NEVER_PACK_PREFIXES = [
  ".aria/exports",
  ".aria/imports",
  ".aria/cms/revisions",
] as const;

const NEVER_PACK_BASENAMES = new Set([
  "agent-credentials.json",
  "thumbs",
]);

type SiteExportManifest = {
  format: typeof MANIFEST_FORMAT;
  version: typeof MANIFEST_VERSION;
  generatedAt: string;
  counts: {
    pages: number;
    layouts: number;
    components: number;
    media: number;
    cmsCollections: number;
    cmsEntries: number;
    redirects: number;
    pageMetadata: number;
  };
  included: string[];
  excluded: string[];
  selection?: SiteExportSelection;
};

export type PackSiteExportResult = {
  bytes: Uint8Array;
  filename: string;
  pageCount: number;
  layoutCount: number;
  componentCount: number;
  mediaCount: number;
  cmsCollectionCount: number;
  cmsEntryCount: number;
  redirectCount: number;
  estimatedMediaBytes: number;
  selection: SiteExportSelection;
};

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

function toExportTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function isNeverPackRelative(relPosix: string): boolean {
  const normalized = relPosix.replace(/^\/+/, "");
  if (!normalized) return true;
  const segments = normalized.split("/");
  if (segments.some((segment) => NEVER_PACK_BASENAMES.has(segment))) {
    return true;
  }
  for (const prefix of NEVER_PACK_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

function projectFileExists(root: string, relPosix: string): boolean {
  try {
    const absolute = resolveWithinRoot(root, path.join(root, relPosix), {
      allowMissing: true,
      rejectFinalSymlink: true,
    });
    return existsSync(absolute) && statSync(absolute).isFile();
  } catch {
    return false;
  }
}

function readProjectFile(root: string, relPosix: string): Buffer | null {
  try {
    const absolute = resolveWithinRoot(root, path.join(root, relPosix), {
      rejectFinalSymlink: true,
    });
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return null;
    return readFileSync(absolute);
  } catch {
    return null;
  }
}

function addFile(
  zip: JSZip,
  root: string,
  relPosix: string,
  contents?: string | Buffer | Uint8Array,
): boolean {
  if (isNeverPackRelative(relPosix)) return false;
  if (contents !== undefined) {
    zip.file(relPosix, contents);
    return true;
  }
  const bytes = readProjectFile(root, relPosix);
  if (!bytes) return false;
  zip.file(relPosix, bytes);
  return true;
}

function walkFiles(
  root: string,
  absoluteDir: string,
  out: string[],
  depth = 0,
): void {
  if (depth > 60) return;
  if (!existsSync(absoluteDir) || !statSync(absoluteDir).isDirectory()) return;

  let entries: Dirent[];
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") continue;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absolute = path.join(absoluteDir, entry.name);
    const relPosix = toPosix(path.relative(root, absolute));
    if (isNeverPackRelative(relPosix)) continue;

    if (entry.isDirectory()) {
      walkFiles(root, absolute, out, depth + 1);
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isFile()) continue;
    out.push(relPosix);
  }
}

function listTreeFiles(root: string, relativeDir: string): string[] {
  const absolute = path.join(root, ...relativeDir.split("/"));
  const out: string[] = [];
  walkFiles(root, absolute, out);
  return out;
}

function countTreeFiles(root: string, relativeDir: string): number {
  return listTreeFiles(root, relativeDir).length;
}

function addTree(zip: JSZip, root: string, relativeDir: string): number {
  const files = listTreeFiles(root, relativeDir);
  let added = 0;
  for (const rel of files) {
    if (addFile(zip, root, rel)) added += 1;
  }
  return added;
}

function buildManifestIncludedExcluded(input: {
  sections: ResolvedSiteExportSections;
  mediaMode: string;
}): { included: string[]; excluded: string[] } {
  const labels: Record<string, string> = {
    pages: "Astro pages",
    layouts: "Astro layouts",
    components: "Astro components",
    designSystem: "design system",
    siteSettings: "site settings",
    media:
      input.mediaMode === "manifestOnly"
        ? "media manifest"
        : input.mediaMode === "omit"
          ? "media references only"
          : "media files",
    cms: "CMS collections",
    redirects: "redirect rules",
    discovery: "discovery artifacts",
    contentState: "content state & studio grouping",
    pageMetadata: "page metadata",
  };

  const included: string[] = [];
  const excluded: string[] = [];

  for (const section of SITE_EXPORT_SECTIONS) {
    const label = labels[section];
    if (!label) continue;
    if (input.sections[section]) {
      included.push(label);
    } else {
      excluded.push(label);
    }
  }

  excluded.push(
    "BYOK provider secrets",
    "WordPress import batches",
    "CMS revision history",
    "thumbnails and runtime caches",
    "previous site export artifacts",
  );

  return { included, excluded };
}

function countCmsEntries(projectPath: string): number {
  const { collections } = readCollections(projectPath);
  let total = 0;
  for (const collection of collections) {
    total += cmsStore.listEntries(projectPath, collection.id).length;
  }
  return total;
}

function collectContentStateFiles(root: string): string[] {
  const ariaDir = path.join(root, ".aria");
  if (!existsSync(ariaDir) || !statSync(ariaDir).isDirectory()) return [];

  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(ariaDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name.toLowerCase();
    if (
      name.includes("grouping") ||
      name.includes("content-state") ||
      name === "order.json"
    ) {
      const rel = toPosix(path.join(".aria", entry.name));
      if (!isNeverPackRelative(rel)) out.push(rel);
    }
  }
  return out;
}

/**
 * Pack selected on-disk project sections into an `aria-site-export` zip.
 */
export async function packSiteExport(
  projectPath: string,
  selectionInput?: SiteExportSelectionInput,
): Promise<PackSiteExportResult> {
  const startedAt = Date.now();
  const root = canonicalDirectory(projectPath);
  const resolved = resolveExportSelection(selectionInput);
  const { sections, mediaMode } = resolved;
  const selection: SiteExportSelection = {
    preset: resolved.preset,
    mediaMode,
    cms: resolved.cms,
    ...(selectionInput?.sections ? { sections: selectionInput.sections } : {}),
  };

  const zip = new JSZip();
  const generatedAt = new Date();

  let pageCount = 0;
  let layoutCount = 0;
  let componentCount = 0;
  let mediaCount = 0;
  let cmsCollectionCount = 0;
  let cmsEntryCount = 0;
  let redirectCount = 0;
  let pageMetadataCount = 0;
  let estimatedMediaBytes = 0;

  if (sections.pages) {
    pageCount = addTree(zip, root, "src/pages");
  }
  if (sections.layouts) {
    layoutCount = addTree(zip, root, "src/layouts");
  }
  if (sections.components) {
    componentCount = addTree(zip, root, "src/components");
  }

  if (sections.designSystem) {
    if (projectFileExists(root, ".aria/design-meta.json")) {
      addFile(zip, root, ".aria/design-meta.json");
    }
    const entry = resolveDesignEntryRelativePath(root);
    if (entry) {
      addFile(zip, root, entry);
    }
    if (existsSync(path.join(root, "public", "fonts"))) {
      addTree(zip, root, "public/fonts");
    }
  }

  if (sections.siteSettings) {
    if (projectFileExists(root, ".aria/site-settings.json")) {
      addFile(zip, root, ".aria/site-settings.json");
    }
  }

  if (sections.media && mediaMode === "bundle") {
    const mediaFiles = listMedia(root).filter((asset) =>
      asset.file.startsWith("public/uploads/"),
    );
    estimatedMediaBytes = mediaFiles.reduce((sum, asset) => sum + asset.size, 0);
    for (const asset of mediaFiles) {
      if (addFile(zip, root, asset.file)) {
        mediaCount += 1;
      }
    }
  } else if (sections.media && mediaMode === "manifestOnly") {
    const mediaFiles = listMedia(root).filter((asset) =>
      asset.file.startsWith("public/uploads/"),
    );
    estimatedMediaBytes = mediaFiles.reduce((sum, asset) => sum + asset.size, 0);
    mediaCount = mediaFiles.length;
    addFile(
      zip,
      root,
      "media-manifest.json",
      JSON.stringify(
        mediaFiles.map((asset) => ({
          path: asset.file,
          url: asset.url,
          size: asset.size,
          contentType: asset.mimeType,
          mtimeMs: asset.mtimeMs,
        })),
        null,
        2,
      ),
    );
  } else if (sections.media === false || mediaMode === "omit") {
    estimatedMediaBytes = listMedia(root)
      .filter((asset) => asset.file.startsWith("public/uploads/"))
      .reduce((sum, asset) => sum + asset.size, 0);
  }

  if (sections.cms) {
    if (projectFileExists(root, ".aria/collections.json")) {
      addFile(zip, root, ".aria/collections.json");
    }
    cmsCollectionCount = readCollections(root).collections.length;
    cmsEntryCount = countCmsEntries(root);
    addTree(zip, root, ".aria/cms/entries");
    if (existsSync(path.join(root, "src", "content"))) {
      addTree(zip, root, "src/content");
    }
    if (projectFileExists(root, "src/content.config.ts")) {
      addFile(zip, root, "src/content.config.ts");
    }
  }

  if (sections.redirects) {
    const rules = readRedirects(root);
    redirectCount = rules.length;
    if (projectFileExists(root, ".aria/redirects.json")) {
      addFile(zip, root, ".aria/redirects.json");
    }
    const redirectsBody = buildNetlifyRedirects(
      rules.filter((rule) => rule.enabled !== false),
    );
    if (redirectsBody.length > 0) {
      addFile(zip, root, "_redirects", redirectsBody);
    }
  }

  if (sections.discovery) {
    try {
      const siteSettings = readSiteSettings(root);
      const discoveryContext = await loadDiscoveryContext(root, siteSettings);
      const artifacts = buildDiscoveryArtifacts({
        siteSettings: discoveryContext.siteSettings,
        pages: discoveryContext.pages,
        cmsEntries: discoveryContext.cmsEntries,
      });
      addFile(zip, root, "robots.txt", artifacts.robots);
      if (artifacts.sitemap) {
        addFile(zip, root, "sitemap.xml", artifacts.sitemap);
      }
      if (artifacts.llms) {
        addFile(zip, root, "llms.txt", artifacts.llms);
      }
    } catch {
      // Discovery is best-effort when site settings / scan are incomplete.
    }
  }

  if (sections.pageMetadata) {
    if (projectFileExists(root, ".aria/pages-meta.json")) {
      addFile(zip, root, ".aria/pages-meta.json");
      pageMetadataCount = 1;
    }
  }

  if (sections.contentState) {
    const groupingFiles = collectContentStateFiles(root);
    for (const rel of groupingFiles) {
      addFile(zip, root, rel);
    }

    try {
      const settings = readSiteSettings(root);
      const contentState = {
        format: "aria-content-state",
        version: 1,
        componentGrouping: settings.componentGrouping ?? null,
        mediaGrouping: settings.mediaGrouping ?? null,
      };
      addFile(
        zip,
        root,
        ".aria/content-state.json",
        `${JSON.stringify(contentState, null, 2)}\n`,
      );
    } catch {
      // Site settings may be absent.
    }
  }

  const labels = buildManifestIncludedExcluded({ sections, mediaMode });
  const manifest: SiteExportManifest = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    generatedAt: generatedAt.toISOString(),
    counts: {
      pages: pageCount,
      layouts: layoutCount,
      components: componentCount,
      media: mediaCount,
      cmsCollections: cmsCollectionCount,
      cmsEntries: cmsEntryCount,
      redirects: redirectCount,
      pageMetadata: pageMetadataCount,
    },
    included: labels.included,
    excluded: labels.excluded,
    selection,
  };

  addFile(zip, root, "aria-export.json", JSON.stringify(manifest, null, 2));

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  console.info(
    `[aria:perf] Export packing completed in ${Date.now() - startedAt}ms with ${bytes.byteLength} bytes across ${pageCount + layoutCount + componentCount + mediaCount + cmsEntryCount} selected items.`,
  );

  return {
    bytes,
    filename: `aria-site-export-${toExportTimestamp(generatedAt)}.zip`,
    pageCount,
    layoutCount,
    componentCount,
    mediaCount,
    cmsCollectionCount,
    cmsEntryCount,
    redirectCount,
    estimatedMediaBytes,
    selection,
  };
}

/** Inventory counts for the export UI (demo `importExport.list` parity). */
export async function getSiteExportInventory(projectPath: string): Promise<{
  pages: number;
  layouts: number;
  components: number;
  media: number;
  cmsCollections: number;
  cmsEntries: number;
  redirects: number;
  estimatedMediaBytes: number;
}> {
  const root = canonicalDirectory(projectPath);
  let pages = countTreeFiles(root, "src/pages");
  let layouts = countTreeFiles(root, "src/layouts");
  let components = countTreeFiles(root, "src/components");
  try {
    const scan = await scanProject(root);
    pages = scan.pages.length;
    layouts = scan.layouts.length;
    components = scan.components.length;
  } catch {
    // Fall back to filesystem counts when the project scan is incomplete.
  }
  const media = listMedia(root).filter((asset) =>
    asset.file.startsWith("public/uploads/"),
  );
  return {
    pages,
    layouts,
    components,
    media: media.length,
    cmsCollections: readCollections(root).collections.length,
    cmsEntries: countCmsEntries(root),
    redirects: listRedirects(root, { includeDisabled: true }).length,
    estimatedMediaBytes: media.reduce((sum, asset) => sum + asset.size, 0),
  };
}
