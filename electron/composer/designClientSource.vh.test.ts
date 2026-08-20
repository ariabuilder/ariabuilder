import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { DESIGN_CLIENT_SOURCE } from "./designClientSource"
import { asMessageEventSource } from "./designClientSource.testUtils"
import { ARIA_MSG } from "../../shared/composer/protocol"

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("Composer design client viewport freeze", () => {
  it("rewrites vh units and remaps position:fixed after aria:set-vh", async () => {
    const dom = new JSDOM(`<!doctype html><html><head>
      <style>
        .hero { height: 100vh; }
        .nav { position: fixed; top: 0; }
        .copy { color: rgb(1, 2, 3); }
      </style>
    </head><body>
      <div class="hero"></div>
      <header class="nav"></header>
      <p class="copy">Hi</p>
    </body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
    })
    const { window } = dom
    const heights: number[] = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.pageHeight && typeof event.data.height === "number") {
        heights.push(event.data.height)
      }
    })

    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await flush()
    expect(window.document.getElementById("aria-vh-override")).toBeNull()

    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.setVh, px: 900 },
    }))
    await flush()

    expect(window.document.documentElement.style.getPropertyValue("--aria-vh")).toBe("9px")
    const override = window.document.getElementById("aria-vh-override")
    expect(override?.textContent).toContain("html, body { height: auto !important; }")
    expect(override?.textContent).toContain("calc(100 * var(--aria-vh, 1vh))")
    expect(override?.textContent).toMatch(/position:\s*absolute/)
    expect(override?.textContent).not.toContain("color:")
    expect(heights.length).toBeGreaterThan(0)
    dom.window.close()
  })

  it("reports body content height instead of the iframe viewport", async () => {
    const dom = new JSDOM(`<!doctype html><html><body style="margin: 0"><div id="page"></div></body></html>`, {
      url: "http://127.0.0.1:4321/#aria-design",
      runScripts: "dangerously",
    })
    const { window } = dom
    const body = window.document.body
    Object.defineProperty(body, "offsetTop", { configurable: true, value: 0 })
    Object.defineProperty(body, "scrollHeight", { configurable: true, value: 2400 })
    Object.defineProperty(window.document.documentElement, "scrollHeight", {
      configurable: true,
      value: 812,
    })

    const heights: number[] = []
    window.addEventListener("message", (event) => {
      if (event.data?.type === ARIA_MSG.pageHeight) heights.push(event.data.height)
    })

    window.eval(DESIGN_CLIENT_SOURCE)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    await flush()
    window.dispatchEvent(new window.MessageEvent("message", {
      source: asMessageEventSource(window),
      data: { type: ARIA_MSG.setVh, px: 812 },
    }))
    await flush()

    expect(heights.at(-1)).toBe(2400)
    dom.window.close()
  })
})
