// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import StudioDocumentDetailShell from "./StudioDocumentDetailShell.vue"

const mounted: Array<() => void> = []

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("StudioDocumentDetailShell", () => {
  it("focuses the heading and exposes keyboard-operable tabs", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const onBack = vi.fn()
    const activeTab = ref("overview")
    const tabs = [
      { id: "overview", label: "Overview" },
      { id: "structure", label: "Structure" },
      { id: "usage", label: "Usage" },
    ]
    const app = createApp(defineComponent({
      setup: () => () => h(StudioDocumentDetailShell, {
        title: "Hero",
        backLabel: "Components",
        tabs,
        activeTab: activeTab.value,
        onBack,
        "onUpdate:activeTab": (value: string) => {
          activeTab.value = value
        },
      }, { default: () => h("p", "Detail content") }),
    }))
    app.mount(host)
    mounted.push(() => {
      app.unmount()
      host.remove()
    })

    await nextTick()
    await nextTick()

    const heading = host.querySelector("h1") as HTMLHeadingElement
    expect(document.activeElement).toBe(heading)

    const tablist = host.querySelector('[role="tablist"]')
    const tabButtons = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tablist?.getAttribute("aria-label")).toBeTruthy()
    expect(tabButtons).toHaveLength(3)
    expect(tabButtons[0]?.getAttribute("aria-selected")).toBe("true")
    expect(tabButtons[1]?.tabIndex).toBe(-1)

    tabButtons[0]?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
    }))
    await nextTick()
    await nextTick()

    const nextTab = host.querySelector<HTMLButtonElement>("#studio-detail-tab-structure")
    expect(activeTab.value).toBe("structure")
    expect(document.activeElement).toBe(nextTab)
    expect(nextTab?.getAttribute("aria-selected")).toBe("true")
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby"))
      .toBe("studio-detail-tab-structure")

    const backButton = [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Components"))
    ;(backButton as HTMLButtonElement).click()
    expect(onBack).toHaveBeenCalledOnce()
  })
})
