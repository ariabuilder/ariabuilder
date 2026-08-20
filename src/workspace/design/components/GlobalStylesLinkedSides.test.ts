// @vitest-environment jsdom

import { nextTick } from "vue"
import { describe, expect, it, vi } from "vitest"
import { createApp, h, type Component } from "vue"
import type { SpacingSides } from "../../../../shared/composer/styleAttr"
import GlobalStylesLinkedSides from "./GlobalStylesLinkedSides.vue"

type LinkedSidesProps = {
  label: string
  linked: boolean
  values: SpacingSides
  "onUpdate:linked"?: (value: boolean) => void
}

function mount(props: LinkedSidesProps) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    render: () => h(GlobalStylesLinkedSides as Component, props),
  })
  app.mount(host)
  return { host, unmount: () => { app.unmount(); host.remove() } }
}

describe("GlobalStylesLinkedSides", () => {
  it("renders linked spacing as Y/X axis controls", () => {
    const { host, unmount } = mount({
      label: "Margin",
      linked: true,
      values: { top: "8px", right: "4px", bottom: "8px", left: "4px" },
    })
    const inputs = host.querySelectorAll("input")
    expect(inputs).toHaveLength(2)
    expect((inputs[0] as HTMLInputElement).value).toBe("8px")
    expect((inputs[1] as HTMLInputElement).value).toBe("4px")
    unmount()
  })

  it("renders unlinked spacing as four side controls", () => {
    const { host, unmount } = mount({
      label: "Padding",
      linked: false,
      values: { top: "1px", right: "2px", bottom: "3px", left: "4px" },
    })
    const inputs = host.querySelectorAll("input")
    expect(inputs).toHaveLength(4)
    expect([...inputs].map((input) => (input as HTMLInputElement).value)).toEqual([
      "1px",
      "3px",
      "4px",
      "2px",
    ])
    unmount()
  })

  it("toggles linked spacing sides with an accessible pressed state", async () => {
    const update = vi.fn()
    const { host, unmount } = mount({
      label: "Padding",
      linked: true,
      values: { top: "1rem", right: "1rem", bottom: "1rem", left: "1rem" },
      "onUpdate:linked": update,
    })
    const button = host.querySelector('button[aria-pressed="true"]') as HTMLButtonElement
    expect(button).not.toBeNull()
    button.click()
    await nextTick()
    expect(update).toHaveBeenCalledWith(false)
    unmount()
  })
})
