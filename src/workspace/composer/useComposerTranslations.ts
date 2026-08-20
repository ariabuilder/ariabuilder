import { inject, provide, type InjectionKey, type Ref } from "vue"
import type { ProjectTranslationCatalogResult } from "../../../shared/composer"

export type ComposerTranslationsContext = {
  result: Ref<ProjectTranslationCatalogResult>
  loading: Ref<boolean>
  error: Ref<string>
  activeLocale: Ref<string>
  refresh: (force?: boolean) => Promise<void>
}

const key: InjectionKey<ComposerTranslationsContext> = Symbol("composer-translations")

export function provideComposerTranslations(context: ComposerTranslationsContext): ComposerTranslationsContext {
  provide(key, context)
  return context
}

export function tryUseComposerTranslations(): ComposerTranslationsContext | null {
  return inject(key, null)
}

