import { inject, provide, ref, watch, type InjectionKey, type Ref } from "vue"
import type { ProjectTranslationCatalogResult } from "../../../shared/composer"

export type ComposerTranslationsContext = {
  result: Ref<ProjectTranslationCatalogResult>
  loading: Ref<boolean>
  error: Ref<string>
  activeLocale: Ref<string>
  refresh: (force?: boolean) => Promise<void>
}

const key: InjectionKey<ComposerTranslationsContext> = Symbol("composer-translations")

function emptyTranslationResult(): ProjectTranslationCatalogResult {
  return {
    catalogs: [],
    unsupported: [],
    scannedAt: "",
  }
}

export function useComposerTranslationState(
  projectPath: Readonly<Ref<string>>,
  load: (projectPath: string, force?: boolean) => Promise<ProjectTranslationCatalogResult>,
): ComposerTranslationsContext {
  const result = ref<ProjectTranslationCatalogResult>(emptyTranslationResult())
  const loading = ref(false)
  const error = ref("")
  const activeLocale = ref("")
  let loadGeneration = 0

  async function refresh(force = false): Promise<void> {
    const requestedProject = projectPath.value
    const generation = ++loadGeneration
    loading.value = true
    error.value = ""
    try {
      const next = await load(requestedProject, force)
      if (generation !== loadGeneration || requestedProject !== projectPath.value) return
      result.value = next
      const locales = [...new Set(next.catalogs.flatMap((catalog) => catalog.locales))]
      if (!locales.includes(activeLocale.value)) {
        activeLocale.value = next.catalogs[0]?.defaultLocale ?? locales[0] ?? ""
      }
    } catch (cause) {
      if (generation === loadGeneration) {
        error.value = cause instanceof Error ? cause.message : String(cause)
      }
    } finally {
      if (generation === loadGeneration) loading.value = false
    }
  }

  watch(projectPath, () => {
    loadGeneration += 1
    result.value = emptyTranslationResult()
    loading.value = false
    error.value = ""
    activeLocale.value = ""
  }, { flush: "sync" })

  return { result, loading, error, activeLocale, refresh }
}

export function provideComposerTranslations(context: ComposerTranslationsContext): ComposerTranslationsContext {
  provide(key, context)
  return context
}

export function tryUseComposerTranslations(): ComposerTranslationsContext | null {
  return inject(key, null)
}
