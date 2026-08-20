import {
  type ComponentPublicInstance,
  type MaybeRefOrGetter,
} from "vue"
import { resolveButtonEl } from "../utils/resolveButtonEl"
import { useSlidingNavIndicator } from "./useSlidingNavIndicator"

/**
 * Shared sliding-nav wiring for flat section rails (design, settings, media variants).
 */
export function useStudioSectionNav(
  activeKey: MaybeRefOrGetter<string | null>,
) {
  const sliding = useSlidingNavIndicator({
    enabled: true,
    activeKey,
    hoverOnly: true,
    hideWhenOnActive: true,
  })

  const registeredEls = new Map<
    string,
    Element | ComponentPublicInstance | null
  >()

  function bindItemRef(key: string) {
    return (el: Element | ComponentPublicInstance | null) => {
      if (registeredEls.get(key) === el) return
      registeredEls.set(key, el)
      sliding.registerButton(key, resolveButtonEl(el))
    }
  }

  function bindNavRoot(el: Element | ComponentPublicInstance | null) {
    sliding.navRef.value = el instanceof HTMLElement ? el : null
  }

  return {
    indicator: sliding.indicator,
    indicatorAnimated: sliding.indicatorAnimated,
    bindNavRoot,
    bindItemRef,
    onItemEnter: sliding.onItemEnter,
    onNavLeave: sliding.onNavLeave,
    updateIndicator: sliding.updateIndicator,
  }
}
