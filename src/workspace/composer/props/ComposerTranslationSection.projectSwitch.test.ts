// @vitest-environment jsdom

import { createApp, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"

const hosts: HTMLElement[] = []

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  for (const host of hosts.splice(0)) host.remove()
})

describe("ComposerTranslationSection project switching", () => {
  it("stays lazy when mounted with catalogs and refreshes after a project switch", async () => {
    const projectPath = ref("/project-a")
    const refresh = vi.fn(async () => undefined)
    vi.doMock("../useComposerDocumentSession", () => ({
      tryUseComposerDocument: () => ({ projectPath }),
    }))
    vi.doMock("../useComposerTranslations", () => ({
      tryUseComposerTranslations: () => ({
        result: ref({ catalogs: [], unsupported: [], scannedAt: "project-a-scan" }),
        loading: ref(false),
        error: ref(""),
        activeLocale: ref(""),
        refresh,
      }),
    }))
    vi.doMock("../selection/useComposerBeacon", () => ({
      tryUseComposerBeacon: () => null,
    }))
    const { default: ComposerTranslationSection } = await import("./ComposerTranslationSection.vue")
    const host = document.createElement("div")
    hosts.push(host)
    document.body.append(host)
    const app = createApp(ComposerTranslationSection)
    app.mount(host)
    await nextTick()
    expect(refresh).not.toHaveBeenCalled()

    projectPath.value = "/project-b"
    await nextTick()
    expect(refresh).toHaveBeenCalledTimes(1)
    app.unmount()
  })
})
