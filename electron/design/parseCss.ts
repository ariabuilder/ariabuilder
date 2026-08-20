import { parseSpacingShorthand } from "../../shared/composer/styleAttr";
import { isAriaBemSystemClass } from "../../shared/composer/ariaBem";
import {
  COLOR_SHADE_KEYS,
  SEMANTIC_CSS_VAR,
  createEmptyGlobalStyles,
  mergeGlobalStyles,
  type ColorShadeKey,
  type DesignClassRule,
  type DesignColorPalette,
  type DesignColorTokenReference,
  type DesignCssVar,
  type DesignGlobalStyles,
  type DesignSemanticColors,
  type DesignValueSource,
  type GlobalStyleElementKey,
} from "../../shared/design";
import { extractClassRulesByName } from "../../shared/designClassCss";

const CUSTOM_PROP_RE = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;

/** Allowed camelCase fields per top-level global-style target (flat bags). */
const KNOWN_FIELDS: Record<
  Exclude<GlobalStyleElementKey, "button">,
  ReadonlySet<string>
> = {
  root: new Set([
    "fontSize",
    "margin",
    "padding",
    "cursor",
    "caretColor",
    "selectionColor",
    "selectionBackgroundColor",
    "scrollBehavior",
    "outlineColor",
    "outlineWidth",
    "outlineStyle",
    "borderColor",
    "borderRadius",
  ]),
  body: new Set([
    "backgroundColor",
    "color",
    "fontFamily",
    "fontSize",
    "lineHeight",
    "fontWeight",
    "letterSpacing",
    "maxWidth",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "overflowX",
    "overflowY",
    "fontSmoothing",
    "textWrap",
  ]),
  heading: new Set([
    "color",
    "fontFamily",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "textTransform",
    "textWrap",
  ]),
  subheading: new Set([
    "color",
    "fontFamily",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
  ]),
  paragraph: new Set([
    "color",
    "fontFamily",
    "fontSize",
    "lineHeight",
    "letterSpacing",
    "maxWidth",
    "textWrap",
  ]),
  link: new Set([
    "color",
    "hoverColor",
    "visitedColor",
    "textDecoration",
    "underlineOffset",
    "fontWeight",
  ]),
  input: new Set([
    "backgroundColor",
    "color",
    "placeholderColor",
    "borderColor",
    "borderRadius",
    "fontFamily",
    "fontSize",
    "lineHeight",
    "paddingX",
    "paddingY",
    "focusRingColor",
  ]),
  section: new Set([
    "contentMaxWidth",
    "horizontalPadding",
    "verticalPadding",
    "sectionGap",
  ]),
  container: new Set(["maxWidth", "width"]),
};

const BUTTON_BASE_FIELDS = new Set([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "borderRadius",
  "paddingX",
  "paddingY",
  "borderWidth",
]);

const BUTTON_VARIANT_FIELDS = new Set([
  "backgroundColor",
  "color",
  "borderColor",
  "hoverBackgroundColor",
  "hoverColor",
  "hoverBorderColor",
]);

function isAntialiasedFontSmoothing(
  property: string,
  value: string,
): boolean {
  const trimmed = value.trim().toLowerCase();
  if (property === "fontSmoothing" && trimmed === "antialiased") return true;
  if (property === "WebkitFontSmoothing" && trimmed === "antialiased") {
    return true;
  }
  if (property === "MozOsxFontSmoothing" && trimmed === "grayscale") {
    return true;
  }
  return false;
}

/** Normalize CSS props into typed global-style field names. */
function normalizeDeclarations(
  declarations: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(declarations)) {
    if (!value?.trim()) continue;
    if (isAntialiasedFontSmoothing(key, value)) {
      out.fontSmoothing = "antialiased";
      continue;
    }
    let mapped = key;
    if (key === "paddingInline") mapped = "paddingX";
    else if (key === "paddingBlock") mapped = "paddingY";
    else if (key === "textUnderlineOffset") mapped = "underlineOffset";
    out[mapped] = value.trim();
  }
  return out;
}

function pickKnown(
  declarations: Record<string, string>,
  allowed: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(declarations)) {
    if (allowed.has(key) && value.trim()) out[key] = value.trim();
  }
  return out;
}

function splitSelectorParts(selector: string): string[] {
  return selector
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isHeadingGroup(parts: string[]): boolean {
  // Compound heading lists only (e.g. h1, h2, …). Standalone h2–h6 must not
  // overwrite the representative heading bucket filled by h1.
  return (
    parts.length >= 2 && parts.every((part) => /^h[1-6]$/i.test(part))
  );
}

function isSubheadingGroup(parts: string[]): boolean {
  return (
    parts.length > 0 &&
    parts.every(
      (part) =>
        /^h[4-6]$/i.test(part) || /data-aria-subheading/i.test(part),
    )
  );
}

type RuleTarget =
  | { kind: "flat"; key: Exclude<GlobalStyleElementKey, "button"> }
  | { kind: "button-base" }
  | { kind: "button-variant"; variant: string; hover: boolean }
  | { kind: "link-hover" }
  | { kind: "link-visited" }
  | { kind: "selection" }
  | { kind: "placeholder" }
  | { kind: "input-focus" }
  | { kind: "section-node" }
  | { kind: "section-content" };

function resolveTargets(selector: string): RuleTarget[] {
  const normalized = selector.trim().replace(/\s+/g, " ");
  const lower = normalized.toLowerCase();

  if (lower === "::selection" || lower === "::-moz-selection") {
    return [{ kind: "selection" }];
  }
  if (/^a:hover$/i.test(normalized)) return [{ kind: "link-hover" }];
  if (/^a:visited$/i.test(normalized)) return [{ kind: "link-visited" }];
  if (/::placeholder/i.test(normalized)) return [{ kind: "placeholder" }];
  if (/:focus-visible/i.test(normalized) && /input|textarea|select|\.input/i.test(normalized)) {
    return [{ kind: "input-focus" }];
  }

  const variantHover = normalized.match(
    /^\.btn-([a-z]+)(?::hover)?(?:,\s*\[data-button-variant=['"]?\1['"]?\](?::hover)?)?$/i,
  );
  if (variantHover) {
    const hover = /:hover/i.test(normalized);
    return [
      { kind: "button-variant", variant: variantHover[1]!.toLowerCase(), hover },
    ];
  }
  const variantAttr = normalized.match(
    /^\[data-button-variant=['"]?([a-z]+)['"]?\](?::hover)?$/i,
  );
  if (variantAttr) {
    return [
      {
        kind: "button-variant",
        variant: variantAttr[1]!.toLowerCase(),
        hover: /:hover/i.test(normalized),
      },
    ];
  }

  if (/data-aria-type=['"]?[Ss]ection['"]?/i.test(normalized) && />\s*\*/.test(normalized)) {
    return [{ kind: "section-content" }];
  }
  if (/data-aria-type=['"]?[Ss]ection['"]?/i.test(normalized)) {
    return [{ kind: "section-node" }];
  }

  const parts = splitSelectorParts(normalized);
  if (isHeadingGroup(parts) || (parts.length === 1 && /^h1$/i.test(parts[0]!))) {
    return [{ kind: "flat", key: "heading" }];
  }
  if (isSubheadingGroup(parts)) {
    return [{ kind: "flat", key: "subheading" }];
  }

  const targets: RuleTarget[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    // Skip complex descendants / pseudo (except handled above).
    if (/\s/.test(part) || part.includes(">") || part.includes("+") || part.includes("~")) {
      continue;
    }
    if (/^html$/i.test(part) || /^:root$/i.test(part)) {
      if (!seen.has("root")) {
        targets.push({ kind: "flat", key: "root" });
        seen.add("root");
      }
      continue;
    }
    if (/^body$/i.test(part)) {
      if (!seen.has("body")) {
        targets.push({ kind: "flat", key: "body" });
        seen.add("body");
      }
      continue;
    }
    if (/^p$/i.test(part)) {
      if (!seen.has("paragraph")) {
        targets.push({ kind: "flat", key: "paragraph" });
        seen.add("paragraph");
      }
      continue;
    }
    if (/^a$/i.test(part)) {
      if (!seen.has("link")) {
        targets.push({ kind: "flat", key: "link" });
        seen.add("link");
      }
      continue;
    }
    if (
      /^button$/i.test(part) ||
      /\[type=['"]?(?:button|submit|reset)['"]?\]/i.test(part) ||
      /^\.btn$/i.test(part) ||
      /\[data-button-variant\]/i.test(part)
    ) {
      if (!seen.has("button-base")) {
        targets.push({ kind: "button-base" });
        seen.add("button-base");
      }
      continue;
    }
    if (
      /^input(?:\b|:)/i.test(part) ||
      /^textarea$/i.test(part) ||
      /^select$/i.test(part) ||
      /^\.input$/i.test(part)
    ) {
      if (!seen.has("input")) {
        targets.push({ kind: "flat", key: "input" });
        seen.add("input");
      }
      continue;
    }
    if (/data-aria-type=['"]?[Cc]ontainer['"]?/i.test(part) || /^\.container$/i.test(part)) {
      if (!seen.has("container")) {
        targets.push({ kind: "flat", key: "container" });
        seen.add("container");
      }
    }
  }

  return targets;
}

function spacingLonghandsFromDeclarations(
  declarations: Record<string, string>,
  property: "margin" | "padding",
): Record<string, string> {
  const shorthand = declarations[property]?.trim() ?? "";
  const fallback = shorthand
    ? parseSpacingShorthand(shorthand)
    : { top: "", right: "", bottom: "", left: "" };
  const top = declarations[`${property}Top`]?.trim() || fallback.top;
  const right = declarations[`${property}Right`]?.trim() || fallback.right;
  const bottom = declarations[`${property}Bottom`]?.trim() || fallback.bottom;
  const left = declarations[`${property}Left`]?.trim() || fallback.left;
  const out: Record<string, string> = {};
  if (top) out[`${property}Top`] = top;
  if (right) out[`${property}Right`] = right;
  if (bottom) out[`${property}Bottom`] = bottom;
  if (left) out[`${property}Left`] = left;
  return out;
}

function applyFlat(
  result: DesignGlobalStyles,
  key: Exclude<GlobalStyleElementKey, "button">,
  declarations: Record<string, string>,
): void {
  const picked = pickKnown(declarations, KNOWN_FIELDS[key]);
  if (key === "body") {
    Object.assign(picked, spacingLonghandsFromDeclarations(declarations, "margin"));
    Object.assign(
      picked,
      spacingLonghandsFromDeclarations(declarations, "padding"),
    );
  }
  if (Object.keys(picked).length === 0) return;
  Object.assign(result[key], picked);
}

export function mapRulesToGlobalStyles(
  rules: Array<{ selector: string; declarations: Record<string, string> }>,
): DesignGlobalStyles {
  const result = createEmptyGlobalStyles();

  for (const rule of rules) {
    const declarations = normalizeDeclarations(rule.declarations);
    const targets = resolveTargets(rule.selector);

    for (const target of targets) {
      switch (target.kind) {
        case "flat":
          applyFlat(result, target.key, declarations);
          break;
        case "selection":
          if (declarations.color)
            result.root.selectionColor = declarations.color;
          if (declarations.backgroundColor)
            result.root.selectionBackgroundColor = declarations.backgroundColor;
          break;
        case "link-hover":
          if (declarations.color) result.link.hoverColor = declarations.color;
          break;
        case "link-visited":
          if (declarations.color) result.link.visitedColor = declarations.color;
          break;
        case "placeholder":
          if (declarations.color)
            result.input.placeholderColor = declarations.color;
          break;
        case "input-focus":
          if (declarations.outlineColor)
            result.input.focusRingColor = declarations.outlineColor;
          break;
        case "button-base": {
          const picked = pickKnown(declarations, BUTTON_BASE_FIELDS);
          Object.assign(result.button.base, picked);
          break;
        }
        case "button-variant": {
          const variant = target.variant as keyof typeof result.button.variants;
          if (!(variant in result.button.variants)) break;
          if (target.hover) {
            if (declarations.backgroundColor)
              result.button.variants[variant].hoverBackgroundColor =
                declarations.backgroundColor;
            if (declarations.color)
              result.button.variants[variant].hoverColor = declarations.color;
            if (declarations.borderColor)
              result.button.variants[variant].hoverBorderColor =
                declarations.borderColor;
          } else {
            const picked = pickKnown(declarations, BUTTON_VARIANT_FIELDS);
            Object.assign(result.button.variants[variant], picked);
          }
          break;
        }
        case "section-node":
          if (declarations.paddingX)
            result.section.horizontalPadding = declarations.paddingX;
          if (declarations.paddingY)
            result.section.verticalPadding = declarations.paddingY;
          if (declarations.gap)
            result.section.sectionGap = declarations.gap;
          break;
        case "section-content":
          if (declarations.maxWidth)
            result.section.contentMaxWidth = declarations.maxWidth;
          break;
      }
    }
  }

  return result;
}

export { mergeGlobalStyles };
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Collapse runs of whitespace (newlines + indent from multiline CSS) into
 * tidy single-line values, preserving spaces inside quoted strings.
 *
 * Multiline clamps like:
 *   clamp(
 *     3.13rem,
 *     calc(...)
 *   )
 * become `clamp(3.13rem, calc(...))` instead of `clamp(   3.13rem,    calc(...)`.
 */
export function normalizeCssDeclarationValue(value: string): string {
  let result = "";
  let inSingle = false;
  let inDouble = false;

  const peekSignificant = (from: number): string => {
    for (let j = from; j < value.length; j++) {
      const ch = value[j]!;
      if (!/\s/.test(ch)) return ch;
    }
    return "";
  };

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    const prevRaw = i > 0 ? value[i - 1]! : "";
    const prevOut = result.length > 0 ? result[result.length - 1]! : "";

    if (ch === "'" && !inDouble && prevRaw !== "\\") {
      inSingle = !inSingle;
      result += ch;
      continue;
    }
    if (ch === '"' && !inSingle && prevRaw !== "\\") {
      inDouble = !inDouble;
      result += ch;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      const next = peekSignificant(i + 1);
      // Drop whitespace at edges / before closers / before commas.
      if (!next || next === ")" || next === ",") continue;
      if (!prevOut || prevOut === "(" || prevOut === " ") continue;
      result += " ";
      continue;
    }

    if (!inSingle && !inDouble && ch === ",") {
      if (prevOut === " ") result = result.slice(0, -1);
      result += ", ";
      while (i + 1 < value.length && /\s/.test(value[i + 1]!)) i += 1;
      continue;
    }

    result += ch;
  }

  return result.trim();
}

function kebabToCamel(property: string): string {
  return property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

const CSS_HEX_COLOR_RE = /^#([0-9a-f]{3,8})$/i;
const CSS_PAINT_FUNCTION_RE =
  /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color-mix|color)\(/i;
const CSS_NAMED_COLOR_RE = /^[a-z]+$/i;

/** Hex / functional color values — used to promote uncategorized paint tokens. */
function looksLikeCssColorValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (CSS_HEX_COLOR_RE.test(trimmed)) return true;
  return CSS_PAINT_FUNCTION_RE.test(trimmed);
}

function looksLikePaintReadyColor(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return looksLikeCssColorValue(trimmed) || CSS_NAMED_COLOR_RE.test(trimmed);
}

/**
 * Paint-like values for `.color-*` class extraction (includes var() + names).
 */
function looksLikePaintColor(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (
    /^(?:inherit|initial|unset|revert|revert-layer|currentcolor|transparent)$/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  if (looksLikeCssColorValue(trimmed)) return true;
  if (/^var\s*\(\s*--[a-zA-Z0-9_-]+/i.test(trimmed)) return true;
  // CSS named colors (red, rebeccapurple, …)
  return /^[a-z]+$/i.test(trimmed) && trimmed.length <= 24;
}

function colorValueFromDeclarations(
  declarations: Record<string, string>,
): string | null {
  for (const key of ["color", "backgroundColor", "background"] as const) {
    const raw = declarations[key]?.trim();
    if (!raw) continue;
    if (key === "background" && /gradient|url\s*\(/i.test(raw)) continue;
    if (looksLikePaintColor(raw)) return raw;
  }
  return null;
}

function categorizeVar(
  name: string,
  value?: string,
): DesignCssVar["category"] {
  const lower = name.toLowerCase();
  // Tailwind v4 / design tokens: `--color-*` is always a color family.
  if (/^(?:color|colors)-/.test(lower)) {
    return "color";
  }
  if (
    /^(?:black|white|light|dark)$/.test(lower) ||
    /color|primary|secondary|accent|success|warning|error|destructive|info|bg|background|foreground|fill|stroke|neutral|gray|grey|slate|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|muted|card|popover|sidebar|ring|chart/.test(
      lower,
    ) ||
    /^(?:[a-z][\w]*)-(?:25|50|100|200|300|400|500|600|700|800|900|950|DEFAULT)$/.test(
      lower,
    )
  ) {
    return "color";
  }
  if (/space|spacing|gap|margin|padding|size|width|height|inset/.test(lower)) {
    return "spacing";
  }
  if (
    /font|text|leading|tracking|letter|line-height|typography/.test(lower)
  ) {
    return "typography";
  }
  if (/border|radius|ring|outline/.test(lower)) return "borders";
  if (/shadow|opacity|blur|filter|transition|animation|ease/.test(lower)) {
    return "effects";
  }
  if (/z-|zindex|layer|grid|flex|container/.test(lower)) return "layout";
  // Bare custom tokens with paint values (e.g. `--brand: hsl(...)`).
  if (value && looksLikeCssColorValue(value)) {
    return "color";
  }
  return "other";
}

function isVarReference(value: string): boolean {
  return /^var\s*\(/i.test(value.trim());
}

function prefersConcreteValue(next: string, previous: string): boolean {
  const nextIsVar = isVarReference(next);
  const prevIsVar = isVarReference(previous);
  if (prevIsVar && !nextIsVar) return true;
  if (!prevIsVar && nextIsVar) return false;
  return false;
}

export { isVarReference };

/** Extract `--name: value` pairs from a CSS string (whole file or block). */
export function extractCustomProperties(
  css: string,
  source: DesignValueSource,
): DesignCssVar[] {
  const cleaned = stripComments(css);
  const byName = new Map<string, DesignCssVar>();
  CUSTOM_PROP_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CUSTOM_PROP_RE.exec(cleaned))) {
    const name = match[1].trim();
    const value = normalizeCssDeclarationValue(match[2]);
    if (!name || !value) continue;
    const existing = byName.get(name);
    if (existing && !prefersConcreteValue(value, existing.value)) continue;
    byName.set(name, {
      name,
      value,
      source,
      category: categorizeVar(name, value),
    });
  }
  return [...byName.values()];
}

/**
 * Families that look like `.color-*` but are not design color tokens.
 * (Does not include black/white — those are real brand tokens when authored.)
 */
const COLOR_CLASS_SKIP = new Set([
  "transparent",
  "current",
  "inherit",
  "none",
  "auto",
  "full",
  "fit",
  "clip",
  "opacity",
  "transform",
]);

/**
 * Catalog `.color-{family}` / `.color-{family}-{shade}` utility classes that
 * set a paint property into synthetic `--color-*` custom properties so they
 * join the Colors / picker pipeline alongside real CSS variables.
 */
export function extractColorClassVariables(
  css: string,
  source: DesignValueSource,
): DesignCssVar[] {
  const rules = extractRules(css);
  const byName = new Map<string, DesignCssVar>();

  for (const rule of rules) {
    const match = rule.selector.match(
      /^\.color-([a-zA-Z][\w]*?)(?:-(\d{2,3}|DEFAULT))?$/,
    );
    if (!match) continue;

    const family = match[1]!.toLowerCase();
    if (COLOR_CLASS_SKIP.has(family)) continue;

    const shade = match[2];
    if (shade && !SHADE_SET.has(shade)) continue;

    const value = colorValueFromDeclarations(rule.declarations);
    if (!value) continue;

    const name = shade ? `color-${family}-${shade}` : `color-${family}`;
    const existing = byName.get(name);
    if (existing && !prefersConcreteValue(value, existing.value)) continue;

    byName.set(name, {
      name,
      value,
      source,
      category: "color",
    });
  }

  return [...byName.values()];
}

function parseDeclarations(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of body.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const prop = trimmed.slice(0, colon).trim();
    const value = normalizeCssDeclarationValue(trimmed.slice(colon + 1));
    if (!prop || !value || prop.startsWith("--")) continue;
    result[kebabToCamel(prop)] = value;
  }
  return result;
}

/**
 * Naive rule splitter — good enough for design hydration of typical globals.
 * Skips @rules (media/keyframes/font-face handled elsewhere).
 */
export function extractRules(
  css: string,
): Array<{ selector: string; declarations: Record<string, string> }> {
  const cleaned = stripComments(css);
  const rules: Array<{
    selector: string;
    declarations: Record<string, string>;
  }> = [];
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned))) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    if (!selector || selector.startsWith("@")) continue;
    const declarations = parseDeclarations(match[2]);
    if (Object.keys(declarations).length === 0) continue;
    rules.push({ selector, declarations });
  }
  return rules;
}

export function extractClassRules(
  css: string,
  source: DesignValueSource,
): DesignClassRule[] {
  const rules = extractRules(css);
  const out: DesignClassRule[] = [];
  const discovered = new Set<string>();
  for (const rule of rules) {
    const match = rule.selector.match(/^\.([a-zA-Z_][\w-]*)$/);
    if (!match) continue;
    if (isAriaBemSystemClass(match[1])) continue;
    const decls = Object.entries(rule.declarations)
      .map(([k, v]) => {
        const kebab = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        return `  ${kebab}: ${v};`;
      })
      .join("\n");
    out.push({
      name: match[1],
      css: `.${match[1]} {\n${decls}\n}`,
      source,
    });
    discovered.add(match[1]);
  }
  // Empty top-level class rules are still authored custom classes. They must
  // remain discoverable so Inspector chips can activate them for first edits.
  for (const rule of extractClassRulesByName(css).values()) {
    if (discovered.has(rule.name) || isAriaBemSystemClass(rule.name)) continue;
    out.push({ name: rule.name, css: rule.css, source });
  }
  return out;
}

const SHADE_SET = new Set<string>(COLOR_SHADE_KEYS);

/** Strip Tailwind v4 `--color-` / legacy `--colors-` prefixes. */
function normalizeColorVarName(name: string): string {
  return name.replace(/^(?:color|colors)-/, "");
}

function semanticKeyFromCssVar(
  cssVar: string,
): keyof DesignSemanticColors | null {
  const normalized = normalizeColorVarName(cssVar);
  for (const [key, slug] of Object.entries(SEMANTIC_CSS_VAR) as Array<
    [keyof DesignSemanticColors, string]
  >) {
    if (cssVar === slug || normalized === slug) return key;
  }
  return null;
}

function ensurePalette(
  map: Map<string, DesignColorPalette>,
  name: string,
  source: DesignValueSource,
): DesignColorPalette {
  let palette = map.get(name);
  if (!palette) {
    palette = { id: name, name, shades: {}, source };
    map.set(name, palette);
  }
  if (source === "aria") palette.source = "aria";
  return palette;
}

/** Group color-like custom properties into palettes + semantic tokens. */
export function groupColorVariables(variables: DesignCssVar[]): {
  palettes: DesignColorPalette[];
  semantic: DesignSemanticColors;
  remaining: DesignCssVar[];
} {
  const paletteMap = new Map<string, DesignColorPalette>();
  const semantic: DesignSemanticColors = {};
  const remaining: DesignCssVar[] = [];

  for (const variable of variables) {
    if (variable.category !== "color") {
      remaining.push(variable);
      continue;
    }

    const semanticKey = semanticKeyFromCssVar(variable.name);
    if (semanticKey) {
      semantic[semanticKey] = variable.value;
      continue;
    }

    const normalized = normalizeColorVarName(variable.name);

    const shadeMatch = normalized.match(
      /^([a-zA-Z][\w]*)-(\d{2,3}|DEFAULT)$/,
    );
    if (shadeMatch && SHADE_SET.has(shadeMatch[2])) {
      const palette = ensurePalette(
        paletteMap,
        shadeMatch[1],
        variable.source,
      );
      const shade = shadeMatch[2] as ColorShadeKey;
      const existing = palette.shades[shade];
      if (
        !existing ||
        (isVarReference(existing) && !isVarReference(variable.value))
      ) {
        palette.shades[shade] = variable.value;
      }
      continue;
    }

    // Bare palette token e.g. `--primary` / `--color-primary`
    if (/^[a-zA-Z][\w]*$/.test(normalized) && !normalized.includes("-")) {
      const palette = ensurePalette(paletteMap, normalized, variable.source);
      const existing = palette.shades.DEFAULT;
      if (
        !existing ||
        (isVarReference(existing) && !isVarReference(variable.value))
      ) {
        palette.shades.DEFAULT = variable.value;
      }
      continue;
    }

    remaining.push(variable);
  }

  return {
    palettes: [...paletteMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    semantic,
    remaining,
  };
}

const COLOR_UTILITY_PREFIXES =
  "text|bg|border|ring|outline|fill|stroke|from|to|via|decoration|accent|caret|divide|placeholder|shadow";

/** Families that are almost never color tokens even with a shade. */
const COLOR_UTILITY_SKIP = new Set([
  "transparent",
  "current",
  "inherit",
  "none",
  "solid",
  "dashed",
  "dotted",
  "double",
  "hidden",
  "auto",
  "full",
  "fit",
  "clip",
  "opacity",
  "white",
  "black",
  "transform",
  "decoration",
  "rendering",
  "top",
  "bottom",
  "left",
  "right",
  "start",
  "end",
  "box",
  "offset",
  "origin",
  "collapse",
  "separate",
  "spacing",
  "color", // border-color / text-color without a family
  "style",
  "width",
  "image",
  "slice",
  "source",
  "repeat",
  "fixed",
  "local",
  "scroll",
  "cover",
  "contain",
  "blend",
  "position",
  "size",
  "clip-path",
]);

/** Known color families allowed without a numeric shade (e.g. `bg-primary`). */
const COLOR_FAMILY_ALLOWLIST = new Set([
  "primary",
  "secondary",
  "muted",
  "accent",
  "destructive",
  "success",
  "warning",
  "error",
  "info",
  "neutral",
  "gray",
  "grey",
  "slate",
  "zinc",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "foreground",
  "background",
  "card",
  "popover",
  "sidebar",
  "chart",
]);

function isCssIdentChar(ch: string): boolean {
  return /[a-zA-Z0-9_-]/.test(ch);
}

function skipCssWhitespace(value: string, from: number): number {
  let index = from;
  while (index < value.length && /\s/.test(value[index]!)) index += 1;
  return index;
}

function closeCssCall(value: string, openParenIndex: number): number | null {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = openParenIndex; index < value.length; index += 1) {
    const ch = value[index]!;
    const prev = index > 0 ? value[index - 1]! : "";
    if (quote) {
      if (ch === quote && prev !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch !== ")") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return null;
}

type CssVarCallScan =
  | { kind: "none" }
  | { kind: "malformed" }
  | { kind: "call"; start: number; open: number; close: number };

function varCallAt(value: string, from: number): CssVarCallScan {
  let quote: "'" | '"' | null = null;
  for (let index = from; index < value.length; index += 1) {
    const ch = value[index]!;
    const prev = index > 0 ? value[index - 1]! : "";
    if (quote) {
      if (ch === quote && prev !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (value.slice(index, index + 3).toLowerCase() !== "var") continue;
    if (index > 0 && isCssIdentChar(prev)) continue;
    const open = skipCssWhitespace(value, index + 3);
    if (value[open] !== "(") continue;
    const close = closeCssCall(value, open);
    if (close == null) return { kind: "malformed" };
    return { kind: "call", start: index, open, close };
  }
  return { kind: "none" };
}

function parseVarArguments(
  inner: string,
): { name: string; fallback?: string } | null {
  const match = inner
    .trim()
    .match(/^--([a-zA-Z0-9_-]+)\s*(?:,\s*([\s\S]*))?$/);
  if (!match) return null;
  const fallback = match[2]?.trim();
  return fallback
    ? { name: match[1]!, fallback }
    : { name: match[1]! };
}

function lookupCustomProperty(
  name: string,
  vars: Map<string, string>,
): string | undefined {
  return (
    vars.get(name) ??
    vars.get(name.replace(/^(?:color|colors)-/, "")) ??
    vars.get(`color-${name}`)
  );
}

function resolveVarReference(
  name: string,
  fallback: string | undefined,
  vars: Map<string, string>,
  depth: number,
): string | null {
  const next = lookupCustomProperty(name, vars);
  if (next) return resolveColorValue(next, vars, depth + 1);
  if (fallback) return resolveColorValue(fallback, vars, depth + 1);
  return null;
}

function substituteEmbeddedVars(
  value: string,
  vars: Map<string, string>,
  depth: number,
): string | null {
  let result = "";
  let cursor = 0;
  while (cursor < value.length) {
    const call = varCallAt(value, cursor);
    if (call.kind === "malformed") return null;
    if (call.kind === "none") {
      result += value.slice(cursor);
      break;
    }
    const parsed = parseVarArguments(value.slice(call.open + 1, call.close));
    const resolved = parsed
      ? resolveVarReference(parsed.name, parsed.fallback, vars, depth)
      : null;
    if (!resolved) return null;
    result += `${value.slice(cursor, call.start)}${resolved}`;
    cursor = call.close + 1;
  }
  return result;
}

/**
 * Resolve `var(--token)` chains against a custom-property map.
 * Returns a paint-ready CSS color when possible, including `color-mix()`.
 */
export function resolveColorValue(
  value: string,
  vars: Map<string, string>,
  depth = 0,
): string | null {
  const trimmed = value.trim();
  if (!trimmed || depth > 8) return null;

  const substituted = substituteEmbeddedVars(trimmed, vars, depth);
  if (substituted == null) return null;
  if (substituted !== trimmed) {
    return resolveColorValue(substituted, vars, depth + 1);
  }

  return looksLikePaintReadyColor(trimmed) ? trimmed : null;
}

function buildVarMap(variables: DesignCssVar[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const variable of variables) {
    map.set(variable.name, variable.value);
    const normalized = variable.name.replace(/^(?:color|colors)-/, "");
    if (normalized !== variable.name && !map.has(normalized)) {
      map.set(normalized, variable.value);
    }
  }
  return map;
}

/**
 * Scan site CSS for Tailwind-style color utilities / @apply tokens
 * (e.g. `text-neutral-500`, `bg-primary-600`, `dark:text-neutral-50`).
 */
export function extractColorTokenReferences(
  css: string,
  variables: DesignCssVar[] = [],
): DesignColorTokenReference[] {
  const cleaned = stripComments(css);
  const familyMap = new Map<
    string,
    { shades: Set<string>; count: number }
  >();
  const vars = buildVarMap(variables);

  const re = new RegExp(
    `(?:^|[\\s"'\\\`\[(/])(?:[a-z0-9-]+:)*(?:${COLOR_UTILITY_PREFIXES})-([a-z][\\w]*)(?:-(\\d{2,3}|DEFAULT))?\\b`,
    "gi",
  );

  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned))) {
    const family = match[1].toLowerCase();
    if (COLOR_UTILITY_SKIP.has(family)) continue;
    if (
      /^(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|base|left|right|center|start|end|justify|wrap|nowrap|ellipsis|clip|balance|pretty)$/.test(
        family,
      )
    ) {
      continue;
    }

    const shadeToken = match[2];
    // Require a numeric shade unless the family is a known color token.
    if (!shadeToken) {
      if (!COLOR_FAMILY_ALLOWLIST.has(family)) continue;
    } else if (!SHADE_SET.has(shadeToken)) {
      continue;
    }

    const shade = shadeToken ?? "DEFAULT";
    let entry = familyMap.get(family);
    if (!entry) {
      entry = { shades: new Set(), count: 0 };
      familyMap.set(family, entry);
    }
    entry.count += 1;
    entry.shades.add(shade);
  }

  return [...familyMap.entries()]
    .map(([family, entry]) => {
      const shades = [...entry.shades].sort((a, b) => {
        if (a === "DEFAULT") return -1;
        if (b === "DEFAULT") return 1;
        return Number(a) - Number(b);
      });
      const preview: string[] = [];
      for (const shade of shades) {
        const keys =
          shade === "DEFAULT"
            ? [family, `color-${family}`, `${family}-DEFAULT`]
            : [
                `${family}-${shade}`,
                `color-${family}-${shade}`,
                `colors-${family}-${shade}`,
              ];
        for (const key of keys) {
          const raw = vars.get(key);
          if (!raw) continue;
          const resolved = resolveColorValue(raw, vars);
          if (resolved) {
            preview.push(resolved);
            break;
          }
        }
      }
      return {
        family,
        shades,
        count: entry.count,
        preview,
      };
    })
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}

/** Resolve palette shade values that are `var(--…)` aliases. */
export function resolvePaletteColors(
  palettes: DesignColorPalette[],
  variables: DesignCssVar[],
): DesignColorPalette[] {
  const vars = buildVarMap(variables);
  for (const palette of palettes) {
    for (const [shade, value] of Object.entries(palette.shades)) {
      if (!value) continue;
      vars.set(`${palette.name}-${shade}`, value);
      if (shade === "DEFAULT") vars.set(palette.name, value);
    }
    // Also register under color- prefix lookups
    for (const [shade, value] of Object.entries(palette.shades)) {
      if (!value) continue;
      if (shade === "DEFAULT") vars.set(`color-${palette.name}`, value);
      else vars.set(`color-${palette.name}-${shade}`, value);
    }
  }

  return palettes.map((palette) => {
    const shades: DesignColorPalette["shades"] = {};
    for (const [shade, value] of Object.entries(palette.shades)) {
      if (!value) continue;
      shades[shade as ColorShadeKey] =
        resolveColorValue(value, vars) ?? value;
    }
    return { ...palette, shades };
  });
}
