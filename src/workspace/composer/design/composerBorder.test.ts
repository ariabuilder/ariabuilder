import { parseStyleAttr, serializeStyleAttr, setStyleProp } from "../../../../shared/composer/styleAttr"
import { describe, expect, it } from "vitest"
import {
  BORDER_SECTION_PROPERTIES,
  BORDER_STYLE_OPTIONS,
  BORDER_WIDTH_UNITS,
  buildBorderWidthValue,
  buildLinkedRadiusUpdates,
  buildMaterializedBorderUpdates,
  buildUnlinkedRadiusUpdates,
  conflictingBorderPresentationUtilities,
  isBorderStyleUtility,
  isRoundedUtility,
  normalizeBorderRadius,
  parseBorderWidthInput,
  resolveBorderCorners,
  resolveBorderStyleFromClasses,
  resolveBorderValues,
  retainCompatibleBorderApplyDirectives,
} from "./composerBorder"

describe("Composer Border controls", () => {
  it("provides the complete aria-demo style and unit option sets", () => {
    expect(BORDER_STYLE_OPTIONS).toEqual([
      "none", "hidden", "solid", "dashed", "dotted",
      "double", "groove", "ridge", "inset", "outset",
    ])
    expect(BORDER_WIDTH_UNITS).toEqual(["px", "rem", "em", "vw", "vh"])
  })

  it("owns the full border and radius declaration set", () => {
    expect(BORDER_SECTION_PROPERTIES).toEqual([
      "border",
      "border-color",
      "border-width",
      "border-style",
      "border-image",
      "border-radius",
      "border-start-start-radius",
      "border-start-end-radius",
      "border-end-start-radius",
      "border-end-end-radius",
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius",
    ])
  })

  it("resolves safe display defaults and common border shorthands", () => {
    expect(resolveBorderValues({})).toEqual({
      color: "transparent",
      width: "1px",
      style: "solid",
    })
    expect(resolveBorderValues({ border: "2rem dashed oklch(0.6 0.2 20 / 0.5)" })).toEqual({
      color: "oklch(0.6 0.2 20 / 0.5)",
      width: "2rem",
      style: "dashed",
    })
  })

  it("materializes the full trio when one border control changes", () => {
    expect(buildMaterializedBorderUpdates({}, { color: "#112233" })).toEqual({
      border: "",
      "border-image": "none",
      "border-color": "#112233",
      "border-width": "1px",
      "border-style": "solid",
    })
    expect(buildMaterializedBorderUpdates({
      "border-color": "red",
      "border-width": "4px",
      "border-style": "dotted",
    }, { style: "double" })).toEqual({
      border: "",
      "border-image": "none",
      "border-color": "red",
      "border-width": "4px",
      "border-style": "double",
    })
    expect(buildMaterializedBorderUpdates({
      border: "4px solid #4a47ff",
    }, { style: "dashed" })).toEqual({
      border: "",
      "border-image": "none",
      "border-color": "#4a47ff",
      "border-width": "4px",
      "border-style": "dashed",
    })
    let next = parseStyleAttr("color: red; border: 4px solid #4a47ff")
    for (const [property, value] of Object.entries(buildMaterializedBorderUpdates({
      border: "4px solid #4a47ff",
    }, { style: "dashed" }))) {
      next = setStyleProp(next, property, value)
    }
    expect(serializeStyleAttr(next)).toBe(
      "color: red; border-image: none; border-color: #4a47ff; border-width: 4px; border-style: dashed",
    )
  })

  it("parses supported width units and preserves authored CSS expressions", () => {
    expect(parseBorderWidthInput("1.5rem")).toEqual({ value: "1.5", unit: "rem" })
    expect(buildBorderWidthValue("2", "vw")).toBe("2vw")
    expect(buildBorderWidthValue("var(--stroke)", "px")).toBe("var(--stroke)")
  })

  it("expands radius shorthand including elliptical radii", () => {
    expect(resolveBorderCorners({ "border-radius": "1px 2px 3px 4px" })).toEqual({
      "border-start-start-radius": "1px",
      "border-start-end-radius": "2px",
      "border-end-end-radius": "3px",
      "border-end-start-radius": "4px",
    })
    expect(resolveBorderCorners({ "border-radius": "1rem / 2rem" })).toEqual({
      "border-start-start-radius": "1rem 2rem",
      "border-start-end-radius": "1rem 2rem",
      "border-end-end-radius": "1rem 2rem",
      "border-end-start-radius": "1rem 2rem",
    })
  })

  it("reads canonical physical corners over legacy logical corners", () => {
    expect(resolveBorderCorners({
      "border-start-start-radius": "4px",
      "border-top-left-radius": "12px",
      "border-bottom-right-radius": "18px",
    })).toEqual({
      "border-start-start-radius": "12px",
      "border-start-end-radius": "0",
      "border-end-end-radius": "18px",
      "border-end-start-radius": "0",
    })
  })

  it("normalizes direct radii while preserving variables and calculations", () => {
    expect(normalizeBorderRadius("8")).toBe("8px")
    expect(normalizeBorderRadius("var(--radius-card)")).toBe("var(--radius-card)")
    expect(normalizeBorderRadius("calc(1rem + 2px)")).toBe("calc(1rem + 2px)")
  })

  it("switches cleanly between shorthand and logical corner declarations", () => {
    expect(buildLinkedRadiusUpdates("12")).toEqual({
      "border-radius": "12px",
      "border-start-start-radius": "",
      "border-start-end-radius": "",
      "border-end-start-radius": "",
      "border-end-end-radius": "",
      "border-top-left-radius": "",
      "border-top-right-radius": "",
      "border-bottom-right-radius": "",
      "border-bottom-left-radius": "",
    })
    const corners = resolveBorderCorners({ "border-radius": "4px 8px" })
    expect(buildUnlinkedRadiusUpdates(corners, "border-end-end-radius", "16")).toEqual({
      "border-radius": "",
      "border-top-left-radius": "",
      "border-top-right-radius": "",
      "border-bottom-right-radius": "",
      "border-bottom-left-radius": "",
      "border-start-start-radius": "4px",
      "border-start-end-radius": "8px",
      "border-end-start-radius": "8px",
      "border-end-end-radius": "16px",
    })
  })

  it("detects Tailwind border-style utilities without matching width or color tokens", () => {
    expect(isBorderStyleUtility("border-solid")).toBe(true)
    expect(isBorderStyleUtility("md:border-dashed")).toBe(true)
    expect(isBorderStyleUtility("border-t-dotted")).toBe(true)
    expect(isBorderStyleUtility("border-4")).toBe(false)
    expect(isBorderStyleUtility("border")).toBe(false)
    expect(isBorderStyleUtility("border-primary")).toBe(false)
    expect(isRoundedUtility("rounded-3xl")).toBe(true)
    expect(isRoundedUtility("md:rounded-full")).toBe(true)
    expect(resolveBorderStyleFromClasses(["rounded-xl", "border-4", "border-solid"])).toBe("solid")
  })

  it("strips owned border-style apply tokens after the inspector writes dashed", () => {
    const shouldRemove = conflictingBorderPresentationUtilities(
      "border-color: #4a47ff; border-width: 4px; border-style: dashed",
    )
    expect(shouldRemove("border-solid")).toBe(true)
    expect(shouldRemove("border-4")).toBe(false)
    expect(shouldRemove("rounded-xl")).toBe(false)
    expect(retainCompatibleBorderApplyDirectives(
      "@apply border-4 border-solid rounded-xl;",
      "border-color: #4a47ff; border-width: 4px; border-style: dashed",
    )).toBe("@apply border-4 rounded-xl;\nborder-color: #4a47ff; border-width: 4px; border-style: dashed")
  })
})
