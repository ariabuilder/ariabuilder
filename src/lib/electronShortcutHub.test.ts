// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { onElectronShortcut } from "./electronShortcutHub"

afterEach(() => {
  Reflect.deleteProperty(window, "aria")
})

describe("Electron shortcut hub", () => {
  it("shares one IPC listener across renderer subscribers", () => {
    let bridgeHandler: ((id: string) => void) | undefined
    const stopBridge = vi.fn()
    const onShortcut = vi.fn((handler: (id: string) => void) => {
      bridgeHandler = handler
      return stopBridge
    })
    Object.defineProperty(window, "aria", {
      configurable: true,
      value: { window: { onShortcut } },
    })
    const handlers = Array.from({ length: 12 }, () => vi.fn())
    const stops = handlers.map((handler) => onElectronShortcut(handler))

    expect(onShortcut).toHaveBeenCalledTimes(1)
    bridgeHandler?.("composer")
    expect(handlers.every((handler) => handler.mock.calls[0]?.[0] === "composer")).toBe(true)

    for (const stop of stops.slice(0, -1)) stop()
    expect(stopBridge).not.toHaveBeenCalled()
    stops.at(-1)?.()
    expect(stopBridge).toHaveBeenCalledTimes(1)
  })
})
