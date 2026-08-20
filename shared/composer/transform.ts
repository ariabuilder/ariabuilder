/**
 * Parse / serialize CSS `transform` + `transform-origin` for the Design inspector.
 *
 * Canonical write path is the composite `transform` function list plus
 * `transform-origin`. Individual `translate` / `rotate` / `scale` properties are
 * hydrated when the composite is empty so existing aria-app styles are not lost,
 * then cleared on the next transform edit.
 */

import { getStyleProp } from "./styleAttr"

const ORIGIN_KEYWORD_VALUES = [
  "left",
  "center",
  "right",
  "top",
  "bottom",
] as const

const VERTICAL_ORIGIN_KEYWORDS = new Set(["top", "bottom"])

const KNOWN_TRANSFORM_FUNCTIONS = new Set([
  "translate",
  "translatex",
  "translatey",
  "rotate",
  "scale",
  "scalex",
  "scaley",
  "skew",
  "skewx",
  "skewy",
])

export interface TransformState {
  translateX: string
  translateY: string
  rotate: string
  scaleX: string
  scaleY: string
  skewX: string
  skewY: string
  originX: string
  originY: string
}

export const TRANSFORM_DEFAULTS: TransformState = {
  translateX: "0px",
  translateY: "0px",
  rotate: "0deg",
  scaleX: "1",
  scaleY: "1",
  skewX: "0deg",
  skewY: "0deg",
  originX: "center",
  originY: "center",
}

export const TRANSFORM_LEGACY_PROPERTIES = ["translate", "rotate", "scale"] as const
export const TRANSFORM_SECTION_PROPERTIES = [
  "transform",
  "transform-origin",
  ...TRANSFORM_LEGACY_PROPERTIES,
] as const

export type TransformStyleKey = "transform" | "transform-origin"

function splitTopLevelWhitespace(value: string): string[] {
  const tokens: string[] = []
  let current = ""
  let depth = 0

  for (const char of value) {
    if (char === "(") {
      depth += 1
      current += char
      continue
    }

    if (char === ")") {
      depth = Math.max(0, depth - 1)
      current += char
      continue
    }

    if (/\s/.test(char) && depth === 0) {
      if (current.trim()) {
        tokens.push(current.trim())
        current = ""
      }
      continue
    }

    current += char
  }

  if (current.trim()) {
    tokens.push(current.trim())
  }

  return tokens
}

function splitTopLevelComma(value: string): string[] {
  const tokens: string[] = []
  let current = ""
  let depth = 0

  for (const char of value) {
    if (char === "(") {
      depth += 1
      current += char
      continue
    }

    if (char === ")") {
      depth = Math.max(0, depth - 1)
      current += char
      continue
    }

    if (char === "," && depth === 0) {
      if (current.trim()) {
        tokens.push(current.trim())
      }
      current = ""
      continue
    }

    current += char
  }

  if (current.trim()) {
    tokens.push(current.trim())
  }

  return tokens
}

type TransformCall = {
  name: string
  argument: string
}

function collectTopLevelTransformFunctions(css: string): TransformCall[] {
  const calls: TransformCall[] = []
  let index = 0

  while (index < css.length) {
    const char = css[index]
    if (!char || /\s/.test(char)) {
      index += 1
      continue
    }

    if (!/[a-zA-Z]/.test(char)) {
      index += 1
      continue
    }

    const nameStart = index
    index += 1
    while (index < css.length && /[a-zA-Z0-9-]/.test(css[index]!)) {
      index += 1
    }
    const name = css.slice(nameStart, index)

    while (index < css.length && /\s/.test(css[index]!)) {
      index += 1
    }

    if (css[index] !== "(") continue
    index += 1

    const argumentStart = index
    let depth = 0
    while (index < css.length) {
      const current = css[index]
      if (current === "(") {
        depth += 1
      } else if (current === ")") {
        if (depth === 0) {
          calls.push({
            name,
            argument: css.slice(argumentStart, index).trim(),
          })
          index += 1
          break
        }
        depth -= 1
      }
      index += 1
    }
  }

  return calls
}

function parseAxisArguments(argument: string): string[] {
  const parts = splitTopLevelComma(argument)
  return parts.length > 1 ? parts : splitTopLevelWhitespace(argument)
}

function normalizeNumberishValue(
  value: string,
  unit: string,
  fallback: string,
): string {
  const trimmed = value.trim()
  if (!trimmed) return fallback

  if (
    trimmed.startsWith("var(") ||
    trimmed.startsWith("calc(") ||
    trimmed.startsWith("clamp(")
  ) {
    return trimmed
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return `${Number(trimmed)}${unit}`
  }

  return trimmed
}

function normalizeScaleValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return TRANSFORM_DEFAULTS.scaleX

  if (
    trimmed.startsWith("var(") ||
    trimmed.startsWith("calc(") ||
    trimmed.startsWith("clamp(")
  ) {
    return trimmed
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return String(Number(trimmed))
  }

  return trimmed
}

function normalizeOriginValue(value: string, fallback: string): string {
  const trimmed = value.trim()
  if (!trimmed) return fallback

  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith("var(") ||
    lower.startsWith("calc(") ||
    lower.startsWith("clamp(")
  ) {
    return trimmed
  }

  if ((ORIGIN_KEYWORD_VALUES as readonly string[]).includes(lower)) {
    return lower
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return `${Number(trimmed)}px`
  }

  return trimmed
}

function applyTranslateArguments(state: TransformState, argument: string): void {
  const values = parseAxisArguments(argument)
  if (values[0]) state.translateX = values[0]
  if (values[1]) state.translateY = values[1]
}

function applyScaleArguments(state: TransformState, argument: string): void {
  const values = parseAxisArguments(argument)
  if (values[0]) state.scaleX = values[0]
  state.scaleY = values[1] ?? values[0] ?? state.scaleY
}

function applyOriginTokens(state: TransformState, transformOrigin: string): void {
  const tokens = splitTopLevelWhitespace(transformOrigin)
  if (!tokens[0]) return

  if (!tokens[1]) {
    const keyword = tokens[0].trim().toLowerCase()
    if (VERTICAL_ORIGIN_KEYWORDS.has(keyword)) {
      state.originY = tokens[0]
      return
    }
    state.originX = tokens[0]
    return
  }

  const first = tokens[0].trim().toLowerCase()
  const second = tokens[1].trim().toLowerCase()
  if (VERTICAL_ORIGIN_KEYWORDS.has(first) && !VERTICAL_ORIGIN_KEYWORDS.has(second)) {
    state.originX = tokens[1]!
    state.originY = tokens[0]!
    return
  }

  state.originX = tokens[0]
  state.originY = tokens[1]
}

function originTokenMatchesKeyword(value: string, keyword: string): boolean {
  const normalized = value.trim().toLowerCase()
  const expected = keyword.toLowerCase()
  if (normalized === expected) return true
  if (expected === "center" && normalized === "50%") return true
  if (expected === "left" && normalized === "0%") return true
  if (expected === "right" && normalized === "100%") return true
  if (expected === "top" && normalized === "0%") return true
  if (expected === "bottom" && normalized === "100%") return true
  return false
}

function isDefaultOriginState(state: TransformState): boolean {
  return (
    originTokenMatchesKeyword(state.originX, "center") &&
    originTokenMatchesKeyword(state.originY, "center")
  )
}

function isEmptyTransform(value: string | null | undefined): boolean {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  return !normalized || normalized === "none"
}

function applyTransformCall(state: TransformState, call: TransformCall): void {
  const argument = call.argument.trim()
  switch (call.name.toLowerCase()) {
    case "translate":
      applyTranslateArguments(state, argument)
      break
    case "translatex":
      if (argument) state.translateX = argument
      break
    case "translatey":
      if (argument) state.translateY = argument
      break
    case "rotate":
      if (argument) state.rotate = argument
      break
    case "scale":
      applyScaleArguments(state, argument)
      break
    case "scalex":
      if (argument) state.scaleX = argument
      break
    case "scaley":
      if (argument) state.scaleY = argument
      break
    case "skew":
      applySkewArguments(state, argument)
      break
    case "skewx":
      if (argument) state.skewX = argument
      break
    case "skewy":
      if (argument) state.skewY = argument
      break
  }
}

function applySkewArguments(state: TransformState, argument: string): void {
  const values = parseAxisArguments(argument)
  if (values[0]) state.skewX = values[0]
  if (values[1]) state.skewY = values[1]
}

export function defaultTransformState(): TransformState {
  return { ...TRANSFORM_DEFAULTS }
}

export function transformStateToCSS(state: TransformState): string {
  const translateX = normalizeNumberishValue(
    state.translateX,
    "px",
    TRANSFORM_DEFAULTS.translateX,
  )
  const translateY = normalizeNumberishValue(
    state.translateY,
    "px",
    TRANSFORM_DEFAULTS.translateY,
  )
  const rotate = normalizeNumberishValue(
    state.rotate,
    "deg",
    TRANSFORM_DEFAULTS.rotate,
  )
  const scaleX = normalizeScaleValue(state.scaleX)
  const scaleY = normalizeScaleValue(state.scaleY)
  const skewX = normalizeNumberishValue(
    state.skewX,
    "deg",
    TRANSFORM_DEFAULTS.skewX,
  )
  const skewY = normalizeNumberishValue(
    state.skewY,
    "deg",
    TRANSFORM_DEFAULTS.skewY,
  )

  const parts: string[] = []

  if (
    translateX !== TRANSFORM_DEFAULTS.translateX ||
    translateY !== TRANSFORM_DEFAULTS.translateY
  ) {
    parts.push(`translate(${translateX}, ${translateY})`)
  }

  if (rotate !== TRANSFORM_DEFAULTS.rotate) {
    parts.push(`rotate(${rotate})`)
  }

  if (
    scaleX !== TRANSFORM_DEFAULTS.scaleX ||
    scaleY !== TRANSFORM_DEFAULTS.scaleY
  ) {
    parts.push(`scale(${scaleX}, ${scaleY})`)
  }

  if (
    skewX !== TRANSFORM_DEFAULTS.skewX ||
    skewY !== TRANSFORM_DEFAULTS.skewY
  ) {
    parts.push(`skew(${skewX}, ${skewY})`)
  }

  return parts.length > 0 ? parts.join(" ") : "none"
}

export function transformOriginStateToCSS(state: TransformState): string {
  const originX = normalizeOriginValue(
    state.originX,
    TRANSFORM_DEFAULTS.originX,
  )
  const originY = normalizeOriginValue(
    state.originY,
    TRANSFORM_DEFAULTS.originY,
  )
  return `${originX} ${originY}`
}

export function cssToTransformState(
  transform: string | null | undefined,
  transformOrigin: string | null | undefined,
): TransformState {
  const state = defaultTransformState()
  const normalizedTransform =
    typeof transform === "string" ? transform.trim() : ""

  if (normalizedTransform && normalizedTransform.toLowerCase() !== "none") {
    for (const call of collectTopLevelTransformFunctions(normalizedTransform)) {
      applyTransformCall(state, call)
    }
  }

  applyOriginTokens(state, transformOrigin ?? "")
  return state
}

export function styleMapToTransformState(
  styles: Readonly<Record<string, string>>,
): TransformState {
  const transform = getStyleProp(styles, "transform")
  const state = cssToTransformState(
    transform,
    getStyleProp(styles, "transform-origin"),
  )
  if (!isEmptyTransform(transform)) return state

  const translate = getStyleProp(styles, "translate")
  if (translate && translate.toLowerCase() !== "none") {
    applyTranslateArguments(state, translate)
  }

  const rotate = getStyleProp(styles, "rotate")
  if (rotate && rotate.toLowerCase() !== "none") {
    state.rotate = rotate
  }

  const scale = getStyleProp(styles, "scale")
  if (scale && scale.toLowerCase() !== "none") {
    applyScaleArguments(state, scale)
  }

  return state
}

export function transformStateToStyleUpdates(
  state: TransformState,
  keys: readonly TransformStyleKey[] = ["transform", "transform-origin"],
  context: {
    inheritedTransform?: string
    inheritedTransformOrigin?: string
  } = {},
): Record<string, string> {
  const updates: Record<string, string> = {}

  if (keys.includes("transform")) {
    const css = transformStateToCSS(state)
    updates.transform =
      css === "none" && !hasEffectiveTransform(context.inheritedTransform) ? "" : css
    updates.translate = ""
    updates.rotate = ""
    updates.scale = ""
  }

  if (keys.includes("transform-origin")) {
    updates["transform-origin"] =
      isDefaultOriginState(state) &&
      isDefaultOriginState(cssToTransformState(null, context.inheritedTransformOrigin))
        ? ""
        : transformOriginStateToCSS(state)
  }

  return updates
}

export function isOriginPresetActive(
  state: TransformState,
  originX: string,
  originY: string,
): boolean {
  return (
    originTokenMatchesKeyword(state.originX, originX) &&
    originTokenMatchesKeyword(state.originY, originY)
  )
}

function hasEffectiveTransform(value: string | null | undefined): boolean {
  return !isEmptyTransform(value)
}

export function hasUnsupportedTransformFunctions(
  transform: string | null | undefined,
): boolean {
  const normalized = typeof transform === "string" ? transform.trim() : ""
  if (!normalized || normalized.toLowerCase() === "none") return false

  for (const call of collectTopLevelTransformFunctions(normalized)) {
    if (!KNOWN_TRANSFORM_FUNCTIONS.has(call.name.toLowerCase())) return true
  }

  return false
}
