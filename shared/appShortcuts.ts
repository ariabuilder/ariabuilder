/**
 * App shortcut chords shared by Electron (before-input-event) and the renderer.
 * Keep this free of Vue / DOM so main-process code can import it.
 */

export type AppShortcutChord = {
  id: string
  key: string
  mod?: boolean
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
}

export const APP_SHORTCUT_CHORDS: readonly AppShortcutChord[] = [
  { id: "pageSwitcher", key: "k", mod: true },
  { id: "projectSwitcher", key: "p", mod: true },
  { id: "railComposer", key: "1", mod: true },
  { id: "railPages", key: "2", mod: true },
  { id: "railComponents", key: "3", mod: true },
  { id: "railLayouts", key: "4", mod: true },
  { id: "railCollections", key: "5", mod: true },
  { id: "railMedia", key: "6", mod: true },
  { id: "railDesign", key: "7", mod: true },
  { id: "settings", key: ",", mod: true },
  { id: "terminal", key: "/", mod: true },
  { id: "git", key: ".", mod: true },
]

export type AppShortcutId = (typeof APP_SHORTCUT_CHORDS)[number]["id"]

export type ShortcutInputLike = {
  type: string
  key: string
  code?: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

/**
 * Match a keyboard input to an app shortcut id, or null.
 * `platform` should be `process.platform` in Electron (`darwin` → ⌘, else Ctrl).
 */
export function matchAppShortcutId(
  input: ShortcutInputLike,
  platform: string,
): AppShortcutId | null {
  if (input.type !== "keyDown") return null

  const onMac = platform === "darwin"
  const key =
    input.alt && input.code && /^Key[A-Z]$/.test(input.code)
      ? input.code.slice(3).toLowerCase()
      : input.key.length === 1
        ? input.key.toLowerCase()
        : input.key

  for (const chord of APP_SHORTCUT_CHORDS) {
    const wantMeta = Boolean(chord.mod ? onMac || chord.meta : chord.meta)
    const wantCtrl = Boolean(chord.mod ? !onMac || chord.ctrl : chord.ctrl)
    const wantAlt = Boolean(chord.alt)
    const wantShift = Boolean(chord.shift)

    if (input.meta !== wantMeta) continue
    if (input.control !== wantCtrl) continue
    if (input.alt !== wantAlt) continue
    if (input.shift !== wantShift) continue
    if (key !== chord.key) continue
    return chord.id
  }
  return null
}
