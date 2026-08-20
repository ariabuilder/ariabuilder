import { describe, expect, it } from "vitest"
import { BREAKPOINT_BOARD_PRESETS, STAGE_DEVICE_WIDTH } from "./devicePreview"

describe("device preview presets", () => {
  it("keeps board desktop at 1440px and Stage desktop as a tweenable 100%", () => {
    expect(BREAKPOINT_BOARD_PRESETS.map((preset) => preset.id)).toEqual([
      "desktop",
      "tablet",
      "mobile",
    ])
    expect(BREAKPOINT_BOARD_PRESETS[0]).toMatchObject({ width: 1440, viewportHeight: 900 })
    expect(BREAKPOINT_BOARD_PRESETS[1]).toMatchObject({ width: 768, viewportHeight: 1024 })
    expect(BREAKPOINT_BOARD_PRESETS[2]).toMatchObject({ width: 375, viewportHeight: 812 })
    expect(STAGE_DEVICE_WIDTH).toEqual({
      desktop: "100%",
      tablet: "768px",
      mobile: "375px",
    })
  })
})
