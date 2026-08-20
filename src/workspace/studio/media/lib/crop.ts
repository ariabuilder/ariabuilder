import type { MediaCropRect, MediaFocalPoint } from "@/lib/media"

type Dimensions = { width: number; height: number }

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function stable(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/** Largest normalized crop matching an aspect ratio around a focal point. */
export function createFocalAspectRatioCrop(input: {
  source: Dimensions
  aspectRatio: Dimensions
  focalPoint?: MediaFocalPoint | null
}): MediaCropRect {
  const sourceWidth = Math.max(1, input.source.width)
  const sourceHeight = Math.max(1, input.source.height)
  const ratioWidth = Math.max(Number.EPSILON, input.aspectRatio.width)
  const ratioHeight = Math.max(Number.EPSILON, input.aspectRatio.height)
  const focalPoint = input.focalPoint ?? { x: 0.5, y: 0.5 }
  const sourceRatio = sourceWidth / sourceHeight
  const desiredRatio = ratioWidth / ratioHeight
  let width = 1
  let height = 1

  if (sourceRatio > desiredRatio) {
    width = desiredRatio / sourceRatio
  } else {
    height = sourceRatio / desiredRatio
  }

  const x = clamp(focalPoint.x - width / 2, 0, 1 - width)
  const y = clamp(focalPoint.y - height / 2, 0, 1 - height)

  return {
    x: stable(x),
    y: stable(y),
    width: stable(width),
    height: stable(height),
  }
}

export function cropToPixels(
  crop: MediaCropRect,
  sourceWidth: number,
  sourceHeight: number,
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.floor(crop.x * sourceWidth))
  const top = Math.max(0, Math.floor(crop.y * sourceHeight))
  const right = Math.min(
    sourceWidth,
    Math.max(left + 1, Math.round((crop.x + crop.width) * sourceWidth)),
  )
  const bottom = Math.min(
    sourceHeight,
    Math.max(top + 1, Math.round((crop.y + crop.height) * sourceHeight)),
  )
  return { left, top, width: right - left, height: bottom - top }
}
