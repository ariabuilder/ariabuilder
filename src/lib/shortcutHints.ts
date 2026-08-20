import { isMacPlatform } from "./keyboardShortcuts"
import { onElectronShortcut } from "./electronShortcutHub"

export const SHORTCUT_HINT_HOLD_DELAY_MS = 550

export type ShortcutHintRevealOptions = {
  delayMs?: number
  modifierKey?: "Meta" | "Control"
}

export function installShortcutHintReveal(
  options: ShortcutHintRevealOptions = {},
): () => void {
  const delayMs = options.delayMs ?? SHORTCUT_HINT_HOLD_DELAY_MS
  const modifierKey =
    options.modifierKey ?? (isMacPlatform() ? "Meta" : "Control")
  let held = false
  let revealTimer: ReturnType<typeof setTimeout> | null = null

  function hide() {
    document.documentElement.removeAttribute("data-shortcut-hints")
  }

  function clearRevealTimer() {
    if (!revealTimer) return
    clearTimeout(revealTimer)
    revealTimer = null
  }

  function setModifierHeld(next: boolean) {
    if (next === held) return
    held = next
    clearRevealTimer()
    if (!next) {
      hide()
      return
    }
    revealTimer = setTimeout(() => {
      revealTimer = null
      if (held) document.documentElement.dataset.shortcutHints = "visible"
    }, delayMs)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === modifierKey) {
      if (!event.repeat) setModifierHeld(true)
      return
    }

    // Hints describe shortcuts while the modifier is held on its own. As soon
    // as a chord begins, cancel both the visible state and any pending reveal.
    if (held) setModifierHeld(false)
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.key === modifierKey) setModifierHeld(false)
  }

  function onVisibilityChange() {
    if (document.hidden) setModifierHeld(false)
  }

  function onBlur() {
    setModifierHeld(false)
  }

  window.addEventListener("keydown", onKeyDown, true)
  window.addEventListener("keyup", onKeyUp, true)
  window.addEventListener("blur", onBlur)
  document.addEventListener("visibilitychange", onVisibilityChange)
  const stopElectronListener = window.aria?.window.onPrimaryModifierChange?.(
    setModifierHeld,
  )
  const stopElectronShortcutListener = onElectronShortcut(() => {
    setModifierHeld(false)
  })

  return () => {
    clearRevealTimer()
    hide()
    window.removeEventListener("keydown", onKeyDown, true)
    window.removeEventListener("keyup", onKeyUp, true)
    window.removeEventListener("blur", onBlur)
    document.removeEventListener("visibilitychange", onVisibilityChange)
    stopElectronListener?.()
    stopElectronShortcutListener?.()
  }
}
