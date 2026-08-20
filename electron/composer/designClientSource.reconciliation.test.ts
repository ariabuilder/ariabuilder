import { JSDOM } from "jsdom"
import { describe, expect, it, vi } from "vitest"
import { DESIGN_CLIENT_SOURCE } from "./designClientSource"
import { asMessageEventSource } from "./designClientSource.testUtils"
import { ARIA_MSG } from "../../shared/composer/protocol"

describe("Composer design client computed styles", () => {
  it("reconciles a marked region in place and preserves scroll", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><section>Before</section><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const scrollTo = vi.fn()
    Object.defineProperty(window, "scrollX", { value: 9, configurable: true })
    Object.defineProperty(window, "scrollY", { value: 321, configurable: true })
    Object.defineProperty(window, "scrollTo", { value: scrollTo, configurable: true })
    Object.defineProperty(window, "fetch", {
      value: vi.fn(async () => ({
        ok: true,
        text: async () => `<!doctype html><html><body>
          <template data-aria-s="0"></template><section class="fresh">After</section><template data-aria-e="0"></template>
        </body></html>`,
      })),
      configurable: true,
    })
    const results: Array<{ type?: string; revision?: number; ok?: boolean }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.reconcileResult) results.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.reconcile, revision: 8, paths: ["0"] },
    }))
    window.dispatchEvent(new window.CustomEvent("aria:source-ready", {
      detail: { revision: 8 },
    }))
    await vi.waitFor(() => {
      expect(results).toContainEqual(expect.objectContaining({ revision: 8, ok: true }))
    })

    expect(window.document.querySelector("section")?.textContent).toBe("After")
    expect(window.document.querySelector("section")?.className).toBe("fresh")
    expect(scrollTo).toHaveBeenCalledWith(9, 321)
    dom.window.close()
  })

  it("morphs dynamic output while retaining media, dirty form state, focus, and selection", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><section class="old"><img src="/same.jpg"><input id="text" value="source"><input id="check" type="checkbox"><select><option value="a" selected>A</option><option value="b">B</option></select><p>Before</p></section><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), configurable: true })
    Object.defineProperty(window, "fetch", {
      value: vi.fn(async () => ({
        ok: true,
        text: async () => `<!doctype html><html><body>
          <template data-aria-s="0"></template><section class="new"><img src="/same.jpg"><input id="text" value="server"><input id="check" type="checkbox"><select><option value="a" selected>A</option><option value="b">B</option></select><p>After</p></section><template data-aria-e="0"></template>
        </body></html>`,
      })),
      configurable: true,
    })
    const results: Array<{ revision: number; ok: boolean }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.reconcileResult) results.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    const section = window.document.querySelector("section")!
    const image = window.document.querySelector("img")!
    const input = window.document.querySelector<HTMLInputElement>("#text")!
    const checkbox = window.document.querySelector<HTMLInputElement>("#check")!
    const select = window.document.querySelector("select")!
    section.scrollTop = 42
    input.focus()
    input.value = "typed locally"
    input.setSelectionRange(2, 7, "forward")
    checkbox.checked = true
    select.value = "b"

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.reconcile, revision: 9, paths: ["0"] },
    }))
    window.dispatchEvent(new window.CustomEvent("aria:source-ready", { detail: { revision: 9 } }))
    await vi.waitFor(() => expect(results).toContainEqual(expect.objectContaining({ revision: 9, ok: true })))

    expect(window.document.querySelector("section")).toBe(section)
    expect(window.document.querySelector("img")).toBe(image)
    expect(window.document.querySelector("input")).toBe(input)
    expect(window.document.activeElement).toBe(input)
    expect(input.value).toBe("typed locally")
    expect(checkbox.checked).toBe(true)
    expect(select.value).toBe("b")
    expect(section.scrollTop).toBe(42)
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([2, 7, "forward"])
    expect(section.className).toBe("new")
    expect(section.querySelector("p")?.textContent).toBe("After")
    dom.window.close()
  })

  it("retains an unchanged hydrated Astro island as an opaque live node", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><astro-island component-url="/Card.js" component-export="default" renderer-url="/client.js" props="{}" client="load"><button>Hydrated state</button></astro-island><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), configurable: true })
    Object.defineProperty(window, "fetch", {
      value: vi.fn(async () => ({
        ok: true,
        text: async () => `<!doctype html><html><body>
          <template data-aria-s="0"></template><astro-island component-url="/Card.js" component-export="default" renderer-url="/client.js" props="{}" client="load" ssr><button>Server state</button></astro-island><template data-aria-e="0"></template>
        </body></html>`,
      })),
      configurable: true,
    })
    const results: Array<{ revision: number; ok: boolean }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.reconcileResult) results.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    const island = window.document.querySelector("astro-island")!

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.reconcile, revision: 10, paths: ["0"] },
    }))
    window.dispatchEvent(new window.CustomEvent("aria:source-ready", { detail: { revision: 10 } }))
    await vi.waitFor(() => expect(results).toContainEqual(expect.objectContaining({ revision: 10, ok: true })))
    expect(window.document.querySelector("astro-island")).toBe(island)
    expect(island.textContent).toBe("Hydrated state")
    dom.window.close()
  })

  it("reconciles when source-ready arrives before the host request", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><section>Before</section><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), configurable: true })
    Object.defineProperty(window, "fetch", {
      value: vi.fn(async () => ({
        ok: true,
        text: async () => `<!doctype html><html><body>
          <template data-aria-s="0"></template><section class="existing-class">After</section><template data-aria-e="0"></template>
        </body></html>`,
      })),
      configurable: true,
    })
    const results: Array<{ type?: string; revision?: number; ok?: boolean }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.reconcileResult) results.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    window.dispatchEvent(new window.CustomEvent("aria:source-ready", {
      detail: { revision: 12 },
    }))
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.reconcile, revision: 12, paths: ["0"] },
    }))

    await vi.waitFor(() => {
      expect(results).toContainEqual(expect.objectContaining({ revision: 12, ok: true }))
    })
    expect(window.document.querySelector("section")?.className).toBe("existing-class")
    dom.window.close()
  })

  it("requests a controlled reload only after an import revision is source-ready", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><main>Before</main><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const fetch = vi.fn()
    Object.defineProperty(window, "fetch", { value: fetch, configurable: true })
    const results: Array<{ revision: number; ok: boolean; hardReload?: boolean; reason?: string }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.reconcileResult) results.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.reconcile,
        revision: 14,
        paths: ["$document"],
        reloadReason: "imports-changed",
      },
    }))
    expect(results).toEqual([])
    window.dispatchEvent(new window.CustomEvent("aria:source-ready", { detail: { revision: 14 } }))
    await vi.waitFor(() => expect(results).toContainEqual(expect.objectContaining({
      revision: 14, ok: false, hardReload: true, reason: "imports-changed",
    })))
    expect(fetch).not.toHaveBeenCalled()
    dom.window.close()
  })

  it("reconciles pending structural changes when the draft store advances the revision", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><main><template data-aria-s="0.0"></template><section>Before</section><template data-aria-e="0.0"></template></main><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), configurable: true })
    Object.defineProperty(window, "fetch", {
      value: vi.fn(async () => ({
        ok: true,
        text: async () => `<!doctype html><html><body>
          <template data-aria-s="0"></template><main><template data-aria-s="0.0"></template><section>After paste</section><template data-aria-e="0.0"></template><section>Copied section</section></main><template data-aria-e="0"></template>
        </body></html>`,
      })),
      configurable: true,
    })
    const results: Array<{ type?: string; revision?: number; ok?: boolean }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.reconcileResult) results.push(event.data)
    })
    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.reconcile, revision: 1, paths: ["0.0"] },
    }))
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.reconcile, revision: 2, paths: ["0"] },
    }))
    window.dispatchEvent(new window.CustomEvent("aria:source-ready", {
      detail: { revision: 11 },
    }))
    await vi.waitFor(() => {
      expect(results).toContainEqual(expect.objectContaining({ revision: 11, ok: true }))
    })

    expect(window.document.body.textContent).toContain("After paste")
    expect(window.document.body.textContent).toContain("Copied section")
    dom.window.close()
  })

})
