export const COMPOSER_FILTER_EFFECTS = [
  "blur",
  "brightness",
  "contrast",
  "grayscale",
  "hueRotate",
  "invert",
  "saturate",
  "sepia",
  "dropShadow",
] as const;

export type ComposerFilterEffect = (typeof COMPOSER_FILTER_EFFECTS)[number];

export const COMPOSER_FILTER_PROPERTIES = [
  "filter",
  "backdrop-filter",
  "mix-blend-mode",
] as const;

export type ComposerFilterProperty = (typeof COMPOSER_FILTER_PROPERTIES)[number];

export const COMPOSER_FILTER_DEFAULTS = {
  blur: "0",
  brightness: "100",
  contrast: "100",
  grayscale: "0",
  hueRotate: "0",
  invert: "0",
  saturate: "100",
  sepia: "0",
  dropShadowX: "0",
  dropShadowY: "0",
  dropShadowBlur: "0",
  dropShadowColor: "transparent",
} as const;

export const COMPOSER_FILTER_ENABLED_PRESETS = {
  blur: { blur: "4" },
  brightness: { brightness: "80" },
  contrast: { contrast: "120" },
  grayscale: { grayscale: "100" },
  hueRotate: { hueRotate: "180" },
  invert: { invert: "100" },
  saturate: { saturate: "150" },
  sepia: { sepia: "100" },
  dropShadow: {
    dropShadowX: "2",
    dropShadowY: "4",
    dropShadowBlur: "8",
    dropShadowColor: "rgba(0, 0, 0, 0.25)",
  },
} as const satisfies Record<ComposerFilterEffect, Partial<ComposerFilterState>>;

export type ComposerFilterState = {
  blur: string;
  brightness: string;
  contrast: string;
  grayscale: string;
  hueRotate: string;
  invert: string;
  saturate: string;
  sepia: string;
  dropShadowX: string;
  dropShadowY: string;
  dropShadowBlur: string;
  dropShadowColor: string;
};

type ComposerFilterSegment = {
  raw: string;
  effect: ComposerFilterEffect | null;
};

export type ParsedComposerFilter = {
  raw: string;
  state: ComposerFilterState;
  segments: readonly ComposerFilterSegment[];
  opaque: boolean;
  structurallyValid: boolean;
};

const FUNCTION_TO_EFFECT: Readonly<Record<string, ComposerFilterEffect>> = {
  blur: "blur",
  brightness: "brightness",
  contrast: "contrast",
  grayscale: "grayscale",
  "hue-rotate": "hueRotate",
  invert: "invert",
  saturate: "saturate",
  sepia: "sepia",
  "drop-shadow": "dropShadow",
};

const EFFECT_TO_FUNCTION: Readonly<Record<ComposerFilterEffect, string>> = {
  blur: "blur",
  brightness: "brightness",
  contrast: "contrast",
  grayscale: "grayscale",
  hueRotate: "hue-rotate",
  invert: "invert",
  saturate: "saturate",
  sepia: "sepia",
  dropShadow: "drop-shadow",
};

const EFFECT_FIELDS: Readonly<Record<ComposerFilterEffect, readonly (keyof ComposerFilterState)[]>> = {
  blur: ["blur"],
  brightness: ["brightness"],
  contrast: ["contrast"],
  grayscale: ["grayscale"],
  hueRotate: ["hueRotate"],
  invert: ["invert"],
  saturate: ["saturate"],
  sepia: ["sepia"],
  dropShadow: [
    "dropShadowX",
    "dropShadowY",
    "dropShadowBlur",
    "dropShadowColor",
  ],
};

const CSS_WIDE_KEYWORDS = new Set([
  "inherit",
  "initial",
  "revert",
  "revert-layer",
  "unset",
]);

export function defaultComposerFilterState(): ComposerFilterState {
  return { ...COMPOSER_FILTER_DEFAULTS };
}

function splitTopLevelWhitespace(value: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const push = () => {
    if (current.trim()) tokens.push(current.trim());
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
    if (character === "'" || character === '"') {
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
    if (/\s/.test(character) && depth === 0) {
      push();
      continue;
    }
    current += character;
  }

  if (depth !== 0 || quote || escaped) return null;
  push();
  return tokens;
}

function functionToken(raw: string): { name: string; argument: string } | null {
  const open = raw.indexOf("(");
  if (open <= 0 || !raw.endsWith(")")) return null;
  const name = raw.slice(0, open).trim().toLowerCase();
  if (!/^[-a-z]+$/.test(name)) return null;
  const argument = raw.slice(open + 1, -1).trim();
  return argument ? { name, argument } : null;
}

function displayArgument(argument: string, unit: string): string {
  const escapedUnit = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = argument.trim().match(
    new RegExp(`^(-?(?:\\d+\\.?\\d*|\\.\\d+))(?:${escapedUnit})?$`, "i"),
  );
  return match?.[1] ?? argument.trim();
}

function displayAmountArgument(argument: string): string {
  const trimmed = argument.trim();
  const percentage = trimmed.match(/^(-?(?:\d+\.?\d*|\.\d+))%$/i);
  if (percentage) return percentage[1] ?? trimmed;
  const ratio = trimmed.match(/^(-?(?:\d+\.?\d*|\.\d+))$/);
  if (!ratio) return trimmed;
  const value = Number.parseFloat(ratio[1] ?? "");
  return Number.isFinite(value) ? String(value * 100) : trimmed;
}

const NUMERIC_EXPRESSION_FUNCTIONS = new Set([
  "abs",
  "calc",
  "clamp",
  "env",
  "exp",
  "hypot",
  "log",
  "max",
  "min",
  "mod",
  "pow",
  "rem",
  "round",
  "sign",
  "sqrt",
  "var",
]);

const COLOR_FUNCTIONS = new Set([
  "color",
  "color-mix",
  "device-cmyk",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "light-dark",
  "oklab",
  "oklch",
  "rgb",
  "rgba",
  "var",
]);

const FALLBACK_NAMED_COLORS = new Set([
  "black",
  "blue",
  "currentcolor",
  "gray",
  "green",
  "grey",
  "red",
  "rebeccapurple",
  "transparent",
  "white",
  "yellow",
]);

function isNumericExpression(argument: string): boolean {
  const fn = functionToken(argument.trim());
  return Boolean(fn && NUMERIC_EXPRESSION_FUNCTIONS.has(fn.name));
}

function numericDimension(argument: string): { value: number; unit: string } | null {
  const match = argument.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1] ?? "");
  return Number.isFinite(value) ? { value, unit: (match[2] ?? "").toLowerCase() } : null;
}

function isLengthArgument(argument: string, allowNegative = true): boolean {
  if (isNumericExpression(argument)) return true;
  const dimension = numericDimension(argument);
  if (!dimension || dimension.unit === "%") return false;
  if (!allowNegative && dimension.value < 0) return false;
  return Boolean(dimension.unit) || dimension.value === 0;
}

function isAmountArgument(argument: string): boolean {
  if (isNumericExpression(argument)) return true;
  const dimension = numericDimension(argument);
  return Boolean(dimension && ["", "%"].includes(dimension.unit) && dimension.value >= 0);
}

function isAngleArgument(argument: string): boolean {
  if (isNumericExpression(argument)) return true;
  const dimension = numericDimension(argument);
  if (!dimension) return false;
  return ["deg", "grad", "rad", "turn"].includes(dimension.unit) ||
    (!dimension.unit && dimension.value === 0);
}

function isColorArgument(argument: string): boolean {
  const trimmed = argument.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return true;
  const fn = functionToken(trimmed);
  if (fn) return COLOR_FUNCTIONS.has(fn.name);
  if (!/^[-a-z][-_a-z0-9]*$/i.test(trimmed)) return false;
  const css = (globalThis as typeof globalThis & {
    CSS?: { supports?: (property: string, value: string) => boolean };
  }).CSS;
  if (typeof css?.supports === "function") return css.supports("color", trimmed);
  if (typeof document !== "undefined") {
    const style = document.createElement("span").style;
    style.color = "";
    style.color = trimmed;
    if (style.color) return true;
  }
  return FALLBACK_NAMED_COLORS.has(trimmed.toLowerCase());
}

type ParsedDropShadow =
  | { kind: "parsed"; value: Pick<
      ComposerFilterState,
      "dropShadowX" | "dropShadowY" | "dropShadowBlur" | "dropShadowColor"
    > }
  | { kind: "opaque" }
  | { kind: "invalid" };

function parseDropShadow(argument: string): ParsedDropShadow {
  const tokens = splitTopLevelWhitespace(argument);
  if (!tokens || tokens.length < 2 || tokens.length > 4) return { kind: "invalid" };

  const candidates: Array<{ colorIndex: number | null; lengths: string[] }> = [];
  const addCandidate = (colorIndex: number | null) => {
    const lengths = tokens.filter((_, index) => index !== colorIndex);
    if (lengths.length < 2 || lengths.length > 3) return;
    if (!lengths.every((token, index) => isLengthArgument(token, index < 2))) return;
    candidates.push({ colorIndex, lengths });
  };

  addCandidate(null);
  for (let index = 0; index < tokens.length; index += 1) {
    if (isColorArgument(tokens[index]!)) addCandidate(index);
  }

  if (candidates.length === 0) return { kind: "invalid" };
  if (candidates.length > 1) return { kind: "opaque" };
  const candidate = candidates[0]!;
  const [x, y, blur] = candidate.lengths;
  if (!x || !y) return { kind: "invalid" };
  return {
    kind: "parsed",
    value: {
      dropShadowX: displayArgument(x, "px"),
      dropShadowY: displayArgument(y, "px"),
      dropShadowBlur: blur ? displayArgument(blur, "px") : "0",
      dropShadowColor: candidate.colorIndex == null
        ? "transparent"
        : tokens[candidate.colorIndex]!,
    },
  };
}

type ApplyArgumentResult = "applied" | "opaque" | "invalid";

function applyKnownArgument(
  state: ComposerFilterState,
  effect: ComposerFilterEffect,
  argument: string,
): ApplyArgumentResult {
  switch (effect) {
    case "blur":
      if (!isLengthArgument(argument, false)) return "invalid";
      state.blur = displayArgument(argument, "px");
      return "applied";
    case "brightness":
    case "contrast":
    case "grayscale":
    case "invert":
    case "saturate":
    case "sepia":
      if (!isAmountArgument(argument)) return "invalid";
      state[effect] = displayAmountArgument(argument);
      return "applied";
    case "hueRotate":
      if (!isAngleArgument(argument)) return "invalid";
      state.hueRotate = displayArgument(argument, "deg");
      return "applied";
    case "dropShadow": {
      const shadow = parseDropShadow(argument);
      if (shadow.kind !== "parsed") return shadow.kind;
      Object.assign(state, shadow.value);
      return "applied";
    }
  }
}

export function parseComposerFilterCss(value: string | null | undefined): ParsedComposerFilter {
  const raw = typeof value === "string" ? value.trim() : "";
  const state = defaultComposerFilterState();
  if (!raw || raw.toLowerCase() === "none") {
    return { raw: raw || "none", state, segments: [], opaque: false, structurallyValid: true };
  }

  if (CSS_WIDE_KEYWORDS.has(raw.toLowerCase())) {
    return { raw, state, segments: [], opaque: true, structurallyValid: true };
  }

  if (/^var\(/i.test(raw)) {
    const variableTokens = splitTopLevelWhitespace(raw);
    const variable = variableTokens?.length === 1 ? functionToken(variableTokens[0]!) : null;
    return {
      raw,
      state,
      segments: [],
      opaque: true,
      structurallyValid: variable?.name === "var",
    };
  }

  const tokens = splitTopLevelWhitespace(raw);
  if (!tokens?.length) {
    return { raw, state, segments: [], opaque: true, structurallyValid: false };
  }

  const seen = new Set<ComposerFilterEffect>();
  const segments: ComposerFilterSegment[] = [];
  let opaque = false;
  for (const token of tokens) {
    const fn = functionToken(token);
    if (!fn) {
      return { raw, state, segments, opaque: true, structurallyValid: false };
    }
    const effect = FUNCTION_TO_EFFECT[fn.name] ?? null;
    if (!effect) {
      if (fn.name !== "url" && !(fn.name === "opacity" && isAmountArgument(fn.argument))) {
        return { raw, state, segments, opaque: true, structurallyValid: false };
      }
      segments.push({ raw: token, effect: null });
      continue;
    }
    if (seen.has(effect)) {
      opaque = true;
      segments.push({ raw: token, effect });
      continue;
    }
    const result = applyKnownArgument(state, effect, fn.argument);
    if (result === "invalid") {
      return {
        raw,
        state,
        segments: [...segments, { raw: token, effect }],
        opaque: true,
        structurallyValid: false,
      };
    }
    if (result === "opaque") opaque = true;
    seen.add(effect);
    segments.push({ raw: token, effect });
  }

  return { raw, state, segments, opaque, structurallyValid: true };
}

function numericValue(value: string, unit: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const escapedUnit = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = trimmed.match(
    new RegExp(`^(-?(?:\\d+\\.?\\d*|\\.\\d+))(?:${escapedUnit})?$`, "i"),
  );
  return match ? `${match[1]}${unit}` : trimmed;
}

function sameEffectState(
  effect: ComposerFilterEffect,
  left: ComposerFilterState,
  right: ComposerFilterState,
): boolean {
  return EFFECT_FIELDS[effect].every((field) => left[field] === right[field]);
}

export function isComposerFilterEffectEnabled(
  state: ComposerFilterState,
  effect: ComposerFilterEffect,
): boolean {
  if (effect === "dropShadow") {
    return (
      Number(state.dropShadowX) !== 0 ||
      Number(state.dropShadowY) !== 0 ||
      Number(state.dropShadowBlur) !== 0 ||
      !["", "transparent"].includes(state.dropShadowColor.trim().toLowerCase())
    );
  }
  return Number(state[effect]) !== Number(COMPOSER_FILTER_DEFAULTS[effect]);
}

function serializeEffect(
  effect: ComposerFilterEffect,
  state: ComposerFilterState,
): string | null {
  if (!isComposerFilterEffectEnabled(state, effect)) return null;
  const name = EFFECT_TO_FUNCTION[effect];
  switch (effect) {
    case "blur":
      return `${name}(${numericValue(state.blur, "px")})`;
    case "brightness":
    case "contrast":
    case "grayscale":
    case "invert":
    case "saturate":
    case "sepia":
      return `${name}(${numericValue(state[effect], "%")})`;
    case "hueRotate":
      return `${name}(${numericValue(state.hueRotate, "deg")})`;
    case "dropShadow": {
      const x = numericValue(state.dropShadowX, "px") || "0px";
      const y = numericValue(state.dropShadowY, "px") || "0px";
      const blur = numericValue(state.dropShadowBlur, "px") || "0px";
      const color = state.dropShadowColor.trim() || "transparent";
      return `${name}(${x} ${y} ${blur} ${color})`;
    }
  }
}

export function serializeComposerFilterCss(
  parsed: ParsedComposerFilter,
  state: ComposerFilterState,
): string {
  if (parsed.opaque) return parsed.raw;

  const emitted = new Set<ComposerFilterEffect>();
  const parts: string[] = [];
  for (const segment of parsed.segments) {
    if (!segment.effect) {
      parts.push(segment.raw);
      continue;
    }
    emitted.add(segment.effect);
    if (!isComposerFilterEffectEnabled(state, segment.effect)) continue;
    if (sameEffectState(segment.effect, parsed.state, state)) {
      parts.push(segment.raw);
      continue;
    }
    const serialized = serializeEffect(segment.effect, state);
    if (serialized) parts.push(serialized);
  }

  for (const effect of COMPOSER_FILTER_EFFECTS) {
    if (emitted.has(effect)) continue;
    const serialized = serializeEffect(effect, state);
    if (serialized) parts.push(serialized);
  }

  return parts.length ? parts.join(" ") : "none";
}

export function resetComposerFilterEffect(
  state: ComposerFilterState,
  effect: ComposerFilterEffect,
): ComposerFilterState {
  const next = { ...state };
  for (const field of EFFECT_FIELDS[effect]) {
    next[field] = COMPOSER_FILTER_DEFAULTS[field];
  }
  return next;
}

export function enableComposerFilterEffect(
  state: ComposerFilterState,
  effect: ComposerFilterEffect,
): ComposerFilterState {
  return { ...state, ...COMPOSER_FILTER_ENABLED_PRESETS[effect] };
}

export function validateComposerFilterCss(
  property: "filter" | "backdrop-filter",
  value: string,
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const parsed = parseComposerFilterCss(trimmed);
  if (!parsed.structurallyValid) return false;
  const css = (globalThis as typeof globalThis & {
    CSS?: { supports?: (property: string, value: string) => boolean };
  }).CSS;
  return typeof css?.supports === "function"
    ? css.supports(property, trimmed)
    : true;
}
