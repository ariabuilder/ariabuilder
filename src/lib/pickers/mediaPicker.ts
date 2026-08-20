import type { MediaAsset, MediaAssetType } from "@/lib/media"

const SVG_EXTENSION_RE = /\.svg(?:$|[?#])/i

export function isSvgMediaAsset(asset: MediaAsset): boolean {
  return (
    asset.mimeType === "image/svg+xml" ||
    [asset.name, asset.file, asset.url].some((value) => SVG_EXTENSION_RE.test(value))
  )
}

export function mediaAssetMatchesPicker(
  asset: MediaAsset,
  mediaTypes: readonly MediaAssetType[],
  requireSvg = false,
): boolean {
  if (mediaTypes.length > 0 && !mediaTypes.includes(asset.type)) return false
  return !requireSvg || isSvgMediaAsset(asset)
}

export function findUploadedPickerAsset(
  refreshed: readonly MediaAsset[],
  uploaded: readonly MediaAsset[],
  mediaTypes: readonly MediaAssetType[],
  requireSvg = false,
): MediaAsset | null {
  const uploadedIds = new Set(uploaded.map((asset) => asset.id))
  return (
    refreshed.find(
      (asset) =>
        uploadedIds.has(asset.id) &&
        mediaAssetMatchesPicker(asset, mediaTypes, requireSvg),
    ) ?? null
  )
}
