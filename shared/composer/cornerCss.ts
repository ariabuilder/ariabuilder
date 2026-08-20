export type PhysicalCorner = "topLeft" | "topRight" | "bottomRight" | "bottomLeft";

export type CornerValues = Record<PhysicalCorner, string>;

export type CornerStyleState = {
  radius: CornerValues;
  shape: CornerValues;
  radiusLinked: boolean;
  shapeLinked: boolean;
  unsafeRadiusShorthand: string | null;
  logicalRadiusNeedsResolution: boolean;
};

export const PHYSICAL_RADIUS_PROPERTIES = {
  topLeft: "border-top-left-radius",
  topRight: "border-top-right-radius",
  bottomRight: "border-bottom-right-radius",
  bottomLeft: "border-bottom-left-radius",
} as const satisfies Record<PhysicalCorner, string>;

export const LEGACY_LOGICAL_RADIUS_PROPERTIES = {
  topLeft: "border-start-start-radius",
  topRight: "border-start-end-radius",
  bottomRight: "border-end-end-radius",
  bottomLeft: "border-end-start-radius",
} as const satisfies Record<PhysicalCorner, string>;

export const PHYSICAL_SHAPE_PROPERTIES = {
  topLeft: "corner-top-left-shape",
  topRight: "corner-top-right-shape",
  bottomRight: "corner-bottom-right-shape",
  bottomLeft: "corner-bottom-left-shape",
} as const satisfies Record<PhysicalCorner, string>;

export const LEGACY_LOGICAL_SHAPE_PROPERTIES = {
  topLeft: "corner-start-start-shape",
  topRight: "corner-start-end-shape",
  bottomRight: "corner-end-end-shape",
  bottomLeft: "corner-end-start-shape",
} as const satisfies Record<PhysicalCorner, string>;

export const CORNER_SECTION_PROPERTIES = [
  "border-radius",
  ...Object.values(PHYSICAL_RADIUS_PROPERTIES),
  ...Object.values(LEGACY_LOGICAL_RADIUS_PROPERTIES),
  "corner-shape",
  ...Object.values(PHYSICAL_SHAPE_PROPERTIES),
  ...Object.values(LEGACY_LOGICAL_SHAPE_PROPERTIES),
] as const;

export const CORNER_SHAPE_OPTIONS = [
  { value: "round", labelKey: "round" },
  { value: "squircle", labelKey: "squircle" },
  { value: "bevel", labelKey: "bevel" },
  { value: "scoop", labelKey: "scoop" },
  { value: "notch", labelKey: "notch" },
  { value: "square", labelKey: "square" },
  { value: "superellipse(1.5)", labelKey: "softSuperellipse" },
  { value: "superellipse(0.5)", labelKey: "pinchedSuperellipse" },
  { value: "superellipse(-0.5)", labelKey: "softScoop" },
  { value: "superellipse(-1.5)", labelKey: "deepScoop" },
] as const;

export const CORNER_SHAPE_SLIDER_MIN = -5;
export const CORNER_SHAPE_SLIDER_MAX = 5;
export const CORNER_SHAPE_SLIDER_STEP = 0.1;

const CORNERS: readonly PhysicalCorner[] = [
  "topLeft",
  "topRight",
  "bottomRight",
  "bottomLeft",
];

function uniformCorners(value: string): CornerValues {
  return {
    topLeft: value,
    topRight: value,
    bottomRight: value,
    bottomLeft: value,
  };
}

function allCornersEqual(values: CornerValues): boolean {
  return CORNERS.every((corner) => values[corner] === values.topLeft);
}

function splitTopLevel(value: string, separator: "whitespace" | "slash"): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const push = (preserveEmpty = false) => {
    if (current.trim() || preserveEmpty) tokens.push(current.trim());
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
    if (depth === 0 && separator === "slash" && character === "/") {
      push(true);
      continue;
    }
    if (depth === 0 && separator === "whitespace" && /\s/.test(character)) {
      push();
      continue;
    }
    current += character;
  }

  if (depth !== 0 || quote) return null;
  push(separator === "slash");
  return tokens;
}

function expandFour(tokens: readonly string[]): CornerValues | null {
  switch (tokens.length) {
    case 1:
      return uniformCorners(tokens[0]!);
    case 2:
      return {
        topLeft: tokens[0]!,
        topRight: tokens[1]!,
        bottomRight: tokens[0]!,
        bottomLeft: tokens[1]!,
      };
    case 3:
      return {
        topLeft: tokens[0]!,
        topRight: tokens[1]!,
        bottomRight: tokens[2]!,
        bottomLeft: tokens[1]!,
      };
    case 4:
      return {
        topLeft: tokens[0]!,
        topRight: tokens[1]!,
        bottomRight: tokens[2]!,
        bottomLeft: tokens[3]!,
      };
    default:
      return null;
  }
}

function isSupportedRadiusToken(value: string): boolean {
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[a-zA-Z%]+)?$/.test(value)) return true;
  return /^(?:calc|min|max|clamp|env)\(/i.test(value);
}

export function parseBorderRadiusShorthand(value: string): CornerValues | null {
  const slashParts = splitTopLevel(value.trim(), "slash");
  if (!slashParts?.length || slashParts.length > 2) return null;
  const horizontalTokens = splitTopLevel(slashParts[0]!, "whitespace");
  const verticalTokens = slashParts.length === 2
    ? splitTopLevel(slashParts[1]!, "whitespace")
    : horizontalTokens;
  if (!horizontalTokens || !verticalTokens) return null;
  if (![...horizontalTokens, ...verticalTokens].every(isSupportedRadiusToken)) return null;
  const horizontal = expandFour(horizontalTokens);
  const vertical = expandFour(verticalTokens);
  if (!horizontal || !vertical) return null;
  if (slashParts.length === 1) return horizontal;
  return Object.fromEntries(CORNERS.map((corner) => [
    corner,
    horizontal[corner] === vertical[corner]
      ? horizontal[corner]
      : `${horizontal[corner]} ${vertical[corner]}`,
  ])) as CornerValues;
}

export function parseCornerShapeShorthand(value: string | null | undefined): CornerValues {
  const normalized = normalizeCornerShapeValue(value);
  const tokens = splitTopLevel(normalized, "whitespace");
  const expanded = tokens && expandFour(tokens);
  if (!expanded) return uniformCorners(normalized);
  return Object.fromEntries(CORNERS.map((corner) => [
    corner,
    normalizeCornerShapeValue(expanded[corner]),
  ])) as CornerValues;
}

export function buildCornerShapeShorthand(values: CornerValues): string {
  if (allCornersEqual(values)) return values.topLeft;
  if (values.topLeft === values.bottomRight && values.topRight === values.bottomLeft) {
    return `${values.topLeft} ${values.topRight}`;
  }
  if (values.topRight === values.bottomLeft) {
    return `${values.topLeft} ${values.topRight} ${values.bottomRight}`;
  }
  return `${values.topLeft} ${values.topRight} ${values.bottomRight} ${values.bottomLeft}`;
}

export function normalizeRadiusValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "0";
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return `${Number(trimmed)}px`;
  return trimmed;
}

export function formatRadiusInput(value: string): string {
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(px)?$/i);
  if (!match) return value;
  const parsed = Number.parseFloat(match[1] ?? "0");
  return Number.isFinite(parsed) ? String(parsed) : value;
}

export function radiusScrubOrigin(value: string): { value: number; unit: string } | null {
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))([a-zA-Z%]+)?$/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1] ?? "0");
  if (!Number.isFinite(parsed)) return null;
  return { value: parsed, unit: match[2] ?? "px" };
}

export function normalizeCornerShapeValue(value: string | null | undefined): string {
  if (typeof value !== "string") return "round";
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "round";
  const lower = compact.toLowerCase();
  if (CORNER_SHAPE_OPTIONS.some((option) => option.value === lower)) return lower;
  if (/^superellipse\(\s*-?(?:\d+\.?\d*|\.\d+)\s*\)$/i.test(compact)) return lower;
  return compact;
}

export function cornerShapeCurvature(value: string): number | null {
  const normalized = normalizeCornerShapeValue(value);
  const keywordValues: Record<string, number> = {
    scoop: -1,
    bevel: 0,
    round: 1,
    squircle: 2,
  };
  if (normalized in keywordValues) return keywordValues[normalized] ?? null;
  const match = normalized.match(/^superellipse\(\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)$/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1] ?? "");
  return Number.isFinite(parsed)
    ? Math.min(CORNER_SHAPE_SLIDER_MAX, Math.max(CORNER_SHAPE_SLIDER_MIN, parsed))
    : null;
}

export function cornerShapeFromCurvature(value: number): string {
  const clamped = Math.min(CORNER_SHAPE_SLIDER_MAX, Math.max(CORNER_SHAPE_SLIDER_MIN, value));
  const rounded = Number.parseFloat(clamped.toFixed(1));
  if (rounded === -1) return "scoop";
  if (rounded === 0) return "bevel";
  if (rounded === 1) return "round";
  if (rounded === 2) return "squircle";
  return `superellipse(${rounded})`;
}

function applyRadiusLayer(
  base: CornerValues,
  styles: Readonly<Record<string, string>>,
): { values: CornerValues; unsafe: string | null } {
  let values = { ...base };
  let unsafe: string | null = null;
  const shorthand = styles["border-radius"]?.trim();
  if (shorthand) {
    const parsed = parseBorderRadiusShorthand(shorthand);
    if (parsed) values = parsed;
    else unsafe = shorthand;
  }
  for (const corner of CORNERS) {
    const legacy = styles[LEGACY_LOGICAL_RADIUS_PROPERTIES[corner]]?.trim();
    if (legacy) values[corner] = legacy;
    const physical = styles[PHYSICAL_RADIUS_PROPERTIES[corner]]?.trim();
    if (physical) values[corner] = physical;
  }
  return { values, unsafe };
}

function applyShapeLayer(
  base: CornerValues,
  styles: Readonly<Record<string, string>>,
): CornerValues {
  let values = { ...base };
  const shorthand = styles["corner-shape"]?.trim();
  if (shorthand) values = parseCornerShapeShorthand(shorthand);
  for (const corner of CORNERS) {
    const logical = styles[LEGACY_LOGICAL_SHAPE_PROPERTIES[corner]]?.trim();
    if (logical) values[corner] = normalizeCornerShapeValue(logical);
    const physical = styles[PHYSICAL_SHAPE_PROPERTIES[corner]]?.trim();
    if (physical) values[corner] = normalizeCornerShapeValue(physical);
  }
  return values;
}

export function resolveCornerStyleState(
  inheritedStyles: Readonly<Record<string, string>>,
  currentStyles: Readonly<Record<string, string>>,
  resolvedPhysicalRadius?: CornerValues | null,
): CornerStyleState {
  const inheritedRadius = applyRadiusLayer(uniformCorners("0"), inheritedStyles);
  const currentRadius = applyRadiusLayer(inheritedRadius.values, currentStyles);
  const currentShorthand = currentStyles["border-radius"]?.trim();
  const currentHasSafeShorthand = Boolean(currentShorthand && parseBorderRadiusShorthand(currentShorthand));
  const currentOverridesEveryCorner = CORNERS.every((corner) => Boolean(
    currentStyles[PHYSICAL_RADIUS_PROPERTIES[corner]]?.trim()
      || currentStyles[LEGACY_LOGICAL_RADIUS_PROPERTIES[corner]]?.trim(),
  ));
  const unsafeRadiusShorthand = currentOverridesEveryCorner
    ? null
    : currentRadius.unsafe ?? (currentHasSafeShorthand ? null : inheritedRadius.unsafe);
  const logicalRadiusNeedsResolution = [...Object.values(LEGACY_LOGICAL_RADIUS_PROPERTIES)]
    .some((property) => Boolean(currentStyles[property]?.trim() || inheritedStyles[property]?.trim()));
  const radius = logicalRadiusNeedsResolution && resolvedPhysicalRadius
    ? { ...resolvedPhysicalRadius }
    : currentRadius.values;
  const inheritedShape = applyShapeLayer(uniformCorners("round"), inheritedStyles);
  const shape = applyShapeLayer(inheritedShape, currentStyles);
  return {
    radius,
    shape,
    radiusLinked: allCornersEqual(radius),
    shapeLinked: allCornersEqual(shape),
    unsafeRadiusShorthand,
    logicalRadiusNeedsResolution,
  };
}

export function canonicalRadiusUpdates(values: CornerValues): Record<string, string> {
  const updates: Record<string, string> = { "border-radius": "" };
  for (const property of Object.values(LEGACY_LOGICAL_RADIUS_PROPERTIES)) updates[property] = "";
  for (const corner of CORNERS) updates[PHYSICAL_RADIUS_PROPERTIES[corner]] = values[corner];
  return updates;
}

export function canonicalShapeUpdates(values: CornerValues): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const property of Object.values(PHYSICAL_SHAPE_PROPERTIES)) updates[property] = "";
  for (const property of Object.values(LEGACY_LOGICAL_SHAPE_PROPERTIES)) updates[property] = "";
  updates["corner-shape"] = buildCornerShapeShorthand(values);
  return updates;
}
