// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import ComposerShadowControls from "./ComposerShadowControls.vue"

const mounted: Array<() => void> = []

function mountShadow(
  props: Record<string, unknown> = {},
  listeners: Record<string, (...args: never[]) => void> = {},
) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    render: () => h(ComposerShadowControls, {
      values: {
        "box-shadow": "0px 4px 8px 0px rgb(0 0 0 / 25%)",
        "text-shadow": "1px 2px 3px #0008",
      },
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
  vi.unstubAllGlobals()
})

describe("ComposerShadowControls", () => {
  it("renders stacked, named Box and Text Shadow controls", () => {
    const host = mountShadow()
    expect(host.textContent).toContain("Box shadow")
    expect(host.textContent).toContain("Text shadow")
    expect(host.querySelector('[data-testid="box-shadow-layer-0"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="text-shadow-layer-0"]')).not.toBeNull()
    expect((host.querySelector('[data-testid="box-shadow-0-offsetX"] input') as HTMLInputElement).getAttribute("aria-label")).toBe("Horizontal offset")
    expect((host.querySelector('[data-testid="box-shadow-0-offsetY"] input') as HTMLInputElement).getAttribute("aria-label")).toBe("Vertical offset")
    expect((host.querySelector('[data-testid="box-shadow-0-inset"]') as HTMLElement).getAttribute("role")).toBe("switch")
    expect(host.querySelector('[data-testid="text-shadow-0-spread"]')).toBeNull()
  })

  it("adds structured box and text layers with the approved defaults", async () => {
    const commits: Record<string, string>[] = []
    const host = mountShadow({ values: {} }, {
      onCommit: (updates: never) => commits.push(updates),
    })
    ;(host.querySelector('[data-testid="box-shadow-add"]') as HTMLButtonElement).click()
    ;(host.querySelector('[data-testid="text-shadow-add"]') as HTMLButtonElement).click()
    await nextTick()
    expect(commits).toEqual([
      { "box-shadow": "0px 4px 8px 0px rgb(0 0 0 / 25%)" },
      { "text-shadow": "0px 4px 8px rgb(0 0 0 / 25%)" },
    ])
  })

  it("duplicates, reorders, toggles inset, and deletes layers with one commit per action", async () => {
    const commits: Record<string, string>[] = []
    const host = mountShadow({}, {
      onCommit: (updates: never) => commits.push(updates),
    })
    ;(host.querySelector('[aria-label="Duplicate shadow 1"]') as HTMLButtonElement).click()
    await nextTick()
    expect(commits).toHaveLength(1)
    expect(commits[0]?.["box-shadow"].split(", ")).toHaveLength(2)

    ;(host.querySelector('[data-testid="box-shadow-0-inset"]') as HTMLButtonElement).click()
    await nextTick()
    expect(commits.at(-1)?.["box-shadow"]).toMatch(/^inset /)

    ;(host.querySelector('[aria-label="Move shadow 2 up"]') as HTMLButtonElement).click()
    await nextTick()
    expect(commits).toHaveLength(3)

    ;(host.querySelector('[aria-label="Delete shadow 1"]') as HTMLButtonElement).click()
    await nextTick()
    ;(host.querySelector('[aria-label="Delete shadow 1"]') as HTMLButtonElement).click()
    await nextTick()
    expect(commits.at(-1)).toEqual({ "box-shadow": "none" })
  })

  it("keeps whole-property variables in lossless raw mode", async () => {
    const host = mountShadow({ values: { "box-shadow": "var(--card-shadow)", "text-shadow": "none" } })
    expect((host.querySelector('[data-testid="box-shadow-raw"] input') as HTMLInputElement).value).toBe("var(--card-shadow)")
    ;(host.querySelector('[data-testid="box-shadow-mode-toggle"]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelector('[data-testid="box-shadow-error"]')?.textContent).toContain("cannot be split into shadow layers")
  })

  it("rejects invalid raw CSS without committing it", async () => {
    vi.stubGlobal("CSS", { supports: vi.fn(() => false) })
    const cancel = vi.fn()
    const commit = vi.fn()
    const host = mountShadow({}, { onCancel: cancel, onCommit: commit })
    ;(host.querySelector('[data-testid="box-shadow-mode-toggle"]') as HTMLButtonElement).click()
    await nextTick()
    const input = host.querySelector('[data-testid="box-shadow-raw"] input') as HTMLInputElement
    input.value = "definitely invalid"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    await nextTick()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="box-shadow-error"]')?.textContent).toContain("valid CSS value for Box shadow")
    expect(input.value).toBe("definitely invalid")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-describedby")).toBe("box-shadow-error")
  })

  it("deduplicates an Enter commit followed by blur", async () => {
    vi.stubGlobal("CSS", { supports: vi.fn(() => true) })
    const commit = vi.fn()
    const host = mountShadow({}, { onCommit: commit })
    const input = host.querySelector('[data-testid="box-shadow-0-offsetX"] input') as HTMLInputElement
    input.value = "12px"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it("renders browser-supported modern colors without a black fallback", () => {
    vi.stubGlobal("CSS", { supports: vi.fn(() => true) })
    const host = mountShadow({
      values: {
        "box-shadow": "0 4px 8px oklch(60% .2 25 / 40%)",
        "text-shadow": "none",
      },
    })
    const swatch = host.querySelector('[data-testid="box-shadow-0-color"] button span span') as HTMLElement
    expect(swatch.style.backgroundColor).toContain("oklch")
    expect(swatch.style.backgroundColor).not.toBe("black")
  })

  it("previews during pointer scrub, commits once on release, and cancels on Escape", async () => {
    vi.stubGlobal("CSS", { supports: vi.fn(() => true) })
    const previews: Record<string, string>[] = []
    const commits: Record<string, string>[] = []
    const cancel = vi.fn()
    const host = mountShadow({}, {
      onPreview: (updates: never) => previews.push(updates),
      onCommit: (updates: never) => commits.push(updates),
      onCancel: cancel,
    })
    const input = host.querySelector('[data-testid="box-shadow-0-offsetX"] input') as HTMLInputElement
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10 }))
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 16 }))
    await nextTick()
    expect(previews.at(-1)?.["box-shadow"]).toBe("6px 4px 8px 0px rgb(0 0 0 / 25%)")
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 16 }))
    await nextTick()
    expect(commits).toEqual([{ "box-shadow": "6px 4px 8px 0px rgb(0 0 0 / 25%)" }])

    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10 }))
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 14 }))
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
    await nextTick()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(commits).toHaveLength(1)
  })

  it("marks inherited groups without relying on color alone and disables all actions", () => {
    const host = mountShadow({ inheritedProperties: ["box-shadow", "text-shadow"], disabled: true })
    expect(host.querySelectorAll('[aria-label="Inherited from a lower breakpoint or base state"]')).toHaveLength(2)
    expect([...host.querySelectorAll("button")].every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
    expect([...host.querySelectorAll("input")].every((input) => (input as HTMLInputElement).disabled)).toBe(true)
  })
})
