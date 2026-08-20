import { previewPageUrl } from "./preview"

export const COMPOSER_AUTHORING_PREVIEW_TIMEOUT_MS = 8_000
export const COMPOSER_AUTHORING_PREVIEW_INTERVAL_MS = 80

export function composerAuthoringPreviewReady(
  html: string,
  componentFile: string,
): boolean {
  const id = componentFile.trim().replace(/\\/g, "/")
  if (!id) return false
  return html.includes(`data-aria-component-authoring=${JSON.stringify(id)}`)
}

export async function waitForComposerAuthoringPreview(input: {
  previewUrl: string
  route: string
  componentFile: string
  timeoutMs?: number
  intervalMs?: number
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? COMPOSER_AUTHORING_PREVIEW_TIMEOUT_MS
  const intervalMs = input.intervalMs ?? COMPOSER_AUTHORING_PREVIEW_INTERVAL_MS
  const fetchImpl = input.fetchImpl ?? globalThis.fetch?.bind(globalThis)
  const now = input.now ?? Date.now
  const sleep =
    input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const id = input.componentFile.trim().replace(/\\/g, "/")

  if (!fetchImpl) {
    throw new Error("Component preview cannot be verified without fetch.")
  }

  const deadline = now() + timeoutMs
  while (now() <= deadline) {
    const href = previewPageUrl(input.previewUrl, input.route)
    if (!href) {
      throw new Error("Component preview URL is not available.")
    }
    const url = new URL(href)
    url.searchParams.set("t", String(now()))
    try {
      const response = await fetchImpl(url.toString(), { cache: "no-store" })
      if (response.ok) {
        const html = await response.text()
        if (composerAuthoringPreviewReady(html, id)) return
      }
    } catch {
      // Astro may 500 while Vite recompiles the overwritten harness.
    }
    if (now() + intervalMs > deadline) break
    await sleep(intervalMs)
  }
  throw new Error("The isolated component preview did not become ready.")
}
