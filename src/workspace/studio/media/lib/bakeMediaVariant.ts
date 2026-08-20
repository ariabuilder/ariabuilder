import type { MediaCropRect, MediaTransformOutput } from "@/lib/media"
import { cropToPixels } from "./crop"

export type BakeMediaVariantInput = {
  /** data URL or blob URL of the source image */
  sourceUrl: string
  crop: MediaCropRect
  output: MediaTransformOutput
}

export type BakedMediaVariant = {
  bytes: Uint8Array
  mimeType: string
  extension: string
  width: number
  height: number
}

function resolveEncodeFormat(
  format: MediaTransformOutput["format"],
  sourceMime: string | null,
): { mimeType: string; extension: string; quality?: number } {
  if (format === "png") return { mimeType: "image/png", extension: ".png" }
  if (format === "webp") {
    return { mimeType: "image/webp", extension: ".webp", quality: undefined }
  }
  if (format === "jpeg") {
    return { mimeType: "image/jpeg", extension: ".jpg", quality: undefined }
  }
  // avif/auto → prefer webp, else jpeg from photographic sources
  if (sourceMime === "image/png" || sourceMime === "image/svg+xml") {
    return { mimeType: "image/png", extension: ".png" }
  }
  return { mimeType: "image/webp", extension: ".webp", quality: undefined }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Failed to decode source image"))
    img.src = url
  })
}

/** Chromium canvas bake — no native sharp dependency. */
export async function bakeMediaVariant(
  input: BakeMediaVariantInput,
): Promise<BakedMediaVariant> {
  const image = await loadImage(input.sourceUrl)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) {
    throw new Error("Unable to determine source image dimensions")
  }

  const rect = cropToPixels(input.crop, sourceWidth, sourceHeight)
  let outWidth = rect.width
  let outHeight = rect.height
  if (input.output.width || input.output.height) {
    const targetW = input.output.width ?? outWidth
    const targetH = input.output.height ?? outHeight
    const scale = Math.min(targetW / rect.width, targetH / rect.height, 1)
    outWidth = Math.max(1, Math.round(rect.width * scale))
    outHeight = Math.max(1, Math.round(rect.height * scale))
  }

  const canvas = document.createElement("canvas")
  canvas.width = outWidth
  canvas.height = outHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas is unavailable")
  ctx.drawImage(
    image,
    rect.left,
    rect.top,
    rect.width,
    rect.height,
    0,
    0,
    outWidth,
    outHeight,
  )

  const encoded = resolveEncodeFormat(input.output.format, null)
  const quality = Math.min(1, Math.max(0.01, input.output.quality / 100))
  let blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (result) => resolve(result),
      encoded.mimeType,
      encoded.mimeType === "image/png" ? undefined : quality,
    )
  })
  // Some Chromium builds reject webp encode; fall back to jpeg so save still works.
  let mimeType = encoded.mimeType
  let extension = encoded.extension
  if (!blob && mimeType === "image/webp") {
    mimeType = "image/jpeg"
    extension = ".jpg"
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), mimeType, quality)
    })
  }
  if (!blob) throw new Error("Failed to encode cropped image")
  const buffer = new Uint8Array(await blob.arrayBuffer())
  return {
    bytes: buffer,
    mimeType,
    extension,
    width: outWidth,
    height: outHeight,
  }
}
