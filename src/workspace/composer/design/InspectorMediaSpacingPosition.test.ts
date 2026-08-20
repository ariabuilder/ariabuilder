// @vitest-environment jsdom

import { nextTick } from "vue"
import { describe, expect, it, vi } from "vitest"
import ComposerLinkedSides from "./ComposerLinkedSides.vue"
import ComposerPositionControls from "./ComposerPositionControls.vue"
import ComposerStyleField from "./ComposerStyleField.vue"
import { mount } from "./InspectorParityComponents.testHarness"

describe("Inspector media, spacing, and position", () => {
  it("exposes the shared media picker action on media-capable CSS fields", async () => {
    const browse = vi.fn()
    const host = mount(ComposerStyleField, {
      label: "Image / gradient",
      modelValue: "",
      mediaPicker: true,
      onBrowseMedia: browse,
    })
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.getAttribute("aria-label")?.toLowerCase().includes("media"),
    )
    expect(button).toBeDefined()
    button?.click()
    await nextTick()
    expect(browse).toHaveBeenCalledOnce()
  })

  it("keeps compact numeric units independently selectable", async () => {
    const commit = vi.fn()
    const host = mount(ComposerStyleField, {
      label: "Width",
      modelValue: "16px",
      scrub: true,
      onCommit: commit,
    })
    const unit = host.querySelector('select[aria-label="Value unit"]') as HTMLSelectElement
    expect(unit.value).toBe("px")
    unit.value = "rem"
    unit.dispatchEvent(new Event("change", { bubbles: true }))
    await nextTick()
    expect(commit).toHaveBeenCalledWith("16rem")
  })

  it("toggles linked spacing sides with an accessible pressed state", async () => {
    const update = vi.fn()
    const host = mount(ComposerLinkedSides, {
      label: "Padding",
      property: "padding",
      linked: true,
      values: { top: "1rem", right: "1rem", bottom: "1rem", left: "1rem" },
      "onUpdate:linked": update,
    })
    const button = host.querySelector('button[aria-pressed="true"]') as HTMLButtonElement
    expect(button).not.toBeNull()
    button.click()
    await nextTick()
    expect(update).toHaveBeenCalledWith(false)
  })

  it("renders linked spacing as Y/X axis controls", () => {
    const host = mount(ComposerLinkedSides, {
      label: "Margin",
      property: "margin",
      linked: true,
      values: { top: "8px", right: "4px", bottom: "8px", left: "4px" },
    })
    const inputs = host.querySelectorAll("input")
    expect(inputs).toHaveLength(2)
    expect((inputs[0] as HTMLInputElement).value).toBe("8px")
    expect((inputs[1] as HTMLInputElement).value).toBe("4px")
  })

  it("renders unlinked spacing as four side controls", async () => {
    const host = mount(ComposerLinkedSides, {
      label: "Padding",
      property: "padding",
      linked: false,
      values: { top: "1px", right: "2px", bottom: "3px", left: "4px" },
    })
    const inputs = host.querySelectorAll("input")
    expect(inputs).toHaveLength(4)
    expect([...inputs].map((input) => (input as HTMLInputElement).value)).toEqual([
      "1px",
      "3px",
      "4px",
      "2px",
    ])
  })

  it("renders position mode, directional offsets, and a Z-index prefix", () => {
    const host = mount(ComposerPositionControls, {
      values: {
        position: "absolute",
        top: "12px",
        right: "18px",
        bottom: "auto",
        left: "6px",
        "z-index": "20",
      },
    })
    const content = host.querySelector('[data-testid="composer-position-controls"]') as HTMLElement
    expect(content).not.toBeNull()
    expect(content.textContent).toContain("Mode")
    expect(content.textContent).toContain("Z-index")
    expect(host.querySelector('[data-testid="position-z-prefix"]')?.textContent?.trim()).toBe("Z")
    expect(host.querySelector('[data-testid="position-mode-select"]')?.getAttribute("data-mode")).toBe("absolute")
    expect(
      (host.querySelector('[data-testid="position-top-input"] input') as HTMLInputElement).value,
    ).toBe("12px")
    expect(
      (host.querySelector('[data-testid="position-z-index-input"] input') as HTMLInputElement).value,
    ).toBe("20")
  })

  it("treats an empty mode as Static and disables offsets until positioned", () => {
    const host = mount(ComposerPositionControls, {
      values: { position: "", top: "8px", "z-index": "1" },
    })
    expect(host.querySelector('[data-testid="position-mode-select"]')?.getAttribute("data-mode")).toBe("static")
    expect(
      (host.querySelector('[data-testid="position-top-input"] input') as HTMLInputElement).disabled,
    ).toBe(true)
    expect(
      (host.querySelector('[data-testid="position-z-index-input"] input') as HTMLInputElement).disabled,
    ).toBe(false)
  })

  it("enables offsets when the mode is not static", () => {
    const host = mount(ComposerPositionControls, {
      values: { position: "relative", top: "8px" },
    })
    expect(
      (host.querySelector('[data-testid="position-top-input"] input') as HTMLInputElement).disabled,
    ).toBe(false)
  })

  it("commits a unitless offset as px and expands inset to longhands", async () => {
    const preview = vi.fn()
    const commit = vi.fn()
    const host = mount(ComposerPositionControls, {
      values: {
        position: "absolute",
        top: "8px",
        right: "8",
        bottom: "8px",
        left: "8px",
      },
      onPreview: preview,
      onCommit: commit,
    })
    const top = host.querySelector('[data-testid="position-top-input"] input') as HTMLInputElement
    top.value = "24"
    top.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(preview).not.toHaveBeenCalled()
    top.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).toHaveBeenCalledWith({
      inset: "",
      top: "24px",
      right: "8px",
      bottom: "8px",
      left: "8px",
    })
  })

  it("does not expand inset when an offset is committed unchanged", async () => {
    const commit = vi.fn()
    const cancel = vi.fn()
    const host = mount(ComposerPositionControls, {
      values: {
        position: "absolute",
        top: "8px",
        right: "8px",
        bottom: "8px",
        left: "8px",
      },
      onCommit: commit,
      onCancel: cancel,
    })
    const top = host.querySelector('[data-testid="position-top-input"] input') as HTMLInputElement
    top.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })

  it("keeps unknown position modes visible and editable", () => {
    const host = mount(ComposerPositionControls, {
      values: { position: "inherit", top: "8px" },
    })
    expect(host.querySelector('[data-testid="position-mode-select"]')?.getAttribute("data-mode")).toBe("inherit")
    expect(
      (host.querySelector('[data-testid="position-top-input"] input') as HTMLInputElement).disabled,
    ).toBe(false)
  })
})
