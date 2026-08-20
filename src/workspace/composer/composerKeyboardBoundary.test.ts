// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest"
import { shouldCloseComposerDrillForEscape } from "./composerKeyboardBoundary"

function escapeFrom(target: HTMLElement, preventDefault = false): boolean {
  if (preventDefault) {
    target.addEventListener("keydown", (event) => event.preventDefault(), { once: true })
  }
  let result = false
  window.addEventListener("keydown", (event) => {
    result = shouldCloseComposerDrillForEscape(event)
  }, { once: true })
  target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    composed: true,
  }))
  return result
}

describe("Composer drill Escape boundary", () => {
  afterEach(() => { document.body.replaceChildren() })

  it("keeps Escape inside the Inspector and its portaled overlays", () => {
    const inspector = document.createElement("aside")
    inspector.dataset.ariaComposerInspector = ""
    const inspectorButton = document.createElement("button")
    inspector.append(inspectorButton)
    document.body.append(inspector)
    expect(escapeFrom(inspectorButton)).toBe(false)

    const listbox = document.createElement("div")
    listbox.setAttribute("role", "listbox")
    const option = document.createElement("button")
    listbox.append(option)
    document.body.append(listbox)
    expect(escapeFrom(option)).toBe(false)

    const popover = document.createElement("div")
    popover.dataset.slot = "popover-content"
    const popoverButton = document.createElement("button")
    popover.append(popoverButton)
    document.body.append(popover)
    expect(escapeFrom(popoverButton)).toBe(false)
  })

  it("honors controls that already consumed Escape", () => {
    const button = document.createElement("button")
    document.body.append(button)
    expect(escapeFrom(button, true)).toBe(false)
  })

  it("uses Escape as drill-back from the canvas surface", () => {
    const canvasControl = document.createElement("button")
    canvasControl.dataset.composerCanvasControl = ""
    document.body.append(canvasControl)
    expect(escapeFrom(canvasControl)).toBe(true)
  })
})
