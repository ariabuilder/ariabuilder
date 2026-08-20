// @vitest-environment jsdom

import { defineComponent, h, nextTick, ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import { WIDTH_SIZING_PROP } from "../../../../shared/composer"
import ComposerSizeControls from "./ComposerSizeControls.vue"
import ComposerTypographyControls from "./ComposerTypographyControls.vue"
import { mount } from "./InspectorParityComponents.testHarness"

describe("Inspector typography and size", () => {
  it("renders the aria-demo typography hierarchy with retained advanced groups", () => {
    const host = mount(ComposerTypographyControls, {
      values: {
        "font-family": "Inter",
        color: "#111111",
        "font-weight": "500",
        "font-size": "1.25rem",
        "line-height": "1.4",
        "letter-spacing": "0.02em",
        "text-wrap": "pretty",
        "white-space": "normal",
        "text-align": "center",
        "text-transform": "capitalize",
        "text-decoration": "underline",
      },
      fontOptions: [
        { family: "Inter", source: "google", weights: [400, 500, 700] },
        { family: "Editorial", source: "custom", weights: [] },
      ],
      headingLevel: 2,
    })

    const content = host.querySelector('[data-testid="composer-typography-controls"]') as HTMLElement
    expect(content).not.toBeNull()
    expect(content.textContent).toContain("Font")
    expect(content.textContent).toContain("Level")
    expect(content.textContent).toContain("Color")
    expect(content.textContent).toContain("Weight")
    expect(content.textContent).toContain("Size")
    expect(content.textContent).toContain("Line height")
    expect(content.textContent).toContain("Spacing")
    expect(content.textContent).toContain("Wrap")
    expect(content.textContent).toContain("White space")
    expect(content.textContent).toContain("Align")
    expect(content.textContent).toContain("Transform")
    expect(content.textContent).toContain("Decoration")
    expect(content.querySelectorAll('[aria-label="Level"] [role="radio"]')).toHaveLength(6)
    expect(content.querySelector('[data-typography-property="white-space"]')).not.toBeNull()
    expect(content.querySelector('[data-typography-property="text-decoration"]')).not.toBeNull()
  })

  it("renders the aria-demo size hierarchy with hug/fill/exact and constraints", () => {
    const host = mount(ComposerSizeControls, {
      values: {
        [WIDTH_SIZING_PROP]: "hug",
        height: "100%",
        "min-width": "0",
        "max-width": "none",
      },
    })
    const content = host.querySelector('[data-testid="composer-size-controls"]') as HTMLElement
    expect(content).not.toBeNull()
    expect(content.textContent).toContain("Width")
    expect(content.textContent).toContain("Height")
    expect(content.textContent).toContain("Hug")
    expect(content.textContent).toContain("Fill")
    expect(content.textContent).toContain("Exact")
    expect(content.textContent).toContain("Constraints")
    expect(content.querySelectorAll('[data-testid="size-width-mode-group"] [role="radio"]')).toHaveLength(3)
    expect((content.querySelector('[data-testid="size-width-mode-hug"]') as HTMLButtonElement).getAttribute("aria-checked")).toBe("true")
    expect((content.querySelector('[data-testid="size-height-mode-fill"]') as HTMLButtonElement).getAttribute("aria-checked")).toBe("true")
    expect(content.querySelector('[data-testid="size-min-width"]')).not.toBeNull()
    expect(content.querySelector('[data-testid="size-max-height"]')).not.toBeNull()
  })

  it("uses keyboard-complete heading and alignment radio groups", async () => {
    const headingLevel = vi.fn()
    const commit = vi.fn()
    const host = mount(ComposerTypographyControls, {
      values: { "text-align": "start" },
      headingLevel: 2,
      onHeadingLevel: headingLevel,
      onCommit: commit,
    })

    const heading = host.querySelector('[aria-label="Level"] [aria-checked="true"]') as HTMLButtonElement
    heading.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    await nextTick()
    expect(headingLevel).toHaveBeenCalledWith(3)

    const align = host.querySelector('[aria-label="Align"] [aria-checked="true"]') as HTMLButtonElement
    align.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
    await nextTick()
    expect(commit).toHaveBeenCalledWith("text-align", "justify")
  })

  it("preserves numeric units during live input and final commit", async () => {
    const preview = vi.fn()
    const commit = vi.fn()
    const values = ref({ "font-size": "1.25rem", "line-height": "1.4" })
    const Harness = defineComponent({
      setup() {
        return () => h(ComposerTypographyControls, {
          values: values.value,
          onPreview: (property, value) => {
            preview(property, value)
            values.value = { ...values.value, [property]: value }
          },
          onCommit: commit,
        })
      },
    })
    const host = mount(Harness)
    const input = host.querySelector('[data-typography-property="font-size"] input') as HTMLInputElement
    input.value = "2"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(preview).toHaveBeenCalledWith("font-size", "2rem")
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).toHaveBeenCalledWith("font-size", "2rem")
  })

  it("keeps heading controls conditional and disables every native typography action", () => {
    const host = mount(ComposerTypographyControls, {
      values: { "font-family": "inherit" },
      headingLevel: null,
      disabled: true,
    })
    expect(host.querySelector('[aria-label="Level"]')).toBeNull()
    const buttons = [...host.querySelectorAll("button")] as HTMLButtonElement[]
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.every((button) => button.disabled)).toBe(true)
  })
})
