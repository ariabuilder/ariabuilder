export interface PositionOption {
  label: string
  value: string
  row: number
  column: number
}

export const DEFAULT_POSITION_VALUE = "center"

export const POSITION_PREVIEW_DOT_COUNT = 9

export const POSITION_OPTIONS_3X3: PositionOption[] = [
  { label: "Top Left", value: "top left", row: 0, column: 0 },
  { label: "Top", value: "top center", row: 0, column: 1 },
  { label: "Top Right", value: "top right", row: 0, column: 2 },
  { label: "Left", value: "center left", row: 1, column: 0 },
  { label: "Center", value: "center", row: 1, column: 1 },
  { label: "Right", value: "center right", row: 1, column: 2 },
  { label: "Bottom Left", value: "bottom left", row: 2, column: 0 },
  { label: "Bottom", value: "bottom center", row: 2, column: 1 },
  { label: "Bottom Right", value: "bottom right", row: 2, column: 2 },
]

const POSITION_ALIAS_TO_CANONICAL: Record<string, string> = {
  top: "top center",
  bottom: "bottom center",
  left: "center left",
  right: "center right",
  center: "center",
  "center center": "center",
  "top center": "top center",
  "center left": "center left",
  "center right": "center right",
  "bottom center": "bottom center",
  "top left": "top left",
  "left top": "top left",
  "top right": "top right",
  "right top": "top right",
  "bottom left": "bottom left",
  "left bottom": "bottom left",
  "bottom right": "bottom right",
  "right bottom": "bottom right",
  "center top": "top center",
  "center bottom": "bottom center",
  "left center": "center left",
  "right center": "center right",
  "0% 0%": "top left",
  "50% 0%": "top center",
  "100% 0%": "top right",
  "0% 50%": "center left",
  "50% 50%": "center",
  "100% 50%": "center right",
  "0% 100%": "bottom left",
  "50% 100%": "bottom center",
  "100% 100%": "bottom right",
}

const AXIS_PERCENTS = ["0%", "50%", "100%"] as const

export function normalizeBackgroundPositionValue(
  value: string | null | undefined,
): string {
  if (typeof value !== "string") return DEFAULT_POSITION_VALUE
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ")
  if (!normalized) return DEFAULT_POSITION_VALUE
  return POSITION_ALIAS_TO_CANONICAL[normalized] ?? normalized
}

export function getPositionOption(
  value: string | null | undefined,
): PositionOption | undefined {
  const normalized = normalizeBackgroundPositionValue(value)
  return POSITION_OPTIONS_3X3.find((option) => option.value === normalized)
}

export function isPositionPreviewDotActive(
  option: PositionOption,
  dotIndex: number,
): boolean {
  return dotIndex === option.row * 3 + option.column + 1
}

export function formatPositionAxis(raw: string, fallback = "50%"): string {
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return `${trimmed}%`
  return trimmed
}

export function positionOptionToPercents(option: PositionOption): { x: string; y: string } {
  return {
    x: AXIS_PERCENTS[option.column] ?? "50%",
    y: AXIS_PERCENTS[option.row] ?? "50%",
  }
}

export function parsePositionAxes(value: string | null | undefined): {
  x: string
  y: string
  option: PositionOption | undefined
} {
  const option = getPositionOption(value)
  if (option) return { ...positionOptionToPercents(option), option }
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return { x: "50%", y: "50%", option: getPositionOption("center") }
  }
  if (parts.length === 1) {
    return { x: formatPositionAxis(parts[0] ?? "50%"), y: "50%", option: undefined }
  }
  return {
    x: formatPositionAxis(parts[0] ?? "50%"),
    y: formatPositionAxis(parts[1] ?? "50%"),
    option: undefined,
  }
}

export function serializePositionAxes(x: string, y: string): string {
  const next = `${formatPositionAxis(x)} ${formatPositionAxis(y)}`
  return getPositionOption(next)?.value ?? next
}
