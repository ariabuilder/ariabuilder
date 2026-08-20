import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeBinaryFileAtomic,
} from "../../pathSafety";
import { downloadRemoteResource } from "./remoteDownload";
import type { WordPressSourceItem } from "./source";

export const WORDPRESS_MEDIA_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

const WORDPRESS_UPLOADS_REL = "public/uploads/wordpress";

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name).trim();
  if (!base || base === "." || base === "..") {
    return "attachment.bin";
  }
  return base.replace(/[<>:"|?*\\/]/g, "-").replace(/[^\w.\-]+/g, "-");
}

export function mediaFilenameFromUrl(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    if (name) {
      return sanitizeFileName(name);
    }
  } catch {
    // Fall through to fallback.
  }
  return sanitizeFileName(`${fallback}.bin`);
}

export function mediaRelativePathForAttachment(item: WordPressSourceItem): string {
  const filename = mediaFilenameFromUrl(
    item.attachmentUrl ?? item.content ?? item.slug,
    `attachment-${item.id}`,
  );
  return toPosix(path.join(WORDPRESS_UPLOADS_REL, `${item.id}-${filename}`));
}

export function computeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type InstalledWordPressMedia = {
  /** Project-relative path used as CMS mediaId (e.g. public/uploads/wordpress/...). */
  mediaId: string;
  /** Public URL (e.g. /uploads/wordpress/...). */
  publicUrl: string;
  contentType: string | null;
  sizeBytes: number;
  sha256: string;
};

/**
 * Write attachment bytes under public/uploads/wordpress/ and return CMS media refs.
 * Prefer this over installMediaFiles so imports keep a stable wordpress/ prefix.
 */
export function installWordPressMediaBytes(
  projectPath: string,
  relativePath: string,
  bytes: Uint8Array,
  contentType?: string | null,
): InstalledWordPressMedia {
  const root = canonicalDirectory(projectPath);
  const posix = toPosix(relativePath).replace(/^\/+/, "");
  if (!posix.startsWith(`${WORDPRESS_UPLOADS_REL}/`)) {
    throw new Error(
      `WordPress media path must be under ${WORDPRESS_UPLOADS_REL}/`,
    );
  }
  const absolute = resolveWithinRoot(
    root,
    path.join(root, ...posix.split("/")),
    { allowMissing: true, rejectFinalSymlink: true },
  );
  mkdirSync(path.dirname(absolute), { recursive: true });
  if (!existsSync(absolute)) {
    writeBinaryFileAtomic(absolute, bytes, { overwrite: false });
  } else {
    writeBinaryFileAtomic(absolute, bytes);
  }
  const publicUrl = `/${posix.slice("public/".length)}`;
  return {
    mediaId: posix,
    publicUrl,
    contentType: contentType ?? null,
    sizeBytes: bytes.byteLength,
    sha256: computeSha256(bytes),
  };
}

export async function downloadAndInstallWordPressAttachment(input: {
  projectPath: string;
  item: WordPressSourceItem;
  sourceUrl: string;
  maxBytes?: number;
}): Promise<InstalledWordPressMedia> {
  const download = await downloadRemoteResource(input.sourceUrl, {
    maxBytes: input.maxBytes ?? WORDPRESS_MEDIA_UPLOAD_MAX_BYTES,
  });
  const contentType = download.response.headers.get("content-type");
  const relativePath = mediaRelativePathForAttachment(input.item);
  return installWordPressMediaBytes(
    input.projectPath,
    relativePath,
    download.bytes,
    contentType,
  );
}
