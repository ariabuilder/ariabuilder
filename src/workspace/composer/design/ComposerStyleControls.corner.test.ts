// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parseStyleAttr } from "../../../../shared/composer"
import type { PropValue } from "../../../../shared/composer/types"
import ComposerStyleControls from "./ComposerStyleControls.vue"

const mounted: Array<() => void> = []

function mountStyles(styleText: string, onSetStyle = vi.fn(), extraProps: Record<string, unknown> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    render: () => h(ComposerStyleControls, {
      styleText,
      isExpr: false,
      defaultSection: "corner",
      currentBreakpoint: "base",
      commitStyle: async () => ({ ok: true as const }),
      onSetStyle,
      ...extraProps,
    }),
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, onSetStyle }
}

function setInput(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function committedStyles(setStyle: ReturnType<typeof vi.fn>): Record<string, string> {
  const value = setStyle.mock.calls.at(-1)?.[0] as PropValue | undefined
  expect(value).toMatchObject({ type: "string" })
  return parseStyleAttr(value?.type === "string" ? value.value : "")
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

describe("ComposerStyleControls Corner integration", () => {
  it("uses the dedicated Corner UI and writes canonical Astro style declarations", async () => {
    const { host, onSetStyle } = mountStyles("color: red; border-radius: 10px; corner-shape: squircle")
    expect(host.querySelector('[data-testid="composer-corner-controls"]')).not.toBeNull()
    expect(host.textContent).not.toContain("Start start")

    const input = host.querySelector('[data-testid="corner-linked-radius-input"] input') as HTMLInputElement
    setInput(input, "18")
    await nextTick()
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()

    expect(onSetStyle).toHaveBeenCalledTimes(1)
    expect(onSetStyle.mock.calls[0]?.[1]).toBe(true)
    expect(committedStyles(onSetStyle)).toEqual({
      color: "red",
      "corner-shape": "squircle",
      "border-top-left-radius": "18px",
      "border-top-right-radius": "18px",
      "border-bottom-right-radius": "18px",
      "border-bottom-left-radius": "18px",
    })
  })

  it("previews scrubbing without persistence and creates one commit on release", async () => {
    const { host, onSetStyle } = mountStyles("border-radius: 4px")
    const input = host.querySelector('[data-testid="corner-linked-radius-input"] input') as HTMLInputElement
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10 }))
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 18 }))
    await nextTick()
    expect(onSetStyle).not.toHaveBeenCalled()

    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 18 }))
    await nextTick()
    expect(onSetStyle).toHaveBeenCalledTimes(1)
    expect(committedStyles(onSetStyle)["border-top-left-radius"]).toBe("12px")
  })

  it("resets shorthand, physical, logical, and shape declarations while preserving unrelated styles", async () => {
    const { host, onSetStyle } = mountStyles([
      "color: red",
      "border-radius: 6px",
      "border-top-left-radius: 7px",
      "border-start-end-radius: 8px",
      "corner-shape: scoop",
      "corner-bottom-left-shape: bevel",
      "corner-end-end-shape: notch",
    ].join("; "))
    const corner = host.querySelector('[data-testid="composer-corner-controls"]') as HTMLElement
    const sectionRoot = corner.closest('[data-slot="collapsible"]')
    const reset = sectionRoot?.querySelector('[data-testid="property-reset-button"]') as HTMLButtonElement
    expect(reset).toBeInstanceOf(HTMLButtonElement)
    reset.click()
    await nextTick()

    expect(onSetStyle).toHaveBeenCalledTimes(1)
    expect(committedStyles(onSetStyle)).toEqual({ color: "red" })
    expect(onSetStyle.mock.calls[0]?.[2]).toMatchObject({ historyBoundary: true })
  })

  it("owns physical, logical, and shape overrides across responsive targets", async () => {
    const selectBreakpoint = vi.fn()
    const { host } = mountStyles("corner-start-start-shape: scoop", vi.fn(), {
      currentBreakpoint: "tablet",
      breakpointStyles: [
        { id: "base", label: "Base", width: null, styleText: "color: red" },
        { id: "tablet", label: "Tablet", width: 900, styleText: "corner-start-start-shape: scoop" },
        { id: "wide", label: "Wide", width: 1280, styleText: "border-bottom-left-radius: 2rem" },
      ],
      onSelectBreakpoint: selectBreakpoint,
    })
    await nextTick()

    const cornerSection = host.querySelector('[data-testid="composer-corner-controls"]')?.closest('[data-slot="collapsible"]') as HTMLElement
    const tablet = cornerSection.querySelector('[data-testid="breakpoint-indicator-tablet"]') as HTMLButtonElement
    const wide = cornerSection.querySelector('[data-testid="breakpoint-indicator-wide"]') as HTMLButtonElement
    expect(cornerSection.querySelector('[data-testid="breakpoint-indicator-base"]')).toBeNull()
    expect(tablet.getAttribute("aria-pressed")).toBe("true")
    expect(wide.getAttribute("aria-pressed")).toBe("false")
    wide.click()
    expect(selectBreakpoint).toHaveBeenCalledWith("wide")
  })
})
