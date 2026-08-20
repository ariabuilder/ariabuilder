import type {
  DesignCssVarCategory,
  DesignVariables,
} from "../../../../shared/design"

/**
 * Variable reference option for pickers / CSS completions.
 * CssEditor and completions only require `value` (+ optional `meta`);
 * pickers prefer `label` / `group` when present.
 */
export type VariableReferenceOption = {
  value: string
  label?: string
  meta?: string
  group?: string
  /** Resolved literal used when detaching a reference without a prior direct value. */
  directValue?: string
}

export const VARIABLE_REFERENCE_PATTERN =
  /^var\(--([a-zA-Z0-9-_]+)(?:\s*,\s*[^)]+)?\)$/

function startCase(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

export function extractVariableReferenceKey(rawValue: string): string | null {
  const matched = rawValue.trim().match(VARIABLE_REFERENCE_PATTERN)
  return matched?.[1] ?? null
}

export function createVariableReferenceValue(variableKey: string): string {
  const normalized = variableKey.trim().replace(/^--+/, "")
  return normalized ? `var(--${normalized})` : ""
}

export function resolveVariableReferenceDirectValue(
  key: string,
  variables: DesignVariables,
  visited: Set<string> = new Set(),
): string {
  const normalizedKey = key.trim()
  if (!normalizedKey || visited.has(normalizedKey)) return ""
  visited.add(normalizedKey)

  const custom = variables.custom[normalizedKey]
  if (custom) return custom.value.trim()

  const alias = variables.aliases[normalizedKey]
  if (!alias) return ""
  if (alias.sourceType === "custom") {
    return resolveVariableReferenceDirectValue(alias.sourceKey, variables, visited)
      || alias.fallback?.trim()
      || ""
  }
  return alias.fallback?.trim() || ""
}

export function resolveVariableDefinitionCategory(
  key: string,
  variables: DesignVariables,
  visited: Set<string> = new Set(),
): DesignCssVarCategory | null {
  const normalizedKey = key.trim()
  if (!normalizedKey || visited.has(normalizedKey)) {
    return null
  }

  visited.add(normalizedKey)

  const customDefinition = variables.custom[normalizedKey]
  if (customDefinition) {
    return customDefinition.category
  }

  const alias = variables.aliases[normalizedKey]
  if (!alias || alias.sourceType !== "custom") {
    return null
  }

  return resolveVariableDefinitionCategory(alias.sourceKey, variables, visited)
}

export function isOpacityCompatibleVariableKey(
  key: string,
  variables: DesignVariables,
): boolean {
  return resolveVariableDefinitionCategory(key, variables) === "effects"
}

export function buildVariableReferenceOptions(
  variables: DesignVariables,
): VariableReferenceOption[] {
  const customOptions = Object.entries(variables.custom).map(
    ([key, variable]) => ({
      value: key,
      label: variable.label.trim() || `--${key}`,
      meta: `${startCase(variable.category)} · --${key}`,
      group: "Custom Variables",
      directValue: variable.value.trim(),
    }),
  )

  const aliasOptions = Object.entries(variables.aliases).map(([key, alias]) => ({
    value: key,
    label: alias.label.trim() || `--${key}`,
    meta: `Alias · --${key}`,
    group: "Aliases",
    directValue: resolveVariableReferenceDirectValue(key, variables),
  }))

  return [...customOptions, ...aliasOptions].sort((left, right) =>
    (left.label ?? left.value).localeCompare(right.label ?? right.value),
  )
}

export function buildOpacityVariableReferenceOptions(
  variables: DesignVariables,
): VariableReferenceOption[] {
  return buildVariableReferenceOptions(variables).filter((option) =>
    isOpacityCompatibleVariableKey(option.value, variables),
  )
}
