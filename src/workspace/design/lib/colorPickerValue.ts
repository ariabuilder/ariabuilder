import { colord } from "colord"
import { z } from "zod"

import type {
  DesignSemanticColors,
  DesignVariables,
} from "../../../../shared/design"
import { toSerializedHex } from "./colorFormat"
import { resolvePaletteColorFromVariableKey } from "./designSystemColorVariables"
import type { VariableManagerPaletteLike } from "./variableManagerTokens"

const CSS_VARIABLE_REFERENCE_PATTERN =
  /^var\(--([a-zA-Z0-9-_]+)(?:\s*,\s*[^)]+)?\)$/

const ColorPickerTokenPreviewOptionSchema = z
  .object({
    value: z.string().trim().min(1),
    preview: z.string().trim().min(1),
  })
  .passthrough()

const ColorPickerTokenPreviewOptionListSchema = z.array(
  ColorPickerTokenPreviewOptionSchema,
)

type ColorPickerTokenPreviewOption = z.infer<
  typeof ColorPickerTokenPreviewOptionSchema
>

export function extractCssVariableReferenceKey(
  rawValue: string,
): string | null {
  const matched = rawValue.trim().match(CSS_VARIABLE_REFERENCE_PATTERN)
  return matched?.[1] ?? null
}

const BARE_VARIABLE_KEY_PATTERN = /^[a-z][a-z0-9-]*$/i

export function createVariableReferenceFromKey(variableKey: string): string {
  const normalized = variableKey
    .trim()
    .replace(/^--+/, "")
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")

  return normalized ? `var(--${normalized})` : ""
}

/**
 * Normalizes RAW tab input into a stored color value (variable reference or hex).
 */
export function normalizeRawColorInput(
  value: string,
  options: { showAlpha?: boolean } = {},
): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (extractCssVariableReferenceKey(trimmed) !== null) {
    return trimmed
  }

  if (trimmed.startsWith("--")) {
    const reference = createVariableReferenceFromKey(trimmed)
    return reference || null
  }

  if (
    BARE_VARIABLE_KEY_PATTERN.test(trimmed) &&
    !trimmed.startsWith("#") &&
    !colord(trimmed).isValid()
  ) {
    const reference = createVariableReferenceFromKey(trimmed)
    return reference || null
  }

  const parsed = colord(trimmed)
  if (!parsed.isValid()) {
    return null
  }

  return toSerializedHex(parsed, options.showAlpha ?? false)
}

function buildTokenPreviewMap(
  tokenOptions: readonly ColorPickerTokenPreviewOption[],
): Map<string, string> {
  const parsedOptions =
    ColorPickerTokenPreviewOptionListSchema.safeParse(tokenOptions)

  if (!parsedOptions.success) {
    return new Map<string, string>()
  }

  return new Map(
    parsedOptions.data.map((option) => [option.value, option.preview]),
  )
}

function resolveVariableColorValue(
  variableKey: string,
  variables: DesignVariables,
  tokenPreviewMap: Map<string, string>,
  visitedKeys: Set<string>,
): string | null {
  if (!variableKey || visitedKeys.has(variableKey)) {
    return null
  }

  visitedKeys.add(variableKey)

  const customVariable = variables.custom[variableKey]
  if (customVariable) {
    const nestedReferenceKey = extractCssVariableReferenceKey(
      customVariable.value,
    )

    if (nestedReferenceKey) {
      return resolveVariableColorValue(
        nestedReferenceKey,
        variables,
        tokenPreviewMap,
        visitedKeys,
      )
    }

    return customVariable.value.trim() || null
  }

  const alias = variables.aliases[variableKey]
  if (!alias) {
    return null
  }

  if (alias.sourceType === "token") {
    return (
      tokenPreviewMap.get(alias.sourceKey) ?? alias.fallback?.trim() ?? null
    )
  }

  if (alias.sourceKey.trim().length > 0) {
    const resolvedSource = resolveVariableColorValue(
      alias.sourceKey,
      variables,
      tokenPreviewMap,
      visitedKeys,
    )

    if (resolvedSource) {
      return resolvedSource
    }
  }

  return alias.fallback?.trim() || null
}

export interface ColorPickerPreviewContext {
  palettes?: readonly VariableManagerPaletteLike[]
  semanticColors?: DesignSemanticColors
}

export function resolveColorPickerPreviewValue(
  rawValue: string,
  variables: DesignVariables,
  tokenOptions: readonly ColorPickerTokenPreviewOption[],
  context: ColorPickerPreviewContext = {},
): string | null {
  const trimmedValue = rawValue.trim()
  if (!trimmedValue) {
    return null
  }

  const referenceKey = extractCssVariableReferenceKey(trimmedValue)
  if (!referenceKey) {
    return trimmedValue
  }

  if (context.palettes && context.semanticColors) {
    const fromDesignSystem = resolvePaletteColorFromVariableKey(
      referenceKey,
      context.palettes,
      context.semanticColors,
    )
    if (fromDesignSystem) {
      return fromDesignSystem
    }
  }

  const tokenPreviewMap = buildTokenPreviewMap(tokenOptions)

  const fromVariables = resolveVariableColorValue(
    referenceKey,
    variables,
    tokenPreviewMap,
    new Set<string>(),
  )

  if (fromVariables) {
    return fromVariables
  }

  const paletteTokenKey = `tokens.colors.palette.${referenceKey}`
  const palettePreview = tokenPreviewMap.get(paletteTokenKey)
  if (palettePreview) {
    return palettePreview
  }

  const alias = variables.aliases[referenceKey]
  if (alias?.sourceType === "token") {
    return (
      tokenPreviewMap.get(alias.sourceKey) ?? alias.fallback?.trim() ?? null
    )
  }

  if (alias) {
    return alias.fallback?.trim() || null
  }

  return null
}
