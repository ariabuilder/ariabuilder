// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parseStyleAttr } from "../../../../shared/composer"
import type { PropValue } from "../../../../shared/composer/types"
import ComposerStyleControls from "./ComposerStyleControls.vue"

const mounted: Array<() => void> = []

function mountOpacity(
  styleText: string,
  commitStyle = vi.fn().mockResolvedValue({ ok: true }),
  extraProps: Record<string, unknown> = {},
) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    render: () => h(ComposerStyleControls, {
      styleText,
      isExpr: false,
      defaultSection: "opacity",
      currentBreakpoint: "base",
      commitStyle,
      ...extraProps,
    }),
  })
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return { host, commitStyle }
}

async function flushUi(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
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

describe("ComposerStyleControls Opacity integration", () => {
  it("renders the dedicated percent slider with accessible slider semantics", () => {
    const { host } = mountOpacity("opacity: 0.44")
    const slider = host.querySelector('[role="slider"]') as HTMLElement
    expect(slider).toBeInstanceOf(HTMLElement)
    expect(slider.getAttribute("aria-label")).toBe("Opacity")
    expect(slider.getAttribute("aria-valuetext")).toBe("44% opacity")
    expect(host.querySelector('[data-testid="opacity-value"]')?.textContent?.trim())
      .toBe("44%")
  })

  it("resets only opacity through the acknowledged history boundary", async () => {
    const { host, commitStyle } = mountOpacity("color: red; opacity: 0.72")
    const reset = host.querySelector('[data-testid="property-reset-button"]') as HTMLButtonElement
    expect(reset).toBeInstanceOf(HTMLButtonElement)
    reset.click()
    await flushUi()

    expect(commitStyle).toHaveBeenCalledOnce()
    const value = commitStyle.mock.calls[0]?.[0] as PropValue | undefined
    expect(parseStyleAttr(value?.type === "string" ? value.value : ""))
      .toEqual({ color: "red" })
    expect(commitStyle.mock.calls[0]?.[1]).toMatchObject({ historyBoundary: true })
    expect(commitStyle.mock.calls[0]?.[1].deletedKeys).toEqual(expect.arrayContaining(["opacity"]))
    expect(host.querySelector('[data-testid="opacity-value"]')?.textContent?.trim())
      .toBe("100%")
  })

  it("restores the prior opacity and reports an acknowledged reset failure", async () => {
    const commitStyle = vi.fn().mockResolvedValue({
      ok: false,
      error: "Opacity transaction failed",
    })
    const { host } = mountOpacity("color: red; opacity: 0.72", commitStyle)
    ;(host.querySelector('[data-testid="property-reset-button"]') as HTMLButtonElement).click()
    await flushUi()

    expect(host.querySelector('[data-testid="opacity-value"]')?.textContent?.trim())
      .toBe("72%")
    expect(host.querySelector('[data-testid="opacity-error"]')?.textContent)
      .toBe("Opacity transaction failed")
  })
})
