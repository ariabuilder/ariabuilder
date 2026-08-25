import { JSDOM as BaseJSDOM } from "jsdom"
import { describe, expect, it, vi } from "vitest"
import { DESIGN_CLIENT_SOURCE } from "./designClientSource"
import { asMessageEventSource } from "./designClientSource.testUtils"
import { ARIA_MSG } from "../../shared/composer/protocol"

class JSDOM extends BaseJSDOM {
  constructor(...args: ConstructorParameters<typeof BaseJSDOM>) {
    super(...args)
    Object.defineProperty(this.window, "requestAnimationFrame", {
      configurable: true,
      value: undefined,
    })
  }
}

describe("Composer design client computed styles", () => {
  it("keeps the active inline caret occurrence while patching repeated mirrors", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><h1><template data-aria-s="0.0"></template>First<template data-aria-e="0.0"></template></h1><template data-aria-e="0"></template>
      <template data-aria-s="0"></template><h1><template data-aria-s="0.0"></template>First<template data-aria-e="0.0"></template></h1><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const rangeRect = { left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1, x: 0, y: 0, toJSON: () => ({}) }
    Object.defineProperty(window.Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => rangeRect,
    })
    Object.defineProperty(window.Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [rangeRect],
    })
    const changes: Array<Record<string, unknown>> = []
    const requests: Array<Record<string, unknown>> = []
    const startResults: Array<Record<string, unknown>> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.inlineTextChange) changes.push(event.data)
      if (event.data?.type === ARIA_MSG.inlineTextRequest) requests.push(event.data)
      if (event.data?.type === ARIA_MSG.inlineTextStartResult) startResults.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    const headings = [...window.document.querySelectorAll("h1")]
    headings[0]!.setAttribute("contenteditable", "false")
    headings[0]!.setAttribute("spellcheck", "false")
    headings[0]!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "A", bubbles: true }))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(requests).toHaveLength(1)
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.inlineTextStart,
        requestId: requests[0]!.requestId,
        sessionId: "session-1",
        path: "0.0",
        occurrence: 0,
        value: "First",
      },
    }))
    await vi.waitFor(() => expect(startResults).toContainEqual(expect.objectContaining({
      requestId: requests[0]!.requestId, sessionId: "session-1", ok: true,
    })))
    expect(headings[0]?.getAttribute("contenteditable")).toBe("plaintext-only")
    headings[0]!.textContent = "Edited"
    headings[0]!.dispatchEvent(new window.InputEvent("input", { bubbles: true }))
    await vi.waitFor(() => expect(changes).toContainEqual(expect.objectContaining({
      sessionId: "session-1", value: "Edited", sequence: 1,
    })))
    expect(headings[1]?.textContent).toBe("Edited")

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.patchNodes,
        revision: 1,
        inlineTextOrigin: { sessionId: "session-1", path: "0.0", occurrence: 0, sequence: 1 },
        patches: [{ kind: "properties", path: "0.0", text: "Server value" }],
      },
    }))
    expect(headings[0]?.textContent).toBe("Edited")
    expect(headings[1]?.textContent).toBe("Server value")
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.inlineTextResult,
        sessionId: "session-1",
        sequence: 2,
        ok: true,
        action: "commit",
        value: "Edited",
      },
    }))
    expect(headings[0]?.getAttribute("contenteditable")).toBe("false")
    expect(headings[0]?.getAttribute("spellcheck")).toBe("false")
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.inlineTextStart,
        requestId: requests[0]!.requestId,
        sessionId: "stale-session",
        path: "0.0",
        occurrence: 0,
        value: "Stale",
      },
    }))
    await vi.waitFor(() => expect(startResults).toContainEqual(expect.objectContaining({
      sessionId: "stale-session", ok: false,
    })))
    expect(headings[0]?.getAttribute("contenteditable")).toBe("false")
    dom.window.close()
  })

  it("buffers IME composition until the host approves text editing", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><h1><template data-aria-s="0.0"></template>First<template data-aria-e="0.0"></template></h1><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const rangeRect = { left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1, x: 0, y: 0, toJSON: () => ({}) }
    Object.defineProperty(window.Range.prototype, "getBoundingClientRect", { configurable: true, value: () => rangeRect })
    Object.defineProperty(window.Range.prototype, "getClientRects", { configurable: true, value: () => [rangeRect] })
    const requests: Array<Record<string, unknown>> = []
    const startResults: Array<Record<string, unknown>> = []
    const changes: Array<Record<string, unknown>> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.inlineTextRequest) requests.push(event.data)
      if (event.data?.type === ARIA_MSG.inlineTextStartResult) startResults.push(event.data)
      if (event.data?.type === ARIA_MSG.inlineTextChange) changes.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    const heading = window.document.querySelector("h1")!
    heading.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    window.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "Process", keyCode: 229, bubbles: true,
    }))
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const capture = window.document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Canvas text input"]')!
    expect(capture).toBeTruthy()
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.inlineTextStart,
        requestId: requests[0]!.requestId,
        sessionId: "ime-session",
        path: "0.0",
        occurrence: 0,
        value: "First",
      },
    }))
    expect(heading.hasAttribute("contenteditable")).toBe(false)
    capture.value = "日本語"
    capture.dispatchEvent(new window.CompositionEvent("compositionend", {
      bubbles: true,
      data: "日本語",
    }))
    await vi.waitFor(() => expect(startResults).toContainEqual(expect.objectContaining({
      sessionId: "ime-session", ok: true,
    })))
    await vi.waitFor(() => expect(changes).toContainEqual(expect.objectContaining({
      sessionId: "ime-session", value: "日本語",
    })))
    expect(heading.textContent).toBe("日本語")
    dom.window.close()
  })

  it("wraps and unwraps a static node without replacing the live node", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><div>
        <template data-aria-s="0.0"></template><p>
          <template data-aria-s="0.0.0"></template>Hello<template data-aria-e="0.0.0"></template>
        </p><template data-aria-e="0.0"></template>
      </div><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const fetch = vi.fn()
    Object.defineProperty(window, "fetch", { value: fetch, configurable: true })
    const results: Array<{ revision: number; status: string }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.patchResult) results.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    let loadEvents = 0
    window.addEventListener("load", () => { loadEvents += 1 })
    const paragraph = window.document.querySelector("p")!

    const text = (path: string) => ({ id: "text", kind: "text", path, text: "Hello" })
    const p = (path: string, childPath: string) => ({
      id: "paragraph", kind: "element", path, tagName: "p", attributes: {},
      children: [text(childPath)],
    })
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.patchNodes,
        revision: 1,
        patches: [{ kind: "static-tree", boundaries: [{
          path: "0",
          before: [p("0.0", "0.0.0")],
          after: [{
            id: "link", kind: "element", path: "0.0", tagName: "a",
            attributes: { href: "/about" }, children: [p("0.0.0", "0.0.0.0")],
          }],
        }] }],
      },
    }))
    await vi.waitFor(() => expect(results).toContainEqual({ revision: 1, status: "applied", type: ARIA_MSG.patchResult, paths: ["0"] }))
    expect(window.document.querySelector("a")?.firstElementChild).toBe(paragraph)
    expect(fetch).not.toHaveBeenCalled()

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.patchNodes,
        revision: 2,
        patches: [{ kind: "static-tree", boundaries: [{
          path: "0",
          before: [{
            id: "link", kind: "element", path: "0.0", tagName: "a",
            attributes: { href: "/about" }, children: [p("0.0.0", "0.0.0.0")],
          }],
          after: [p("0.0", "0.0.0")],
        }] }],
      },
    }))
    await vi.waitFor(() => expect(results).toContainEqual({ revision: 2, status: "applied", type: ARIA_MSG.patchResult, paths: ["0"] }))
    expect(window.document.querySelector("div")?.firstElementChild).toBe(paragraph)
    expect(window.document.querySelector("a")).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(loadEvents).toBe(0)
    dom.window.close()
  })

  it("rejects a multi-occurrence transaction atomically and orders revisions", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><div><template data-aria-s="0.0"></template><p>One</p><template data-aria-e="0.0"></template></div><template data-aria-e="0"></template>
      <template data-aria-s="0"></template><div><template data-aria-s="0.0"></template><span>Two</span><template data-aria-e="0.0"></template></div><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const results: Array<{ revision: number; status: string; reason?: string }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.patchResult) results.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    const beforeHtml = window.document.body.innerHTML
    const child = {
      id: "child", kind: "element", path: "0.0", tagName: "p", attributes: {}, children: [],
    }
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.patchNodes,
        revision: 5,
        patches: [{ kind: "static-tree", boundaries: [{
          path: "0", before: [child], after: [child, {
            id: "new", kind: "element", path: "0.1", tagName: "hr", attributes: {}, children: [],
          }],
        }] }],
      },
    }))
    await vi.waitFor(() => expect(results).toContainEqual(expect.objectContaining({
      revision: 5, status: "rejected", reason: "dom-shape-mismatch",
    })))
    expect(window.document.body.innerHTML).toBe(beforeHtml)
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.patchNodes, revision: 4, patches: [] },
    }))
    await vi.waitFor(() => expect(results).toContainEqual(expect.objectContaining({
      revision: 4, status: "stale", reason: "stale-revision",
    })))
    dom.window.close()
  })

  it("applies one structural transaction to every rendered occurrence", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><div><template data-aria-s="0.0"></template><p>One</p><template data-aria-e="0.0"></template></div><template data-aria-e="0"></template>
      <template data-aria-s="0"></template><div><template data-aria-s="0.0"></template><p>Two</p><template data-aria-e="0.0"></template></div><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const results: Array<{ revision: number; status: string }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.patchResult) results.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    const paragraphs = [...window.document.querySelectorAll("p")]
    const child = {
      id: "child", kind: "element", path: "0.0", tagName: "p", attributes: {}, children: [],
    }

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.patchNodes,
        revision: 8,
        patches: [{ kind: "static-tree", boundaries: [{
          path: "0", before: [child], after: [child, {
            id: "rule", kind: "element", path: "0.1", tagName: "hr", attributes: {}, children: [],
          }],
        }] }],
      },
    }))
    await vi.waitFor(() => expect(results).toContainEqual(expect.objectContaining({
      revision: 8, status: "applied",
    })))
    expect([...window.document.querySelectorAll("div")].map((node) => node.querySelectorAll("hr").length))
      .toEqual([1, 1])
    expect([...window.document.querySelectorAll("p")]).toEqual(paragraphs)
    dom.window.close()
  })

  it("reparents a live node across static boundaries without recreating it", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><main>
        <template data-aria-s="0.0"></template><section><template data-aria-s="0.0.0"></template><p>Move me</p><template data-aria-e="0.0.0"></template></section><template data-aria-e="0.0"></template>
        <template data-aria-s="0.1"></template><aside></aside><template data-aria-e="0.1"></template>
      </main><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const results: Array<{ revision: number; status: string }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.patchResult) results.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    const paragraph = window.document.querySelector("p")!
    const beforeNode = {
      id: "paragraph", kind: "element", path: "0.0.0", tagName: "p", attributes: {}, children: [],
    }
    const afterNode = { ...beforeNode, path: "0.1.0" }

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.patchNodes,
        revision: 6,
        patches: [{ kind: "static-tree", boundaries: [
          { path: "0.0", before: [beforeNode], after: [] },
          { path: "0.1", before: [], after: [afterNode] },
        ] }],
      },
    }))
    await vi.waitFor(() => expect(results).toContainEqual(expect.objectContaining({
      revision: 6, status: "applied",
    })))
    expect(window.document.querySelector("section")?.children).toHaveLength(0)
    expect(window.document.querySelector("aside")?.firstElementChild).toBe(paragraph)
    expect(paragraph.getAttribute("data-aria-p")).toBe("0.1.0")
    dom.window.close()
  })

  it("creates inserted SVG descendants in the SVG namespace", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><div></div><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const results: Array<{ revision: number; status: string }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.patchResult) results.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.patchNodes,
        revision: 7,
        patches: [{ kind: "static-tree", boundaries: [{
          path: "0", before: [], after: [{
            id: "svg", kind: "element", path: "0.0", tagName: "svg",
            attributes: { viewBox: "0 0 10 10" }, children: [{
              id: "gradient", kind: "element", path: "0.0.0", tagName: "linearGradient",
              attributes: { id: "paint" }, children: [],
            }, {
              id: "use", kind: "element", path: "0.0.1", tagName: "use",
              attributes: { "xlink:href": "#paint" }, children: [],
            }],
          }],
        }] }],
      },
    }))
    await vi.waitFor(() => expect(results).toContainEqual(expect.objectContaining({
      revision: 7, status: "applied",
    })))
    const svg = window.document.querySelector("svg")!
    const gradient = svg.children[0]!
    const use = svg.children[1]!
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg")
    expect(gradient.namespaceURI).toBe(svg.namespaceURI)
    expect(gradient.localName).toBe("linearGradient")
    expect(use.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#paint")
    dom.window.close()
  })

})
