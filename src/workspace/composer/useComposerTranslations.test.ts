import { ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import type { ProjectTranslationCatalogResult } from "../../../shared/composer"
import { useComposerTranslationState } from "./useComposerTranslations"

function result(id: string, locale: string): ProjectTranslationCatalogResult {
  return {
    catalogs: [{
      id,
      label: id,
      sourceFile: `src/i18n/${id}.ts`,
      sourceHash: `${id}-hash`,
      sourceFiles: [],
      exportName: id,
      locales: [locale],
      defaultLocale: locale,
      resolver: { kind: "path-prefix" },
      namespaces: [],
      diagnostics: [],
      consumers: [],
      capabilities: { read: true, editScalar: true, adopt: true, bind: true },
    }],
    unsupported: [],
    scannedAt: `${id}-scan`,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe("useComposerTranslationState", () => {
  it("clears the previous project and loads catalogs for the next project", async () => {
    const projectPath = ref("/project-a")
    const load = vi.fn(async (path: string) =>
      path === "/project-a" ? result("a", "en") : result("b", "fr"),
    )
    const state = useComposerTranslationState(projectPath, load)

    await state.refresh()
    expect(state.result.value.catalogs[0]?.id).toBe("a")
    expect(state.activeLocale.value).toBe("en")

    projectPath.value = "/project-b"
    expect(state.result.value).toMatchObject({ catalogs: [], scannedAt: "" })
    expect(state.activeLocale.value).toBe("")

    await state.refresh()
    expect(load).toHaveBeenLastCalledWith("/project-b", false)
    expect(state.result.value.catalogs[0]?.id).toBe("b")
    expect(state.activeLocale.value).toBe("fr")
  })

  it("ignores a stale catalog response after the project changes", async () => {
    const projectPath = ref("/project-a")
    const first = deferred<ProjectTranslationCatalogResult>()
    const second = deferred<ProjectTranslationCatalogResult>()
    const load = vi.fn((path: string) =>
      path === "/project-a" ? first.promise : second.promise,
    )
    const state = useComposerTranslationState(projectPath, load)

    const firstRefresh = state.refresh()
    projectPath.value = "/project-b"
    const secondRefresh = state.refresh()
    second.resolve(result("b", "fr"))
    await secondRefresh
    first.resolve(result("a", "en"))
    await firstRefresh

    expect(state.result.value.catalogs[0]?.id).toBe("b")
    expect(state.activeLocale.value).toBe("fr")
    expect(state.loading.value).toBe(false)
  })
})
