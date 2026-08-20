import type {
  MediaAspectRatio,
  MediaAsset,
  MediaAssetProfile,
  MediaAssetUsage,
  MediaAssetType,
  MediaCropRect,
  MediaFocalPoint,
  MediaGroupingState,
  MediaTransformOutput,
  MediaTransformState,
  MediaTransformVariant,
} from "../../shared/types";

export type {
  MediaAspectRatio,
  MediaAsset,
  MediaAssetProfile,
  MediaAssetUsage,
  MediaAssetType,
  MediaCropRect,
  MediaFocalPoint,
  MediaGroupingState,
  MediaTransformOutput,
  MediaTransformState,
  MediaTransformVariant,
};

export type SaveMediaVariantInput = {
  id: string;
  assetPath: string;
  name: string;
  sourceVersion?: number;
  crop: MediaCropRect;
  focalPoint?: MediaFocalPoint | null;
  aspectRatio?: MediaAspectRatio | null;
  output: MediaTransformOutput;
  bytes: Uint8Array;
};

export type SaveMediaProfileInput = {
  assetPath: string;
  currentSourceVersion?: number;
  altText?: string | null;
  title?: string | null;
  caption?: string | null;
  credit?: string | null;
  copyright?: string | null;
  focalPoint?: MediaFocalPoint | null;
};

function api() {
  if (!window.aria) {
    throw new Error(
      "Aria desktop bridge is unavailable. Restart the app with npm run dev.",
    );
  }
  if (!window.aria.media) {
    throw new Error(
      "Media API missing from preload. Stop the app and run npm run dev again.",
    );
  }
  return window.aria.media;
}

/**
 * Electron IPC uses structured clone, which rejects Vue's reactive proxies.
 * Keep these payloads explicitly plain while leaving the binary image data as
 * a TypedArray, which Electron can transfer safely.
 */
function toIpcProfile(input: SaveMediaProfileInput): SaveMediaProfileInput {
  return {
    assetPath: input.assetPath,
    ...(input.currentSourceVersion === undefined
      ? {}
      : { currentSourceVersion: input.currentSourceVersion }),
    ...(input.altText === undefined ? {} : { altText: input.altText }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.caption === undefined ? {} : { caption: input.caption }),
    ...(input.credit === undefined ? {} : { credit: input.credit }),
    ...(input.copyright === undefined ? {} : { copyright: input.copyright }),
    ...(input.focalPoint === undefined
      ? {}
      : {
          focalPoint: input.focalPoint
            ? { x: input.focalPoint.x, y: input.focalPoint.y }
            : null,
        }),
  };
}

function toIpcVariant(input: SaveMediaVariantInput): SaveMediaVariantInput {
  return {
    id: input.id,
    assetPath: input.assetPath,
    name: input.name,
    ...(input.sourceVersion === undefined
      ? {}
      : { sourceVersion: input.sourceVersion }),
    crop: {
      x: input.crop.x,
      y: input.crop.y,
      width: input.crop.width,
      height: input.crop.height,
    },
    ...(input.focalPoint === undefined
      ? {}
      : {
          focalPoint: input.focalPoint
            ? { x: input.focalPoint.x, y: input.focalPoint.y }
            : null,
        }),
    ...(input.aspectRatio === undefined
      ? {}
      : {
          aspectRatio: input.aspectRatio
            ? {
                width: input.aspectRatio.width,
                height: input.aspectRatio.height,
              }
            : null,
        }),
    output: {
      width: input.output.width,
      height: input.output.height,
      format: input.output.format,
      quality: input.output.quality,
    },
    bytes: input.bytes,
  };
}

export function listMedia(projectPath: string): Promise<MediaAsset[]> {
  return api().list(projectPath);
}

export function listMediaUsages(projectPath: string, assetId: string) {
  return api().usages(projectPath, assetId)
}

export function uploadMedia(
  projectPath: string,
): Promise<{ assets: MediaAsset[] } | { canceled: true }> {
  return api().upload(projectPath);
}

export function deleteMedia(
  projectPath: string,
  assetId: string,
): Promise<{ ok: true }> {
  return api().delete(projectPath, assetId);
}

export function renameMedia(
  projectPath: string,
  assetId: string,
  nextName: string,
): Promise<MediaAsset> {
  return api().rename(projectPath, assetId, nextName);
}

export function duplicateMedia(
  projectPath: string,
  assetId: string,
): Promise<MediaAsset> {
  return api().duplicate(projectPath, assetId);
}

export function revealMedia(
  projectPath: string,
  assetId: string,
): Promise<{ path: string }> {
  return api().reveal(projectPath, assetId);
}

export function resolveMedia(
  projectPath: string,
  assetId: string,
): Promise<{ path: string }> {
  return api().resolve(projectPath, assetId);
}

export function previewMedia(
  projectPath: string,
  assetId: string,
): Promise<{ dataUrl: string | null }> {
  return api().preview(projectPath, assetId);
}

export function getPlayableMediaUrl(
  projectPath: string,
  assetId: string,
): Promise<{ url: string; mimeType: string | null }> {
  return api().getPlayableUrl(projectPath, assetId);
}

export function getMediaGrouping(
  projectPath: string,
): Promise<MediaGroupingState> {
  return api().getGrouping(projectPath);
}

export function updateMediaGrouping(
  projectPath: string,
  grouping: MediaGroupingState,
): Promise<MediaGroupingState> {
  return api().updateGrouping(projectPath, grouping);
}

export function getMediaTransformState(
  projectPath: string,
  assetId: string,
): Promise<MediaTransformState> {
  return api().getTransformState(projectPath, assetId);
}

export function saveMediaProfile(
  projectPath: string,
  input: SaveMediaProfileInput,
): Promise<MediaAssetProfile> {
  return api().saveProfile(projectPath, toIpcProfile(input));
}

export function saveMediaVariant(
  projectPath: string,
  input: SaveMediaVariantInput,
): Promise<{ profile: MediaAssetProfile; variant: MediaTransformVariant }> {
  return api().saveVariant(projectPath, toIpcVariant(input));
}

export function saveMediaVariantWithProfile(
  projectPath: string,
  input: { variant: SaveMediaVariantInput; profile: SaveMediaProfileInput },
): Promise<{ profile: MediaAssetProfile; variant: MediaTransformVariant }> {
  return api().saveVariantWithProfile(projectPath, {
    variant: toIpcVariant(input.variant),
    profile: toIpcProfile(input.profile),
  });
}

export function deleteMediaVariant(
  projectPath: string,
  assetId: string,
  variantId: string,
): Promise<MediaTransformState> {
  return api().deleteVariant(projectPath, assetId, variantId);
}
