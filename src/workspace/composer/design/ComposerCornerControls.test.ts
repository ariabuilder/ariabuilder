// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ComposerCornerControls from "./ComposerCornerControls.vue"

const mounted: Array<() => void> = []

function mountCorner(
  props: Record<string, unknown> = {},
  listeners: Record<string, (...args: never[]) => void> = {},
) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    render: () => h(ComposerCornerControls, {
      styles: {},
      resetKey: "selection:base",
      ...props,
      ...listeners,
    }),
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return host
}

function setInput(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  vi.restoreAllMocks()
})

describe("ComposerCornerControls", () => {
  it("renders Shape before Radius with independent accessible link states", () => {
    const host = mountCorner({
      styles: { "corner-shape": "squircle", "border-radius": "12px" },
    })
    const control = host.querySelector('[data-testid="composer-corner-controls"]') as HTMLElement
    expect(control.textContent?.indexOf("Shape")).toBeLessThan(control.textContent?.indexOf("Radius") ?? -1)
    expect((host.querySelector('[data-testid="corner-shape-select"]') as HTMLElement).textContent).toContain("Squircle")
    expect((host.querySelector('[data-testid="corner-linked-radius-input"] input') as HTMLInputElement).value).toBe("12")

    const shapeLink = host.querySelector('[data-testid="corner-shape-link-toggle"]') as HTMLButtonElement
    const radiusLink = host.querySelector('[data-testid="corner-radius-link-toggle"]') as HTMLButtonElement
    expect(shapeLink.getAttribute("aria-pressed")).toBe("true")
    expect(shapeLink.getAttribute("aria-label")).toBe("Unlink corner shapes")
    expect(radiusLink.getAttribute("aria-pressed")).toBe("true")
    expect(radiusLink.getAttribute("aria-label")).toBe("Unlink corner radii")
    expect(host.querySelector('[data-testid="corner-linked-radius-input"] [data-variable-reference-trigger]')).not.toBeNull()
  })

  it("reveals four physical controls independently for Shape and Radius", async () => {
    const host = mountCorner({ styles: { "corner-shape": "round", "border-radius": "4px" } })
    const shapeLink = host.querySelector('[data-testid="corner-shape-link-toggle"]') as HTMLButtonElement
    const radiusLink = host.querySelector('[data-testid="corner-radius-link-toggle"]') as HTMLButtonElement

    shapeLink.click()
    await nextTick()
    expect(shapeLink.getAttribute("aria-pressed")).toBe("false")
    expect(host.querySelectorAll('[data-testid$="-shape-select"]')).toHaveLength(4)
    expect(host.querySelectorAll('[data-testid$="-shape-slider"]')).toHaveLength(4)
    expect(host.querySelector('[data-testid="corner-linked-radius-input"]')).not.toBeNull()

    radiusLink.click()
    await nextTick()
    expect(radiusLink.getAttribute("aria-pressed")).toBe("false")
    const inputs = [
      "corner-top-left-radius-input",
      "corner-top-right-radius-input",
      "corner-bottom-right-radius-input",
      "corner-bottom-left-radius-input",
    ].map((testId) => host.querySelector(`[data-testid="${testId}"] input`) as HTMLInputElement)
    expect(inputs.map((input) => input.value)).toEqual(["4", "4", "4", "4"])
    expect(inputs.map((input) => input.getAttribute("aria-label"))).toEqual([
      "Top left radius",
      "Top right radius",
      "Bottom right radius",
      "Bottom left radius",
    ])
  })

  it("hides curvature for infinite shapes and keeps it keyboard operable otherwise", async () => {
    const square = mountCorner({ styles: { "corner-shape": "square" } })
    expect(square.querySelector('[data-testid="corner-linked-shape-slider"]')).toBeNull()

    const commit = vi.fn()
    const round = mountCorner({ styles: { "corner-shape": "round" } }, { onCommit: commit })
    const sliderRoot = round.querySelector('[data-testid="corner-linked-shape-slider"]') as HTMLElement
    const slider = sliderRoot.querySelector('[role="slider"]') as HTMLElement
    expect(slider.getAttribute("aria-label")).toBe("Shape curvature")
    expect(slider.getAttribute("aria-valuemin")).toBe("-5")
    expect(slider.getAttribute("aria-valuemax")).toBe("5")
    slider.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }))
    await nextTick()
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0]?.[0]["corner-shape"]).toBe("superellipse(0.9)")
  })

  it("commits a typed radius as four canonical physical declarations", async () => {
    const commit = vi.fn()
    const host = mountCorner({ styles: { "border-radius": "10px" } }, { onCommit: commit })
    const input = host.querySelector('[data-testid="corner-linked-radius-input"] input') as HTMLInputElement
    setInput(input, "18")
    await nextTick()
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0]?.[0]).toMatchObject({
      "border-radius": "",
      "border-start-start-radius": "",
      "border-start-end-radius": "",
      "border-end-end-radius": "",
      "border-end-start-radius": "",
      "border-top-left-radius": "18px",
      "border-top-right-radius": "18px",
      "border-bottom-right-radius": "18px",
      "border-bottom-left-radius": "18px",
    })
  })

  it("does not author default radii when an untouched input blurs", async () => {
    const commit = vi.fn()
    const host = mountCorner({}, { onCommit: commit })
    const input = host.querySelector('[data-testid="corner-linked-radius-input"] input') as HTMLInputElement
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).not.toHaveBeenCalled()
  })

  it("preserves the other three physical radii when one unlinked corner changes", async () => {
    const commit = vi.fn()
    const host = mountCorner({ styles: { "border-radius": "1px 2px 3px 4px" } }, { onCommit: commit })
    const input = host.querySelector('[data-testid="corner-top-left-radius-input"] input') as HTMLInputElement
    setInput(input, "20")
    await nextTick()
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()

    expect(commit.mock.calls[0]?.[0]).toMatchObject({
      "border-top-left-radius": "20px",
      "border-top-right-radius": "2px",
      "border-bottom-right-radius": "3px",
      "border-bottom-left-radius": "4px",
    })
  })

  it("preserves the other three shapes during an unlinked keyboard adjustment", async () => {
    const commit = vi.fn()
    const host = mountCorner({
      styles: { "corner-shape": "round squircle bevel scoop" },
    }, { onCommit: commit })
    const slider = host.querySelector('[data-testid="corner-top-left-shape-slider"] [role="slider"]') as HTMLElement
    slider.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }))
    await nextTick()
    expect(commit.mock.calls[0]?.[0]["corner-shape"]).toBe("superellipse(0.9) squircle bevel scoop")
  })

  it("previews a scrub, commits once on release, and cancels on Escape", async () => {
    const preview = vi.fn()
    const commit = vi.fn()
    const cancel = vi.fn()
    const host = mountCorner({ styles: { "border-radius": "4px" } }, {
      onPreview: preview,
      onCommit: commit,
      onCancel: cancel,
    })
    const input = host.querySelector('[data-testid="corner-linked-radius-input"] input') as HTMLInputElement

    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10 }))
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 16 }))
    await nextTick()
    expect(preview).toHaveBeenCalled()
    expect(preview.mock.calls.at(-1)?.[0]["border-top-left-radius"]).toBe("10px")
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 16 }))
    await nextTick()
    expect(commit).toHaveBeenCalledTimes(1)

    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10 }))
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 14 }))
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
    await nextTick()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it("preserves an unsafe shorthand until the user supplies a replacement", async () => {
    const commit = vi.fn()
    const host = mountCorner({ styles: { "border-radius": "1px 2px 3px 4px 5px" } }, { onCommit: commit })
    const input = host.querySelector('[data-testid="corner-linked-radius-input"] input') as HTMLInputElement
    const toggle = host.querySelector('[data-testid="corner-radius-link-toggle"]') as HTMLButtonElement
    expect(host.querySelector('[data-testid="corner-radius-error"]')?.textContent).toContain("cannot be safely expanded")
    expect(toggle.disabled).toBe(true)

    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).not.toHaveBeenCalled()

    setInput(input, "var(--radius-card)")
    await nextTick()
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0]?.[0]["border-top-left-radius"]).toBe("var(--radius-card)")
  })

  it("blocks unresolved logical adoption and uses computed physical geometry when available", async () => {
    const unresolved = mountCorner({
      styles: { "border-start-start-radius": "20px" },
      logicalRadiusResolutionFailed: true,
    })
    expect((unresolved.querySelector('[data-testid="corner-top-left-radius-input"] input') as HTMLInputElement).disabled).toBe(true)
    expect(unresolved.querySelector('[data-testid="corner-radius-error"]')?.textContent).toContain("could not be resolved")

    const commit = vi.fn()
    const resolved = mountCorner({
      styles: { "border-start-start-radius": "20px" },
      resolvedPhysicalRadius: {
        topLeft: "1px",
        topRight: "20px",
        bottomRight: "3px",
        bottomLeft: "4px",
      },
    }, { onCommit: commit })
    const input = resolved.querySelector('[data-testid="corner-top-left-radius-input"] input') as HTMLInputElement
    setInput(input, "8")
    await nextTick()
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit.mock.calls[0]?.[0]).toMatchObject({
      "border-top-left-radius": "8px",
      "border-top-right-radius": "20px",
      "border-bottom-right-radius": "3px",
      "border-bottom-left-radius": "4px",
    })
  })

  it("associates invalid Radius feedback with the affected input", async () => {
    vi.stubGlobal("CSS", { supports: vi.fn(() => false) })
    const host = mountCorner({ styles: { "border-radius": "4px" } })
    const input = host.querySelector('[data-testid="corner-linked-radius-input"] input') as HTMLInputElement
    setInput(input, "invalid-radius")
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    const error = host.querySelector('[data-testid="corner-radius-error"]') as HTMLElement
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-describedby")).toBe(error.id)
  })

  it("disables every editing surface", async () => {
    const host = mountCorner({ disabled: true })
    expect((host.querySelector('[data-testid="corner-shape-link-toggle"]') as HTMLButtonElement).disabled).toBe(true)
    expect((host.querySelector('[data-testid="corner-radius-link-toggle"]') as HTMLButtonElement).disabled).toBe(true)
    expect((host.querySelector('[data-testid="corner-shape-select"]') as HTMLButtonElement).disabled).toBe(true)
    expect((host.querySelector('[data-testid="corner-linked-radius-input"] input') as HTMLInputElement).disabled).toBe(true)
    expect((host.querySelector('[data-testid="corner-linked-shape-slider"] [role="slider"]') as HTMLElement).getAttribute("aria-disabled")).toBe("true")
  })
})
