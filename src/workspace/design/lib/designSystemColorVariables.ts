import type {
  ColorShadeKey,
  DesignSemanticColors,
  DesignVariables,
} from "../../../../shared/design"
import { COLOR_SHADE_KEYS, SEMANTIC_CSS_VAR } from "../../../../shared/design"
import {
  findExistingTokenExposure,
  type VariableManagerPaletteLike,
} from "./variableManagerTokens"

const COLOR_SHADE_SET = new Set<string>(COLOR_SHADE_KEYS)

const SEMANTIC_KEY_BY_CSS_VAR = Object.fromEntries(
  Object.entries(SEMANTIC_CSS_VAR).map(([key, cssVar]) => [
    cssVar,
    key as keyof DesignSemanticColors,
  ]),
) as Record<string, keyof DesignSemanticColors>

export function paletteCssVariableKey(
  paletteName: string,
  shade?: string,
): string {
  if (shade === undefined || shade === "DEFAULT") {
    return paletteName
  }
  return `${paletteName}-${shade}`
}

export function createPaletteVariableReference(
  paletteName: string,
  shade?: string,
): string {
  return `var(--${paletteCssVariableKey(paletteName, shade)})`
}

export function createSemanticVariableReference(
  semanticKey: keyof DesignSemanticColors | string,
  shade?: string,
): string {
  const cssKey =
    SEMANTIC_CSS_VAR[semanticKey as keyof DesignSemanticColors] ??
    String(semanticKey)

  if (shade === undefined || shade === "DEFAULT") {
    return `var(--${cssKey})`
  }

  return `var(--${cssKey}-${shade})`
}

function getPaletteShadeHex(
  shades: VariableManagerPaletteLike["shades"],
  shade?: string,
): string | null {
  if (shade === undefined || shade === "DEFAULT") {
    const base = shades.DEFAULT?.trim() || shades["500"]?.trim()
    return base || null
  }

  const shadeValue = shades[shade as ColorShadeKey]
  return typeof shadeValue === "string" && shadeValue.trim().length > 0
    ? shadeValue.trim()
    : null
}

function parsePaletteVariableKey(
  variableKey: string,
): { paletteName: string; shade?: string } | null {
  const legacyMatch = variableKey.match(/^color-([a-z0-9-]+?)(?:-(\d+))?$/)
  const key = legacyMatch ? legacyMatch[1] : variableKey
  const shadePart = legacyMatch ? legacyMatch[2] : undefined

  if (!key) {
    return null
  }

  const shadeMatch = key.match(/^([a-z0-9-]+)-(\d+)$/)
  if (shadeMatch && COLOR_SHADE_SET.has(shadeMatch[2])) {
    return { paletteName: shadeMatch[1], shade: shadeMatch[2] }
  }

  if (shadePart && COLOR_SHADE_SET.has(shadePart)) {
    return { paletteName: key, shade: shadePart }
  }

  return { paletteName: key }
}

function parseSemanticVariableKey(
  variableKey: string,
): { semanticKey: keyof DesignSemanticColors; shade?: string } | null {
  if (variableKey in SEMANTIC_KEY_BY_CSS_VAR) {
    return { semanticKey: SEMANTIC_KEY_BY_CSS_VAR[variableKey] }
  }

  for (const [cssVar, semanticKey] of Object.entries(SEMANTIC_KEY_BY_CSS_VAR)) {
    const prefix = `${cssVar}-`
    if (!variableKey.startsWith(prefix)) continue
    const shade = variableKey.slice(prefix.length)
    if (COLOR_SHADE_SET.has(shade)) {
      return { semanticKey, shade }
    }
  }

  for (const semanticKey of Object.keys(SEMANTIC_CSS_VAR) as Array<
    keyof DesignSemanticColors
  >) {
    const prefix = `${semanticKey}-`
    if (!variableKey.startsWith(prefix)) continue
    const shade = variableKey.slice(prefix.length)
    if (COLOR_SHADE_SET.has(shade)) {
      return { semanticKey, shade }
    }
  }

  return null
}

/**
 * Resolve a CSS variable key (without `var(--…)`) to a literal color from
 * snapshot palettes / semantic colors. Does not generate missing shades.
 */
export function resolvePaletteColorFromVariableKey(
  variableKey: string,
  palettes: readonly VariableManagerPaletteLike[],
  semanticColors: DesignSemanticColors,
): string | null {
  const semanticParsed = parseSemanticVariableKey(variableKey)
  if (semanticParsed) {
    const baseColor = semanticColors[semanticParsed.semanticKey]?.trim()
    if (!baseColor) return null
    // No shade generation — only the base semantic value is available.
    if (semanticParsed.shade !== undefined) {
      return null
    }
    return baseColor
  }

  const paletteParsed = parsePaletteVariableKey(variableKey)
  if (!paletteParsed) return null

  const palette = palettes.find(
    (entry) => entry.name === paletteParsed.paletteName,
  )
  if (!palette) return null

  return getPaletteShadeHex(palette.shades, paletteParsed.shade)
}

export interface ResolveDesignColorAssignmentOptions {
  variables: DesignVariables
  palettes: readonly VariableManagerPaletteLike[]
  semanticColors: DesignSemanticColors
  tokenSourceKey: string
  paletteName?: string
  shade?: string
  semanticKey?: keyof DesignSemanticColors | string
  fallbackColor: string
}

/**
 * Prefer an existing token alias exposure; otherwise emit `var(--token)`
 * or fall back to the literal shade color.
 */
export function resolveDesignColorAssignmentValue(
  options: ResolveDesignColorAssignmentOptions,
): string {
  const aliasKey = findExistingTokenExposure(
    options.variables,
    options.tokenSourceKey,
  )
  if (aliasKey) {
    return `var(--${aliasKey})`
  }

  if (options.paletteName) {
    return createPaletteVariableReference(options.paletteName, options.shade)
  }

  if (options.semanticKey) {
    return createSemanticVariableReference(options.semanticKey, options.shade)
  }

  return options.fallbackColor.trim()
}

export function designSwatchAssignmentLabel(
  assignmentValue: string,
  fallbackHex: string,
): string {
  if (assignmentValue.startsWith("var(--")) {
    return `${assignmentValue} · ${fallbackHex}`
  }

  return fallbackHex
}
