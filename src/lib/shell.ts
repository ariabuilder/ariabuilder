function api() {
  if (!window.aria?.shell) {
    throw new Error(
      "Shell API missing from preload. Stop the app and run npm run dev again.",
    )
  }
  return window.aria.shell
}

/** Reveal a file or folder in the OS file manager (Finder / Explorer). */
export function revealPath(targetPath: string): Promise<{ path: string }> {
  return api().revealPath(targetPath)
}
