/**
 * Cross-platform keyboard shortcut helpers for Aria.
 *
 * `mod` means Cmd on macOS and Ctrl on Windows/Linux.
 */

export type ShortcutModifiers = {
  /** Primary accelerator: Meta (⌘) on macOS, Ctrl elsewhere. */
  mod?: boolean
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
}

export type ShortcutDefinition = ShortcutModifiers & {
  /** Stable id for docs / conflict checks. */
  id: string
  /** Letter or named key (`k`, `Escape`, `,`). */
  key: string
  /** When true, fires even while focus is in an input/textarea/contenteditable. */
  allowInInput?: boolean
  /** Default true. */
  preventDefault?: boolean
}

let isMacPlatformCache: boolean | null = null

export function isMacPlatform(): boolean {
  if (isMacPlatformCache !== null) return isMacPlatformCache
  if (typeof navigator === "undefined") {
    isMacPlatformCache = false
    return false
  }
  isMacPlatformCache =
    /Mac|iPhone|iPod|iPad/.test(navigator.platform) ||
    /Mac|iPhone|iPod|iPad/.test(navigator.userAgent)
  return isMacPlatformCache
}

/** True when the event target is a text-entry surface. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  return target.closest("[contenteditable=''], [contenteditable='true']") != null
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

/**
 * Build a canonical chord string from a definition, expanding `mod`
 * for the current platform (e.g. `meta+k` or `ctrl+k`).
 */
export function shortcutChord(def: ShortcutDefinition): string {
  const parts: string[] = []
  const mod = Boolean(def.mod)
  const onMac = isMacPlatform()

  if (mod ? onMac || def.meta : def.meta) parts.push("meta")
  if (mod ? !onMac || def.ctrl : def.ctrl) parts.push("ctrl")
  if (def.shift) parts.push("shift")
  if (def.alt) parts.push("alt")
  parts.push(normalizeKey(def.key))
  return parts.join("+")
}

/**
 * Resolve a keyboard event to a canonical chord (`meta+shift+k`).
 * Uses `event.code` for Alt-letter macOS dead keys when needed.
 */
export function resolveShortcutChordFromEvent(event: KeyboardEvent): string | null {
  const eventKey = event.key
  if (typeof eventKey !== "string" || eventKey.length === 0) return null

  const parts: string[] = []
  if (event.metaKey) parts.push("meta")
  if (event.ctrlKey) parts.push("ctrl")
  if (event.shiftKey) parts.push("shift")
  if (event.altKey) parts.push("alt")

  const key =
    event.altKey && /^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3).toLowerCase()
      : normalizeKey(eventKey)

  parts.push(key)
  return parts.join("+")
}

export function eventMatchesShortcut(
  event: KeyboardEvent,
  def: ShortcutDefinition,
): boolean {
  const chord = resolveShortcutChordFromEvent(event)
  if (!chord) return false
  return chord === shortcutChord(def)
}

/** ARIA `aria-keyshortcuts` value, e.g. `Meta+K` / `Control+K`. */
export function ariaKeyShortcuts(def: ShortcutDefinition): string {
  const keyLabel =
    def.key.length === 1 ? def.key.toUpperCase() : def.key
  const onMac = isMacPlatform()
  const parts: string[] = []

  if (def.mod) {
    parts.push(onMac ? "Meta" : "Control")
  } else {
    if (def.meta) parts.push("Meta")
    if (def.ctrl) parts.push("Control")
  }
  if (def.alt) parts.push("Alt")
  if (def.shift) parts.push("Shift")
  parts.push(keyLabel)
  return parts.join("+")
}

/** Human-readable label: `⌘K` on macOS, `Ctrl+K` on Windows/Linux. */
export function formatShortcut(def: ShortcutDefinition): string {
  const keyLabel =
    def.key.length === 1 ? def.key.toUpperCase() : def.key
  const onMac = isMacPlatform()
  const chunks: string[] = []

  if (def.mod) {
    chunks.push(onMac ? "⌘" : "Ctrl")
  } else {
    if (def.meta) chunks.push(onMac ? "⌘" : "Meta")
    if (def.ctrl) chunks.push("Ctrl")
  }
  if (def.alt) chunks.push(onMac ? "⌥" : "Alt")
  if (def.shift) chunks.push(onMac ? "⇧" : "Shift")

  if (onMac && (def.mod || def.meta || def.alt || def.shift)) {
    return `${chunks.join("")}${keyLabel}`
  }
  return [...chunks, keyLabel].join("+")
}

/** App-wide shortcut catalog — add new chords here (and in shared/appShortcuts.ts). */
export const AppShortcuts = {
  pageSwitcher: {
    id: "pageSwitcher",
    key: "k",
    mod: true,
    allowInInput: true,
    preventDefault: true,
  },
  projectSwitcher: {
    id: "projectSwitcher",
    key: "p",
    mod: true,
    allowInInput: true,
    preventDefault: true,
  },
  railComposer: {
    id: "railComposer",
    key: "1",
    mod: true,
    allowInInput: true,
    preventDefault: true,
  },
  railPages: {
    id: "railPages",
    key: "2",
    mod: true,
    allowInInput: true,
    preventDefault: true,
  },
  railComponents: {
    id: "railComponents",
    key: "3",
    mod: true,
    allowInInput: true,
    preventDefault: true,
  },
  railLayouts: {
    id: "railLayouts",
    key: "4",
    mod: true,
    allowInInput: true,
    preventDefault: true,
  },
  railCollections: {
    id: "railCollections",
    key: "5",
    mod: true,
    allowInInput: true,
    preventDefault: true,
  },
  railMedia: {
    id: "railMedia",
    key: "6",
    mod: true,
    allowInInput: true,
    preventDefault: true,
  },
  railDesign: {
    id: "railDesign",
    key: "7",
    mod: true,
    allowInInput: true,
    preventDefault: true,
  },
  settings: {
    id: "settings",
    key: ",",
    mod: true,
    allowInInput: true,
    preventDefault: true,
  },
  terminal: {
    id: "terminal",
    key: "/",
    mod: true,
    allowInInput: true,
    preventDefault: true,
  },
  git: {
    id: "git",
    key: ".",
    mod: true,
    allowInInput: true,
    preventDefault: true,
  },
} as const satisfies Record<string, ShortcutDefinition>
