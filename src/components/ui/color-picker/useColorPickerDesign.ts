import { computed, ref, watch } from "vue"

import {
  designSwatchAssignmentLabel,
  resolveDesignColorAssignmentValue,
} from "@/workspace/design/lib/designSystemColorVariables"
import {
  paletteTokenSourceKey,
  semanticTokenSourceKey,
  type VariableManagerPaletteLike,
} from "@/workspace/design/lib/variableManagerTokens"
import { useDesignColorPickerContext } from "@/workspace/design/composables/useDesignColorPickerContext"
import type {
  ColorShadeKey,
  DesignColorPalette,
  DesignSemanticColors,
} from "../../../../shared/design"
import { COLOR_SHADE_KEYS } from "../../../../shared/design"

export type SemanticColorKey = keyof DesignSemanticColors

export type ActiveDesignSwatch =
  | { kind: "palette"; name: string }
  | { kind: "semantic"; key: SemanticColorKey }

export type ColorPickerPaletteShades = DesignColorPalette["shades"]

export type ActiveShadeSource =
  | {
      id: string
      label: string
      shades: ColorPickerPaletteShades
      kind: "palette"
    }
  | {
      id: SemanticColorKey
      label: string
      shades: ColorPickerPaletteShades
      kind: "semantic"
    }

export type DesignColorSelectOptions = {
  tokenSourceKey: string
  fallbackColor: string
  paletteName?: string
  shade?: string
  semanticKey?: SemanticColorKey
}

function startCase(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function toPaletteLike(
  palette: DesignColorPalette,
): VariableManagerPaletteLike {
  return {
    name: palette.name,
    label: startCase(palette.name),
    shades: palette.shades,
  }
}

export function useColorPickerDesign(enabled: () => boolean) {
  const {
    palettes,
    semanticColors,
    variables,
    isLoading: isDesignSystemLoading,
  } = useDesignColorPickerContext()

  const activeDesignSwatch = ref<ActiveDesignSwatch | null>(null)

  const designPalettes = computed(() => {
    if (!enabled()) {
      return []
    }

    return palettes.value.map((palette) => {
      const label = startCase(palette.name)
      return {
        name: palette.name,
        label,
        shades: palette.shades,
        baseColor:
          palette.shades.DEFAULT?.trim() ||
          palette.shades["500"]?.trim() ||
          "#000000",
      }
    })
  })

  const semanticColorOptions = computed(() => {
    if (!enabled()) {
      return []
    }

    const keys: SemanticColorKey[] = ["success", "warning", "error", "info"]
    const options: Array<{
      key: SemanticColorKey
      label: string
      color: string
      shades: ColorPickerPaletteShades
    }> = []

    for (const key of keys) {
      const color = semanticColors.value[key]?.trim()
      if (!color) continue
      // No shade generation — only the base semantic color from the snapshot.
      options.push({
        key,
        label: startCase(key),
        color,
        shades: { DEFAULT: color },
      })
    }

    return options
  })

  const activeShadeSource = computed((): ActiveShadeSource | null => {
    const active = activeDesignSwatch.value
    if (!active) {
      return null
    }

    if (active.kind === "palette") {
      const palette = designPalettes.value.find(
        (entry) => entry.name === active.name,
      )
      if (!palette) {
        return null
      }

      return {
        id: palette.name,
        label: palette.label,
        shades: palette.shades,
        kind: "palette" as const,
      }
    }

    const option = semanticColorOptions.value.find(
      (entry) => entry.key === active.key,
    )
    if (!option) {
      return null
    }

    return {
      id: option.key,
      label: option.label,
      shades: option.shades,
      kind: "semantic" as const,
    }
  })

  function syncActiveDesignSwatch(): void {
    const nextPalettes = designPalettes.value
    const nextSemanticOptions = semanticColorOptions.value

    if (nextPalettes.length === 0 && nextSemanticOptions.length === 0) {
      activeDesignSwatch.value = null
      return
    }

    const active = activeDesignSwatch.value
    if (
      active?.kind === "palette" &&
      nextPalettes.some((palette) => palette.name === active.name)
    ) {
      return
    }

    if (
      active?.kind === "semantic" &&
      nextSemanticOptions.some((option) => option.key === active.key)
    ) {
      return
    }

    const firstPalette = nextPalettes[0]
    if (firstPalette) {
      activeDesignSwatch.value = { kind: "palette", name: firstPalette.name }
      return
    }

    const firstSemantic = nextSemanticOptions[0]
    if (firstSemantic) {
      activeDesignSwatch.value = { kind: "semantic", key: firstSemantic.key }
    }
  }

  watch([designPalettes, semanticColorOptions], syncActiveDesignSwatch, {
    immediate: true,
  })

  function setActiveDesignSwatch(swatch: ActiveDesignSwatch): void {
    activeDesignSwatch.value = swatch
  }

  function isActivePaletteSwatch(name: string): boolean {
    const active = activeDesignSwatch.value
    return active?.kind === "palette" && active.name === name
  }

  function isActiveSemanticSwatch(key: SemanticColorKey): boolean {
    const active = activeDesignSwatch.value
    return active?.kind === "semantic" && active.key === key
  }

  function previewDesignColorAssignment(
    options: DesignColorSelectOptions,
  ): string {
    return resolveDesignColorAssignmentValue({
      variables: variables.value,
      palettes: palettes.value.map(toPaletteLike),
      semanticColors: semanticColors.value,
      tokenSourceKey: options.tokenSourceKey,
      paletteName: options.paletteName,
      shade: options.shade,
      semanticKey: options.semanticKey,
      fallbackColor: options.fallbackColor,
    })
  }

  function designSwatchTitle(options: DesignColorSelectOptions): string {
    return designSwatchAssignmentLabel(
      previewDesignColorAssignment(options),
      options.fallbackColor,
    )
  }

  /** Available shade keys that have values on the active source. */
  function availableShadeKeys(
    shades: ColorPickerPaletteShades,
  ): ColorShadeKey[] {
    return COLOR_SHADE_KEYS.filter((key) => Boolean(shades[key]?.trim()))
  }

  return {
    COLOR_SHADE_KEYS,
    availableShadeKeys,
    palettes,
    semanticColors,
    variables,
    isDesignSystemLoading,
    designPalettes,
    semanticColorOptions,
    activeDesignSwatch,
    activeShadeSource,
    setActiveDesignSwatch,
    isActivePaletteSwatch,
    isActiveSemanticSwatch,
    previewDesignColorAssignment,
    designSwatchTitle,
    paletteTokenSourceKey,
    semanticTokenSourceKey,
  }
}
