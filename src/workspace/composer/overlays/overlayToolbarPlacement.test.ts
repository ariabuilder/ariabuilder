import { describe, expect, it } from "vitest"
import { overlayToolbarPlacement } from "./overlayToolbarPlacement"

function canvasTop(rectY: number, placement: ReturnType<typeof overlayToolbarPlacement>) {
  return rectY + Number.parseFloat(placement.top)
}

describe("overlay toolbar placement", () => {
  it("pins an oversized root selection inside the top of the canvas", () => {
    const rect = { x: 0, y: 0, w: 856, h: 1051 }
    const placement = overlayToolbarPlacement(rect, { width: 856, height: 824 })
    expect(canvasTop(rect.y, placement)).toBe(2)
    expect(placement.transform).toBe("translateX(-50%)")
  })

  it("pins a scrolled oversized selection to the nearest visible edge", () => {
    const rect = { x: 0, y: -200, w: 856, h: 1000 }
    const placement = overlayToolbarPlacement(rect, { width: 856, height: 824 })
    expect(canvasTop(rect.y, placement)).toBe(788)
  })

  it("preserves normal above and below placement when either fits", () => {
    const aboveRect = { x: 20, y: 200, w: 200, h: 60 }
    const above = overlayToolbarPlacement(aboveRect, { width: 856, height: 824 })
    expect(canvasTop(aboveRect.y, above)).toBe(154)

    const belowRect = { x: 20, y: 10, w: 200, h: 60 }
    const below = overlayToolbarPlacement(belowRect, { width: 856, height: 824 })
    expect(canvasTop(belowRect.y, below)).toBe(109)
  })
})
