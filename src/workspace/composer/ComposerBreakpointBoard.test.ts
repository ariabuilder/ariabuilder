// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import ComposerBreakpointBoard from "./ComposerBreakpointBoard.vue"

const mounted: Array<() => void> = []

function stubBoardSize(host: HTMLElement, width: number, height: number) {
  const board = host.querySelector("[data-aria-composer-breakpoint-board]") as HTMLElement | null
  if (!board) return
  Object.defineProperty(board, "clientWidth", { configurable: true, get: () => width })
  Object.defineProperty(board, "clientHeight", { configurable: true, get: () => height })
}

async function flushOpeningFit() {
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
  await nextTick()
}

function mountBoard(isolatedDevice: "desktop" | "tablet" | "mobile" | null = null) {
  const host = document.createElement("div")
  host.style.width = "1749px"
  host.style.height = "800px"
  document.body.append(host)
  const app = createApp({
    render: () =>
      h(ComposerBreakpointBoard, {
        previewUrl: "http://127.0.0.1:4321",
        selectedRoute: "/",
        reloadKey: 1,
        isolatedDevice,
      }),
  })
  app.mount(host)
  stubBoardSize(host, 1749, 800)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ComposerBreakpointBoard", () => {
  it("renders three view-only breakpoint frames on a pan/zoom board", async () => {
    const host = mountBoard()
    await flushOpeningFit()
    expect(host.querySelector("[data-aria-composer-breakpoint-board]")).not.toBeNull()
    const iframes = [...host.querySelectorAll("iframe")]
    expect(iframes).toHaveLength(3)
    expect(host.textContent).toContain("Desktop · 1440px")
    expect(host.textContent).toContain("Tablet · 768px")
    expect(host.textContent).toContain("Mobile · 375px")
    for (const frame of iframes) {
      expect(frame.className).toContain("pointer-events-none")
      expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-same-origin")
      expect(frame.src).toContain("aria-design")
    }
    expect(host.querySelector("button[aria-label='Fit']")).not.toBeNull()
    expect(host.textContent).toMatch(/\d+%/)
  })

  it("dims the other breakpoint frames when one is isolated", async () => {
    const host = mountBoard("tablet")
    await flushOpeningFit()
    const desktop = host.querySelector("[data-aria-breakpoint-frame='desktop']")
    const tablet = host.querySelector("[data-aria-breakpoint-frame='tablet']")
    const mobile = host.querySelector("[data-aria-breakpoint-frame='mobile']")
    expect(desktop?.className).toContain("opacity-35")
    expect(tablet?.className).toContain("opacity-100")
    expect(mobile?.className).toContain("opacity-35")
  })
})
