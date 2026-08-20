import type { DevicePreview } from "@/workspace/types"
import {
  BREAKPOINT_BOARD_PRESETS,
  type BreakpointBoardPreset,
} from "./devicePreview"

export const BREAKPOINT_BOARD_GAP = 40
export const BREAKPOINT_BOARD_MIN_ZOOM = 0.05
export const BREAKPOINT_BOARD_MAX_ZOOM = 4
export const BREAKPOINT_BOARD_MIN_PAGE_HEIGHT = 200
export const BREAKPOINT_BOARD_MAX_PAGE_HEIGHT = 30_000
export const BREAKPOINT_BOARD_FIT_PAD = 56

export type BreakpointBoardFrame = BreakpointBoardPreset & {
  x: number
  height: number
}

export type BreakpointBoardView = {
  x: number
  y: number
  s: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function clampPageHeight(height: number | undefined, fallback: number): number {
  return clamp(
    Number.isFinite(height) ? height! : fallback,
    BREAKPOINT_BOARD_MIN_PAGE_HEIGHT,
    BREAKPOINT_BOARD_MAX_PAGE_HEIGHT,
  )
}

export function layoutBreakpointFrames(
  heights: Partial<Record<DevicePreview, number>> = {},
): BreakpointBoardFrame[] {
  let x = 0
  return BREAKPOINT_BOARD_PRESETS.map((preset) => {
    const frame = {
      ...preset,
      x,
      height: clampPageHeight(heights[preset.id], preset.viewportHeight),
    }
    x += preset.width + BREAKPOINT_BOARD_GAP
    return frame
  })
}

export function breakpointBoardWorldSize(frames: BreakpointBoardFrame[]): {
  w: number
  h: number
} {
  const last = frames[frames.length - 1]
  if (!last) return { w: 0, h: 0 }
  return {
    w: last.x + last.width,
    h: Math.max(...frames.map((frame) => frame.height)),
  }
}

/** Device windows only — the Preview starting camera, before live page heights arrive. */
export function openingBreakpointBoardWorld(): { w: number; h: number } {
  return breakpointBoardWorldSize(layoutBreakpointFrames())
}

export function fitBreakpointBoardView(input: {
  viewportWidth: number
  viewportHeight: number
  worldWidth: number
  worldHeight: number
}): BreakpointBoardView | null {
  if (input.viewportWidth <= 1 || input.viewportHeight <= 1) return null
  const pad = BREAKPOINT_BOARD_FIT_PAD
  const s = clamp(
    Math.min(
      (input.viewportWidth - pad * 2) / Math.max(input.worldWidth, 1),
      (input.viewportHeight - pad * 2) / Math.max(input.worldHeight, 1),
    ),
    BREAKPOINT_BOARD_MIN_ZOOM,
    1,
  )
  return {
    s,
    x: (input.viewportWidth - input.worldWidth * s) / 2,
    y: pad,
  }
}

export function fitBreakpointFrameView(input: {
  viewportWidth: number
  viewportHeight: number
  frameX: number
  frameWidth: number
  frameHeight: number
}): BreakpointBoardView | null {
  const fitted = fitBreakpointBoardView({
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    worldWidth: input.frameWidth,
    worldHeight: input.frameHeight,
  })
  if (!fitted) return null
  return {
    s: fitted.s,
    x: fitted.x - input.frameX * fitted.s,
    y: fitted.y,
  }
}

export function zoomBreakpointBoardView(input: {
  view: BreakpointBoardView
  nextScale: number
  originX: number
  originY: number
}): BreakpointBoardView {
  const s = clamp(input.nextScale, BREAKPOINT_BOARD_MIN_ZOOM, BREAKPOINT_BOARD_MAX_ZOOM)
  const k = input.view.s === 0 ? 1 : s / input.view.s
  return {
    s,
    x: input.originX - (input.originX - input.view.x) * k,
    y: input.originY - (input.originY - input.view.y) * k,
  }
}

export function panBreakpointBoardView(
  view: BreakpointBoardView,
  dx: number,
  dy: number,
): BreakpointBoardView {
  return { ...view, x: view.x + dx, y: view.y + dy }
}
