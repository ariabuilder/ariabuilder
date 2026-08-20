// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, h } from "vue"
import WorkspaceSwitcherDismissLayer from "@/workspace/WorkspaceSwitcherDismissLayer.vue"

const mounted: Array<() => void> = []

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("WorkspaceSwitcherDismissLayer", () => {
  it("dismisses on an outside pointer press without passing it through", () => {
    const onDismiss = vi.fn()
    const host = document.createElement("div")
    document.body.append(host)

    const app = createApp({
      render: () => h(WorkspaceSwitcherDismissLayer, { onDismiss }),
    })
    app.mount(host)
    mounted.push(() => {
      app.unmount()
      host.remove()
    })

    const layer = host.querySelector<HTMLElement>(
      "[data-workspace-switcher-dismiss-layer]",
    )
    expect(layer).not.toBeNull()
    expect(layer?.getAttribute("aria-hidden")).toBe("true")
    expect(layer?.classList.contains("app-region-no-drag")).toBe(true)

    const event = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    })
    layer?.dispatchEvent(event)

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })
})
