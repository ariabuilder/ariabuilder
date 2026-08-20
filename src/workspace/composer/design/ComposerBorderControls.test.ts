// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import ComposerBorderControls from "./ComposerBorderControls.vue"

const mounted: Array<() => void> = []

function mountBorder(
  props: Record<string, unknown> = {},
  listeners: Record<string, (...args: never[]) => void> = {},
) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    render: () => h(ComposerBorderControls, {
      values: {},
      ...props,
      ...listeners,
    }),
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return host
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  vi.restoreAllMocks()
})

describe("ComposerBorderControls", () => {
  it("renders the compound default layout and accessible linking control", () => {
    const host = mountBorder()
    const control = host.querySelector('[data-testid="composer-border-controls"]') as HTMLElement
    expect(control.textContent).toContain("Color")
    expect(control.textContent).toContain("Size")
    expect(control.textContent).toContain("Type")
    expect(control.textContent).toContain("Radius")
    expect((host.querySelector('[data-testid="border-width-input"] input') as HTMLInputElement).value).toBe("1")
    expect((host.querySelector('[data-testid="border-linked-radius-input"] input') as HTMLInputElement).value).toBe("0")
    expect((host.querySelector('[data-testid="border-width-input"] input') as HTMLInputElement).getAttribute("aria-label")).toBe("Border width")
    expect((host.querySelector('[data-testid="border-style-select"]') as HTMLButtonElement).getAttribute("aria-label")).toBe("Type")
    const toggle = host.querySelector('[data-testid="border-radius-link-toggle"]') as HTMLButtonElement
    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    expect(toggle.getAttribute("aria-label")).toBe("Unlink corner radii")
  })

  it("reveals four named logical corner controls when unlinked", async () => {
    const host = mountBorder()
    const toggle = host.querySelector('[data-testid="border-radius-link-toggle"]') as HTMLButtonElement
    toggle.click()
    await nextTick()

    expect(toggle.getAttribute("aria-pressed")).toBe("false")
    expect(toggle.getAttribute("aria-label")).toBe("Link corner radii")
    const inputs = [...host.querySelectorAll('[data-testid="border-unlinked-radius-grid"] input')] as HTMLInputElement[]
    expect(inputs).toHaveLength(4)
    expect(inputs.map((input) => input.getAttribute("aria-label"))).toEqual([
      "Top start radius",
      "Top end radius",
      "Bottom start radius",
      "Bottom end radius",
    ])
  })

  it("disables every editing surface when the Inspector is read-only", () => {
    const host = mountBorder({ disabled: true })
    const width = host.querySelector('[data-testid="border-width-input"] input') as HTMLInputElement
    const radius = host.querySelector('[data-testid="border-linked-radius-input"] input') as HTMLInputElement
    const toggle = host.querySelector('[data-testid="border-radius-link-toggle"]') as HTMLButtonElement
    expect(width.disabled).toBe(true)
    expect(radius.disabled).toBe(true)
    expect(toggle.disabled).toBe(true)
  })

  it("marks inherited border values without relying on color alone", () => {
    const host = mountBorder({ inheritedProperties: ["border"] })
    const inheritedMarkers = host.querySelectorAll(`[aria-label="Inherited from a lower breakpoint or base state"]`)
    expect(inheritedMarkers).toHaveLength(3)
  })

  it("previews during width scrub and commits once on release", async () => {
    const previews: Record<string, string>[] = []
    const commits: Record<string, string>[] = []
    const host = mountBorder({}, {
      onPreview: (updates: never) => previews.push(updates),
      onCommit: (updates: never) => commits.push(updates),
    })
    const input = host.querySelector('[data-testid="border-width-input"] input') as HTMLInputElement
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10 }))
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 15 }))
    await nextTick()
    expect(previews.at(-1)).toEqual({
      border: "",
      "border-image": "none",
      "border-color": "transparent",
      "border-width": "6px",
      "border-style": "solid",
    })
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 15 }))
    await nextTick()
    expect(commits).toEqual([{
      border: "",
      "border-image": "none",
      "border-color": "transparent",
      "border-width": "6px",
      "border-style": "solid",
    }])
  })

  it("cancels a radius scrub on Escape without committing", async () => {
    const cancel = vi.fn()
    const commit = vi.fn()
    const host = mountBorder({ values: { "border-radius": "4px" } }, {
      onCancel: cancel,
      onCommit: commit,
    })
    const input = host.querySelector('[data-testid="border-linked-radius-input"] input') as HTMLInputElement
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10 }))
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 15 }))
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
    await nextTick()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
  })
})
