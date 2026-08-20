// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest"
import { nextTick } from "vue"

afterEach(() => {
  localStorage.clear()
})

describe("useComposerOptions document layers", () => {
  it("shows document layers by default and persists the toggle", async () => {
    const { useComposerOptions } = await import("./useComposerOptions")
    const options = useComposerOptions()
    expect(options.showDocumentLayers.value).toBe(true)

    options.showDocumentLayers.value = false
    await nextTick()

    const stored = JSON.parse(localStorage.getItem("aria.composer.options") ?? "null") as {
      showDocumentLayers?: boolean
    }
    expect(stored.showDocumentLayers).toBe(false)
  })
})
