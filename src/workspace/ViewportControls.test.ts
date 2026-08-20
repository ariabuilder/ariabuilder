// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import ViewportControls from "./ViewportControls.vue"
import type { DevicePreview } from "@/workspace/types"

const mounted: Array<() => void> = []

function mountControls(device: DevicePreview | null, allowDeselect = false) {
  const host = document.createElement("div")
  document.body.append(host)
  const changes: Array<DevicePreview | null> = []
  const app = createApp({
    render: () =>
      h(TooltipProvider, null, {
        default: () =>
          h(ViewportControls, {
            device,
            allowDeselect,
            onChange: (next: DevicePreview | null) => {
              changes.push(next)
            },
          }),
      }),
  })
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return { host, changes }
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ViewportControls", () => {
  it("emits the clicked device in design mode", async () => {
    const { host, changes } = mountControls("desktop")
    const buttons = [...host.querySelectorAll("button")]
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true")
    buttons[1]?.click()
    await nextTick()
    expect(changes).toEqual(["tablet"])
  })

  it("toggles the active preview device back to all breakpoints", async () => {
    const { host, changes } = mountControls("tablet", true)
    const buttons = [...host.querySelectorAll("button")]
    expect(buttons[1]?.getAttribute("aria-label")).toBe("Show all breakpoints")
    buttons[1]?.click()
    await nextTick()
    expect(changes).toEqual([null])
  })
})
