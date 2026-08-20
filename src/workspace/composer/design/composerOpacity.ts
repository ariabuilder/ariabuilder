import {
  extractVariableReferenceKey,
  type VariableReferenceOption,
} from "@/workspace/design/lib/variableReferences"

export type ComposerOpacityError = "invalid" | "incompatible-variable"

export type ComposerOpacityValue = {
  cssValue: string
  percentage: number | null
  variableKey: string | null
}

export type ComposerOpacityParseResult =
  | { ok: true; value: ComposerOpacityValue }
  | { ok: false; error: ComposerOpacityError }

export type ComposerStyleCommitResult =
  | { ok: true }
  | { ok: false; error: string }

const DECIMAL_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)$/

export function parseComposerOpacityValue(
  rawValue: string,
  variableOptions: readonly VariableReferenceOption[],
): ComposerOpacityParseResult {
  const trimmed = rawValue.trim()
  if (!trimmed) return { ok: false, error: "invalid" }

  const variableKey = extractVariableReferenceKey(trimmed)
  if (variableKey !== null) {
    if (!variableOptions.some((option) => option.value === variableKey)) {
      return { ok: false, error: "incompatible-variable" }
    }
    return {
      ok: true,
      value: { cssValue: trimmed, percentage: null, variableKey },
    }
  }

  const isPercentage = trimmed.endsWith("%")
  const numericText = isPercentage ? trimmed.slice(0, -1).trim() : trimmed
  if (!DECIMAL_PATTERN.test(numericText)) {
    return { ok: false, error: "invalid" }
  }

  const numeric = Number(numericText)
  if (!Number.isFinite(numeric)) return { ok: false, error: "invalid" }
  if (isPercentage ? numeric < 0 || numeric > 100 : numeric < 0 || numeric > 1) {
    return { ok: false, error: "invalid" }
  }

  const percentage = Math.min(
    100,
    Math.max(0, Math.round(isPercentage ? numeric : numeric * 100)),
  )
  return {
    ok: true,
    value: {
      cssValue: String(percentage / 100),
      percentage,
      variableKey: null,
    },
  }
}

export function composerOpacityPercentage(rawValue: string): number {
  const trimmed = rawValue.trim()
  if (extractVariableReferenceKey(trimmed) !== null) return 100
  const isPercentage = trimmed.endsWith("%")
  const numeric = Number(isPercentage ? trimmed.slice(0, -1).trim() : trimmed)
  if (!Number.isFinite(numeric)) return 100
  return Math.min(
    100,
    Math.max(0, Math.round(isPercentage ? numeric : numeric * 100)),
  )
}
