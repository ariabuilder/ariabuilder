import type { AriaRect } from "../../../../shared/composer/protocol"

const TOOLBAR_PADDING = 2
const TOOLBAR_OFFSET = 12
const TOOLBAR_HALF_WIDTH = 144
const TOOLBAR_HEIGHT = 34
const SIZE_BADGE_HEIGHT = 20
const SIZE_BADGE_GAP = 7

export type OverlayToolbarPlacement = {
  left: string
  top: string
  maxWidth: string
  transform: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/** Keep the selection toolbar visible even when its selection spans the canvas. */
export function overlayToolbarPlacement(
  rect: AriaRect,
  viewport: { width: number; height: number },
): OverlayToolbarPlacement {
  const rootWidth = Math.max(0, viewport.width)
  const rootHeight = Math.max(0, viewport.height)
  const desiredCenter = rect.x + rect.w / 2
  const availableHalf = Math.max(0, (rootWidth - TOOLBAR_PADDING * 2) / 2)
  const halfWidth = Math.min(TOOLBAR_HALF_WIDTH, availableHalf)
  const clampedCenter = clamp(
    desiredCenter,
    TOOLBAR_PADDING + halfWidth,
    Math.max(TOOLBAR_PADDING + halfWidth, rootWidth - TOOLBAR_PADDING - halfWidth),
  )

  const above = rect.y - TOOLBAR_OFFSET - TOOLBAR_HEIGHT
  const below =
    rect.y + rect.h + TOOLBAR_OFFSET + SIZE_BADGE_GAP + SIZE_BADGE_HEIGHT
  const minTop = TOOLBAR_PADDING
  const maxTop = Math.max(minTop, rootHeight - TOOLBAR_PADDING - TOOLBAR_HEIGHT)
  const aboveFits = above >= minTop && above <= maxTop
  const belowFits = below >= minTop && below <= maxTop

  let canvasTop: number
  if (aboveFits) canvasTop = above
  else if (belowFits) canvasTop = below
  else {
    const clampedAbove = clamp(above, minTop, maxTop)
    const clampedBelow = clamp(below, minTop, maxTop)
    canvasTop = Math.abs(clampedAbove - above) <= Math.abs(clampedBelow - below)
      ? clampedAbove
      : clampedBelow
  }

  return {
    left: `${clampedCenter - rect.x}px`,
    top: `${canvasTop - rect.y}px`,
    maxWidth: `${Math.max(0, rootWidth - TOOLBAR_PADDING * 2)}px`,
    transform: "translateX(-50%)",
  }
}
