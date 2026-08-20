// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installShortcutHintReveal } from "./shortcutHints"

afterEach(() => {
  vi.useRealTimers()
  document.documentElement.removeAttribute("data-shortcut-hints")
  Reflect.deleteProperty(window, "aria")
})

function modifierEvent(type: "keydown" | "keyup") {
  window.dispatchEvent(
    new KeyboardEvent(type, {
      key: "Meta",
      metaKey: type === "keydown",
      bubbles: true,
    }),
  )
}

describe("shortcut hint reveal", () => {
  it("reveals only after the modifier hold delay and hides on release", () => {
    vi.useFakeTimers()
    const stop = installShortcutHintReveal({ delayMs: 400, modifierKey: "Meta" })

    modifierEvent("keydown")
    vi.advanceTimersByTime(399)
    expect(document.documentElement.dataset.shortcutHints).toBeUndefined()

    vi.advanceTimersByTime(1)
    expect(document.documentElement.dataset.shortcutHints).toBe("visible")

    modifierEvent("keyup")
    expect(document.documentElement.dataset.shortcutHints).toBeUndefined()
    stop()
  })

  it("does not reveal for a quick shortcut chord", () => {
    vi.useFakeTimers()
    const stop = installShortcutHintReveal({ delayMs: 400, modifierKey: "Meta" })

    modifierEvent("keydown")
    vi.advanceTimersByTime(100)
    modifierEvent("keyup")
    vi.advanceTimersByTime(400)

    expect(document.documentElement.dataset.shortcutHints).toBeUndefined()
    stop()
  })

  it("hides and cancels a pending reveal when a shortcut chord begins", () => {
    vi.useFakeTimers()
    const stop = installShortcutHintReveal({ delayMs: 400, modifierKey: "Meta" })

    modifierEvent("keydown")
    vi.advanceTimersByTime(100)
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        bubbles: true,
      }),
    )
    vi.advanceTimersByTime(400)

    expect(document.documentElement.dataset.shortcutHints).toBeUndefined()
    stop()
  })

  it("hides when Electron forwards a shortcut from the preview iframe", () => {
    vi.useFakeTimers()
    let onModifierChange: ((held: boolean) => void) | undefined
    let onShortcut: ((id: string) => void) | undefined
    Object.defineProperty(window, "aria", {
      configurable: true,
      value: {
        window: {
          onPrimaryModifierChange(handler: (held: boolean) => void) {
            onModifierChange = handler
            return () => undefined
          },
          onShortcut(handler: (id: string) => void) {
            onShortcut = handler
            return () => undefined
          },
        },
      },
    })
    const stop = installShortcutHintReveal({ delayMs: 0, modifierKey: "Meta" })

    onModifierChange?.(true)
    vi.runOnlyPendingTimers()
    expect(document.documentElement.dataset.shortcutHints).toBe("visible")

    onShortcut?.("pageSwitcher")
    expect(document.documentElement.dataset.shortcutHints).toBeUndefined()
    stop()
  })

  it("hides immediately when the window loses focus", () => {
    vi.useFakeTimers()
    const stop = installShortcutHintReveal({ delayMs: 0, modifierKey: "Meta" })

    modifierEvent("keydown")
    vi.runOnlyPendingTimers()
    expect(document.documentElement.dataset.shortcutHints).toBe("visible")

    window.dispatchEvent(new Event("blur"))
    expect(document.documentElement.dataset.shortcutHints).toBeUndefined()
    stop()
  })
})
