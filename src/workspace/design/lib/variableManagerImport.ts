import { z } from "zod"
import type {
  DesignCssVarCategory,
  DesignVariableAlias,
  DesignVariableDefinition,
  DesignVariables,
} from "../../../../shared/design"
import {
  createEmptyVariableSet,
  mergeImportedVariableSet,
} from "./variableManagerTable"
import {
  ensureUniqueVariableKey,
  normalizeCssVariableKey,
} from "./variableManagerTokens"

const CSS_VARIABLE_DECLARATION_PATTERN = /--([a-zA-Z0-9-_]+)\s*:\s*([^;]+);?/g
const CSS_VARIABLE_REFERENCE_PATTERN =
  /^var\(\s*--([a-zA-Z0-9-_]+)\s*(?:,\s*(.+))?\)$/i

const ImportedCssVariableSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string().trim().min(1),
})

export interface VariableImportParseSuccess {
  success: true
  data: DesignVariables
  summary: {
    customCount: number
    aliasCount: number
    totalCount: number
  }
}

export interface VariableImportParseFailure {
  success: false
  error: string
}

export type VariableImportParseResult =
  | VariableImportParseSuccess
  | VariableImportParseFailure

export const VariableImportModeSchema = z.enum(["merge", "replace"])

export type VariableImportMode = z.infer<typeof VariableImportModeSchema>

const CATEGORIES = [
  "color",
  "spacing",
  "typography",
  "borders",
  "effects",
  "layout",
  "other",
] as const

function startCase(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function inferVariableCategory(
  key: string,
  value: string,
): DesignCssVarCategory {
  const normalizedKey = key.toLowerCase()
  const normalizedValue = value.toLowerCase()

  if (
    /(color|bg|background|text|border|fill|stroke)/.test(normalizedKey) ||
    /^(#|rgb\(|rgba\(|hsl\(|hsla\(|oklch\(|oklab\(|color\()/.test(
      normalizedValue,
    )
  ) {
    return "color"
  }

  if (/(space|gap|padding|margin|inset)/.test(normalizedKey)) {
    return "spacing"
  }

  if (
    /(font|text|type|line-height|letter-spacing|leading)/.test(normalizedKey)
  ) {
    return "typography"
  }

  if (/(radius|border|outline|stroke-width)/.test(normalizedKey)) {
    return "borders"
  }

  if (/(shadow|blur|opacity|filter)/.test(normalizedKey)) {
    return "effects"
  }

  if (
    /(width|height|max|min|layout|container|section|grid|column)/.test(
      normalizedKey,
    )
  ) {
    return "layout"
  }

  return "other"
}

function buildFallbackLabel(key: string): string {
  return startCase(key) || key
}

function sanitizeCustomDefinition(
  key: string,
  definition: DesignVariableDefinition,
): DesignVariableDefinition {
  const category = CATEGORIES.includes(
    definition.category as (typeof CATEGORIES)[number],
  )
    ? definition.category
    : "other"

  return {
    label: definition.label.trim() || buildFallbackLabel(key),
    value: typeof definition.value === "string" ? definition.value : "",
    category,
    source: "aria",
    description:
      typeof definition.description === "string" ? definition.description : "",
  }
}

function normalizeAliasSourceKey(
  sourceType: DesignVariableAlias["sourceType"],
  sourceKey: string,
): string {
  const trimmedSourceKey = sourceKey.trim()
  if (!trimmedSourceKey) {
    return ""
  }

  if (sourceType === "token") {
    return trimmedSourceKey
  }

  return normalizeCssVariableKey(trimmedSourceKey)
}

function sanitizeAliasDefinition(
  key: string,
  alias: DesignVariableAlias,
): DesignVariableAlias | null {
  const sourceType = alias.sourceType === "token" ? "token" : "custom"
  const sourceKey =
    typeof alias.sourceKey === "string"
      ? normalizeAliasSourceKey(sourceType, alias.sourceKey)
      : ""

  if (!sourceKey) {
    return null
  }

  return {
    label: alias.label.trim() || buildFallbackLabel(key),
    sourceType,
    sourceKey,
    fallback: typeof alias.fallback === "string" ? alias.fallback : "",
  }
}

function sanitizeVariableSet(variables: DesignVariables): DesignVariables {
  const nextVariables: DesignVariables = {
    custom: {},
    aliases: {},
  }

  for (const [key, definition] of Object.entries(variables.custom)) {
    nextVariables.custom[key] = sanitizeCustomDefinition(key, definition)
  }

  for (const [key, alias] of Object.entries(variables.aliases)) {
    const sanitizedAlias = sanitizeAliasDefinition(key, alias)
    if (!sanitizedAlias) {
      continue
    }

    nextVariables.aliases[key] = sanitizedAlias
  }

  return nextVariables
}

function parseImportedCssVariables(
  input: string,
): Array<{ key: string; value: string }> {
  const matches: Array<{ key: string; value: string }> = []

  for (const match of input.matchAll(CSS_VARIABLE_DECLARATION_PATTERN)) {
    const parsedMatch = ImportedCssVariableSchema.safeParse({
      key: normalizeCssVariableKey(match[1] ?? ""),
      value: match[2]?.trim() ?? "",
    })

    if (!parsedMatch.success) {
      continue
    }

    matches.push(parsedMatch.data)
  }

  return matches
}

function buildVariableImportSummary(
  variables: DesignVariables,
): VariableImportParseSuccess["summary"] {
  const customCount = Object.keys(variables.custom).length
  const aliasCount = Object.keys(variables.aliases).length

  return {
    customCount,
    aliasCount,
    totalCount: customCount + aliasCount,
  }
}

export function parseVariableImportInput(
  input: string,
): VariableImportParseResult {
  const matches = parseImportedCssVariables(input)

  if (matches.length === 0) {
    return {
      success: false,
      error:
        "No CSS custom properties found. Paste declarations like --brand-primary: #2d49b7;",
    }
  }

  const custom: Record<string, DesignVariableDefinition> = {}
  const aliases: Record<string, DesignVariableAlias> = {}

  for (const match of matches) {
    const referenceMatch = match.value.match(CSS_VARIABLE_REFERENCE_PATTERN)

    if (referenceMatch) {
      aliases[match.key] = {
        label: startCase(match.key),
        sourceType: "custom",
        sourceKey: normalizeCssVariableKey(referenceMatch[1] ?? ""),
        fallback: referenceMatch[2]?.trim() ?? "",
      }
      continue
    }

    custom[match.key] = {
      label: startCase(match.key),
      value: match.value,
      category: inferVariableCategory(match.key, match.value),
      source: "aria",
      description: "",
    }
  }

  const data = sanitizeVariableSet({ custom, aliases })

  return {
    success: true,
    data,
    summary: buildVariableImportSummary(data),
  }
}

export {
  createEmptyVariableSet,
  ensureUniqueVariableKey,
  mergeImportedVariableSet,
}
