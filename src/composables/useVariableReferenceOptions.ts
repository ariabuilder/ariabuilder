import {
  computed,
  inject,
  toValue,
  type ComputedRef,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Ref,
} from "vue"

import type { VariableReferenceOption } from "@/workspace/design/lib/variableReferences"

export const DESIGN_VARIABLE_REFERENCES_KEY: InjectionKey<
  Ref<readonly VariableReferenceOption[]> | ComputedRef<readonly VariableReferenceOption[]>
> = Symbol("design-variable-references")

export interface UseVariableReferenceOptionsArgs {
  /** Explicit options override (takes precedence over inject). */
  options?: MaybeRefOrGetter<readonly VariableReferenceOption[] | undefined>
}

export function useVariableReferenceOptions(
  args: UseVariableReferenceOptionsArgs = {},
) {
  const injected = inject(DESIGN_VARIABLE_REFERENCES_KEY, null)

  const variableReferenceOptions = computed<readonly VariableReferenceOption[]>(
    () => {
      const override = args.options !== undefined ? toValue(args.options) : undefined
      if (override !== undefined) {
        return override
      }
      return injected?.value ?? []
    },
  )

  const isLoadingVariableReferences = computed(() => false)

  async function loadVariableReferences(): Promise<void> {
    // Options come from DesignSurface provide / props override — nothing to load.
  }

  return {
    variableReferenceOptions,
    isLoadingVariableReferences,
    loadVariableReferences,
  }
}
