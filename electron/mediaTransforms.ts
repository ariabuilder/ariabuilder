import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  canonicalDirectory,
  removePathTracked,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";
import {
  deleteVariantFile,
  mediaSafeKey,
  writeVariantBytes,
} from "./media";
import type {
  MediaAssetProfile,
  MediaCropRect,
  MediaFocalPoint,
  MediaAspectRatio,
  MediaTransformOutput,
  MediaTransformState,
  MediaTransformVariant,
} from "../shared/types";

const MEDIA_META_DIR = path.join(".aria", "media");

function metaRoot(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(root, path.join(root, MEDIA_META_DIR), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function assetMetaPath(projectPath: string, assetId: string): string {
  const root = canonicalDirectory(projectPath);
  const safeId = mediaSafeKey(assetId);
  const dir = metaRoot(projectPath);
  return resolveWithinRoot(root, path.join(dir, `${safeId}.json`), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeCrop(raw: unknown): MediaCropRect | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    !isFiniteNumber(o.x) ||
    !isFiniteNumber(o.y) ||
    !isFiniteNumber(o.width) ||
    !isFiniteNumber(o.height)
  ) {
    return null;
  }
  if (o.x < 0 || o.y < 0 || o.width <= 0 || o.height <= 0) return null;
  if (o.x + o.width > 1.000001 || o.y + o.height > 1.000001) return null;
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}

function normalizeFocal(raw: unknown): MediaFocalPoint | null {
  if (raw == null) return null;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isFiniteNumber(o.x) || !isFiniteNumber(o.y)) return null;
  if (o.x < 0 || o.x > 1 || o.y < 0 || o.y > 1) return null;
  return { x: o.x, y: o.y };
}

function normalizeAspect(raw: unknown): MediaAspectRatio | null {
  if (raw == null) return null;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isFiniteNumber(o.width) || !isFiniteNumber(o.height)) return null;
  if (o.width <= 0 || o.height <= 0) return null;
  return { width: o.width, height: o.height };
}

function normalizeOutput(raw: unknown): MediaTransformOutput {
  const defaults: MediaTransformOutput = {
    width: null,
    height: null,
    format: "auto",
    quality: 92,
  };
  if (!raw || typeof raw !== "object") return defaults;
  const o = raw as Record<string, unknown>;
  const format =
    o.format === "jpeg" ||
    o.format === "png" ||
    o.format === "webp" ||
    o.format === "avif" ||
    o.format === "auto"
      ? o.format
      : "auto";
  const quality =
    isFiniteNumber(o.quality) && o.quality >= 1 && o.quality <= 100
      ? Math.round(o.quality)
      : 92;
  const width =
    o.width == null
      ? null
      : isFiniteNumber(o.width) && o.width > 0
        ? Math.round(o.width)
        : null;
  const height =
    o.height == null
      ? null
      : isFiniteNumber(o.height) && o.height > 0
        ? Math.round(o.height)
        : null;
  return { width, height, format, quality };
}

function normalizeProfile(
  raw: unknown,
  assetPath: string,
): MediaAssetProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const now = new Date().toISOString();
  return {
    assetPath,
    currentSourceVersion:
      isFiniteNumber(o.currentSourceVersion) && o.currentSourceVersion > 0
        ? Math.round(o.currentSourceVersion)
        : 1,
    altText: typeof o.altText === "string" ? o.altText.slice(0, 2000) : null,
    title: typeof o.title === "string" ? o.title.slice(0, 500) : null,
    caption: typeof o.caption === "string" ? o.caption.slice(0, 4000) : null,
    credit: typeof o.credit === "string" ? o.credit.slice(0, 500) : null,
    copyright: typeof o.copyright === "string" ? o.copyright.slice(0, 500) : null,
    focalPoint: normalizeFocal(o.focalPoint),
    createdAt: typeof o.createdAt === "string" ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : now,
  };
}

function normalizeVariant(
  raw: unknown,
  assetPath: string,
): MediaTransformVariant | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const crop = normalizeCrop(o.crop);
  if (!id || !name || !crop) return null;
  const now = new Date().toISOString();
  return {
    id,
    assetPath,
    name: name.slice(0, 100),
    sourceVersion:
      isFiniteNumber(o.sourceVersion) && o.sourceVersion > 0
        ? Math.round(o.sourceVersion)
        : 1,
    crop,
    focalPoint: normalizeFocal(o.focalPoint),
    aspectRatio: normalizeAspect(o.aspectRatio),
    output: normalizeOutput(o.output),
    url: typeof o.url === "string" ? o.url : "",
    file: typeof o.file === "string" ? o.file : "",
    createdAt: typeof o.createdAt === "string" ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : now,
  };
}

type AssetMetaFile = {
  profile: MediaAssetProfile | null;
  variants: MediaTransformVariant[];
};

function readMetaFile(
  projectPath: string,
  assetId: string,
): AssetMetaFile {
  const file = assetMetaPath(projectPath, assetId);
  if (!existsSync(file)) {
    return { profile: null, variants: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { profile: null, variants: [] };
    }
    const o = parsed as Record<string, unknown>;
    const profile = normalizeProfile(o.profile, assetId);
    const variants: MediaTransformVariant[] = [];
    if (Array.isArray(o.variants)) {
      for (const item of o.variants) {
        const variant = normalizeVariant(item, assetId);
        if (variant) variants.push(variant);
      }
    }
    return { profile, variants };
  } catch {
    return { profile: null, variants: [] };
  }
}

function writeMetaFile(
  projectPath: string,
  assetId: string,
  meta: AssetMetaFile,
): void {
  const root = canonicalDirectory(projectPath);
  const dir = metaRoot(projectPath);
  mkdirSync(dir, { recursive: true });
  const file = assetMetaPath(projectPath, assetId);
  writeTextFileAtomic(
    resolveWithinRoot(root, file, {
      allowMissing: true,
      rejectFinalSymlink: true,
    }),
    JSON.stringify(meta, null, 2),
    { overwrite: true },
  );
}

export function countVariantsForAsset(
  projectPath: string,
  assetId: string,
): number {
  try {
    return readMetaFile(projectPath, assetId).variants.length;
  } catch {
    return 0;
  }
}

export function getMediaTransformState(
  projectPath: string,
  assetId: string,
): MediaTransformState {
  const meta = readMetaFile(projectPath, assetId);
  return {
    profile: meta.profile,
    variants: meta.variants,
  };
}

export function saveMediaProfile(
  projectPath: string,
  input: {
    assetPath: string;
    currentSourceVersion?: number;
    altText?: string | null;
    title?: string | null;
    caption?: string | null;
    credit?: string | null;
    copyright?: string | null;
    focalPoint?: MediaFocalPoint | null;
  },
): MediaAssetProfile {
  const assetId = input.assetPath.trim();
  const meta = readMetaFile(projectPath, assetId);
  const now = new Date().toISOString();
  const profile: MediaAssetProfile = {
    assetPath: assetId,
    currentSourceVersion: input.currentSourceVersion ?? meta.profile?.currentSourceVersion ?? 1,
    altText: input.altText ?? meta.profile?.altText ?? null,
    title: input.title ?? meta.profile?.title ?? null,
    caption: input.caption ?? meta.profile?.caption ?? null,
    credit: input.credit ?? meta.profile?.credit ?? null,
    copyright: input.copyright ?? meta.profile?.copyright ?? null,
    focalPoint:
      input.focalPoint === undefined
        ? (meta.profile?.focalPoint ?? null)
        : input.focalPoint,
    createdAt: meta.profile?.createdAt ?? now,
    updatedAt: now,
  };
  writeMetaFile(projectPath, assetId, { profile, variants: meta.variants });
  return profile;
}

function extensionForFormat(
  format: MediaTransformOutput["format"],
  sourceExt: string,
): string {
  if (format === "jpeg") return ".jpg";
  if (format === "png") return ".png";
  if (format === "webp") return ".webp";
  // avif/auto → webp for Chromium bake
  if (format === "avif") return ".webp";
  const lower = sourceExt.toLowerCase();
  if (lower === ".png") return ".png";
  if (lower === ".webp") return ".webp";
  return ".jpg";
}

export function saveMediaVariant(
  projectPath: string,
  input: {
    id: string;
    assetPath: string;
    name: string;
    sourceVersion?: number;
    crop: MediaCropRect;
    focalPoint?: MediaFocalPoint | null;
    aspectRatio?: MediaAspectRatio | null;
    output: MediaTransformOutput;
    bytes: Uint8Array;
  },
): { profile: MediaAssetProfile; variant: MediaTransformVariant } {
  const assetId = input.assetPath.trim();
  const crop = normalizeCrop(input.crop);
  if (!crop) throw new Error("Invalid crop");
  const name = input.name.trim();
  if (!name) throw new Error("Variant name is required");
  if (!input.id.trim()) throw new Error("Variant id is required");
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
    throw new Error("Variant bytes are required");
  }

  const meta = readMetaFile(projectPath, assetId);
  const now = new Date().toISOString();
  const output = normalizeOutput(input.output);
  const ext = extensionForFormat(output.format, path.extname(assetId));
  const safeStem = name.replace(/[<>:"|?*\\/]/g, "-").slice(0, 80) || "variant";
  const variantFileName = `${safeStem}-${input.id.slice(0, 8)}${ext}`;

  // Remove previous baked file if replacing.
  const existing = meta.variants.find((v) => v.id === input.id);
  if (existing?.file) {
    try {
      deleteVariantFile(projectPath, assetId, path.basename(existing.file));
    } catch {
      // best-effort
    }
  }

  const written = writeVariantBytes(
    projectPath,
    assetId,
    variantFileName,
    input.bytes,
  );

  const variant: MediaTransformVariant = {
    id: input.id.trim(),
    assetPath: assetId,
    name: name.slice(0, 100),
    sourceVersion: input.sourceVersion ?? meta.profile?.currentSourceVersion ?? 1,
    crop,
    focalPoint: input.focalPoint ?? null,
    aspectRatio: input.aspectRatio ?? null,
    output,
    url: written.url,
    file: written.file,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const variants = meta.variants.filter((v) => v.id !== variant.id);
  variants.push(variant);
  variants.sort((a, b) => a.name.localeCompare(b.name));

  const profile: MediaAssetProfile = meta.profile ?? {
    assetPath: assetId,
    currentSourceVersion: 1,
    altText: null,
    title: null,
    caption: null,
    credit: null,
    copyright: null,
    focalPoint: null,
    createdAt: now,
    updatedAt: now,
  };
  profile.updatedAt = now;

  writeMetaFile(projectPath, assetId, { profile, variants });
  return { profile, variant };
}

export function saveMediaVariantWithProfile(
  projectPath: string,
  input: {
    variant: Parameters<typeof saveMediaVariant>[1];
    profile: Parameters<typeof saveMediaProfile>[1];
  },
): { profile: MediaAssetProfile; variant: MediaTransformVariant } {
  if (input.variant.assetPath.trim() !== input.profile.assetPath.trim()) {
    throw new Error("Variant and profile must target the same media asset");
  }
  const saved = saveMediaVariant(projectPath, input.variant);
  const profile = saveMediaProfile(projectPath, input.profile);
  return { profile, variant: saved.variant };
}

export function deleteMediaVariant(
  projectPath: string,
  assetId: string,
  variantId: string,
): MediaTransformState {
  const id = assetId.trim();
  const meta = readMetaFile(projectPath, id);
  const existing = meta.variants.find((v) => v.id === variantId);
  if (existing?.file) {
    try {
      deleteVariantFile(projectPath, id, path.basename(existing.file));
    } catch {
      // best-effort
    }
  }
  const variants = meta.variants.filter((v) => v.id !== variantId);
  writeMetaFile(projectPath, id, { profile: meta.profile, variants });
  return { profile: meta.profile, variants };
}

/** Delete transform metadata when the source asset is removed. */
export function deleteMediaMeta(
  projectPath: string,
  assetId: string,
): void {
  const file = assetMetaPath(projectPath, assetId);
  if (existsSync(file)) removePathTracked(file);
  // Clean empty media dir noise is fine to leave.
  try {
    const dir = metaRoot(projectPath);
    if (existsSync(dir) && readdirSync(dir).length === 0) {
      removePathTracked(dir);
    }
  } catch {
    // ignore
  }
}
