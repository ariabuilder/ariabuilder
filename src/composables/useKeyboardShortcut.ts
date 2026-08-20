import {
  onMounted,
  onUnmounted,
  toValue,
  type MaybeRefOrGetter,
} from "vue"
import {
  eventMatchesShortcut,
  isEditableKeyboardTarget,
  type ShortcutDefinition,
} from "@/lib/keyboardShortcuts"
import { onElectronShortcut as subscribeElectronShortcut } from "@/lib/electronShortcutHub"

export type UseKeyboardShortcutOptions = {
  /** When false, the shortcut is ignored. Defaults to true. */
  enabled?: MaybeRefOrGetter<boolean>
  /** Capture phase — prefer true so we beat focused controls when allowed. */
  capture?: boolean
}

/**
 * Register a window-level keyboard shortcut for the component lifetime.
 *
 * In Electron, app chords are also delivered via `before-input-event` →
 * `aria.window.onShortcut`, so they still fire when the Composer preview
 * iframe has focus (cross-origin keydown never reaches the parent window).
 *
 * @example
 * useKeyboardShortcut(AppShortcuts.pageSwitcher, () => { open.value = true })
 */
export function useKeyboardShortcut(
  shortcut: MaybeRefOrGetter<ShortcutDefinition>,
  handler: (event: KeyboardEvent | null) => void,
  options: UseKeyboardShortcutOptions = {},
) {
  const capture = options.capture ?? true
  let stopElectronShortcut: (() => void) | undefined

  function isEnabled() {
    return options.enabled === undefined || Boolean(toValue(options.enabled))
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!isEnabled()) return

    const def = toValue(shortcut)
    if (!eventMatchesShortcut(event, def)) return

    if (!def.allowInInput && isEditableKeyboardTarget(event.target)) {
      return
    }

    if (def.preventDefault !== false) {
      event.preventDefault()
      event.stopPropagation()
    }

    handler(event)
  }

  function onElectronShortcut(id: string) {
    if (!isEnabled()) return
    const def = toValue(shortcut)
    if (def.id !== id) return
    handler(null)
  }

  onMounted(() => {
    window.addEventListener("keydown", onKeyDown, capture)
    stopElectronShortcut = subscribeElectronShortcut(onElectronShortcut)
  })

  onUnmounted(() => {
    window.removeEventListener("keydown", onKeyDown, capture)
    stopElectronShortcut?.()
    stopElectronShortcut = undefined
  })
}
