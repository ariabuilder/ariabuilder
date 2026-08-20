// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import ComposerStyleControls from "./ComposerStyleControls.vue"

const mounted: Array<() => void> = []

function mountStyles() {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    render: () => h(ComposerStyleControls, {
      styleText: "",
      isExpr: false,
      defaultSection: "display",
      currentBreakpoint: "base",
    }),
  })
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ComposerStyleControls section order", () => {
  it("places layout before appearance and effects last", async () => {
    const host = mountStyles()
    await nextTick()
    const titles = [...host.querySelectorAll("[data-inspector-section]")].map((node) => node.getAttribute("data-inspector-section"))
    expect(titles).toEqual([
      "Display",
      "Size",
      "Spacing",
      "Position",
      "Transform",
      "Typography",
      "Background",
      "Border",
      "Corner",
      "Shadow",
      "Filter",
      "Opacity",
    ])
  })
})
