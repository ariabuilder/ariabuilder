import { JSDOM } from "jsdom"
import { describe, expect, it, vi } from "vitest"
import { ARIA_MOTION_JS } from "./motionAssets"

type MotionRuntime = {
  init: (root?: Document | Element) => void
  destroy: (root?: Document | Element) => void
}

describe("Aria Motion runtime lifecycle", () => {
  it("reconciles trigger changes without duplicate listeners", () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <div id="target" class="aria-motion aria-motion-reveal aria-motion-fade"></div>
    </body></html>`, {
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const disconnect = vi.fn()
    class TestIntersectionObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = disconnect
    }
    Object.defineProperty(window, "IntersectionObserver", {
      value: TestIntersectionObserver,
      configurable: true,
    })

    window.eval(ARIA_MOTION_JS)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    const runtime = (window as unknown as { AriaMotion: MotionRuntime }).AriaMotion
    const target = window.document.querySelector("#target") as HTMLElement

    target.classList.remove("aria-motion-reveal")
    target.classList.add("aria-motion-click")
    runtime.init(window.document)
    expect(disconnect).toHaveBeenCalledTimes(1)

    target.click()
    expect(target.classList.contains("aria-motion-in")).toBe(true)
    runtime.init(window.document)
    target.click()
    expect(target.classList.contains("aria-motion-in")).toBe(false)

    runtime.destroy()
    target.click()
    expect(target.classList.contains("aria-motion-in")).toBe(false)
    dom.window.close()
  })

  it("removes stale scroll handlers when scrub configuration changes", () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <div id="target" class="aria-motion aria-motion-scrub" data-aria-motion-scrub="100"></div>
    </body></html>`, {
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    const remove = vi.spyOn(window, "removeEventListener")
    window.eval(ARIA_MOTION_JS)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    const runtime = (window as unknown as { AriaMotion: MotionRuntime }).AriaMotion
    const target = window.document.querySelector("#target") as HTMLElement

    target.setAttribute("data-aria-motion-scrub", "240")
    runtime.init(window.document)
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function))

    runtime.destroy()
    expect(target.style.getPropertyValue("--aria-motion-progress")).toBe("")
    dom.window.close()
  })

  it("reindexes staggered children after an in-place DOM patch", () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <div id="target" class="aria-motion aria-motion-stagger">
        <span>One</span>
      </div>
    </body></html>`, {
      runScripts: "dangerously",
      pretendToBeVisual: true,
    })
    const { window } = dom
    window.eval(ARIA_MOTION_JS)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
    const runtime = (window as unknown as { AriaMotion: MotionRuntime }).AriaMotion
    const target = window.document.querySelector("#target") as HTMLElement
    const second = window.document.createElement("span")
    second.textContent = "Two"
    target.appendChild(second)

    runtime.init(window.document)
    expect(second.style.getPropertyValue("--aria-motion-child-index")).toBe("1")
    runtime.destroy()
    expect(second.style.getPropertyValue("--aria-motion-child-index")).toBe("")
    dom.window.close()
  })
})
