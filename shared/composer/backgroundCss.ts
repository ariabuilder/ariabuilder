export type BackgroundType = "color" | "gradient" | "image" | "none"
export type GradientType = "linear" | "radial"
export type BackgroundSize = "cover" | "contain" | "auto"
export type BackgroundRepeat = "no-repeat" | "repeat" | "repeat-x" | "repeat-y"
export type BackgroundAttachment = "scroll" | "fixed" | "local"
export type BackgroundBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "soft-light"
  | "difference"
  | "luminosity"

export type GradientStop = {
  color: string
  position: number
}

export type GradientConfig = {
  type: GradientType
  angle?: number
  stops: GradientStop[]
}

export type BackgroundStyleKey =
  | "background"
  | "background-color"
  | "background-image"
  | "background-size"
  | "background-position"
  | "background-repeat"
  | "background-attachment"
  | "background-blend-mode"

export const BACKGROUND_SECTION_PROPERTIES = [
  "background",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "background-attachment",
  "background-blend-mode",
] as const satisfies readonly BackgroundStyleKey[]

export const BACKGROUND_SIZE_OPTIONS = ["cover", "contain", "auto"] as const
export const BACKGROUND_REPEAT_OPTIONS = [
  "no-repeat",
  "repeat",
  "repeat-x",
  "repeat-y",
] as const satisfies readonly BackgroundRepeat[]
export const BACKGROUND_ATTACHMENT_OPTIONS = [
  "scroll",
  "fixed",
  "local",
] as const satisfies readonly BackgroundAttachment[]
export const BACKGROUND_BLEND_MODE_OPTIONS = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "soft-light",
  "difference",
  "luminosity",
] as const satisfies readonly BackgroundBlendMode[]

export const DEFAULT_GRADIENT: GradientConfig = {
  type: "linear",
  angle: 90,
  stops: [
    { color: "#000000", position: 0 },
    { color: "#ffffff", position: 100 },
  ],
}

const EMPTY_BACKGROUND_UPDATES: Record<BackgroundStyleKey, string> = {
  background: "",
  "background-color": "",
  "background-image": "",
  "background-size": "",
  "background-position": "",
  "background-repeat": "",
  "background-attachment": "",
  "background-blend-mode": "",
}

export function clearedBackgroundUpdates(): Record<string, string> {
  return { ...EMPTY_BACKGROUND_UPDATES }
}

export function extractBackgroundImageUrl(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^url\((['"]?)(.*)\1\)$/i)
  return match?.[2]?.trim() || trimmed
}

export function buildBackgroundImageValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (/^(url\(|linear-gradient\(|radial-gradient\()/i.test(trimmed)) return trimmed
  return `url("${trimmed.replace(/"/g, '\\"')}")`
}

export function gradientToCSS(gradient: GradientConfig): string {
  const stops = gradient.stops
    .map((stop) => `${stop.color} ${stop.position}%`)
    .join(", ")
  if (gradient.type === "linear") {
    return `linear-gradient(${gradient.angle ?? 90}deg, ${stops})`
  }
  return `radial-gradient(circle, ${stops})`
}

export function cssToGradient(css: string): GradientConfig | null {
  const trimmed = css.trim()
  const lower = trimmed.toLowerCase()

  const linearPrefix = "linear-gradient("
  if (lower.startsWith(linearPrefix)) {
    const body = trimmed.slice(linearPrefix.length, -1)
    const parts = splitGradientArguments(body)
    if (parts.length < 2) return null
    const angleMatch = parts[0]?.trim().match(/^(-?\d+(?:\.\d+)?)deg$/i)
    const angle = angleMatch ? Number.parseFloat(angleMatch[1] ?? "90") : 90
    const stops = parseGradientStops(parts.slice(angleMatch ? 1 : 0))
    return { type: "linear", angle, stops }
  }

  const radialPrefix = "radial-gradient("
  if (lower.startsWith(radialPrefix)) {
    const body = trimmed.slice(radialPrefix.length, -1)
    const parts = splitGradientArguments(body)
    const hasShapePrefix = parts[0]?.trim().toLowerCase() === "circle"
    const stops = parseGradientStops(parts.slice(hasShapePrefix ? 1 : 0))
    return { type: "radial", stops }
  }

  return null
}

const BACKGROUND_REPEAT_TOKENS = new Set([
  "repeat-x",
  "repeat-y",
  "repeat",
  "space",
  "round",
  "no-repeat",
])
const BACKGROUND_ATTACHMENT_TOKENS = new Set(["scroll", "fixed", "local"])
const BACKGROUND_BOX_TOKENS = new Set(["border-box", "padding-box", "content-box"])
const BACKGROUND_POSITION_TOKENS = new Set(["left", "right", "center", "top", "bottom"])

export function expandBackgroundShorthand(
  value: string,
): Partial<Record<BackgroundStyleKey, string>> {
  const trimmed = value.trim()
  if (!trimmed || trimmed.toLowerCase() === "none") return {}

  const layers = splitCssList(trimmed)
  const first = layers[0] ?? ""
  const last = layers[layers.length - 1] ?? first
  const parsedFirst = parseBackgroundLayer(first, layers.length === 1)
  const parsedLast = layers.length > 1 ? parseBackgroundLayer(last, true) : parsedFirst

  return {
    ...(parsedLast.color ? { "background-color": parsedLast.color } : {}),
    ...(parsedFirst.image ? { "background-image": parsedFirst.image } : {}),
    ...(parsedFirst.size ? { "background-size": parsedFirst.size } : {}),
    ...(parsedFirst.position ? { "background-position": parsedFirst.position } : {}),
    ...(parsedFirst.repeat ? { "background-repeat": parsedFirst.repeat } : {}),
    ...(parsedFirst.attachment ? { "background-attachment": parsedFirst.attachment } : {}),
  }
}

export function resolveBackgroundStyleValues(
  values: Partial<Record<BackgroundStyleKey | string, string>>,
): Partial<Record<BackgroundStyleKey, string>> {
  const shorthand = expandBackgroundShorthand(values.background ?? "")
  const pick = (key: BackgroundStyleKey) => {
    const authored = values[key]?.trim() ?? ""
    return authored || shorthand[key] || ""
  }
  return {
    background: values.background?.trim() ?? "",
    "background-color": pick("background-color"),
    "background-image": pick("background-image"),
    "background-size": pick("background-size"),
    "background-position": pick("background-position"),
    "background-repeat": pick("background-repeat"),
    "background-attachment": pick("background-attachment"),
    "background-blend-mode": values["background-blend-mode"]?.trim() ?? "",
  }
}

export function inferBackgroundType(values: {
  background?: string
  "background-color"?: string
  "background-image"?: string
}): BackgroundType {
  const resolved = resolveBackgroundStyleValues(values)
  const image = resolved["background-image"] ?? ""
  if (image && cssToGradient(image)) return "gradient"
  if (image && image.toLowerCase() !== "none") return "image"
  const color = resolved["background-color"] ?? ""
  if (color && color.toLowerCase() !== "transparent") return "color"
  return "none"
}

const IMAGE_LONGHAND_RESET: Record<string, string> = {
  background: "",
  "background-image": "",
  "background-size": "",
  "background-position": "",
  "background-repeat": "",
  "background-attachment": "",
  "background-blend-mode": "",
}

export function colorBackgroundUpdates(color: string): Record<string, string> {
  const normalized = color.trim() || "transparent"
  return {
    ...IMAGE_LONGHAND_RESET,
    "background-color": normalized,
  }
}

export function gradientBackgroundUpdates(
  css: string,
  blendMode: string = "normal",
): Record<string, string> {
  return {
    background: "",
    "background-image": css,
    "background-size": "",
    "background-position": "",
    "background-repeat": "",
    "background-attachment": "",
    "background-blend-mode": blendMode !== "normal" ? blendMode : "",
  }
}

export function imageBackgroundUpdates(input: {
  url: string
  size: string
  position: string
  repeat: string
  attachment?: string
  blendMode?: string
}): Record<string, string> {
  const imageValue = buildBackgroundImageValue(input.url)
  if (!imageValue) {
    return { ...IMAGE_LONGHAND_RESET }
  }
  return {
    background: "",
    "background-image": imageValue,
    "background-size": input.size,
    "background-position": input.position,
    "background-repeat": input.repeat,
    "background-attachment":
      input.attachment && input.attachment !== "scroll" ? input.attachment : "",
    "background-blend-mode":
      input.blendMode && input.blendMode !== "normal" ? input.blendMode : "",
  }
}

function splitGradientArguments(value: string): string[] {
  const segments: string[] = []
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
      if (current.trim()) segments.push(current.trim())
      current = ""
      continue
    }
    current += char
  }
  if (current.trim()) segments.push(current.trim())
  return segments
}

function parseGradientStops(stopParts: string[]): GradientStop[] {
  const stops: GradientStop[] = []
  for (const part of stopParts) {
    const trimmed = part.trim()
    const positionMatch = trimmed.match(/(-?\d+(?:\.\d+)?)%\s*$/)
    const position = positionMatch
      ? Number.parseFloat(positionMatch[1] ?? "0")
      : undefined
    const resolvedPosition =
      typeof position === "number" && Number.isFinite(position)
        ? position
        : inferStopPosition(stops.length, stopParts.length)
    const color = positionMatch
      ? trimmed.slice(0, positionMatch.index).trim()
      : trimmed
    if (!color) continue
    stops.push({ color, position: resolvedPosition })
  }
  return stops.length >= 2 ? stops : DEFAULT_GRADIENT.stops
}

function inferStopPosition(index: number, total: number): number {
  if (total <= 1) return 0
  return Math.round((index / (total - 1)) * 100)
}

function splitCssList(value: string): string[] {
  return splitGradientArguments(value)
}

function tokenizeCssValue(value: string): string[] {
  const tokens: string[] = []
  let current = ""
  let depth = 0
  for (const char of value.trim()) {
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
    if (depth === 0 && char === "/") {
      if (current.trim()) tokens.push(current.trim())
      tokens.push("/")
      current = ""
      continue
    }
    if (depth === 0 && /\s/.test(char)) {
      if (current.trim()) tokens.push(current.trim())
      current = ""
      continue
    }
    current += char
  }
  if (current.trim()) tokens.push(current.trim())
  return tokens
}

function isBackgroundImageToken(token: string): boolean {
  const lower = token.toLowerCase()
  return lower === "none" || /^(url|(?:repeating-)?(?:linear|radial|conic)-gradient)\(/i.test(token)
}

function isLengthOrPercent(token: string): boolean {
  return /^-?(\d*\.?\d+)(%|px|em|rem|vh|vw|vmin|vmax|ch|ex|cm|mm|in|pt|pc)?$/i.test(token)
}

function parseBackgroundLayer(layer: string, allowColor: boolean): {
  image: string
  color: string
  size: string
  position: string
  repeat: string
  attachment: string
} {
  const tokens = tokenizeCssValue(layer)
  let image = ""
  let color = ""
  let repeat = ""
  let attachment = ""
  const positionParts: string[] = []
  const sizeParts: string[] = []
  let seenSlash = false

  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (token === "/") {
      seenSlash = true
      continue
    }
    if (isBackgroundImageToken(token)) {
      if (lower !== "none") image = token
      continue
    }
    if (BACKGROUND_REPEAT_TOKENS.has(lower)) {
      repeat = lower
      continue
    }
    if (BACKGROUND_ATTACHMENT_TOKENS.has(lower)) {
      attachment = lower
      continue
    }
    if (BACKGROUND_BOX_TOKENS.has(lower)) continue
    if (seenSlash) {
      sizeParts.push(token)
      continue
    }
    if (BACKGROUND_POSITION_TOKENS.has(lower) || isLengthOrPercent(token)) {
      if (positionParts.length < 2) positionParts.push(lower === token.toLowerCase() && BACKGROUND_POSITION_TOKENS.has(lower) ? lower : token)
      continue
    }
    if (allowColor && !color) color = token
  }

  return {
    image,
    color,
    size: sizeParts.join(" "),
    position: positionParts.join(" "),
    repeat,
    attachment,
  }
}
