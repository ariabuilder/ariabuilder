import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createTransientScrollbarController,
  shouldUseTransientScrollbars,
  TRANSIENT_SCROLLBAR_ACTIVE_ATTRIBUTE,
} from "./transientScrollbars"

describe("transient Composer scrollbars", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("only replaces persistent Windows and Linux scrollbars outside forced-colors mode", () => {
    expect(shouldUseTransientScrollbars("Win32", "", false)).toBe(true)
    expect(shouldUseTransientScrollbars("", "Windows NT 10.0", false)).toBe(true)
    expect(shouldUseTransientScrollbars("Linux x86_64", "", false)).toBe(true)
    expect(shouldUseTransientScrollbars("", "X11; Linux x86_64", false)).toBe(true)
    expect(shouldUseTransientScrollbars("MacIntel", "Macintosh", false)).toBe(false)
    expect(shouldUseTransientScrollbars("Win32", "Windows NT 10.0", true)).toBe(false)
    expect(shouldUseTransientScrollbars("Linux x86_64", "Linux", true)).toBe(false)
  })

  it("shows on scroll, waits for inactivity, then fades to transparent", () => {
    const animation = {
      cancel: vi.fn(),
      onfinish: null as ScrollbarAnimation["onfinish"],
    }
    const animate = vi.fn(() => animation)
    const element = createTestElement(animate)
    const controller = createTransientScrollbarController({
      hideDelayMs: 650,
      fadeDurationMs: 180,
      reducedMotion: () => false,
    })

    controller.activate(element)
    expect(element.hasAttribute(TRANSIENT_SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true)
    vi.advanceTimersByTime(649)
    expect(animate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(element.hasAttribute(TRANSIENT_SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false)
    expect(animate).toHaveBeenCalledWith(
      [
        { scrollbarColor: "rgb(117 117 117) transparent" },
        { scrollbarColor: "transparent transparent" },
      ],
      {
        duration: 180,
        easing: "cubic-bezier(0.2, 0, 0, 1)",
        fill: "forwards",
      },
    )
    animation.onfinish?.call(animation as unknown as Animation, {} as AnimationPlaybackEvent)
    expect(animation.cancel).toHaveBeenCalledOnce()
  })

  it("extends visibility when scrolling continues and cleans up on dispose", () => {
    const element = createTestElement()
    const controller = createTransientScrollbarController({ reducedMotion: () => true })

    controller.activate(element)
    vi.advanceTimersByTime(500)
    controller.activate(element)
    vi.advanceTimersByTime(500)
    expect(element.hasAttribute(TRANSIENT_SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true)

    controller.dispose()
    expect(element.hasAttribute(TRANSIENT_SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false)
    vi.runAllTimers()
    expect(element.hasAttribute(TRANSIENT_SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false)
  })
})

type ScrollbarAnimation = {
  onfinish: ((this: Animation, ev: AnimationPlaybackEvent) => unknown) | null
}

function createTestElement(animate?: (...args: unknown[]) => unknown): Element {
  const attributes = new Set<string>()
  return {
    setAttribute: (name: string) => attributes.add(name),
    removeAttribute: (name: string) => attributes.delete(name),
    hasAttribute: (name: string) => attributes.has(name),
    ...(animate ? { animate } : {}),
  } as unknown as Element
}
