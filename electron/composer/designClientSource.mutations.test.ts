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
