// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parseStyleAttr } from "../../../../shared/composer"
import type { PropValue } from "../../../../shared/composer/types"
import ComposerStyleControls from "./ComposerStyleControls.vue"

const mounted: Array<() => void> = []

function mountStyles(styleText: string, onSetStyle = vi.fn()) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    render: () => h(ComposerStyleControls, {
      styleText,
      isExpr: false,
      defaultSection: "border",
      currentBreakpoint: "base",
      commitStyle: async () => ({ ok: true as const }),
      onSetStyle,
    }),
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, onSetStyle }
}

function committedCall(setStyle: ReturnType<typeof vi.fn>) {
  const [value, immediate, options] = setStyle.mock.calls.at(-1) ?? []
  expect(value).toMatchObject({ type: "string" })
  return {
    styles: parseStyleAttr((value as PropValue).type === "string" ? (value as Extract<PropValue, { type: "string" }>).value : ""),
    immediate,
    options: options as { historyBoundary?: boolean; deletedKeys?: string[] } | undefined,
  }
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

describe("ComposerStyleControls Border integration", () => {
  it("patches a border stroke onto existing corner geometry instead of replacing the class body", async () => {
    const { host, onSetStyle } = mountStyles([
      "corner-shape: squircle",
      "border-top-left-radius: 203px",
      "border-top-right-radius: 203px",
      "border-bottom-right-radius: 203px",
      "border-bottom-left-radius: 203px",
    ].join("; "))

    const input = host.querySelector('[data-testid="border-width-input"] input') as HTMLInputElement
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10 }))
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 31 }))
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 31 }))
    await nextTick()

    const committed = committedCall(onSetStyle)
    expect(committed.immediate).toBe(true)
    expect(committed.styles).toMatchObject({
      "corner-shape": "squircle",
      "border-top-left-radius": "203px",
      "border-top-right-radius": "203px",
      "border-bottom-right-radius": "203px",
      "border-bottom-left-radius": "203px",
      "border-image": "none",
      "border-width": "22px",
      "border-style": "solid",
    })
    expect(committed.styles.border).toBeUndefined()
    expect(committed.options?.deletedKeys).toEqual(expect.arrayContaining(["border"]))
  })
})
