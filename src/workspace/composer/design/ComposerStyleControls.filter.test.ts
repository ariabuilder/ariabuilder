// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parseStyleAttr } from "../../../../shared/composer"
import type { PropValue } from "../../../../shared/composer/types"
import ComposerStyleControls from "./ComposerStyleControls.vue"

const mounted: Array<() => void> = []

function mountStyles(styleText: string, extraProps: Record<string, unknown> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const onSetStyle = vi.fn()
  const app = createApp({
    render: () => h(ComposerStyleControls, {
      styleText,
      isExpr: false,
      defaultSection: "filter",
      currentBreakpoint: "base",
      onSetStyle,
      ...extraProps,
    }),
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, onSetStyle }
}

function committedStyles(setStyle: ReturnType<typeof vi.fn>): Record<string, string> {
  const value = setStyle.mock.calls.at(-1)?.[0] as PropValue | undefined
  expect(value).toMatchObject({ type: "string" })
  return parseStyleAttr(value?.type === "string" ? value.value : "")
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
  vi.stubGlobal("CSS", { supports: vi.fn(() => true) })
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

describe("ComposerStyleControls Filter integration", () => {
  it("uses the dedicated editor and preserves unrelated and advanced filter declarations", async () => {
    const { host, onSetStyle } = mountStyles("color: red; filter: url(#noise) blur(2px); mix-blend-mode: multiply")
    expect(host.querySelector('[data-testid="composer-filter-controls"]')).not.toBeNull()

    ;(host.querySelector('[data-testid="filter-contrast-toggle"]') as HTMLButtonElement).click()
    await nextTick()
    expect(onSetStyle).toHaveBeenCalledTimes(1)
    expect(onSetStyle.mock.calls[0]?.[1]).toBe(true)
    expect(committedStyles(onSetStyle)).toEqual({
      color: "red",
      filter: "url(#noise) blur(2px) contrast(120%)",
      "mix-blend-mode": "multiply",
    })
  })

  it("previews a scrub without persistence and commits once on release", async () => {
    const { host, onSetStyle } = mountStyles("filter: blur(2px)")
    const input = host.querySelector('[data-testid="filter-blur-input"] input') as HTMLInputElement
    input.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10 }))
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 16 }))
    await nextTick()
    expect(onSetStyle).not.toHaveBeenCalled()

    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 16 }))
    await nextTick()
    expect(onSetStyle).toHaveBeenCalledTimes(1)
    expect(committedStyles(onSetStyle).filter).toBe("blur(8px)")
  })

  it("resets filter, backdrop filter, and blend with one history boundary", async () => {
    const { host, onSetStyle } = mountStyles([
      "color: red",
      "filter: blur(4px)",
      "backdrop-filter: saturate(120%)",
      "mix-blend-mode: screen",
    ].join("; "))
    const controls = host.querySelector('[data-testid="composer-filter-controls"]') as HTMLElement
    const sectionRoot = controls.closest('[data-slot="collapsible"]')
    const reset = sectionRoot?.querySelector('[data-testid="property-reset-button"]') as HTMLButtonElement
    expect(reset).not.toBeNull()
    reset.click()
    await nextTick()

    expect(committedStyles(onSetStyle)).toEqual({ color: "red" })
    expect(onSetStyle.mock.calls[0]?.[2]).toMatchObject({ historyBoundary: true })
  })

  it("resolves inherited filter values while authoring only the selected breakpoint", async () => {
    const { host, onSetStyle } = mountStyles("color: red", {
      inheritedStyleText: "filter: blur(4px); backdrop-filter: contrast(120%)",
    })
    expect(host.querySelectorAll('[aria-label="Inherited from a lower breakpoint or base state"]')).toHaveLength(2)

    ;(host.querySelector('[data-testid="filter-blur-toggle"]') as HTMLButtonElement).click()
    await nextTick()
    expect(committedStyles(onSetStyle)).toEqual({ color: "red", filter: "none" })
  })

  it("owns all three declarations across responsive breakpoint indicators", async () => {
    const selectBreakpoint = vi.fn()
    const { host } = mountStyles("backdrop-filter: blur(8px)", {
      currentBreakpoint: "tablet",
      breakpointStyles: [
        { id: "base", label: "Base", width: null, styleText: "filter: grayscale(100%)" },
        { id: "tablet", label: "Tablet", width: 900, styleText: "backdrop-filter: blur(8px)" },
        { id: "wide", label: "Wide", width: 1280, styleText: "mix-blend-mode: overlay" },
      ],
      onSelectBreakpoint: selectBreakpoint,
    })
    await nextTick()

    const section = host.querySelector('[data-testid="composer-filter-controls"]')?.closest('[data-slot="collapsible"]') as HTMLElement
    expect(section.querySelector('[data-testid="breakpoint-indicator-base"]')).not.toBeNull()
    expect(section.querySelector('[data-testid="breakpoint-indicator-tablet"]')?.getAttribute("aria-pressed")).toBe("true")
    const wide = section.querySelector('[data-testid="breakpoint-indicator-wide"]') as HTMLButtonElement
    wide.click()
    expect(selectBreakpoint).toHaveBeenCalledWith("wide")
  })

  it("restores the committed Advanced value on Escape through the live session", async () => {
    const { host, onSetStyle } = mountStyles("filter: blur(2px)")
    await openAdvanced(host)
    const raw = host.querySelector('[data-testid="filter-filter-raw"]') as HTMLTextAreaElement
    raw.value = "blur(8px)"
    raw.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(raw.value).toBe("blur(8px)")

    raw.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))
    await nextTick()
    await nextTick()
    expect((host.querySelector('[data-testid="filter-filter-raw"]') as HTMLTextAreaElement).value).toBe("blur(2px)")
    expect(onSetStyle).not.toHaveBeenCalled()
  })

  it("clears dirty Advanced drafts when the Filter section is reset", async () => {
    const { host, onSetStyle } = mountStyles("filter: blur(2px); backdrop-filter: contrast(120%)")
    await openAdvanced(host)
    const raw = host.querySelector('[data-testid="filter-filter-raw"]') as HTMLTextAreaElement
    raw.value = "broken()"
    raw.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(raw.getAttribute("aria-invalid")).toBe("true")

    const controls = host.querySelector('[data-testid="composer-filter-controls"]') as HTMLElement
    const reset = controls.closest('[data-slot="collapsible"]')
      ?.querySelector('[data-testid="property-reset-button"]') as HTMLButtonElement
    reset.click()
    await nextTick()
    await openAdvanced(host)

    const replacement = host.querySelector('[data-testid="filter-filter-raw"]') as HTMLTextAreaElement
    expect(replacement.value).toBe("none")
    expect(replacement.getAttribute("aria-invalid")).not.toBe("true")
    const last = onSetStyle.mock.calls.at(-1)
    expect(last?.[0]).toBeUndefined()
    expect(last?.[1]).toBe(true)
    expect(last?.[2]).toMatchObject({ historyBoundary: true })
  })
})
