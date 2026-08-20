// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import StageOverlays, { type OverlayBox } from "./StageOverlays.vue"
import type { AstroDocumentModel } from "../../../../shared/composer/types"
import { provideComposerBeacon } from "../selection/useComposerBeacon"
import { provideComposerDocument, type ComposerDocumentSession } from "../useComposerDocumentSession"

const mounted: Array<() => void> = []

function mountOverlay(onResizePreview = vi.fn(), onResizeClear = vi.fn()) {
  const host = document.createElement("div")
  document.body.append(host)
  const box: OverlayBox = {
    key: "selection:0",
    type: "sel",
    path: "0",
    occurrence: 0,
    rect: { x: 20, y: 30, w: 100, h: 40 },
    info: { path: "0", label: "Paragraph", kind: "element" },
  }
  const app = createApp({
    render: () => h(StageOverlays, {
      boxes: [box],
      showSelectionToolbar: false,
      onResizePreview,
      onResizeClear,
    }),
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, onResizePreview, onResizeClear }
}

function mountToolbar(modelValue: AstroDocumentModel, label = "Element") {
  const host = document.createElement("div")
  document.body.append(host)
  const box: OverlayBox = {
    key: "selection:0",
    type: "sel",
    path: "0",
    occurrence: 0,
    rect: { x: 20, y: 30, w: 200, h: 40 },
    info: { path: "0", label, kind: "element" },
  }
  const app = createApp(defineComponent({
    setup() {
      const beacon = provideComposerBeacon()
      beacon.illuminate("0")
      provideComposerDocument({
        model: ref(modelValue),
        editable: ref(true),
        designActive: ref(true),
        projectPath: ref("/project"),
        editFile: ref("src/pages/index.astro"),
        availableLayouts: ref([]),
        pages: ref([]),
        documentKind: ref("page"),
      } as unknown as ComposerDocumentSession)
      return () => h(StageOverlays, { boxes: [box] })
    },
  }))
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return host
}

function pointerEvent(
  type: string,
  init: PointerEventInit & { pointerId: number },
): PointerEvent {
  const event = new PointerEvent(type, { bubbles: true, ...init })
  if (event.pointerId !== init.pointerId) {
    Object.defineProperty(event, "pointerId", { value: init.pointerId })
  }
  return event
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  vi.restoreAllMocks()
})

describe("StageOverlays selection resizing", () => {
  it("captures the pointer so resizing continues across the preview iframe", async () => {
    const { host, onResizePreview, onResizeClear } = mountOverlay()
    await nextTick()
    const handle = host.querySelector(
      'button[aria-label="Resize Paragraph from s"]',
    ) as HTMLButtonElement
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.defineProperties(handle, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
    })

    handle.dispatchEvent(pointerEvent("pointerdown", {
      pointerId: 7,
      clientX: 70,
      clientY: 70,
    }))
    handle.dispatchEvent(pointerEvent("pointermove", {
      pointerId: 7,
      clientX: 70,
      clientY: 105,
    }))

    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(onResizePreview).toHaveBeenLastCalledWith({
      path: "0",
      cssText: "height:75px;",
    })

    handle.dispatchEvent(pointerEvent("pointerup", {
      pointerId: 7,
      clientX: 70,
      clientY: 105,
    }))
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    expect(onResizeClear).toHaveBeenCalledWith("0")
  })

  it("cleans up a captured resize when the pointer is cancelled", async () => {
    const { host, onResizePreview, onResizeClear } = mountOverlay()
    await nextTick()
    const handle = host.querySelector(
      'button[aria-label="Resize Paragraph from e"]',
    ) as HTMLButtonElement
    Object.defineProperties(handle, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    })

    handle.dispatchEvent(pointerEvent("pointerdown", {
      pointerId: 11,
      clientX: 120,
      clientY: 50,
    }))
    handle.dispatchEvent(pointerEvent("pointercancel", {
      pointerId: 11,
      clientX: 120,
      clientY: 50,
    }))
    handle.dispatchEvent(pointerEvent("pointermove", {
      pointerId: 11,
      clientX: 200,
      clientY: 50,
    }))

    expect(onResizeClear).toHaveBeenCalledTimes(1)
    expect(onResizeClear).toHaveBeenCalledWith("0")
    expect(onResizePreview).not.toHaveBeenCalled()
  })
})

describe("StageOverlays CMS selection controls", () => {
  it("shows text binding and collection repeat controls for a heading", async () => {
    const host = mountToolbar({
      imports: [],
      extraFrontmatter: "",
      nodes: [{
        id: "heading",
        kind: "element",
        name: "h2",
        props: {},
        children: [{ id: "text", kind: "text", value: "Title" }],
      }],
      propSchema: [],
      slots: [],
      extendsTag: null,
    }, "Heading")
    await nextTick()
    expect(host.querySelector('button[aria-label="Bind text field"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Repeat from collection"]')).not.toBeNull()
  })

  it("shows image source and alt binding controls without a repeat action", async () => {
    const host = mountToolbar({
      imports: [],
      extraFrontmatter: "",
      nodes: [{ id: "image", kind: "element", name: "img", props: {}, children: null }],
      propSchema: [],
      slots: [],
      extendsTag: null,
    }, "Image")
    await nextTick()
    expect(host.querySelector('button[aria-label="Bind image source"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Bind alternative text"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Repeat from collection"]')).toBeNull()
  })
})
