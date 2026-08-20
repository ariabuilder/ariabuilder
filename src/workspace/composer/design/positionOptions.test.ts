import { describe, expect, it } from "vitest"
import {
  getPositionOption,
  parsePositionAxes,
  serializePositionAxes,
} from "./positionOptions"

describe("positionOptions", () => {
  it("maps percentage and keyword aliases onto the 9-point grid", () => {
    expect(getPositionOption("50% 50%")?.label).toBe("Center")
    expect(getPositionOption("0% 0%")?.label).toBe("Top Left")
    expect(getPositionOption("100% 0%")?.label).toBe("Top Right")
    expect(getPositionOption("left top")?.label).toBe("Top Left")
    expect(getPositionOption("center")?.label).toBe("Center")
  })

  it("serializes custom axes and snaps exact percents back to presets", () => {
    expect(serializePositionAxes("50", "50")).toBe("center")
    expect(serializePositionAxes("0%", "100%")).toBe("bottom left")
    expect(serializePositionAxes("23", "71")).toBe("23% 71%")
  })

  it("parses authored object-position into axes", () => {
    expect(parsePositionAxes("top right")).toMatchObject({ x: "100%", y: "0%" })
    expect(parsePositionAxes("18% 42%")).toMatchObject({
      x: "18%",
      y: "42%",
      option: undefined,
    })
  })
})
