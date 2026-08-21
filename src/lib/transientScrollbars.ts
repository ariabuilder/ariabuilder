export const TRANSIENT_SCROLLBAR_ACTIVE_ATTRIBUTE = "data-aria-scroll-active"

const VISIBLE_SCROLLBAR_COLOR = "rgb(117 117 117) transparent"
const HIDDEN_SCROLLBAR_COLOR = "transparent transparent"

type ScrollbarAnimation = Pick<Animation, "cancel"> & {
  onfinish: ((this: Animation, ev: AnimationPlaybackEvent) => unknown) | null
}

type ScrollbarState = {
  hideTimer: ReturnType<typeof setTimeout> | null
  animation: ScrollbarAnimation | null
}

type TransientScrollbarOptions = {
  hideDelayMs?: number
  fadeDurationMs?: number
  reducedMotion?: () => boolean
}

export function shouldUseTransientScrollbars(
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
  forcedColors = typeof matchMedia === "function" && matchMedia("(forced-colors: active)").matches,
): boolean {
  return !forcedColors && (
    /^(Win|Linux)/i.test(platform) ||
    /\b(Windows|Linux)\b/i.test(userAgent)
  )
}

export function createTransientScrollbarController({
  hideDelayMs = 650,
  fadeDurationMs = 180,
  reducedMotion = () =>
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
}: TransientScrollbarOptions = {}) {
  const states = new Map<Element, ScrollbarState>()

  function clearState(element: Element, state: ScrollbarState) {
    if (state.hideTimer !== null) clearTimeout(state.hideTimer)
    state.animation?.cancel()
    element.removeAttribute(TRANSIENT_SCROLLBAR_ACTIVE_ATTRIBUTE)
    states.delete(element)
  }

  function activate(element: Element) {
    const previous = states.get(element)
    if (previous) clearState(element, previous)

    element.setAttribute(TRANSIENT_SCROLLBAR_ACTIVE_ATTRIBUTE, "")
    const state: ScrollbarState = { hideTimer: null, animation: null }
    state.hideTimer = setTimeout(() => {
      state.hideTimer = null
      if (reducedMotion() || typeof element.animate !== "function") {
        element.removeAttribute(TRANSIENT_SCROLLBAR_ACTIVE_ATTRIBUTE)
        states.delete(element)
        return
      }

      let animation: ScrollbarAnimation
      try {
        animation = element.animate(
          [
            { scrollbarColor: VISIBLE_SCROLLBAR_COLOR },
            { scrollbarColor: HIDDEN_SCROLLBAR_COLOR },
          ],
          {
            duration: fadeDurationMs,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
            fill: "forwards",
          },
        ) as ScrollbarAnimation
      } catch {
        element.removeAttribute(TRANSIENT_SCROLLBAR_ACTIVE_ATTRIBUTE)
        states.delete(element)
        return
      }
      state.animation = animation
      element.removeAttribute(TRANSIENT_SCROLLBAR_ACTIVE_ATTRIBUTE)
      animation.onfinish = () => {
        if (states.get(element)?.animation !== animation) return
        animation.cancel()
        states.delete(element)
      }
    }, hideDelayMs)
    states.set(element, state)
  }

  function dispose() {
    for (const [element, state] of states) clearState(element, state)
  }

  return { activate, dispose }
}
