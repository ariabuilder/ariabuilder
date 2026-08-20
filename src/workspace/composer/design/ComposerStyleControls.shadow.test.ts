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
      defaultSection: "shadow",
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

describe("ComposerStyleControls Shadow integration", () => {
  it("uses the dedicated editor and commits canonical CSS without disturbing other declarations", async () => {
    const { host, onSetStyle } = mountStyles([
      "color: red",
      "box-shadow: 0 4px 8px #0004",
      "text-shadow: 1px 2px 3px blue",
    ].join("; "))
    expect(host.querySelector('[data-testid="composer-shadow-controls"]')).not.toBeNull()
    expect(host.textContent).not.toContain("0 1px 2px #0002")

    const input = host.querySelector('[data-testid="box-shadow-0-offsetX"] input') as HTMLInputElement
    input.value = "12"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(onSetStyle).not.toHaveBeenCalled()
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()

    expect(onSetStyle).toHaveBeenCalledTimes(1)
    expect(onSetStyle.mock.calls[0]?.[1]).toBe(true)
    expect(committedStyles(onSetStyle)).toEqual({
      color: "red",
      "box-shadow": "12px 4px 8px 0px #0004",
      "text-shadow": "1px 2px 3px blue",
    })
  }, 10_000)

  it("shows inherited shadow values and authors none at the selected breakpoint", async () => {
    const { host, onSetStyle } = mountStyles("color: red", {
      inheritedStyleText: "box-shadow: 0 4px 8px #0004",
    })
    expect(host.querySelector('[aria-label="Inherited from a lower breakpoint or base state"]')).not.toBeNull()
    ;(host.querySelector('[aria-label="Delete shadow 1"]') as HTMLButtonElement).click()
    await nextTick()
    expect(committedStyles(onSetStyle)).toEqual({ color: "red", "box-shadow": "none" })
  })

  it("resets both shadow properties with one explicit history boundary", async () => {
    const { host, onSetStyle } = mountStyles("color: red; box-shadow: 0 1px 2px black; text-shadow: 0 1px black")
    const shadow = host.querySelector('[data-testid="composer-shadow-controls"]') as HTMLElement
    const sectionRoot = shadow.closest('[data-slot="collapsible"]')
    const reset = sectionRoot?.querySelector('[data-testid="property-reset-button"]') as HTMLButtonElement
    expect(reset).not.toBeNull()
    reset.click()
    await nextTick()
    expect(committedStyles(onSetStyle)).toEqual({ color: "red" })
    expect(onSetStyle.mock.calls[0]?.[2]).toMatchObject({ historyBoundary: true })
  })

  it("restores the Stage preview but keeps an invalid raw draft editable", async () => {
    vi.stubGlobal("CSS", { supports: vi.fn(() => false) })
    const { host, onSetStyle } = mountStyles("box-shadow: 0 4px 8px #0004")
    ;(host.querySelector('[data-testid="box-shadow-mode-toggle"]') as HTMLButtonElement).click()
    await nextTick()
    const input = host.querySelector('[data-testid="box-shadow-raw"] input') as HTMLInputElement
    input.value = "definitely invalid"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    await nextTick()
    expect(onSetStyle).not.toHaveBeenCalled()
    expect(input.value).toBe("definitely invalid")
    expect(host.querySelector('[data-testid="box-shadow-error"]')).not.toBeNull()
  })
})
