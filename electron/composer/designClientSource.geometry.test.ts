import { JSDOM } from "jsdom"
import { describe, expect, it, vi } from "vitest"
import { ARIA_MSG } from "../../shared/composer/protocol"
import { DESIGN_CLIENT_SOURCE } from "./designClientSource"
import { asMessageEventSource } from "./designClientSource.testUtils"

type RectMessage = {
  rects?: Record<string, Array<{ x: number; y: number; w: number; h: number }> | null>
}

describe("Composer design client geometry", () => {
  it("does not double-count an unstamped element that remains in a collected run", async () => {
    const path = "src/components/Card.astro|0"
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="${path}"></template><section></section><template data-aria-e="${path}"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
    })
    const { window } = dom
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: undefined,
    })
    const section = window.document.querySelector<HTMLElement>("section")!
    Object.defineProperty(section, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10,
        y: 20,
        left: 10,
        top: 20,
        right: 90,
        bottom: 60,
        width: 80,
        height: 40,
        toJSON: () => ({}),
      }),
    })
    const rectMessages: RectMessage[] = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.rects) rectMessages.push(event.data)
    })

    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    section.removeAttribute("data-aria-occurrence")
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.track,
        trackingRevision: 8,
        paths: [path],
        scope: "src/components/Card.astro|",
      },
    }))

    await vi.waitFor(() => {
      expect(rectMessages.at(-1)?.rects?.[path]).toEqual([
        { x: 10, y: 20, w: 80, h: 40 },
      ])
    })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    dom.window.close()
  })

  it("coalesces structural collection and only remeasures geometry mutations", () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><main></main><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
    })
    const { window } = dom
    const frames: FrameRequestCallback[] = []
    const observers: Array<{
      callback: MutationCallback
      options?: MutationObserverInit
    }> = []
    class TestMutationObserver {
      private readonly entry: (typeof observers)[number]

      constructor(callback: MutationCallback) {
        this.entry = { callback }
        observers.push(this.entry)
      }

      observe(_target: Node, options?: MutationObserverInit) {
        this.entry.options = options
      }

      disconnect() {}
      takeRecords(): MutationRecord[] { return [] }
    }
    Object.defineProperty(window, "MutationObserver", {
      configurable: true,
      value: TestMutationObserver,
    })
    Object.defineProperty(window.document, "readyState", {
      configurable: true,
      value: "complete",
    })
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      },
    })
    const querySelectorAll = window.document.querySelectorAll.bind(window.document)
    let markerQueries = 0
    vi.spyOn(window.document, "querySelectorAll").mockImplementation(((selectors: string) => {
      if (selectors === "template[data-aria-s]") markerQueries += 1
      return querySelectorAll(selectors)
    }) as typeof window.document.querySelectorAll)

    window.eval(DESIGN_CLIENT_SOURCE)
    frames.length = 0
    markerQueries = 0
    const regionObserver = observers.find((observer) => observer.options?.characterData)
    expect(regionObserver).toBeDefined()
    const childListRecord = (node: Node) => ({
      type: "childList",
      addedNodes: [node],
      removedNodes: [],
      attributeName: null,
    }) as unknown as MutationRecord
    regionObserver?.callback([
      childListRecord(window.document.createElement("span")),
    ], {} as MutationObserver)
    regionObserver?.callback([
      childListRecord(window.document.createElement("span")),
    ], {} as MutationObserver)

    expect(frames).toHaveLength(1)
    expect(markerQueries).toBe(0)
    frames.shift()?.(0)
    expect(markerQueries).toBe(1)

    regionObserver?.callback([{
      type: "attributes",
      addedNodes: [],
      removedNodes: [],
      attributeName: "class",
    } as unknown as MutationRecord], {} as MutationObserver)
    regionObserver?.callback([{
      type: "characterData",
      addedNodes: [],
      removedNodes: [],
      attributeName: null,
    } as unknown as MutationRecord], {} as MutationObserver)
    expect(frames).toHaveLength(1)
    frames.shift()?.(16)
    expect(markerQueries).toBe(1)
    dom.window.close()
  })
})
