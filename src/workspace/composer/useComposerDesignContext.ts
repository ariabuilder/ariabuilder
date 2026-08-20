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

export type ComposerDesignClassesApi = {
  snapshot: Ref<DesignSnapshot | null>
  classNames: ComputedRef<string[]>
  fontOptions: ComputedRef<ComposerFontOption[]>
  framework: Ref<ComposerFrameworkCapabilities | null>
  utilityCandidates: ComputedRef<string[]>
}

export type ComposerFontOption = {
  family: string
  source: "google" | "custom" | "fontsource"
  weights: number[]
}

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
    if (!fonts) return []

    const options = new Map<string, ComposerFontOption>()
    for (const font of fonts.google) {
      const family = font.family.trim()
      if (!family) continue
      options.set(family.toLocaleLowerCase(), {
        family,
        source: "google",
        weights: [...font.weights],
      })
    }
    for (const font of fonts.fontsource ?? []) {
      const family = font.family.trim()
      if (!family) continue
      const key = family.toLocaleLowerCase()
      if (options.has(key)) continue
      options.set(key, {
        family,
        source: "fontsource",
        weights: [],
      })
    }
    for (const font of fonts.custom) {
      const family = font.family.trim()
      if (!family) continue
      options.set(family.toLocaleLowerCase(), {
        family,
        source: "custom",
        weights: [],
      })
    }
    for (const family of [fonts.bodyFamily, fonts.headingFamily]) {
      const normalized = family?.trim()
      if (!normalized || options.has(normalized.toLocaleLowerCase())) continue
      options.set(normalized.toLocaleLowerCase(), {
        family: normalized,
        source: "custom",
        weights: [],
      })
    }

    return [...options.values()].sort((left, right) =>
      left.family.localeCompare(right.family),
    )
  })
  const utilityCandidates = computed(() => framework.value?.candidates ?? [])
  const api = { snapshot, classNames, fontOptions, framework, utilityCandidates }
  provide(COMPOSER_DESIGN_CLASSES_KEY, api)
  return api
}

export function tryUseComposerDesignClasses(): ComposerDesignClassesApi | null {
  return inject(COMPOSER_DESIGN_CLASSES_KEY, null)
}
