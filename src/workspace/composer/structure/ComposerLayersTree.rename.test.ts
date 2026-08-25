// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ComposerLayerRow, ComposerLayerTreeProjection } from "../../../../shared/composer/layers"
import { createComposerBeacon, provideComposerBeacon } from "../selection/useComposerBeacon"
import ComposerLayersTree from "./ComposerLayersTree.vue"

const mounted: Array<() => void> = []

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
})

function componentRow(): ComposerLayerRow {
  return {
    path: "0",
    treeKey: "0",
    id: "logo-marquee",
    kind: "component",
    region: "content",
    semanticType: "component",
    label: "LogoMarquee",
    sourceLabel: "<LogoMarquee>",
    searchText: "logo marquee",
    children: [],
    isDocumentShell: false,
    draggable: true,
    deletable: true,
    canAcceptChildren: true,
  }
}

function mountLayers(row: ComposerLayerRow): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const tree: ComposerLayerTreeProjection = {
    content: [row],
    document: [],
    contentParentPath: null,
  }
  const Harness = defineComponent({
    setup() {
      provideComposerBeacon(createComposerBeacon())
      return () => h(ComposerLayersTree, {
        tree,
        embedded: true,
        editable: true,
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
  localStorage.clear()
})

describe("Composer Layers component rename", () => {
  it("starts inline rename from the component context menu", async () => {
    const host = mountLayers(componentRow())
    host.querySelector<HTMLElement>('[role="treeitem"]')?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    )
    await nextTick()
    await nextTick()

    const renameItem = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.includes("Rename"))
    expect(renameItem).not.toBeNull()
    expect(renameItem?.getAttribute("aria-disabled")).not.toBe("true")

    renameItem?.click()
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Rename LogoMarquee"]')
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
  })
})
