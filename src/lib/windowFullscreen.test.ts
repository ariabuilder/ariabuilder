// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useWindowFullscreen } from "@/composables/useWindowFullscreen"

const mountedApps: Array<ReturnType<typeof createApp>> = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("useWindowFullscreen", () => {
  it("shares one native listener across all mounted consumers", async () => {
    const removeListener = vi.fn()
    const onFullscreenChange = vi.fn(() => removeListener)
    const isFullscreen = vi.fn().mockResolvedValue(false)
    Object.defineProperty(window, "aria", {
      configurable: true,
      value: {
        window: {
          isFullscreen,
          onFullscreenChange,
        },
      },
    })

    const Consumer = defineComponent({
      setup() {
        useWindowFullscreen()
        return () => h("div")
      },
    })
    const app = createApp({
      render: () => h("div", [h(Consumer), h(Consumer), h(Consumer)]),
    })
    mountedApps.push(app)
    const host = document.createElement("div")
    document.body.append(host)
    app.mount(host)
    await nextTick()

    expect(isFullscreen).toHaveBeenCalledTimes(1)
    expect(onFullscreenChange).toHaveBeenCalledTimes(1)

    app.unmount()
    mountedApps.pop()
    expect(removeListener).toHaveBeenCalledTimes(1)
  })
})
