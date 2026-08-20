import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  type Dirent,
} from "node:fs";
import path from "node:path";
import { dialog, type BrowserWindow } from "./electron-api";
import {
  canonicalDirectory,
  copyFileTracked,
  removePathTracked,
  renamePathTracked,
  resolveWithinRoot,
  writeBinaryFileAtomic,
  writeTextFileAtomic,
} from "./pathSafety";
import type {
  MediaAsset,
  MediaAssetType,
  MediaAssetUsage,
} from "../shared/types";

export type { MediaAsset, MediaAssetType } from "../shared/types";

const PUBLIC_REL = "public";
const UPLOADS_REL = "public/uploads";
const ASSETS_REL = "src/assets";
const VARIANTS_DIR_NAME = "variants";
const MAX_LIST_FILES = 5_000;
const MAX_SCAN_DEPTH = 40;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_REFERENCE_SCAN_FILES = 5_000;
const MAX_REFERENCE_FILE_BYTES = 2 * 1024 * 1024;
const REFERENCE_EXTENSIONS = new Set([
  ".astro", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mdx",
  ".mjs", ".scss", ".svelte", ".ts", ".tsx", ".vue", ".yaml", ".yml",
]);

const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".avif",
  ".ico",
  ".bmp",
]);
const VIDEO_EXTS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".avi",
  ".mkv",
]);
const AUDIO_EXTS = new Set([
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".flac",
  ".aac",
]);
const FONT_EXTS = new Set([".woff", ".woff2", ".ttf", ".otf", ".eot"]);
const DOCUMENT_EXTS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".md",
  ".csv",
  ".json",
]);

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
};

type MediaRootKind = "uploads" | "public" | "assets";

type MediaRoot = {
  kind: MediaRootKind;
  /** Project-relative posix root (e.g. public/uploads). */
  rel: string;
};

const STATIC_MEDIA_ROOTS: MediaRoot[] = [{ kind: "assets", rel: ASSETS_REL }];

function classifyType(ext: string): MediaAssetType {
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (FONT_EXTS.has(ext)) return "font";
  if (DOCUMENT_EXTS.has(ext)) return "document";
  return "other";
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

/** Encode an asset id for use as a single path segment / meta filename. */
export function mediaSafeKey(assetId: string): string {
  const normalized = assetId.trim().replace(/\\/g, "/");
  if (!normalized) throw new Error("Media id is required");
  return normalized.replace(/[<>:"|?*]/g, "-").replace(/\//g, "__");
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name).trim();
  if (!base || base === "." || base === "..") {
    throw new Error("Invalid file name");
  }
  if (base.includes("\0")) throw new Error("Invalid file name");
  return base.replace(/[<>:"|?*\\/]/g, "-");
}

function uniqueName(dir: string, fileName: string): string {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  let candidate = fileName;
  let i = 1;
  while (existsSync(path.join(dir, candidate))) {
    candidate = `${stem}-${i}${ext}`;
    i += 1;
    if (i > 10_000) throw new Error("Could not allocate a unique file name");
  }
  return candidate;
}

function resolveProjectRel(
  projectPath: string,
  rel: string,
  options?: { allowMissing?: boolean },
): string {
  const root = canonicalDirectory(projectPath);
  const posix = toPosix(rel).replace(/^\/+/, "");
  return resolveWithinRoot(root, path.join(root, ...posix.split("/")), {
    allowMissing: options?.allowMissing ?? false,
    rejectFinalSymlink: true,
  });
}

function uploadsRoot(projectPath: string): string {
  return resolveProjectRel(projectPath, UPLOADS_REL, { allowMissing: true });
}

function ensureUploadsDir(projectPath: string): string {
  const dir = uploadsRoot(projectPath);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function countVariantMeta(projectPath: string, assetId: string): number {
  try {
    const root = canonicalDirectory(projectPath);
    const safeId = mediaSafeKey(assetId);
    const metaFile = resolveWithinRoot(
      root,
      path.join(root, ".aria", "media", `${safeId}.json`),
      { allowMissing: true, rejectFinalSymlink: true },
    );
    if (!existsSync(metaFile)) return 0;
    const parsed = JSON.parse(readFileSync(metaFile, "utf8")) as {
      variants?: unknown;
    };
    return Array.isArray(parsed.variants) ? parsed.variants.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Discover top-level directories under `public/` (images, uploads, files, …)
 * plus the fixed `src/assets` root. Root-level public files (e.g. robots.txt)
 * are intentionally not indexed.
 */
function mediaRootsForProject(projectPath: string): MediaRoot[] {
  const roots: MediaRoot[] = [...STATIC_MEDIA_ROOTS];
  const publicAbs = resolveProjectRel(projectPath, PUBLIC_REL, {
    allowMissing: true,
  });
  if (!existsSync(publicAbs) || !statSync(publicAbs).isDirectory()) {
    return roots;
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(publicAbs, { withFileTypes: true });
  } catch {
    return roots;
  }

  const publicRoots: MediaRoot[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory()) continue;
    const rel = `${PUBLIC_REL}/${entry.name}`;
    publicRoots.push({
      kind: rel === UPLOADS_REL ? "uploads" : "public",
      rel,
    });
  }
  publicRoots.sort((a, b) => a.rel.localeCompare(b.rel));
  return [...publicRoots, ...roots];
}

function mediaRootForPath(projectRel: string): MediaRoot | null {
  const id = toPosix(projectRel).replace(/^\/+/, "");
  if (id === ASSETS_REL || id.startsWith(`${ASSETS_REL}/`)) {
    return { kind: "assets", rel: ASSETS_REL };
  }
  if (!id.startsWith(`${PUBLIC_REL}/`)) return null;
  const folder = id.slice(PUBLIC_REL.length + 1).split("/")[0];
  if (!folder) return null;
  const rel = `${PUBLIC_REL}/${folder}`;
  return {
    kind: rel === UPLOADS_REL ? "uploads" : "public",
    rel,
  };
}

function publicUrlFor(mediaRoot: MediaRoot, relWithinRoot: string): string {
  if (mediaRoot.kind === "assets") {
    // src/assets are import paths, not static public URLs.
    return `/${ASSETS_REL}/${relWithinRoot}`;
  }
  // public/<dir>/... → /<dir>/...
  const prefix = mediaRoot.rel.startsWith(`${PUBLIC_REL}/`)
    ? mediaRoot.rel.slice(PUBLIC_REL.length + 1)
    : mediaRoot.rel;
  return `/${prefix}/${relWithinRoot}`;
}

function folderFromRel(relWithinRoot: string): string | undefined {
  const parts = relWithinRoot.split("/");
  if (parts.length <= 1) return undefined;
  return parts.slice(0, -1).join("/");
}

function toAssetFromAbsolute(
  projectPath: string,
  mediaRoot: MediaRoot,
  scanRootAbs: string,
  absolute: string,
): MediaAsset | null {
  const root = canonicalDirectory(projectPath);
  let st;
  try {
    st = statSync(absolute);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;

  const relWithinRoot = toPosix(path.relative(scanRootAbs, absolute));
  if (!relWithinRoot || relWithinRoot.startsWith("..")) return null;
  if (
    mediaRoot.kind === "uploads" &&
    (relWithinRoot === VARIANTS_DIR_NAME ||
      relWithinRoot.startsWith(`${VARIANTS_DIR_NAME}/`))
  ) {
    return null;
  }

  const file = toPosix(path.relative(root, absolute));
  const ext = path.extname(absolute).toLowerCase();
  const folder = folderFromRel(relWithinRoot);

  return {
    id: file,
    name: path.basename(absolute),
    type: classifyType(ext),
    file,
    url: publicUrlFor(mediaRoot, relWithinRoot),
    size: st.size,
    mimeType: MIME[ext] ?? null,
    mtimeMs: st.mtimeMs,
    dimensions: null,
    cropCount: countVariantMeta(projectPath, file),
    ...(folder ? { folder } : {}),
  };
}

function walkMediaRoot(
  projectPath: string,
  mediaRoot: MediaRoot,
  assets: MediaAsset[],
): void {
  const scanRootAbs = resolveProjectRel(projectPath, mediaRoot.rel, {
    allowMissing: true,
  });
  if (!existsSync(scanRootAbs) || !statSync(scanRootAbs).isDirectory()) {
    return;
  }

  let visited = 0;
  const walk = (current: string, depth: number): void => {
    if (assets.length >= MAX_LIST_FILES) return;
    if (depth > MAX_SCAN_DEPTH) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (assets.length >= MAX_LIST_FILES) return;
      visited += 1;
      if (visited > MAX_LIST_FILES * 4) return;
      if (entry.name.startsWith(".")) continue;
      if (
        mediaRoot.kind === "uploads" &&
        depth === 0 &&
        entry.name === VARIANTS_DIR_NAME
      ) {
        continue;
      }

      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      const asset = toAssetFromAbsolute(
        projectPath,
        mediaRoot,
        scanRootAbs,
        absolute,
      );
      if (asset) assets.push(asset);
    }
  };

  walk(scanRootAbs, 0);
}

function assertAllowedMediaPath(assetId: string): string {
  const id = toPosix(assetId).replace(/^\/+/, "");
  if (id.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("Invalid media path");
  }
  if (id.includes(`${UPLOADS_REL}/${VARIANTS_DIR_NAME}`)) {
    throw new Error("Variant files are managed separately");
  }
  const mediaRoot = mediaRootForPath(id);
  if (!mediaRoot || (id !== mediaRoot.rel && !id.startsWith(`${mediaRoot.rel}/`))) {
    throw new Error(
      "Media path must be under a public/ folder or src/assets",
    );
  }
  // Require a file path under the root (public/<folder>/file… or src/assets/file…)
  if (id === mediaRoot.rel) {
    throw new Error(
      "Media path must be under a public/ folder or src/assets",
    );
  }
  return id;
}

export function resolveMediaFilePath(
  projectPath: string,
  assetId: string,
): string {
  const id = assertAllowedMediaPath(assetId);
  return resolveProjectRel(projectPath, id, { allowMissing: false });
}

/** MIME type for a media file extension (including leading dot). */
export function mimeForMediaExt(ext: string): string | null {
  return MIME[ext.toLowerCase()] ?? null;
}

export function listMedia(projectPath: string): MediaAsset[] {
  const assets: MediaAsset[] = [];
  for (const mediaRoot of mediaRootsForProject(projectPath)) {
    walkMediaRoot(projectPath, mediaRoot, assets);
  }
  assets.sort(
    (a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name),
  );
  return assets;
}

export async function pickMediaFiles(
  win: BrowserWindow | null,
): Promise<{ filePaths: string[] } | { canceled: true }> {
  const options = {
    title: "Upload media",
    properties: ["openFile" as const, "multiSelections" as const],
    filters: [
      {
        name: "Media",
        extensions: [
          "png",
          "jpg",
          "jpeg",
          "webp",
          "gif",
          "svg",
          "avif",
          "mp4",
          "webm",
          "mov",
          "mp3",
          "wav",
          "ogg",
          "woff",
          "woff2",
          "ttf",
          "otf",
          "pdf",
        ],
      },
      { name: "All files", extensions: ["*"] },
    ],
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return { filePaths: [...result.filePaths] };
}

export function installMediaFiles(
  projectPath: string,
  filePaths: readonly string[],
): { assets: MediaAsset[] } {
  const uploads = ensureUploadsDir(projectPath);
  const uploadsRootDef: MediaRoot = { kind: "uploads", rel: UPLOADS_REL };

  const assets: MediaAsset[] = [];
  const scanRootAbs = uploads;
  for (const source of filePaths) {
    const fileName = uniqueName(uploads, sanitizeFileName(source));
    const dest = resolveWithinRoot(
      canonicalDirectory(projectPath),
      path.join(uploads, fileName),
      { allowMissing: true, rejectFinalSymlink: true },
    );
    copyFileTracked(source, dest);
    const asset = toAssetFromAbsolute(
      projectPath,
      uploadsRootDef,
      scanRootAbs,
      dest,
    );
    if (asset) assets.push(asset);
  }
  return { assets };
}

export function deleteMedia(
  projectPath: string,
  assetId: string,
): { ok: true } {
  const usages = listMediaUsages(projectPath, assetId);
  if (usages.length > 0) {
    const summary = usages.slice(0, 3).map((usage) => `${usage.file}:${usage.line}`).join(", ");
    throw new Error(
      `MEDIA_IN_USE: This media is used in ${usages.length} location${usages.length === 1 ? "" : "s"} (${summary}). Replace those references before deleting it.`,
    );
  }
  const absolute = resolveMediaFilePath(projectPath, assetId);
  removePathTracked(absolute);
  try {
    const root = canonicalDirectory(projectPath);
    const variantsDir = resolveWithinRoot(
      root,
      path.join(
        uploadsRoot(projectPath),
        VARIANTS_DIR_NAME,
        mediaSafeKey(assetId),
      ),
      { allowMissing: true, rejectFinalSymlink: true },
    );
    if (existsSync(variantsDir)) {
      removePathTracked(variantsDir, { recursive: true, force: true });
    }
  } catch {
    // best-effort
  }
  try {
    const root = canonicalDirectory(projectPath);
    const metaFile = resolveWithinRoot(
      root,
      path.join(root, ".aria", "media", `${mediaSafeKey(assetId)}.json`),
      { allowMissing: true, rejectFinalSymlink: true },
    );
    if (existsSync(metaFile)) removePathTracked(metaFile);
  } catch {
    // best-effort
  }
  return { ok: true };
}

function mediaReferenceValues(projectPath: string, assetId: string): string[] {
  const asset = listMedia(projectPath).find((item) => item.id === assetId);
  return [...new Set([assetId, asset?.url].filter((value): value is string => Boolean(value)))];
}

function referenceFiles(projectPath: string): string[] {
  const root = canonicalDirectory(projectPath);
  const files: string[] = [];
  let visited = 0;
  const walk = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && [".git", "node_modules", "dist", ".astro"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (
        entry.isDirectory() &&
        toPosix(path.relative(root, absolute)) === ".aria/media"
      ) continue;
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile() || !REFERENCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      visited += 1;
      if (visited > MAX_REFERENCE_SCAN_FILES) throw new Error("Project is too large to scan for media usage");
      if (statSync(absolute).size <= MAX_REFERENCE_FILE_BYTES) files.push(absolute);
    }
  };
  walk(path.join(root, "src"));
  walk(path.join(root, ".aria"));
  return files;
}

export function listMediaUsages(
  projectPath: string,
  assetId: string,
): MediaAssetUsage[] {
  const root = canonicalDirectory(projectPath);
  const references = mediaReferenceValues(root, assetId);
  const usages: MediaAssetUsage[] = [];
  for (const absolute of referenceFiles(root)) {
    const content = readFileSync(absolute, "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const reference = references.find((value) => lines[index]!.includes(value));
      if (!reference) continue;
      usages.push({
        file: toPosix(path.relative(root, absolute)),
        line: index + 1,
        reference,
      });
    }
  }
  return usages;
}

type MediaReferenceRewrite = {
  absolute: string;
  next: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceExactMediaReference(
  input: string,
  before: string,
  after: string,
): string {
  const escaped = escapeRegExp(before);
  let next = input.replace(
    new RegExp(`(["'\`])${escaped}\\1`, "g"),
    (_match, quote: string) => `${quote}${after}${quote}`,
  );
  next = next.replace(
    new RegExp(`\\(${escaped}\\)`, "g"),
    () => `(${after})`,
  );
  next = next.replace(
    new RegExp(`(<)${escaped}(>)`, "g"),
    () => `<${after}>`,
  );
  next = next.replace(
    new RegExp(`(^\\s*[A-Za-z0-9_-]+\\s*:\\s*)${escaped}(\\s*(?:#.*)?$)`, "gm"),
    (_match, prefix: string, suffix: string) => `${prefix}${after}${suffix}`,
  );
  return next;
}

function planMediaReferenceRewrites(
  projectPath: string,
  beforeValues: readonly string[],
  afterValues: readonly string[],
): MediaReferenceRewrite[] {
  const rewrites: MediaReferenceRewrite[] = [];
  const unresolved: string[] = [];
  for (const absolute of referenceFiles(projectPath)) {
    const current = readFileSync(absolute, "utf8");
    let next = current;
    for (let index = 0; index < beforeValues.length; index += 1) {
      const before = beforeValues[index];
      const after = afterValues[index];
      if (!before || after === undefined) continue;
      next = replaceExactMediaReference(next, before, after);
    }
    for (const before of beforeValues) {
      if (!before || !next.includes(before)) continue;
      const line = next.slice(0, next.indexOf(before)).split(/\r?\n/).length;
      unresolved.push(
        `${toPosix(path.relative(canonicalDirectory(projectPath), absolute))}:${line}`,
      );
    }
    if (next !== current) rewrites.push({ absolute, next });
  }
  if (unresolved.length > 0) {
    throw new Error(
      `MEDIA_REFERENCE_UNSAFE: Aria could not safely rewrite ${unresolved.slice(0, 8).join(", ")}${unresolved.length > 8 ? ` and ${unresolved.length - 8} more` : ""}. Update those expressions manually before renaming this media.`,
    );
  }
  return rewrites;
}

export function renameMedia(
  projectPath: string,
  assetId: string,
  nextName: string,
): MediaAsset {
  const absolute = resolveMediaFilePath(projectPath, assetId);
  const safeNext = sanitizeFileName(nextName);
  if (!path.extname(safeNext)) {
    throw new Error("New name must include a file extension");
  }
  const parent = path.dirname(absolute);
  const projectRel = toPosix(
    path.relative(canonicalDirectory(projectPath), absolute),
  );
  const mediaRoot = mediaRootForPath(projectRel);
  if (!mediaRoot) {
    throw new Error("Media path must be under a public/ folder or src/assets");
  }
  const scanRootAbs = resolveProjectRel(projectPath, mediaRoot.rel, {
    allowMissing: true,
  });

  if (path.basename(absolute) === safeNext) {
    const same = toAssetFromAbsolute(
      projectPath,
      mediaRoot,
      scanRootAbs,
      absolute,
    );
    if (!same) throw new Error("Media could not be read");
    return same;
  }

  const finalDest = resolveWithinRoot(
    canonicalDirectory(projectPath),
    path.join(parent, safeNext),
    { allowMissing: true, rejectFinalSymlink: true },
  );
  if (existsSync(finalDest)) {
    throw new Error("A file with that name already exists");
  }
  const beforeAsset = toAssetFromAbsolute(
    projectPath,
    mediaRoot,
    scanRootAbs,
    absolute,
  );
  if (!beforeAsset) throw new Error("Media could not be read");
  const root = canonicalDirectory(projectPath);
  const nextRelative = toPosix(path.relative(scanRootAbs, finalDest));
  const nextId = toPosix(path.relative(root, finalDest));
  const nextUrl = publicUrlFor(mediaRoot, nextRelative);
  const referenceRewrites = planMediaReferenceRewrites(
    projectPath,
    [beforeAsset.id, beforeAsset.url],
    [nextId, nextUrl],
  );
  renamePathTracked(absolute, finalDest);
  const asset = toAssetFromAbsolute(
    projectPath,
    mediaRoot,
    scanRootAbs,
    finalDest,
  );
  if (!asset) throw new Error("Renamed media could not be read");
  for (const rewrite of referenceRewrites) {
    writeTextFileAtomic(rewrite.absolute, rewrite.next);
  }

  const oldMeta = path.join(root, ".aria", "media", `${mediaSafeKey(beforeAsset.id)}.json`);
  const nextMeta = path.join(root, ".aria", "media", `${mediaSafeKey(asset.id)}.json`);
  if (existsSync(oldMeta) && !existsSync(nextMeta)) renamePathTracked(oldMeta, nextMeta);
  const variantsRoot = path.join(uploadsRoot(projectPath), VARIANTS_DIR_NAME);
  const oldVariants = path.join(variantsRoot, mediaSafeKey(beforeAsset.id));
  const nextVariants = path.join(variantsRoot, mediaSafeKey(asset.id));
  if (existsSync(oldVariants) && !existsSync(nextVariants)) renamePathTracked(oldVariants, nextVariants);
  return asset;
}

export function duplicateMedia(
  projectPath: string,
  assetId: string,
): MediaAsset {
  const absolute = resolveMediaFilePath(projectPath, assetId);
  const parent = path.dirname(absolute);
  const ext = path.extname(absolute);
  const stem = path.basename(absolute, ext);
  const copyName = uniqueName(parent, `${stem}-copy${ext}`);
  const dest = resolveWithinRoot(
    canonicalDirectory(projectPath),
    path.join(parent, copyName),
    { allowMissing: true, rejectFinalSymlink: true },
  );
  copyFileTracked(absolute, dest);

  const projectRel = toPosix(
    path.relative(canonicalDirectory(projectPath), absolute),
  );
  const mediaRoot = mediaRootForPath(projectRel);
  if (!mediaRoot) {
    throw new Error("Media path must be under a public/ folder or src/assets");
  }
  const scanRootAbs = resolveProjectRel(projectPath, mediaRoot.rel, {
    allowMissing: true,
  });
  const asset = toAssetFromAbsolute(projectPath, mediaRoot, scanRootAbs, dest);
  if (!asset) throw new Error("Duplicated media could not be read");
  return asset;
}

export function readMediaPreview(
  projectPath: string,
  assetId: string,
): { dataUrl: string | null } {
  const absolute = resolveMediaFilePath(projectPath, assetId);
  const ext = path.extname(absolute).toLowerCase();
  // Images for thumbnails; fonts so the UI can FontFace-preview "Aa".
  if (!IMAGE_EXTS.has(ext) && !FONT_EXTS.has(ext)) {
    return { dataUrl: null };
  }
  const st = statSync(absolute);
  if (st.size > MAX_PREVIEW_BYTES) return { dataUrl: null };
  const mime = MIME[ext] ?? "application/octet-stream";
  const buf = readFileSync(absolute);
  return { dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
}

export function writeVariantBytes(
  projectPath: string,
  assetId: string,
  variantFileName: string,
  bytes: Uint8Array,
): { file: string; url: string } {
  const root = canonicalDirectory(projectPath);
  const safeAsset = mediaSafeKey(assertAllowedMediaPath(assetId));
  const safeVariant = sanitizeFileName(variantFileName);
  const uploads = ensureUploadsDir(projectPath);
  const dir = resolveWithinRoot(
    root,
    path.join(uploads, VARIANTS_DIR_NAME, safeAsset),
    { allowMissing: true, rejectFinalSymlink: true },
  );
  mkdirSync(dir, { recursive: true });
  const absolute = resolveWithinRoot(root, path.join(dir, safeVariant), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  writeBinaryFileAtomic(absolute, bytes, { overwrite: true });
  const file = toPosix(path.relative(root, absolute));
  const url = `/uploads/${VARIANTS_DIR_NAME}/${safeAsset}/${safeVariant}`;
  return { file, url };
}

export function deleteVariantFile(
  projectPath: string,
  assetId: string,
  variantFileName: string,
): void {
  const root = canonicalDirectory(projectPath);
  const safeAsset = mediaSafeKey(assertAllowedMediaPath(assetId));
  const safeVariant = sanitizeFileName(variantFileName);
  const uploads = uploadsRoot(projectPath);
  const absolute = resolveWithinRoot(
    root,
    path.join(uploads, VARIANTS_DIR_NAME, safeAsset, safeVariant),
    { allowMissing: true, rejectFinalSymlink: true },
  );
  if (existsSync(absolute)) removePathTracked(absolute);
}
