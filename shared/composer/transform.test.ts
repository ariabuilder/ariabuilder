import { describe, expect, it } from "vitest"
import {
  TRANSFORM_DEFAULTS,
  cssToTransformState,
  defaultTransformState,
  hasUnsupportedTransformFunctions,
  isOriginPresetActive,
  styleMapToTransformState,
  transformOriginStateToCSS,
  transformStateToCSS,
  transformStateToStyleUpdates,
} from "./transform"

describe("transform", () => {
  it("omits identity functions and writes default origin as two keywords", () => {
    const state = defaultTransformState()
    expect(transformStateToCSS(state)).toBe("none")
    expect(transformOriginStateToCSS(state)).toBe("center center")
  })

  it("round-trips combined transform functions and origin", () => {
    const css =
      "translate(12px, 18px) rotate(45deg) scale(1.1, 1.2) skew(2deg, 4deg)"
    const state = cssToTransformState(css, "left top")
    expect(state).toEqual({
      translateX: "12px",
      translateY: "18px",
      rotate: "45deg",
      scaleX: "1.1",
      scaleY: "1.2",
      skewX: "2deg",
      skewY: "4deg",
      originX: "left",
      originY: "top",
    })
    expect(transformStateToCSS(state)).toBe(css)
    expect(transformOriginStateToCSS(state)).toBe("left top")
  })

  it("parses space-separated function arguments", () => {
    const state = cssToTransformState(
      "translate(12px 18px) scale(1.2 0.8)",
      "",
    )
    expect(state.translateX).toBe("12px")
    expect(state.translateY).toBe("18px")
    expect(state.scaleX).toBe("1.2")
    expect(state.scaleY).toBe("0.8")
    expect(transformStateToCSS(state)).toBe(
      "translate(12px, 18px) scale(1.2, 0.8)",
    )
  })

  it("copies a single scale argument to both axes", () => {
    const state = cssToTransformState("scale(1.4)", "")
    expect(state.scaleX).toBe("1.4")
    expect(state.scaleY).toBe("1.4")
    expect(transformStateToCSS(state)).toBe("scale(1.4, 1.4)")
  })

  it("passes var/calc/clamp through without adding units", () => {
    const state = {
      ...TRANSFORM_DEFAULTS,
      translateX: "var(--shift-x)",
      rotate: "calc(45deg + 10deg)",
      scaleX: "clamp(0.8, 1, 1.2)",
    }
    expect(transformStateToCSS(state)).toBe(
      "translate(var(--shift-x), 0px) rotate(calc(45deg + 10deg)) scale(clamp(0.8, 1, 1.2), 1)",
    )
  })

  it("adds implied units to bare numbers", () => {
    expect(
      transformStateToCSS({
        ...TRANSFORM_DEFAULTS,
        translateX: "12",
        rotate: "45",
        skewY: "8",
      }),
    ).toBe("translate(12px, 0px) rotate(45deg) skew(0deg, 8deg)")
  })

  it("detects unsupported transform functions and ignores known axis forms", () => {
    expect(hasUnsupportedTransformFunctions("matrix(1, 0, 0, 1, 10, 20)")).toBe(true)
    expect(hasUnsupportedTransformFunctions("translate(10px) rotate(15deg)")).toBe(false)
    expect(hasUnsupportedTransformFunctions("translateX(10px)")).toBe(false)
    expect(hasUnsupportedTransformFunctions("translate(calc(10px + 4px))")).toBe(false)
    expect(hasUnsupportedTransformFunctions("rotate(var(--angle))")).toBe(false)
    expect(hasUnsupportedTransformFunctions("none")).toBe(false)
    expect(hasUnsupportedTransformFunctions("")).toBe(false)
  })

  it("hydrates axis-specific translate/scale/skew functions", () => {
    expect(cssToTransformState("translateX(10px) rotate(15deg)", "")).toMatchObject({
      translateX: "10px",
      translateY: TRANSFORM_DEFAULTS.translateY,
      rotate: "15deg",
    })
    expect(cssToTransformState("scaleX(1.2) scaleY(0.8)", "")).toMatchObject({
      scaleX: "1.2",
      scaleY: "0.8",
    })
    expect(transformStateToCSS(cssToTransformState("translateX(10px) rotate(15deg)", ""))).toBe(
      "translate(10px, 0px) rotate(15deg)",
    )
  })

  it("normalizes a lone origin keyword so the grid can highlight", () => {
    expect(cssToTransformState(null, "center")).toMatchObject({
      originX: "center",
      originY: "center",
    })
    expect(cssToTransformState(null, "left")).toMatchObject({
      originX: "left",
      originY: "center",
    })
    expect(cssToTransformState(null, "top")).toMatchObject({
      originX: "center",
      originY: "top",
    })
    expect(cssToTransformState(null, "top left")).toMatchObject({
      originX: "left",
      originY: "top",
    })
    expect(transformOriginStateToCSS(cssToTransformState(null, "center"))).toBe(
      "center center",
    )
  })

  it("hydrates leftover individual translate/rotate/scale when transform is empty", () => {
    expect(
      styleMapToTransformState({
        translate: "12px 18px",
        rotate: "45deg",
        scale: "1.2",
      }),
    ).toMatchObject({
      translateX: "12px",
      translateY: "18px",
      rotate: "45deg",
      scaleX: "1.2",
      scaleY: "1.2",
    })
  })

  it("prefers composite transform over leftover individual properties", () => {
    expect(
      styleMapToTransformState({
        transform: "rotate(15deg)",
        translate: "12px 18px",
        rotate: "90deg",
        scale: "2",
      }),
    ).toMatchObject({
      translateX: TRANSFORM_DEFAULTS.translateX,
      translateY: TRANSFORM_DEFAULTS.translateY,
      rotate: "15deg",
      scaleX: TRANSFORM_DEFAULTS.scaleX,
      scaleY: TRANSFORM_DEFAULTS.scaleY,
    })
  })

  it("clears leftover individual properties when writing transform updates", () => {
    const state = cssToTransformState("rotate(45deg)", "left top")
    expect(transformStateToStyleUpdates(state, ["transform"])).toEqual({
      transform: "rotate(45deg)",
      translate: "",
      rotate: "",
      scale: "",
    })
    expect(transformStateToStyleUpdates(state, ["transform-origin"])).toEqual({
      "transform-origin": "left top",
    })
  })

  it("omits identity transform and origin unless inherited values need overriding", () => {
    expect(transformStateToStyleUpdates(defaultTransformState(), ["transform"])).toEqual({
      transform: "",
      translate: "",
      rotate: "",
      scale: "",
    })
    expect(
      transformStateToStyleUpdates(defaultTransformState(), ["transform"], {
        inheritedTransform: "rotate(45deg)",
      }),
    ).toEqual({
      transform: "none",
      translate: "",
      rotate: "",
      scale: "",
    })
    expect(transformStateToStyleUpdates(defaultTransformState(), ["transform-origin"])).toEqual({
      "transform-origin": "",
    })
    expect(
      transformStateToStyleUpdates(defaultTransformState(), ["transform-origin"], {
        inheritedTransformOrigin: "left top",
      }),
    ).toEqual({
      "transform-origin": "center center",
    })
  })

  it("preserves custom property case in origin values", () => {
    expect(
      transformOriginStateToCSS({
        ...TRANSFORM_DEFAULTS,
        originX: "var(--MyOrigin)",
        originY: "center",
      }),
    ).toBe("var(--MyOrigin) center")
  })

  it("treats 50% and swapped keyword order as origin presets", () => {
    expect(isOriginPresetActive(cssToTransformState(null, "50% 50%"), "center", "center")).toBe(true)
    expect(isOriginPresetActive(cssToTransformState(null, "top left"), "left", "top")).toBe(true)
    expect(isOriginPresetActive(cssToTransformState(null, "0% 0%"), "left", "top")).toBe(true)
  })
})
