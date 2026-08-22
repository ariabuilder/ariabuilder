// @vitest-environment jsdom

import { createApp, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ProjectTranslationAdoptionAssessment, ProjectTranslationCatalogResult } from "../../../../shared/composer"

const hosts: HTMLElement[] = []

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function catalogResult(): ProjectTranslationCatalogResult {
  return {
    catalogs: [{
      id: "catalog-a",
      label: "Catalog A",
      sourceFile: "src/i18n/messages.ts",
      sourceHash: "catalog-a-hash",
      sourceFiles: [],
      exportName: "messages",
      locales: ["en"],
      defaultLocale: "en",
      resolver: { kind: "path-prefix" },
      namespaces: [{
        id: "catalog-a:home",
        name: "home",
        label: "Home",
        keys: [{
          path: ["title"],
          label: "title",
          values: { en: "Hello" },
          sourceRanges: {},
          sourceFiles: {},
          complete: true,
          editable: true,
        }],
      }],
      diagnostics: [],
      consumers: [],
      capabilities: { read: true, editScalar: true, adopt: true, bind: true },
    }],
    unsupported: [],
    scannedAt: "project-a-scan",
  }
}

function adoptionAssessment(): ProjectTranslationAdoptionAssessment {
  return {
    catalogId: "catalog-a",
    catalogHash: "catalog-a-hash",
    previewHash: "preview-a-hash",
    defaultLocale: "en",
    settingsCompatible: true,
    namespaces: [{
      namespace: "home",
      label: "Home",
      collectionName: "translations-home",
      collectionLabel: "Home translations",
      schema: [],
      locales: ["en"],
      issues: [],
      consumers: [],
    }],
  }
}

function clickButton(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)
  if (!button) throw new Error(`Could not find ${label} button`)
  button.click()
}

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

  it("ignores an adoption review that resolves after the project switches", async () => {
    const projectPath = ref("/project-a")
    const review = deferred<ProjectTranslationAdoptionAssessment>()
    const assess = vi.fn(() => review.promise)
    const refresh = vi.fn(async () => undefined)
    vi.doMock("@/lib/composer", () => ({
      applyComposerTranslationCutover: vi.fn(),
      assessComposerTranslationAdoption: assess,
      createComposerTranslationDrafts: vi.fn(),
      editComposerTranslationValue: vi.fn(),
    }))
    vi.doMock("@/lib/workspace", () => ({
      getSiteSettings: vi.fn(async () => ({ localization: { content: { locales: [{ code: "en", enabled: true }], resolver: { kind: "path-prefix" } } } })),
      updateContentLocalization: vi.fn(),
    }))
    vi.doMock("../useComposerDocumentSession", () => ({
      tryUseComposerDocument: () => ({ projectPath, model: ref(null), editFile: ref("") }),
    }))
    vi.doMock("../useComposerTranslations", () => ({
      tryUseComposerTranslations: () => ({
        result: ref(catalogResult()),
        loading: ref(false),
        error: ref(""),
        activeLocale: ref("en"),
        refresh,
      }),
    }))
    vi.doMock("../selection/useComposerBeacon", () => ({ tryUseComposerBeacon: () => null }))

    const { default: ComposerTranslationSection } = await import("./ComposerTranslationSection.vue")
    const host = document.createElement("div")
    hosts.push(host)
    document.body.append(host)
    const app = createApp(ComposerTranslationSection)
    app.mount(host)
    await nextTick()

    clickButton(host, "Review CMS adoption")
    expect(assess).toHaveBeenCalledWith("/project-a", expect.any(Object))
    projectPath.value = "/project-b"
    review.resolve(adoptionAssessment())
    await review.promise
    await nextTick()

    expect(host.textContent).not.toContain("translations-home")
    app.unmount()
  })

  it("ignores draft creation that resolves after the project switches", async () => {
    const projectPath = ref("/project-a")
    const drafts = deferred<{ ok: true; sourceChanged: false; targets: [] }>()
    const createDrafts = vi.fn(() => drafts.promise)
    const refresh = vi.fn(async () => undefined)
    vi.doMock("@/lib/composer", () => ({
      applyComposerTranslationCutover: vi.fn(),
      assessComposerTranslationAdoption: vi.fn(async () => adoptionAssessment()),
      createComposerTranslationDrafts: createDrafts,
      editComposerTranslationValue: vi.fn(),
    }))
    vi.doMock("@/lib/workspace", () => ({
      getSiteSettings: vi.fn(async () => ({ localization: { content: { locales: [{ code: "en", enabled: true }], resolver: { kind: "path-prefix" } } } })),
      updateContentLocalization: vi.fn(),
    }))
    vi.doMock("../useComposerDocumentSession", () => ({
      tryUseComposerDocument: () => ({ projectPath, model: ref(null), editFile: ref("") }),
    }))
    vi.doMock("../useComposerTranslations", () => ({
      tryUseComposerTranslations: () => ({
        result: ref(catalogResult()),
        loading: ref(false),
        error: ref(""),
        activeLocale: ref("en"),
        refresh,
      }),
    }))
    vi.doMock("../selection/useComposerBeacon", () => ({ tryUseComposerBeacon: () => null }))

    const { default: ComposerTranslationSection } = await import("./ComposerTranslationSection.vue")
    const host = document.createElement("div")
    hosts.push(host)
    document.body.append(host)
    const app = createApp(ComposerTranslationSection)
    app.mount(host)
    await nextTick()

    clickButton(host, "Review CMS adoption")
    await vi.waitFor(() => expect(host.textContent).toContain("translations-home"))
    clickButton(host, "Create drafts")
    expect(createDrafts).toHaveBeenCalledWith("/project-a", expect.any(Object))
    projectPath.value = "/project-b"
    drafts.resolve({ ok: true, sourceChanged: false, targets: [] })
    await drafts.promise
    await nextTick()

    expect(host.textContent).not.toContain("CMS drafts created")
    app.unmount()
  })
})
