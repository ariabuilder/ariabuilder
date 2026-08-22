/**
 * Design-system context for Composer Design tab (class names from snapshot).
 * Color/variable pickers use DESIGN_COLOR_PICKER_KEY provided alongside this.
 */

import {
  computed,
  inject,
  provide,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from "vue"
import type { DesignSnapshot } from "../../../shared/design"
import type { ComposerFrameworkCapabilities } from "../../../shared/composer"
import {
  buildDesignFontOptions,
  type DesignFontOption,
} from "@/workspace/design/lib/fontOptions"

export type ComposerDesignClassesApi = {
  snapshot: Ref<DesignSnapshot | null>
  classNames: ComputedRef<string[]>
  fontOptions: ComputedRef<ComposerFontOption[]>
  framework: Ref<ComposerFrameworkCapabilities | null>
  utilityCandidates: ComputedRef<string[]>
}

export type ComposerFontOption = DesignFontOption

const COMPOSER_DESIGN_CLASSES_KEY: InjectionKey<ComposerDesignClassesApi> =
  Symbol("aria.composer.designClasses")

export function provideComposerDesignClasses(
  snapshot: Ref<DesignSnapshot | null>,
  framework: Ref<ComposerFrameworkCapabilities | null>,
): ComposerDesignClassesApi {
  const classNames = computed(() =>
    (snapshot.value?.classes ?? [])
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b)),
  )
  const fontOptions = computed<ComposerFontOption[]>(() => {
    const fonts = snapshot.value?.fonts
    return buildDesignFontOptions(fonts)
  })
  const utilityCandidates = computed(() => framework.value?.candidates ?? [])
  const api = { snapshot, classNames, fontOptions, framework, utilityCandidates }
  provide(COMPOSER_DESIGN_CLASSES_KEY, api)
  return api
}

export function tryUseComposerDesignClasses(): ComposerDesignClassesApi | null {
  return inject(COMPOSER_DESIGN_CLASSES_KEY, null)
}
