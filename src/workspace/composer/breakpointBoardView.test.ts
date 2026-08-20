import { describe, expect, it } from "vitest"
import {
  BREAKPOINT_BOARD_FIT_PAD,
  BREAKPOINT_BOARD_GAP,
  BREAKPOINT_BOARD_MAX_PAGE_HEIGHT,
  BREAKPOINT_BOARD_MAX_ZOOM,
  BREAKPOINT_BOARD_MIN_PAGE_HEIGHT,
  breakpointBoardWorldSize,
  clampPageHeight,
  fitBreakpointBoardView,
  fitBreakpointFrameView,
  layoutBreakpointFrames,
  openingBreakpointBoardWorld,
  panBreakpointBoardView,
  zoomBreakpointBoardView,
} from "./breakpointBoardView"

describe("breakpoint board view", () => {
  it("lays out desktop, tablet, and mobile side by side with a tight gap", () => {
    const frames = layoutBreakpointFrames()
    expect(frames.map((frame) => ({ id: frame.id, x: frame.x, width: frame.width }))).toEqual([
      { id: "desktop", x: 0, width: 1440 },
      { id: "tablet", x: 1440 + BREAKPOINT_BOARD_GAP, width: 768 },
      { id: "mobile", x: 1440 + BREAKPOINT_BOARD_GAP + 768 + BREAKPOINT_BOARD_GAP, width: 375 },
    ])
    expect(breakpointBoardWorldSize(frames)).toEqual({
      w: 1440 + BREAKPOINT_BOARD_GAP + 768 + BREAKPOINT_BOARD_GAP + 375,
      h: 1024,
    })
    expect(openingBreakpointBoardWorld()).toEqual({
      w: 1440 + BREAKPOINT_BOARD_GAP + 768 + BREAKPOINT_BOARD_GAP + 375,
      h: 1024,
    })
  })

  it("clamps reported page height and grows the world from live measurements", () => {
    expect(clampPageHeight(undefined, 900)).toBe(900)
    expect(clampPageHeight(12, 900)).toBe(BREAKPOINT_BOARD_MIN_PAGE_HEIGHT)
    expect(clampPageHeight(80_000, 900)).toBe(BREAKPOINT_BOARD_MAX_PAGE_HEIGHT)
    const frames = layoutBreakpointFrames({ desktop: 2400, tablet: 1100, mobile: 1800 })
    expect(frames.map((frame) => frame.height)).toEqual([2400, 1100, 1800])
    expect(breakpointBoardWorldSize(frames).h).toBe(2400)
  })

  it("fits the device windows top-left padded and horizontally centered", () => {
    const opening = openingBreakpointBoardWorld()
    const view = fitBreakpointBoardView({
      viewportWidth: 1749,
      viewportHeight: 800,
      worldWidth: opening.w,
      worldHeight: opening.h,
    })
    expect(view).not.toBeNull()
    expect(view!.s).toBeCloseTo((1749 - BREAKPOINT_BOARD_FIT_PAD * 2) / opening.w)
    expect(view!.x).toBeCloseTo(BREAKPOINT_BOARD_FIT_PAD)
    expect(view!.y).toBe(BREAKPOINT_BOARD_FIT_PAD)
    expect(fitBreakpointBoardView({
      viewportWidth: 0,
      viewportHeight: 800,
      worldWidth: opening.w,
      worldHeight: opening.h,
    })).toBeNull()
  })

  it("fits a single breakpoint frame into the viewport for isolate", () => {
    const frames = layoutBreakpointFrames()
    const tablet = frames[1]!
    const view = fitBreakpointFrameView({
      viewportWidth: 800,
      viewportHeight: 800,
      frameX: tablet.x,
      frameWidth: tablet.width,
      frameHeight: tablet.height,
    })
    const pad = BREAKPOINT_BOARD_FIT_PAD
    const s = Math.min((800 - pad * 2) / tablet.width, (800 - pad * 2) / tablet.height)
    expect(view).not.toBeNull()
    expect(view!.s).toBeCloseTo(s)
    expect(view!.x + tablet.x * view!.s).toBeCloseTo((800 - tablet.width * s) / 2)
    expect(view!.y).toBe(pad)
  })

  it("zooms toward a cursor origin and pans by delta", () => {
    const view = { x: 40, y: 80, s: 1 }
    const zoomed = zoomBreakpointBoardView({
      view,
      nextScale: 2,
      originX: 100,
      originY: 100,
    })
    expect(zoomed.s).toBe(2)
    expect(zoomed.x).toBe(100 - (100 - 40) * 2)
    expect(zoomed.y).toBe(100 - (100 - 80) * 2)
    expect(zoomBreakpointBoardView({
      view,
      nextScale: 99,
      originX: 0,
      originY: 0,
    }).s).toBe(BREAKPOINT_BOARD_MAX_ZOOM)
    expect(panBreakpointBoardView(view, -12, 8)).toEqual({ x: 28, y: 88, s: 1 })
  })
})
