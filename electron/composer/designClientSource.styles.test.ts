import { JSDOM } from "jsdom"
import { describe, expect, it, vi } from "vitest"
import { DESIGN_CLIENT_SOURCE } from "./designClientSource"
import { asMessageEventSource } from "./designClientSource.testUtils"
import { ARIA_MSG, ARIA_PROTOCOL_VERSION } from "../../shared/composer/protocol"

describe("Composer design client computed styles", () => {
  it.each(["Win32", "Linux x86_64"])("uses transient scrollbars for %s Composer previews", async (platform) => {
    const dom = new JSDOM(`<!doctype html><html><head></head><body><main style="height: 200vh"></main></body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    Object.defineProperty(window.navigator, "platform", { configurable: true, value: platform })

    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    const style = window.document.getElementById("aria-transient-scrollbars")
    expect(style?.textContent).toContain("scrollbar-width: thin")
    expect(style?.textContent).toContain("scrollbar-color: transparent transparent")
    expect(window.document.documentElement.hasAttribute("data-aria-transient-scrollbars")).toBe(true)

    window.document.dispatchEvent(new window.Event("scroll"))
    expect(window.document.documentElement.hasAttribute("data-aria-scroll-active")).toBe(true)
    dom.window.close()
  })

  it("resolves a stylesheet color on an inline descendant source path", async () => {
    const dom = new JSDOM(`<!doctype html><html><head>
      <style>.project-heading strong { color: rgb(24, 74, 138); }</style>
    </head><body style="background-color: rgb(255, 255, 255)">
      <section style="background-color: rgb(245, 247, 250)">
        <template data-aria-s="0"></template><h1 class="project-heading">Real Projects. <strong>Real Results.</strong></h1><template data-aria-e="0"></template>
      </section>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
    })
    const { window } = dom
    const responses: Array<{ type?: string; requestId?: string; values?: Record<string, string> }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.computedStyleResponse) responses.push(event.data)
    })

    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.computedStyleRequest,
        requestId: "color-1",
        path: "0",
        occurrence: 0,
        relativePath: "1",
        properties: ["color", "aria-effective-background-color"],
      },
    }))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    expect(responses).toContainEqual({
      type: ARIA_MSG.computedStyleResponse,
      requestId: "color-1",
      values: {
        color: "rgb(24, 74, 138)",
        "aria-effective-background-color": "rgb(245, 247, 250)",
      },
    })

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.previewStyle,
        path: "0",
        relativePath: "1",
        cssText: "color: rgb(190, 24, 93) !important;",
      },
    }))
    const strong = window.document.querySelector("strong") as HTMLElement
    expect(strong.getAttribute("data-aria-composer-preview-target")).toBe("0::1")
    expect(window.getComputedStyle(strong).color).toBe("rgb(190, 24, 93)")

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.clearPreviewStyle,
        path: "0",
        relativePath: "1",
      },
    }))
    expect(strong.hasAttribute("data-aria-composer-preview-target")).toBe(false)
    expect(window.getComputedStyle(strong).color).toBe("rgb(24, 74, 138)")

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.previewStyle,
        path: "0",
        relativePath: "0",
        cssText: "color: rgb(5, 150, 105) !important;",
      },
    }))
    const previewSpan = window.document.querySelector(
      '[data-aria-composer-preview-target="0::0"]',
    ) as HTMLElement
    expect(previewSpan.textContent).toBe("Real Projects. ")
    expect(window.getComputedStyle(previewSpan).color).toBe("rgb(5, 150, 105)")
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.clearPreviewStyle,
        path: "0",
        relativePath: "0",
      },
    }))
    expect(window.document.querySelector('[data-aria-composer-preview-target="0::0"]'))
      .toBeNull()
    expect(window.document.querySelector("h1")?.childNodes[0]?.nodeType).toBe(3)
    const googleFontsUrl = "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.syncFontStylesheet, url: googleFontsUrl },
    }))
    const fontLink = window.document.querySelector(
      'link[data-aria-composer-font-asset]',
    ) as HTMLLinkElement
    expect(fontLink.href).toBe(googleFontsUrl)
    const fontsourceUrl = "https://cdn.jsdelivr.net/fontsource/css/outfit:vf@latest/index.css"
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.syncFontStylesheet,
        urls: [googleFontsUrl, fontsourceUrl],
      },
    }))
    const fontHrefs = [...window.document.querySelectorAll(
      'link[data-aria-composer-font-asset]',
    )].map((node) => (node as HTMLLinkElement).href)
    expect(fontHrefs).toEqual([googleFontsUrl, fontsourceUrl])
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.syncFontStylesheet, url: "https://example.com/font.css" },
    }))
    expect(window.document.querySelector('link[data-aria-composer-font-asset]'))
      .toBeNull()
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.syncFontStylesheet, url: googleFontsUrl },
    }))
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.syncFontStylesheet, url: null },
    }))
    expect(window.document.querySelector('link[data-aria-composer-font-asset]'))
      .toBeNull()
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.syncMotionAssets, enabled: true },
    }))
    expect(window.document.querySelector('link[data-aria-motion-asset="css"]'))
      .not.toBeNull()
    expect(window.document.querySelector('script[data-aria-motion-asset="js"]'))
      .not.toBeNull()
    const destroyMotion = vi.fn()
    ;(window as unknown as { AriaMotion?: { destroy: () => void } }).AriaMotion = {
      destroy: destroyMotion,
    }
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.syncMotionAssets, enabled: false },
    }))
    expect(destroyMotion).toHaveBeenCalledTimes(1)
    expect((window as unknown as { AriaMotion?: unknown }).AriaMotion).toBeUndefined()
    expect(window.document.querySelector('[data-aria-motion-asset]')).toBeNull()
    expect(ARIA_PROTOCOL_VERSION).toBe(12)
    dom.window.close()
  })

  it("resolves a gradient ancestor as the effective editing backdrop", async () => {
    const dom = new JSDOM(`<!doctype html><html><body style="background-color: rgb(255, 255, 255)">
      <section style="background: linear-gradient(135deg, #070b14 0%, #0b1020 52%, #101a35 100%)">
        <template data-aria-s="0"></template><h1 style="color: rgb(255, 255, 255)">Build beyond the visible.</h1><template data-aria-e="0"></template>
      </section>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
    })
    const { window } = dom
    const responses: Array<{ type?: string; requestId?: string; values?: Record<string, string> }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.computedStyleResponse) responses.push(event.data)
    })

    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.computedStyleRequest,
        requestId: "gradient-1",
        path: "0",
        occurrence: 0,
        properties: ["color", "aria-effective-background"],
      },
    }))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    expect(responses).toContainEqual({
      type: ARIA_MSG.computedStyleResponse,
      requestId: "gradient-1",
      values: {
        color: "rgb(255, 255, 255)",
        "aria-effective-background": "linear-gradient(135deg, rgb(7, 11, 20) 0%, rgb(11, 16, 32) 52%, rgb(16, 26, 53) 100%) rgba(0, 0, 0, 0)",
      },
    })
    dom.window.close()
  })

  it("remeasures tracked overlay geometry after preview sizing and cleanup", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><section>Resizable</section><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    Object.defineProperties(window, {
      requestAnimationFrame: {
        configurable: true,
        value: (callback: FrameRequestCallback) => window.setTimeout(
          () => callback(window.performance.now()),
          0,
        ),
      },
      cancelAnimationFrame: {
        configurable: true,
        value: (id: number) => window.clearTimeout(id),
      },
    })
    const section = window.document.querySelector("section")!
    Object.defineProperty(section, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const previewCss = window.document
          .querySelector("#aria-composer-preview-style")
          ?.textContent ?? ""
        const width = previewCss.includes("width:160px") ? 160 : 100
        return {
          x: 20,
          y: 30,
          left: 20,
          top: 30,
          right: 20 + width,
          bottom: 70,
          width,
          height: 40,
          toJSON: () => ({}),
        }
      },
    })
    const rectMessages: Array<{
      rects?: Record<string, Array<{ w: number }> | null>
    }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.rects) rectMessages.push(event.data)
    })

    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.track,
        trackingRevision: 1,
        paths: ["0"],
        scope: "",
      },
    }))
    await vi.waitFor(() => {
      expect(rectMessages.at(-1)?.rects?.["0"]?.[0]?.w).toBe(100)
    })

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: {
        type: ARIA_MSG.previewStyle,
        path: "0",
        cssText: "width:160px;",
      },
    }))
    await vi.waitFor(() => {
      expect(rectMessages.at(-1)?.rects?.["0"]?.[0]?.w).toBe(160)
    })

    const messageCountBeforeClear = rectMessages.length
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.clearPreviewStyle, path: "0" },
    }))
    await vi.waitFor(() => {
      expect(rectMessages.length).toBeGreaterThan(messageCountBeforeClear)
      expect(rectMessages.at(-1)?.rects?.["0"]?.[0]?.w).toBe(100)
    })
    dom.window.close()
  })

  it("reports and restores the canvas viewport without animated selection scrolling", async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <template data-aria-s="0"></template><section>Target</section><template data-aria-e="0"></template>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const scrollTo = vi.fn()
    Object.defineProperty(window, "scrollTo", { value: scrollTo, configurable: true })
    Object.defineProperty(window, "scrollX", { value: 12, configurable: true })
    Object.defineProperty(window, "scrollY", { value: 480, configurable: true })
    const viewports: Array<{ type?: string; href?: string; x?: number; y?: number }> = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.viewport) viewports.push(event.data)
    })

    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.restoreViewport, x: 12, y: 480 },
    }))
    expect(scrollTo).toHaveBeenCalledWith(12, 480)

    window.dispatchEvent(new window.Event("scroll"))
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(viewports).toContainEqual({
      type: ARIA_MSG.viewport,
      href: window.location.href,
      x: 12,
      y: 480,
    })
    dom.window.close()
  })
})
