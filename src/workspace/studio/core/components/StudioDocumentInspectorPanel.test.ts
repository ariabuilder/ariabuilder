// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import StudioDocumentInspectorPanel from "./StudioDocumentInspectorPanel.vue"

const mounted: Array<() => void> = []
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("StudioDocumentInspectorPanel", () => {
  it("focuses its heading and supports the tabs and close control by keyboard", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const activeTab = ref("contract")
    const onClose = vi.fn()
    const app = createApp(defineComponent({
      setup: () => () => h(StudioDocumentInspectorPanel, {
        title: "Hero",
        description: "src/components/Hero.astro",
        closeLabel: "Close inspector",
        tabs: [
          { id: "contract", label: "Contract" },
          { id: "usage", label: "Usage" },
        ],
        activeTab: activeTab.value,
        onClose,
        "onUpdate:activeTab": (value: string) => { activeTab.value = value },
      }, { default: () => h("p", "Inspector content") }),
    }))
    app.mount(host)
    mounted.push(() => { app.unmount(); host.remove() })

    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(host.querySelector("h1"))

    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(host.querySelector('[role="tablist"]')?.className).toContain("h-12")
    expect(tabs[0]?.className).toContain("h-full!")
    expect(tabs[0]?.className).toContain("after:-bottom-px")
    tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    await nextTick()
    await nextTick()
    expect(activeTab.value).toBe("usage")
    expect(document.activeElement).toBe(host.querySelector("#studio-inspector-tab-usage"))

    host.querySelector<HTMLButtonElement>('button[aria-label="Close inspector"]')?.click()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("closes on outside pointer interaction but stays open for panel interaction", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const onClose = vi.fn()
    const app = createApp(StudioDocumentInspectorPanel, {
      title: "Hero",
      closeLabel: "Close inspector",
      tabs: [{ id: "contract", label: "Contract" }],
      activeTab: "contract",
      onClose,
    })
    app.mount(host)
    mounted.push(() => { app.unmount(); host.remove() })
    await nextTick()

    host.querySelector("aside")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()

    const pageTrigger = document.createElement("button")
    pageTrigger.dataset.pageFile = "src/pages/about.astro"
    document.body.append(pageTrigger)
    pageTrigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    pageTrigger.remove()

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
