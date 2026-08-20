function api() {
  if (!window.aria?.clipboard) {
    throw new Error(
      "Clipboard API missing from preload. Stop the app and run npm run dev again.",
    )
  }
  return window.aria.clipboard
}

/** Write text via Electron main clipboard (works after context-menu closes). */
export function writeClipboardText(text: string): Promise<{ ok: true }> {
  return api().writeText(text)
}
