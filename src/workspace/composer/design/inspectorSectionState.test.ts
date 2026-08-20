import { describe, expect, it } from "vitest"
import { resolveInspectorSectionState } from "./inspectorSectionState"

describe("Inspector section responsive state", () => {
  const sources = [
    { id: "base", label: "Base", width: null, styleText: "color: red; display: block" },
    { id: "sm", label: "sm", width: 640, styleText: "padding: 1rem" },
    { id: "tablet", label: "tablet", width: 900, styleText: "display: grid; gap: 2rem" },
    { id: "wide", label: "wide", width: 1280, styleText: "opacity: .8" },
  ] as const

  it("reports all and current overrides for a section", () => {
    const state = resolveInspectorSectionState(["display", "gap"], "tablet", sources)
    expect(state.hasAuthoredValues).toBe(true)
    expect(state.hasCurrentTargetValues).toBe(true)
    expect(state.canReset).toBe(true)
    expect(state.overrideBreakpoints.map((item) => item.id)).toEqual(["base", "tablet"])
    expect(state.overrideBreakpoints.find((item) => item.id === "tablet")?.isCurrent).toBe(true)
  })

  it("keeps a cross-breakpoint notification while disabling current reset", () => {
    const state = resolveInspectorSectionState(["opacity"], "tablet", sources)
    expect(state.hasAuthoredValues).toBe(true)
    expect(state.hasCurrentTargetValues).toBe(false)
    expect(state.canReset).toBe(false)
    expect(state.overrideBreakpoints.map((item) => item.id)).toEqual(["wide"])
  })

  it("does not report unrelated declarations", () => {
    const state = resolveInspectorSectionState(["border-color"], "base", sources)
    expect(state.hasAuthoredValues).toBe(false)
    expect(state.overrideBreakpoints).toEqual([])
  })

  it("reports section-owned shorthand declarations", () => {
    const shorthandSources = [
      { id: "base", label: "Base", width: null, styleText: "background: linear-gradient(red, blue)" },
      { id: "tablet", label: "Tablet", width: 900, styleText: "border: 1px solid red" },
    ] as const

    expect(resolveInspectorSectionState(["background-color", "background"], "base", shorthandSources).overrideBreakpoints.map((item) => item.id)).toEqual(["base"])
    expect(resolveInspectorSectionState(["border-color", "border"], "tablet", shorthandSources).overrideBreakpoints.map((item) => item.id)).toEqual(["tablet"])
  })
})
