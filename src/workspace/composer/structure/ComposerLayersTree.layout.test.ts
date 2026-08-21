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

function row(treeKey: string, region: "content" | "document"): ComposerLayerRow {
  return {
    path: treeKey,
    treeKey,
    id: treeKey,
    kind: "element",
    region,
    semanticType: region === "document" ? "head" : "container",
    label: treeKey,
    sourceLabel: `<${treeKey}>`,
    searchText: treeKey,
    children: [],
    isDocumentShell: region === "document",
    draggable: region === "content",
    deletable: region === "content",
    canAcceptChildren: true,
  }
}

function mountLayers(tree: ComposerLayerTreeProjection): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const Harness = defineComponent({
    setup() {
      provideComposerBeacon(createComposerBeacon())
      return () => h(ComposerLayersTree, { tree, embedded: true })
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

describe("Composer Layers panel layout", () => {
  it("keeps Document below a long independently scrolling Structure tree", async () => {
    const tree: ComposerLayerTreeProjection = {
      content: Array.from({ length: 64 }, (_, index) => row(`content-${index}`, "content")),
      document: [row("document-head", "document")],
      contentParentPath: null,
    }
    const host = mountLayers(tree)
    const structure = host.querySelector<HTMLElement>('[data-layer-scroll-region="structure"]')
    const documentSection = host.querySelector<HTMLElement>('[data-layer-section="document"]')

    expect(structure).not.toBeNull()
    expect(documentSection).not.toBeNull()
    expect(structure?.nextElementSibling).toBe(documentSection)
    expect(structure?.classList.contains("flex-1")).toBe(true)
    expect(structure?.classList.contains("min-h-0")).toBe(true)
    expect(structure?.classList.contains("overflow-y-auto")).toBe(true)
    expect(structure?.classList.contains("overflow-x-auto")).toBe(true)
    expect(structure?.classList.contains("[container-type:inline-size]")).toBe(true)
    const structureContent = structure?.querySelector<HTMLElement>("[data-layer-scroll-content]")
    expect(structureContent?.classList.contains("w-max")).toBe(true)
    expect(structureContent?.classList.contains("min-w-full")).toBe(true)
    const scrollBy = vi.fn()
    Object.defineProperty(structure!, "scrollBy", { configurable: true, value: scrollBy })
    vi.spyOn(structure!, "getBoundingClientRect").mockReturnValue({
      bottom: 400,
      height: 400,
      left: 0,
      right: 256,
      top: 0,
      width: 256,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    structure?.dispatchEvent(new MouseEvent("dragover", { bubbles: true, clientX: 255, clientY: 200 }))
    expect(scrollBy).toHaveBeenCalledWith({ left: 10, top: 0 })
    expect(documentSection?.classList.contains("shrink-0")).toBe(true)
    expect(documentSection?.classList.contains("max-h-[45%]")).toBe(true)
    expect(documentSection?.classList.contains("mx-1")).toBe(false)

    const documentHeader = documentSection?.querySelector("button")
    expect(documentHeader?.className).toContain("h-10")
    expect(documentHeader?.className).toContain("border-dashed")
    expect(documentHeader?.className).toContain("px-2")

    documentSection?.querySelector<HTMLButtonElement>("button")?.click()
    await nextTick()

    const documentScroller = documentSection?.querySelector<HTMLElement>('[data-layer-scroll-region="document"]')
    expect(documentScroller).not.toBeNull()
    expect(documentScroller?.classList.contains("overflow-y-auto")).toBe(true)
    expect(documentScroller?.classList.contains("overflow-x-auto")).toBe(true)
    expect(documentScroller?.classList.contains("[container-type:inline-size]")).toBe(true)
    expect(documentScroller?.classList.contains("pb-6")).toBe(true)
    const documentContent = documentScroller?.querySelector<HTMLElement>("[data-layer-scroll-content]")
    expect(documentContent?.classList.contains("w-max")).toBe(true)
    expect(documentContent?.classList.contains("min-w-full")).toBe(true)
  })

  it("hides the Document section when the document tree is empty", () => {
    const tree: ComposerLayerTreeProjection = {
      content: [row("content-main", "content")],
      document: [],
      contentParentPath: null,
    }
    const host = mountLayers(tree)
    expect(host.querySelector('[data-layer-section="document"]')).toBeNull()
  })
})
