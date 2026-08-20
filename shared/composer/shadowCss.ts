export type ShadowKind = "box" | "text";

export type ShadowLayer = {
  offsetX: string;
  offsetY: string;
  blur: string;
  spread: string;
  color: string;
  inset: boolean;
};

export type ParsedShadowValue =
  | { mode: "layers"; layers: ShadowLayer[] }
  | {
      mode: "raw";
      value: string;
      reason: "css-wide" | "whole-variable" | "ambiguous" | "invalid";
    };

export const SHADOW_SECTION_PROPERTIES = ["box-shadow", "text-shadow"] as const;

const CSS_WIDE_KEYWORDS = new Set([
  "inherit",
  "initial",
  "revert",
  "revert-layer",
  "unset",
]);

const COLOR_FUNCTIONS = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|device-cmyk|light-dark)\(/i;
const LENGTH_FUNCTIONS = /^(?:calc|min|max|clamp|env)\(/i;
const VARIABLE_FUNCTION = /^var\(/i;
const DIMENSION = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[a-z%]+)?$/i;

function splitTopLevel(value: string, separator: "comma" | "whitespace"): string[] | null {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  const push = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      current += character;
      continue;
    }
    if (character === ")") {
      if (depth === 0) return null;
      depth -= 1;
      current += character;
      continue;
    }
    if (depth === 0 && separator === "comma" && character === ",") {
      push();
      continue;
    }
    if (depth === 0 && separator === "whitespace" && /\s/.test(character)) {
      push();
      continue;
    }
    current += character;
  }

  if (depth !== 0 || quote) return null;
  push();
  return parts;
}

function isVariable(value: string): boolean {
  return VARIABLE_FUNCTION.test(value);
}

function isLength(value: string): boolean {
  return DIMENSION.test(value) || LENGTH_FUNCTIONS.test(value) || isVariable(value);
}

function isNegativeLiteral(value: string): boolean {
  const matched = value.match(/^([-+]?(?:\d+\.?\d*|\.\d+))(?:[a-z%]+)?$/i);
  return matched ? Number(matched[1]) < 0 : false;
}

function isExplicitColor(value: string): boolean {
  if (/^#(?:[0-9a-f]{3,8})$/i.test(value)) return true;
  if (COLOR_FUNCTIONS.test(value)) return true;
  if (["currentcolor", "transparent"].includes(value.toLowerCase())) return true;
  return !isLength(value) && value.toLowerCase() !== "inset";
}

function raw(value: string, reason: Extract<ParsedShadowValue, { mode: "raw" }>["reason"]): ParsedShadowValue {
  return { mode: "raw", value, reason };
}

function parseLayer(kind: ShadowKind, source: string): ShadowLayer | "ambiguous" | null {
  const tokens = splitTopLevel(source, "whitespace");
  if (!tokens?.length) return null;

  let inset = false;
  const values: string[] = [];
  for (const token of tokens) {
    if (token.toLowerCase() === "inset") {
      if (kind !== "box" || inset) return null;
      inset = true;
    } else {
      values.push(token);
    }
  }

  const explicitColors = values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => isExplicitColor(value));
  if (explicitColors.length > 1) return null;

  let color = explicitColors[0]?.value ?? "currentColor";
  let lengths = explicitColors.length
    ? values.filter((_, index) => index !== explicitColors[0]!.index)
    : [...values];

  if (!explicitColors.length) {
    const firstVariable = isVariable(values[0] ?? "");
    const lastVariable = isVariable(values.at(-1) ?? "");
    const maxLengths = kind === "box" ? 4 : 3;
    if (values.length === maxLengths + 1 && firstVariable) {
      color = values[0]!;
      lengths = values.slice(1);
    } else if (values.length === maxLengths + 1 && lastVariable) {
      color = values.at(-1)!;
      lengths = values.slice(0, -1);
    } else if (values.some(isVariable) && values.length > 2) {
      return "ambiguous";
    }
  }

  const maximum = kind === "box" ? 4 : 3;
  if (lengths.length < 2 || lengths.length > maximum || !lengths.every(isLength)) return null;
  if (lengths[2] && isNegativeLiteral(lengths[2])) return null;

  return {
    offsetX: lengths[0]!,
    offsetY: lengths[1]!,
    blur: lengths[2] ?? "0px",
    spread: kind === "box" ? lengths[3] ?? "0px" : "",
    color,
    inset,
  };
}

export function parseShadowValue(kind: ShadowKind, value: string | null | undefined): ParsedShadowValue {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.toLowerCase() === "none") return { mode: "layers", layers: [] };
  if (CSS_WIDE_KEYWORDS.has(normalized.toLowerCase())) return raw(normalized, "css-wide");
  if (isVariable(normalized) && splitTopLevel(normalized, "whitespace")?.length === 1) {
    return raw(normalized, "whole-variable");
  }

  const sources = splitTopLevel(normalized, "comma");
  if (!sources?.length) return raw(normalized, "invalid");
  const layers: ShadowLayer[] = [];
  for (const source of sources) {
    const parsed = parseLayer(kind, source);
    if (parsed === "ambiguous") return raw(normalized, "ambiguous");
    if (!parsed) return raw(normalized, "invalid");
    layers.push(parsed);
  }
  return { mode: "layers", layers };
}

export function normalizeShadowLength(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "0px";
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return `${Number(trimmed)}px`;
  return trimmed;
}

export function createDefaultShadowLayer(kind: ShadowKind): ShadowLayer {
  return {
    offsetX: "0px",
    offsetY: "4px",
    blur: "8px",
    spread: kind === "box" ? "0px" : "",
    color: "rgb(0 0 0 / 25%)",
    inset: false,
  };
}

export function serializeShadowValue(kind: ShadowKind, layers: readonly ShadowLayer[]): string {
  if (!layers.length) return "none";
  return layers.map((layer) => [
    kind === "box" && layer.inset ? "inset" : "",
    normalizeShadowLength(layer.offsetX),
    normalizeShadowLength(layer.offsetY),
    normalizeShadowLength(layer.blur),
    kind === "box" ? normalizeShadowLength(layer.spread) : "",
    layer.color.trim() || "currentColor",
  ].filter(Boolean).join(" ")).join(", ");
}
