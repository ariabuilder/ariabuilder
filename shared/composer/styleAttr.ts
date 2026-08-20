/**
 * Inline `style` attribute parse/serialize for Design inspector quick controls.
 * Prefer CSS custom properties (`var(--…)`) from the project design system.
 */

/** Parse a CSS style declaration string into a property map (last wins). */
export function parseStyleAttr(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!style.trim()) return out;
  for (const part of style.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const prop = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (!prop || !value) continue;
    out[prop] = value;
  }
  return out;
}

/** Serialize a style map; empty values are omitted. Stable key order by input Object.keys. */
export function serializeStyleAttr(
  styles: Readonly<Record<string, string | undefined | null>>,
): string {
  const parts: string[] = [];
  for (const [prop, raw] of Object.entries(styles)) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) continue;
    parts.push(`${prop}: ${value}`);
  }
  return parts.join("; ");
}

/** Make inspector preview declarations beat utilities until the class CSS lands. */
export function withPreviewImportant(cssText: string): string {
  const next: Record<string, string> = {};
  for (const [property, value] of Object.entries(parseStyleAttr(cssText))) {
    next[property] = /!important\s*$/i.test(value) ? value : `${value} !important`;
  }
  return serializeStyleAttr(next);
}

/** Read one property (case-insensitive key lookup). */
export function getStyleProp(
  styles: Readonly<Record<string, string>>,
  prop: string,
): string {
  const key = prop.toLowerCase();
  return styles[key] ?? "";
}

/**
 * Set or clear a property. Returns a new map (does not mutate).
 * Empty / whitespace value removes the property.
 */
export function setStyleProp(
  styles: Readonly<Record<string, string>>,
  prop: string,
  value: string | null | undefined,
): Record<string, string> {
  const key = prop.toLowerCase();
  const next = { ...styles };
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    delete next[key];
  } else {
    next[key] = trimmed;
  }
  return next;
}

export type SpacingSides = {
  top: string
  right: string
  bottom: string
  left: string
}

/** Expand CSS margin/padding shorthand into four sides. */
export function parseSpacingShorthand(shorthand: string): SpacingSides {
  const parts = shorthand.trim().split(/\s+/).filter(Boolean)
  switch (parts.length) {
    case 1:
      return { top: parts[0]!, right: parts[0]!, bottom: parts[0]!, left: parts[0]! }
    case 2:
      return { top: parts[0]!, right: parts[1]!, bottom: parts[0]!, left: parts[1]! }
    case 3:
      return { top: parts[0]!, right: parts[1]!, bottom: parts[2]!, left: parts[1]! }
    case 4:
      return { top: parts[0]!, right: parts[1]!, bottom: parts[2]!, left: parts[3]! }
    default:
      return { top: "", right: "", bottom: "", left: "" }
  }
}

/**
 * Resolve authored side values, falling back to a margin/padding shorthand when
 * individual sides are unset.
 */
export function resolveSpacingSides(
  styles: Readonly<Record<string, string>>,
  property: "padding" | "margin",
): SpacingSides {
  const shorthand = getStyleProp(styles, property)
  const fallback = shorthand
    ? parseSpacingShorthand(shorthand)
    : { top: "", right: "", bottom: "", left: "" }
  const top = getStyleProp(styles, `${property}-top`)
  const right = getStyleProp(styles, `${property}-right`)
  const bottom = getStyleProp(styles, `${property}-bottom`)
  const left = getStyleProp(styles, `${property}-left`)
  return {
    top: top || fallback.top,
    right: right || fallback.right,
    bottom: bottom || fallback.bottom,
    left: left || fallback.left,
  }
}

/**
 * Resolve top/right/bottom/left, falling back to the CSS `inset` shorthand when
 * individual offsets are unset. Longhands always win.
 */
export function resolveInsetSides(
  styles: Readonly<Record<string, string>>,
): SpacingSides {
  const shorthand = getStyleProp(styles, "inset")
  const fallback = shorthand
    ? parseSpacingShorthand(shorthand)
    : { top: "", right: "", bottom: "", left: "" }
  const top = getStyleProp(styles, "top")
  const right = getStyleProp(styles, "right")
  const bottom = getStyleProp(styles, "bottom")
  const left = getStyleProp(styles, "left")
  return {
    top: top || fallback.top,
    right: right || fallback.right,
    bottom: bottom || fallback.bottom,
    left: left || fallback.left,
  }
}

export type PositionOffsetKey = "top" | "right" | "bottom" | "left"
export type PositionValueKey = PositionOffsetKey | "z-index"

const POSITION_CSS_KEYWORDS = new Set([
  "auto",
  "inherit",
  "initial",
  "unset",
  "revert",
])

/**
 * Normalize a Position inspector value for persist.
 * Empty clears. `var(` / `calc(` and CSS keywords pass through. Bare numbers
 * become `px` for offsets and a rounded integer for z-index.
 */
export function normalizePositionValue(
  key: PositionValueKey,
  value: string,
): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.startsWith("var(") || trimmed.startsWith("calc(")) return trimmed
  if (POSITION_CSS_KEYWORDS.has(trimmed)) return trimmed

  const numeric = Number.parseFloat(trimmed)
  if (!Number.isFinite(numeric) || String(numeric) !== trimmed) return trimmed

  if (key === "z-index") return String(Math.round(numeric))
  return `${Math.round(numeric)}px`
}
