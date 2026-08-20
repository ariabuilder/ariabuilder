// @vitest-environment jsdom

import { computed, createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ComposerLayerTreeProjection } from "../../../../shared/composer/layers"
import { TooltipProvider } from "@/components/ui/tooltip"
import { createComposerBeacon, provideComposerBeacon } from "../selection/useComposerBeacon"
import {
  provideComposerDocument,
  type ComposerDocumentSession,
} from "../useComposerDocumentSession"
import { clearComposerDrag, getComposerDrag } from "../dragState"
import ComposerLeftPanel from "./ComposerLeftPanel.vue"

vi.mock("@/workspace/agent/components/AgentComposerDock.vue", () => ({
  default: {
    name: "AgentComposerDock",
    template: `<div data-aria-composer-agent-dock-stub></div>`,
  },
}))

vi.mock("@/workspace/agent/composables/useAriaAgent", async () => {
  const { ref } = await import("vue")
  return {
    useAriaAgent: () => ({
      isStreaming: ref(false),
    }),
  }
})

const mounted: Array<() => void> = []

function dragEvent(type: "dragstart" | "dragend"): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: {
      effectAllowed: "none",
      setData: vi.fn(),
    },
  })
  return event
}

function mountLeftPanel(): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const tree: ComposerLayerTreeProjection = {
    content: [],
    document: [],
    contentParentPath: null,
  }
  const Harness = defineComponent({
    setup() {
      provideComposerBeacon(createComposerBeacon())
      provideComposerDocument({
        model: ref(null),
        editable: ref(true),
        designActive: ref(true),
        documentKind: computed(() => "page" as const),
      } as unknown as ComposerDocumentSession)
      return () => h(TooltipProvider, null, {
        default: () => h(ComposerLeftPanel, {
          tree,
          editable: true,
          designActive: true,
          projectPath: "/tmp/aria-test",
        }),
      })
    },
  })
  const app = createApp(Harness)
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  clearComposerDrag()
  localStorage.clear()
})

describe("ComposerLeftPanel palette dragging", () => {
  it("does not switch or restyle the palette source when a canvas drag starts", async () => {
    const host = mountLeftPanel()
    await nextTick()

    const addTab = host.querySelector<HTMLButtonElement>(
      "#composer-add-elements-tab",
    )!
    addTab.click()
    await nextTick()

    const textLabel = [...host.querySelectorAll("span")].find(
      (element) => element.textContent?.trim() === "Text",
    )!
    const source = textLabel.closest<HTMLElement>('[draggable="true"]')!
    source.dispatchEvent(dragEvent("dragstart"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    expect(addTab.getAttribute("aria-selected")).toBe("true")
    expect(
      host.querySelector("#composer-add-elements-panel")?.getAttribute(
        "data-panel-state",
      ),
    ).toBe("active")
    expect(getComposerDrag()).toEqual({
      kind: "primitive",
      id: "text",
      tag: "p",
    })

    source.dispatchEvent(dragEvent("dragend"))
    expect(getComposerDrag()).toBeNull()
  })
})
