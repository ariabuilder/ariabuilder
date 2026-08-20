import { isEditableKeyboardTarget } from "../../lib/keyboardShortcuts"

const ESCAPE_BOUNDARY_SELECTOR = [
  "[data-aria-composer-inspector]",
  "[data-composer-escape-boundary]",
  "[data-slot='popover-content']",
  "[role='dialog']",
  "[role='listbox']",
  "[role='menu']",
].join(",")

/**
 * Escape dismisses the nearest focused control first. Composer drill-back is
 * only the fallback when focus is outside text entry, Inspector, and portaled
 * overlays such as selects, popovers, dialogs, and menus.
 */
export function shouldCloseComposerDrillForEscape(event: KeyboardEvent): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false
  if (isEditableKeyboardTarget(event.target)) return false

  const path = event.composedPath?.() ?? [event.target]
  return !path.some(
    (target) => target instanceof Element && target.matches(ESCAPE_BOUNDARY_SELECTOR),
  )
}
