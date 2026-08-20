// @vitest-environment jsdom

import { createApp, h, nextTick, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { m } from "@/paraglide/messages.js"
import ComposerFilterControls from "./ComposerFilterControls.vue"

const mounted: Array<() => void> = []

function mountFilter(
  props: Record<string, unknown> = {},
  listeners: Record<string, (...args: never[]) => void> = {},
) {
  const host = document.createElement("div")
  document.body.append(host)
  const { values: initialValues = {}, ...restProps } = props
  const values = ref<Record<string, string>>({ ...(initialValues as Record<string, string>) })
  const onPreview = listeners.onPreview
  const onCommit = listeners.onCommit
  const onCancel = listeners.onCancel
  const app = createApp({
    render: () => h(ComposerFilterControls, {
      resetKey: "selection:base",
      ...restProps,
      values: values.value,
      onPreview: (updates: Record<string, string>) => {
        values.value = { ...values.value, ...updates }
        onPreview?.(updates as never)
      },
      onCommit: (updates: Record<string, string>) => {
        values.value = { ...values.value, ...updates }
        onCommit?.(updates as never)
      },
      onCancel: () => onCancel?.(),
    }),
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return host
}

function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

async function openAdvanced(host: HTMLElement) {
  const trigger = [...host.querySelectorAll("button")]
    .find((button) => button.textContent?.includes("Advanced CSS")) as HTMLButtonElement
  trigger.click()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 25))
  await nextTick()
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
  vi.unstubAllGlobals()
})

describe("ComposerFilterControls", () => {
  it("keeps Blend first and renders both nine-effect groups with accessible ranges", () => {
    const host = mountFilter()
    const text = host.textContent ?? ""
    expect(text.indexOf("Blend")).toBeLessThan(text.indexOf("Filter"))
    expect(host.querySelector('[data-testid="filter-filter-section"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="backdrop-filter-section"]')).not.toBeNull()
    expect(host.querySelectorAll('button[aria-pressed="false"]')).toHaveLength(18)

    const filterBlur = host.querySelector('[data-testid="filter-blur-slider"] [role="slider"]') as HTMLElement
    const backdropBlur = host.querySelector('[data-testid="backdrop-blur-slider"] [role="slider"]') as HTMLElement
    const hue = host.querySelector('[data-testid="filter-hueRotate-slider"] [role="slider"]') as HTMLElement
    const saturate = host.querySelector('[data-testid="filter-saturate-slider"] [role="slider"]') as HTMLElement
    expect(filterBlur.getAttribute("aria-label")).toBe("Filter Blur")
    expect(filterBlur.getAttribute("aria-valuemax")).toBe("64")
    expect(backdropBlur.getAttribute("aria-valuemax")).toBe("40")
    expect(hue.getAttribute("aria-valuemax")).toBe("360")
    expect(saturate.getAttribute("aria-valuemax")).toBe("300")
    expect((host.querySelector('[data-testid="filter-blur-input"] input') as HTMLInputElement).getAttribute("aria-label")).toBe("Filter Blur")
    expect((host.querySelector('[data-testid="filter-blend-select"]') as HTMLElement).getAttribute("aria-labelledby"))
      .toBe("composer-filter-blend-label")
  })

  it("uses useful toggle presets, restores identity, and retains advanced URL tokens", async () => {
    const commit = vi.fn()
    const host = mountFilter({ values: { filter: "url(#noise) opacity(75%)" } }, { onCommit: commit })
    const blur = host.querySelector('[data-testid="filter-blur-toggle"]') as HTMLButtonElement
    blur.click()
    await nextTick()
    expect(commit).toHaveBeenLastCalledWith({ filter: "url(#noise) opacity(75%) blur(4px)" })
    expect(blur.getAttribute("aria-pressed")).toBe("true")

    blur.click()
    await nextTick()
    expect(commit).toHaveBeenLastCalledWith({ filter: "url(#noise) opacity(75%)" })
    expect(blur.getAttribute("aria-pressed")).toBe("false")
  })

  it("disables only the slider for a variable value and clamps typed numeric commits", async () => {
    const commit = vi.fn()
    const host = mountFilter({ values: { filter: "blur(var(--softness))" } }, { onCommit: commit })
    const slider = host.querySelector('[data-testid="filter-blur-slider"] [role="slider"]') as HTMLElement
    const input = host.querySelector('[data-testid="filter-blur-input"] input') as HTMLInputElement
    expect(slider.getAttribute("aria-disabled")).toBe("true")
    expect(input.disabled).toBe(false)
    expect(input.value).toBe("var(--softness)")

    setInput(input, "100")
    await nextTick()
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).toHaveBeenLastCalledWith({ filter: "blur(64px)" })
  })

  it("keeps malformed structured drafts visible without previewing or committing them", async () => {
    const preview = vi.fn()
    const commit = vi.fn()
    const cancel = vi.fn()
    const host = mountFilter({ values: { filter: "blur(2px)" } }, {
      onPreview: preview,
      onCommit: commit,
      onCancel: cancel,
    })
    const input = host.querySelector('[data-testid="filter-blur-input"] input') as HTMLInputElement

    setInput(input, "bogus")
    await nextTick()
    expect(input.value).toBe("bogus")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-describedby")).toBe("composer-filter-blur-error")
    expect(host.textContent).toContain("Use a valid CSS value for Filter")
    expect(preview).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)

    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).not.toHaveBeenCalled()

    setInput(input, "var(--softness)")
    await nextTick()
    expect(preview).toHaveBeenLastCalledWith({ filter: "blur(var(--softness))" })
    expect(input.getAttribute("aria-invalid")).toBeNull()
  })

  it("locks an opaque property without locking the other structured group", async () => {
    const host = mountFilter({ values: { filter: "var(--site-filter)" } })
    expect(host.textContent).toContain("structured controls cannot edit safely")
    expect((host.querySelector('[data-testid="filter-blur-toggle"]') as HTMLButtonElement).disabled).toBe(true)
    expect((host.querySelector('[data-testid="backdrop-blur-toggle"]') as HTMLButtonElement).disabled).toBe(false)

    await openAdvanced(host)
    expect((host.querySelector('[data-testid="filter-filter-raw"]') as HTMLTextAreaElement).value).toBe("var(--site-filter)")
  })

  it("previews valid Advanced CSS, rejects invalid drafts, commits on blur, and cancels on Escape", async () => {
    vi.stubGlobal("CSS", {
      supports: vi.fn((_property: string, value: string) => value !== "broken()"),
    })
    const preview = vi.fn()
    const commit = vi.fn()
    const cancel = vi.fn()
    const host = mountFilter({ values: { filter: "blur(2px)" } }, {
      onPreview: preview,
      onCommit: commit,
      onCancel: cancel,
    })
    await openAdvanced(host)
    const raw = host.querySelector('[data-testid="filter-filter-raw"]') as HTMLTextAreaElement

    setInput(raw, "broken()")
    await nextTick()
    expect(raw.getAttribute("aria-invalid")).toBe("true")
    expect(host.textContent).toContain("Use a valid CSS value for Filter")
    expect(preview).not.toHaveBeenCalled()
    raw.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    expect(commit).not.toHaveBeenCalled()

    setInput(raw, "blur(8px) contrast(120%)")
    await nextTick()
    expect(preview).toHaveBeenLastCalledWith({ filter: "blur(8px) contrast(120%)" })
    raw.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).toHaveBeenLastCalledWith({ filter: "blur(8px) contrast(120%)" })

    setInput(raw, "blur(12px)")
    raw.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
    await nextTick()
    expect(cancel).toHaveBeenCalled()
  })

  it("previews a pointer scrub, commits once on release, and cancels on Escape", async () => {
    const preview = vi.fn()
    const commit = vi.fn()
    const cancel = vi.fn()
    const host = mountFilter({ values: { filter: "blur(2px)" } }, {
      onPreview: preview,
      onCommit: commit,
      onCancel: cancel,
    })
    const input = host.querySelector('[data-testid="filter-blur-input"] input') as HTMLInputElement
    input.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10 }))
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 16 }))
    await nextTick()
    expect(preview).toHaveBeenLastCalledWith({ filter: "blur(8px)" })
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 16 }))
    await nextTick()
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenLastCalledWith({ filter: "blur(8px)" })

    input.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10 }))
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 14 }))
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
    await nextTick()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it("expands the drop shadow preset into ranged controls and the alpha color field", async () => {
    const commit = vi.fn()
    const host = mountFilter({}, { onCommit: commit })
    ;(host.querySelector('[data-testid="filter-dropShadow-toggle"]') as HTMLButtonElement).click()
    await nextTick()

    expect(commit).toHaveBeenLastCalledWith({
      filter: "drop-shadow(2px 4px 8px rgba(0, 0, 0, 0.25))",
    })
    const x = host.querySelector('[data-testid="filter-dropShadowX-slider"] [role="slider"]') as HTMLElement
    const blur = host.querySelector('[data-testid="filter-dropShadowBlur-slider"] [role="slider"]') as HTMLElement
    expect(x.getAttribute("aria-valuemin")).toBe("-100")
    expect(x.getAttribute("aria-valuemax")).toBe("100")
    expect(blur.getAttribute("aria-valuemin")).toBe("0")
    expect(blur.getAttribute("aria-valuemax")).toBe("100")
    expect(host.querySelector('[aria-label="Filter drop shadow color"]')).not.toBeNull()
  })

  it("parses color-first drop shadows without swapping color and offsets", () => {
    const host = mountFilter({ values: { filter: "drop-shadow(red 2px 4px 8px)" } })
    expect((host.querySelector('[data-testid="filter-dropShadowX-input"] input') as HTMLInputElement).value).toBe("2")
    expect((host.querySelector('[data-testid="filter-dropShadowY-input"] input') as HTMLInputElement).value).toBe("4")
    expect((host.querySelector('[data-testid="filter-dropShadowBlur-input"] input') as HTMLInputElement).value).toBe("8")
    expect(host.querySelector('[aria-label="Filter drop shadow color"]')?.textContent).toContain("red")
  })

  it("marks inherited values, localizes all new copy, and respects disabled state", async () => {
    expect(m.composer_filter_backdrop({}, { locale: "fr" })).toBe("Filtre d’arrière-plan")
    expect(m.composer_filter_advanced_hint({}, { locale: "fr" })).toContain("Échap")

    const host = mountFilter({
      inheritedProperties: ["filter", "backdrop-filter", "mix-blend-mode"],
      disabled: true,
    })
    expect(host.querySelectorAll('[aria-label="Inherited from a lower breakpoint or base state"]')).toHaveLength(3)
    expect((host.querySelector('[data-testid="filter-blend-select"]') as HTMLButtonElement).disabled).toBe(true)
    expect((host.querySelector('[data-testid="filter-blur-toggle"]') as HTMLButtonElement).disabled).toBe(true)
    expect((host.querySelector('[data-testid="filter-blur-input"] input') as HTMLInputElement).disabled).toBe(true)
    await openAdvanced(host)
    expect((host.querySelector('[data-testid="filter-filter-raw"]') as HTMLTextAreaElement).disabled).toBe(true)
  })
})
