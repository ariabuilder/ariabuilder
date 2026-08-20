import { parseStyleAttr } from "../../../../shared/composer/styleAttr"
import { preserveClassApplyDirectives } from "../../../../shared/composer/cssRuleAst"

export const BORDER_STYLE_OPTIONS = [
  "none",
  "hidden",
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
] as const

export type ComposerBorderStyle = (typeof BORDER_STYLE_OPTIONS)[number]

export const BORDER_WIDTH_UNITS = ["px", "rem", "em", "vw", "vh"] as const
export type ComposerBorderWidthUnit = (typeof BORDER_WIDTH_UNITS)[number]

export const BORDER_RADIUS_CORNER_PROPERTIES = [
  "border-start-start-radius",
  "border-start-end-radius",
  "border-end-start-radius",
  "border-end-end-radius",
] as const

export const BORDER_RADIUS_PHYSICAL_PROPERTIES = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
] as const

export const BORDER_RADIUS_PROPERTIES = [
  "border-radius",
  ...BORDER_RADIUS_CORNER_PROPERTIES,
  ...BORDER_RADIUS_PHYSICAL_PROPERTIES,
] as const

export const BORDER_SECTION_PROPERTIES = [
  "border",
  "border-color",
  "border-width",
  "border-style",
  "border-image",
  ...BORDER_RADIUS_PROPERTIES,
] as const

export type BorderRadiusCorner =
  | "border-start-start-radius"
  | "border-start-end-radius"
  | "border-end-start-radius"
  | "border-end-end-radius"

export type BorderControlValues = Partial<Record<(typeof BORDER_SECTION_PROPERTIES)[number], string>>

export type ResolvedBorderValues = {
  color: string
  width: string
  style: ComposerBorderStyle
}

export type ResolvedBorderCorners = Record<BorderRadiusCorner, string>
export type BorderUpdateOverrides = Partial<{
  color: string
  width: string
  style: ComposerBorderStyle
}>

function splitTopLevelWhitespace(value: string): string[] {
  const parts: string[] = []
  let current = ""
  let depth = 0
  let quote = ""
  for (const character of value.trim()) {
    if (quote) {
      current += character
      if (character === quote) quote = ""
      continue
    }
    if (character === "\"" || character === "'") {
      quote = character
      current += character
      continue
    }
    if (character === "(") depth += 1
    else if (character === ")") depth = Math.max(0, depth - 1)
    if (/\s/.test(character) && depth === 0) {
      if (current) parts.push(current)
      current = ""
    } else {
      current += character
    }
  }
  if (current) parts.push(current)
  return parts
}

function splitRadiusAxes(value: string): [string, string | null] {
  let depth = 0
  let quote = ""
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (quote) {
      if (character === quote) quote = ""
      continue
    }
    if (character === "\"" || character === "'") {
      quote = character
      continue
    }
    if (character === "(") depth += 1
    else if (character === ")") depth = Math.max(0, depth - 1)
    else if (character === "/" && depth === 0) {
      return [value.slice(0, index).trim(), value.slice(index + 1).trim()]
    }
  }
  return [value.trim(), null]
}

function expandFourValues(values: readonly string[], fallback = "0"): [string, string, string, string] {
  const first = values[0] ?? fallback
  const second = values[1] ?? first
  const third = values[2] ?? first
  const fourth = values[3] ?? second
  if (values.length === 2) return [first, second, first, second]
  if (values.length === 3) return [first, second, third, second]
  return [first, second, third, fourth]
}

function parseBorderShorthand(value: string): Partial<ResolvedBorderValues> {
  const tokens = splitTopLevelWhitespace(value)
  const style = tokens.find((token) => BORDER_STYLE_OPTIONS.includes(token.toLowerCase() as ComposerBorderStyle))
  const width = tokens.find((token) => /^(?:0|thin|medium|thick|-?(?:\d+\.?\d*|\.\d+)[a-z%]*)$/i.test(token))
  const color = tokens.filter((token) => token !== style && token !== width).join(" ")
  return {
    ...(width ? { width } : {}),
    ...(style ? { style: style.toLowerCase() as ComposerBorderStyle } : {}),
    ...(color ? { color } : {}),
  }
}

const BORDER_STYLE_UTILITY =
  /^(?:(?:[^:\s]+):)*border-(?:(?:[trblsexy]|ss|se|es|ee)-)?(?:none|hidden|solid|dashed|dotted|double)$/
const ROUNDED_UTILITY =
  /^(?:(?:[^:\s]+):)*rounded(?:-.+)?$/

export function isBorderStyleUtility(token: string): boolean {
  return BORDER_STYLE_UTILITY.test(token)
}

export function isRoundedUtility(token: string): boolean {
  return ROUNDED_UTILITY.test(token)
}

export function borderStyleFromClassToken(token: string): ComposerBorderStyle | undefined {
  if (!isBorderStyleUtility(token)) return undefined
  const base = token.split(":").pop() ?? token
  const match = /^border-(?:(?:[trblsexy]|ss|se|es|ee)-)?(none|hidden|solid|dashed|dotted|double)$/.exec(base)
  const style = match?.[1]
  return style && BORDER_STYLE_OPTIONS.includes(style as ComposerBorderStyle)
    ? style as ComposerBorderStyle
    : undefined
}

export function resolveBorderStyleFromClasses(tokens: readonly string[]): ComposerBorderStyle | undefined {
  let style: ComposerBorderStyle | undefined
  for (const token of tokens) {
    const next = borderStyleFromClassToken(token)
    if (next) style = next
  }
  return style
}

export function conflictingBorderPresentationUtilities(css: string): (token: string) => boolean {
  const styles = parseStyleAttr(css)
  const stripStyle = Boolean(styles.border?.trim() || styles["border-style"]?.trim())
  const stripRadius = BORDER_RADIUS_PROPERTIES.some((property) => styles[property]?.trim())
  return (token) =>
    (stripStyle && isBorderStyleUtility(token))
    || (stripRadius && isRoundedUtility(token))
}

/** Keep `@apply` while dropping tokens the Border inspector now owns. */
export function retainCompatibleBorderApplyDirectives(current: string, next: string): string {
  const preserved = preserveClassApplyDirectives(current, next)
  const shouldRemove = conflictingBorderPresentationUtilities(next)
  return preserved.replace(/@apply\s+[^;{}]+;/g, (directive) => {
    const tokens = directive
      .replace(/^@apply\s+/i, "")
      .replace(/;$/, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    const kept = tokens.filter((token) => !shouldRemove(token))
    if (kept.length === tokens.length) return directive
    return kept.length ? `@apply ${kept.join(" ")};` : ""
  }).replace(/\n{3,}/g, "\n\n")
}

export function resolveBorderValues(values: BorderControlValues): ResolvedBorderValues {
  const shorthand = parseBorderShorthand(values.border?.trim() ?? "")
  const authoredStyle = values["border-style"]?.trim().toLowerCase()
  return {
    color: values["border-color"]?.trim() || shorthand.color || "transparent",
    width: values["border-width"]?.trim() || shorthand.width || "1px",
    style: BORDER_STYLE_OPTIONS.includes(authoredStyle as ComposerBorderStyle)
      ? authoredStyle as ComposerBorderStyle
      : shorthand.style ?? "solid",
  }
}

export function buildMaterializedBorderUpdates(
  values: BorderControlValues,
  overrides: BorderUpdateOverrides = {},
): Record<string, string> {
  const resolved = resolveBorderValues(values)
  return {
    border: "",
    "border-image": "none",
    "border-color": overrides.color?.trim() || resolved.color || "transparent",
    "border-width": overrides.width?.trim() || resolved.width || "1px",
    "border-style": overrides.style ?? resolved.style ?? "solid",
  }
}

export function parseBorderWidthInput(value: string): {
  value: string
  unit: ComposerBorderWidthUnit
} {
  const trimmed = value.trim()
  const match = trimmed.match(/^(-?(?:\d+\.?\d*|\.\d+))([a-zA-Z%]+)?$/)
  if (!match) return { value: trimmed || "0", unit: "px" }
  const unit = match[2]?.toLowerCase()
  return {
    value: match[1] ?? "0",
    unit: BORDER_WIDTH_UNITS.includes(unit as ComposerBorderWidthUnit)
      ? unit as ComposerBorderWidthUnit
      : "px",
  }
}

export function buildBorderWidthValue(value: string, unit: ComposerBorderWidthUnit): string {
  const trimmed = value.trim()
  if (!trimmed) return `0${unit}`
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed) ? `${trimmed}${unit}` : trimmed
}

export function normalizeBorderRadius(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "0px"
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return `${Number(trimmed)}px`
  return trimmed
}

export function formatBorderRadiusInput(value: string): string {
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))px$/i)
  return match ? String(Number(match[1])) : value.trim()
}

export function resolveBorderCorners(values: BorderControlValues): ResolvedBorderCorners {
  const [horizontalSource, verticalSource] = splitRadiusAxes(values["border-radius"]?.trim() || "0")
  const horizontal = expandFourValues(splitTopLevelWhitespace(horizontalSource))
  const vertical = verticalSource
    ? expandFourValues(splitTopLevelWhitespace(verticalSource))
    : horizontal
  const physical = horizontal.map((value, index) => value === vertical[index]
    ? value
    : `${value} ${vertical[index]}`) as [string, string, string, string]
  return {
    "border-start-start-radius": values["border-top-left-radius"]?.trim() || values["border-start-start-radius"]?.trim() || physical[0],
    "border-start-end-radius": values["border-top-right-radius"]?.trim() || values["border-start-end-radius"]?.trim() || physical[1],
    "border-end-end-radius": values["border-bottom-right-radius"]?.trim() || values["border-end-end-radius"]?.trim() || physical[2],
    "border-end-start-radius": values["border-bottom-left-radius"]?.trim() || values["border-end-start-radius"]?.trim() || physical[3],
  }
}

export function buildLinkedRadiusUpdates(value: string): Record<string, string> {
  return {
    "border-radius": normalizeBorderRadius(value),
    "border-start-start-radius": "",
    "border-start-end-radius": "",
    "border-end-start-radius": "",
    "border-end-end-radius": "",
    "border-top-left-radius": "",
    "border-top-right-radius": "",
    "border-bottom-right-radius": "",
    "border-bottom-left-radius": "",
  }
}

export function buildUnlinkedRadiusUpdates(
  corners: ResolvedBorderCorners,
  property: BorderRadiusCorner,
  value: string,
): Record<string, string> {
  return {
    "border-radius": "",
    ...Object.fromEntries(BORDER_RADIUS_PHYSICAL_PROPERTIES.map((property) => [property, ""])),
    ...Object.fromEntries(BORDER_RADIUS_CORNER_PROPERTIES.map((corner) => [
      corner,
      corner === property ? normalizeBorderRadius(value) : normalizeBorderRadius(corners[corner]),
    ])),
  }
}
