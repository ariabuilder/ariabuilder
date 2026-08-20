import { JSDOM } from "jsdom"
import { describe, expect, it, vi } from "vitest"
import { DESIGN_CLIENT_SOURCE } from "./designClientSource"
import { asMessageEventSource } from "./designClientSource.testUtils"
import {
  ARIA_BRIDGE_ID,
  ARIA_MSG,
  ARIA_PROTOCOL_VERSION,
} from "../../shared/composer/protocol"
import {
  COMPOSER_IMAGE_PLACEHOLDER_SRC,
  LEGACY_BRANDED_COMPOSER_IMAGE_PLACEHOLDER_SRC,
  LEGACY_COMPOSER_IMAGE_PLACEHOLDER_SRC,
} from "../../shared/composer/ariaPrimitives"

describe("Composer design client computed styles", () => {
  it("opens and closes the real native popover for Design authoring", async () => {
    const dom = new JSDOM(`<!doctype html><html><body><button id="trigger" popovertarget="menu">Open</button><div id="menu" popover>Content</div></body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const target = window.document.querySelector<HTMLElement>("#menu")!
    const trigger = window.document.querySelector<HTMLElement>("#trigger")!
    let open = false
    const showPopover = vi.fn((options?: { source?: Element }) => {
      expect(options?.source).toBe(trigger)
      open = true
    })
    const hidePopover = vi.fn(() => { open = false })
    Object.defineProperties(target, {
      showPopover: { value: showPopover, configurable: true },
      hidePopover: { value: hidePopover, configurable: true },
      matches: { value: (selector: string) => selector === ":popover-open" ? open : false, configurable: true },
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.popoverPreview, targetId: "menu", open: true },
    }))
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    expect(showPopover).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.popoverPreview, targetId: "menu", open: false },
    }))
    expect(hidePopover).toHaveBeenCalledTimes(1)
    dom.window.close()
  })

  it("repeats ready with the host token when the bridge is pinged", async () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://127.0.0.1:4321/?aria-frame=original#aria-design",
      runScripts: "dangerously",
    })
    const { window } = dom
    const readyMessages: Array<Record<string, unknown>> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.ready) readyMessages.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    readyMessages.length = 0

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.bridgePing, frameToken: "recovered-token" },
    }))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    expect(readyMessages).toContainEqual(expect.objectContaining({
      type: ARIA_MSG.ready,
      version: ARIA_PROTOCOL_VERSION,
      bridgeId: ARIA_BRIDGE_ID,
      frameToken: "recovered-token",
    }))
    dom.window.close()
  })

  it("recovers the legacy image placeholder only after it fails", () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <img id="legacy" src="/placeholder.svg">
      <img id="project" src="/images/placeholder.svg">
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
    })
    const { window } = dom
    window.eval(DESIGN_CLIENT_SOURCE)
    const legacy = window.document.querySelector<HTMLImageElement>("#legacy")!
    const project = window.document.querySelector<HTMLImageElement>("#project")!

    legacy.dispatchEvent(new window.Event("error"))
    project.dispatchEvent(new window.Event("error"))

    expect(legacy.src).toContain("data:image/svg+xml")
    expect(project.getAttribute("src")).toBe("/images/placeholder.svg")
    dom.window.close()
  })

  it("updates previously serialized portable placeholders on the canvas", async () => {
    const dom = new JSDOM(`<!doctype html><html><body><img id="placeholder"><img id="branded-placeholder"></body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
    })
    const { window } = dom
    window.document.querySelector("#placeholder")?.setAttribute("src", LEGACY_COMPOSER_IMAGE_PLACEHOLDER_SRC)
    window.document.querySelector("#branded-placeholder")?.setAttribute("src", LEGACY_BRANDED_COMPOSER_IMAGE_PLACEHOLDER_SRC)
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))

    await vi.waitFor(() => {
      expect(window.document.querySelector("#placeholder")?.getAttribute("src")).toBe(COMPOSER_IMAGE_PLACEHOLDER_SRC)
      expect(window.document.querySelector("#branded-placeholder")?.getAttribute("src")).toBe(COMPOSER_IMAGE_PLACEHOLDER_SRC)
    })
    dom.window.close()
  })

  it("patches every rendered occurrence without reloading or revealing", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><p class="old">First</p><template data-aria-e="0"></template>
      <template data-aria-s="0"></template><p class="old">Second</p><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 10))

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.patchNodes,
        revision: 4,
        patches: [{ kind: "properties", path: "0", attributes: { class: "new", title: "Live" } }],
      },
    }))

    expect([...window.document.querySelectorAll("p")].map((node) => node.className))
      .toEqual(["new", "new"])
    expect([...window.document.querySelectorAll("p")].map((node) => node.title))
      .toEqual(["Live", "Live"])
    dom.window.close()
  })

  it("hovers the deepest inline text marker and preserves its occurrence", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><div data-occurrence="0"><template data-aria-s="0.0"></template>132K<template data-aria-e="0.0"></template></div><template data-aria-e="0"></template>
      <template data-aria-s="0"></template><div data-occurrence="1"><template data-aria-s="0.0"></template>24.8K<template data-aria-e="0.0"></template></div><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const rect = (left: number) => ({
      x: left,
      y: 10,
      left,
      top: 10,
      right: left + 60,
      bottom: 30,
      width: 60,
      height: 20,
      toJSON: () => ({}),
    })
    Object.defineProperty(window.Range.prototype, "getClientRects", {
      configurable: true,
      value(this: Range) {
        const selected = this.startContainer.childNodes[this.startOffset]
        const occurrence = selected?.parentElement?.getAttribute("data-occurrence")
        return [rect(occurrence === "1" ? 100 : 10)]
      },
    })
    Object.defineProperty(window.Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: Range) {
        return this.getClientRects()[0]
      },
    })
    const second = window.document.querySelector<HTMLElement>('[data-occurrence="1"]')!
    Object.defineProperty(window.document, "elementFromPoint", {
      configurable: true,
      value: () => second,
    })
    const hovers: Array<{ path: string | null; occurrence: number }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.hover) hovers.push(event.data)
    })

    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    second.dispatchEvent(new window.MouseEvent("mousemove", {
      bubbles: true,
      clientX: 120,
      clientY: 20,
    }))

    await vi.waitFor(() => expect(hovers).toContainEqual(expect.objectContaining({
      path: "0.0",
      occurrence: 1,
    })))
    dom.window.close()
  })

})
