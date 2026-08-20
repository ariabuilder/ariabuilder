import {
  computed,
  inject,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from "vue"

import type {
  DesignColorPalette,
  DesignSemanticColors,
  DesignVariables,
} from "../../../../shared/design"
import { EMPTY_DESIGN_VARIABLES } from "../../../../shared/design"

export type DesignColorPickerContext = {
  palettes: readonly DesignColorPalette[]
  semantic: DesignSemanticColors
  variables: DesignVariables
}

export const DESIGN_COLOR_PICKER_KEY: InjectionKey<
  | Ref<DesignColorPickerContext>
  | ComputedRef<DesignColorPickerContext>
> = Symbol("design-color-picker")

const EMPTY_CONTEXT: DesignColorPickerContext = {
  palettes: [],
  semantic: {},
  variables: EMPTY_DESIGN_VARIABLES,
}

/**
 * Inject DesignSnapshot-like color/variable context provided by DesignSurface.
 * Returns empty stubs when used outside DesignSurface.
 */
export function useDesignColorPickerContext() {
  const injected = inject(DESIGN_COLOR_PICKER_KEY, null)

  const context = computed<DesignColorPickerContext>(
    () => injected?.value ?? EMPTY_CONTEXT,
  )

  const palettes = computed(() => context.value.palettes)
  const semantic = computed(() => context.value.semantic)
  const variables = computed(() => context.value.variables)
  const isLoading = computed(() => false)

  return {
    context,
    palettes,
    semantic,
    semanticColors: semantic,
    variables,
    isLoading,
  }
}
