// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"

const mountedApps: Array<ReturnType<typeof createApp>> = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ""
})

describe("Dialog focus handoff", () => {
  it("clears background focus before opening and restores it after closing", async () => {
    const open = ref(false)
    const Harness = defineComponent({
      setup() {
        return () =>
          h("div", [
            h("button", { id: "dialog-origin" }, "Open"),
            h(
              Dialog,
              {
                open: open.value,
                "onUpdate:open": (value: boolean) => {
                  open.value = value
                },
              },
              {
                default: () =>
                  h(DialogContent, null, {
                    default: () => [
                      h(DialogTitle, null, { default: () => "Example" }),
                      h(DialogDescription, null, { default: () => "Example dialog" }),
                      h("button", { id: "inside-dialog" }, "Continue"),
                    ],
                  }),
              },
            ),
          ])
      },
    })

    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp(Harness)
    mountedApps.push(app)
    app.mount(host)

    const origin = document.querySelector<HTMLButtonElement>("#dialog-origin")!
    origin.focus()
    expect(document.activeElement).toBe(origin)

    open.value = true
    await nextTick()
    expect(document.activeElement).not.toBe(origin)
    await nextTick()
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true)

    open.value = false
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement).toBe(origin)
  })
})
