/**
 * List marker / position presentation for the Inspector List section.
 * Tailwind `list-*` utilities and `list-style` shorthand both paint markers;
 * the inspector owns a single inline `list-style` shorthand and strips the
 * utilities so they cannot win the cascade.
 */

import {
  removeClassListTokens,
  splitClassNames,
} from "./classAttr";
import { stringFieldDisplay } from "./propValueCodec";
import { parseStyleAttr, serializeStyleAttr } from "./styleAttr";
import type { ElementNode, PropValue } from "./types";

type ListMode = "unordered" | "ordered" | "description";

export const UNORDERED_LIST_MARKERS = [
  "disc",
  "circle",
  "square",
  "none",
] as const;
export const ORDERED_LIST_MARKERS = [
  "decimal",
  "lower-alpha",
  "upper-alpha",
  "lower-roman",
  "upper-roman",
] as const;

const UNORDERED_MARKER_SET = new Set<string>(UNORDERED_LIST_MARKERS);
const ORDERED_MARKER_SET = new Set<string>([
  ...ORDERED_LIST_MARKERS,
  "decimal-leading-zero",
  "lower-latin",
  "upper-latin",
  "lower-greek",
]);
const LIST_POSITIONS = new Set(["inside", "outside"]);
const LIST_STYLE_UTILITY =
  /^(?:(?:[^:\s]+):)*(?:list-(?:none|disc|decimal|circle|square|inside|outside)|list-image-.+)$/;
const LIST_MARKER_FROM_CLASS: Record<string, string> = {
  none: "none",
  disc: "disc",
  circle: "circle",
  square: "square",
  decimal: "decimal",
};
export const LIST_PRESENTATION_PROPERTIES = [
  "list-style",
  "list-style-type",
  "list-style-position",
] as const;
const START_PADDING_UTILITY =
  /^(?:(?:[^:\s]+):)*(?:p|px|pl|ps)-.+$/;
const ZERO_PADDING_UTILITY =
  /^(?:(?:[^:\s]+):)*(?:p|px|pl|ps)-0$/;
/** UA-like indent so outside markers have somewhere to paint after Tailwind/preflight `padding: 0`. */
export const LIST_OUTSIDE_MARKER_INDENT = "1.5em";

export type ListPresentationUpdate = {
  type?: string;
  position?: string;
};

export function elementListMode(node: ElementNode): ListMode {
  const tag = node.name.toLowerCase();
  return tag === "ol" ? "ordered" : tag === "dl" ? "description" : "unordered";
}

export function isListStyleUtility(token: string): boolean {
  return LIST_STYLE_UTILITY.test(token);
}

export function nativeListMarker(mode: ListMode): string {
  return mode === "ordered" ? "decimal" : "disc";
}

export function compatibleListMarker(
  mode: ListMode,
  marker: string,
): string {
  if (mode === "ordered") {
    return UNORDERED_MARKER_SET.has(marker) ? "decimal" : marker;
  }
  if (mode === "unordered") {
    return ORDERED_MARKER_SET.has(marker) ? "none" : marker;
  }
  return marker;
}

function styleMap(node: ElementNode): Record<string, string> {
  const style = node.props.style;
  if (style && style.type !== "string") return {};
  return parseStyleAttr(stringFieldDisplay(style).text);
}

function classValues(node: ElementNode): PropValue[] {
  return [node.props.class, node.props["class:list"]].filter(
    (value): value is PropValue => Boolean(value),
  );
}

function classTokens(node: ElementNode): string[] {
  const tokens: string[] = [];
  for (const value of classValues(node)) {
    if (value.type === "string") tokens.push(...splitClassNames(value.value));
    else if (value.type === "expr") {
      const literal = /(["'])(.*?)\1/g;
      let match: RegExpExecArray | null;
      while ((match = literal.exec(value.value))) {
        tokens.push(...splitClassNames(match[2] ?? ""));
      }
    }
  }
  return tokens;
}

function utilityBase(token: string): string {
  const parts = token.split(":");
  return parts[parts.length - 1] ?? token;
}

function markerFromClass(node: ElementNode): string | undefined {
  let marker: string | undefined;
  for (const token of classTokens(node)) {
    if (!isListStyleUtility(token)) continue;
    const base = utilityBase(token);
    const match = /^list-(none|disc|decimal|circle|square)$/.exec(base);
    if (match?.[1]) marker = LIST_MARKER_FROM_CLASS[match[1]] ?? match[1];
  }
  return marker;
}

function positionFromClass(node: ElementNode): string | undefined {
  let position: string | undefined;
  for (const token of classTokens(node)) {
    if (!isListStyleUtility(token)) continue;
    const base = utilityBase(token);
    if (base === "list-inside") position = "inside";
    if (base === "list-outside") position = "outside";
  }
  return position;
}

/** Parse CSS `list-style` shorthand into type / position (image ignored). */
export function parseListStyleShorthand(value: string): {
  type?: string;
  position?: string;
} {
  const tokens = value
    .replace(/url\((?:'(?:\\'|[^'])*'|"(?:\\"|[^"])*"|[^)]*)\)/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let type: string | undefined;
  let position: string | undefined;
  let noneCount = 0;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (LIST_POSITIONS.has(lower)) {
      position = lower;
      continue;
    }
    if (lower === "none") {
      noneCount += 1;
      continue;
    }
    if (UNORDERED_MARKER_SET.has(lower) || ORDERED_MARKER_SET.has(lower)) {
      type = lower;
    }
  }
  if (!type && noneCount) type = "none";
  return { type, position };
}

/** Resolve marker / position from a CSS declaration map (class body or inline style). */
export function resolveListPresentationFromStyles(
  styles: Readonly<Record<string, string>>,
): {
  type?: string;
  position?: string;
} {
  const shorthand = parseListStyleShorthand(styles["list-style"] ?? "");
  return {
    type: styles["list-style-type"] || shorthand.type,
    position: styles["list-style-position"] || shorthand.position,
  };
}

export function applyListPresentationToStyles(
  styles: Readonly<Record<string, string>>,
  next: ListPresentationUpdate,
  fallback: { type: string; position: string },
): Record<string, string> {
  const current = resolveListPresentationFromStyles(styles);
  const type = next.type ?? current.type ?? fallback.type;
  const position = next.position ?? current.position ?? fallback.position;
  const result = { ...styles };
  for (const key of LIST_PRESENTATION_PROPERTIES) delete result[key];
  result["list-style"] = serializeListStyleShorthand(type, position);
  return result;
}

export function clearListPresentationFromStyles(
  styles: Readonly<Record<string, string>>,
): Record<string, string> {
  const result = { ...styles };
  for (const key of LIST_PRESENTATION_PROPERTIES) delete result[key];
  return result;
}

export function listPresentationHasChangesFromStyles(
  styles: Readonly<Record<string, string>>,
): boolean {
  return LIST_PRESENTATION_PROPERTIES.some((key) => Boolean(styles[key]));
}

function authoredListStyle(node: ElementNode): {
  type?: string;
  position?: string;
} {
  const fromStyles = resolveListPresentationFromStyles(styleMap(node));
  return {
    type: fromStyles.type || markerFromClass(node),
    position: fromStyles.position || positionFromClass(node),
  };
}

export function resolveListMarker(
  node: ElementNode,
  mode: ListMode = elementListMode(node),
): string {
  return authoredListStyle(node).type || nativeListMarker(mode);
}

export function resolveListPosition(node: ElementNode): string {
  return authoredListStyle(node).position || "outside";
}

function writeStyleMap(node: ElementNode, next: Record<string, string>) {
  const serialized = serializeStyleAttr(next);
  if (serialized) node.props.style = { type: "string", value: serialized };
  else delete node.props.style;
}

function writeClassValue(
  node: ElementNode,
  name: "class" | "class:list",
  value: PropValue | undefined,
) {
  if (value) node.props[name] = value;
  else delete node.props[name];
}

function stripListStyleUtilities(node: ElementNode) {
  for (const name of ["class", "class:list"] as const) {
    const current = node.props[name];
    if (!current) continue;
    const removed = removeClassListTokens(current, isListStyleUtility);
    if (removed.safe) writeClassValue(node, name, removed.value);
  }
}

function serializeListStyleShorthand(type: string, position: string): string {
  if (type === "none") return position === "inside" ? "none inside" : "none";
  // Trailing `none` resets `list-style-image` after a previous `list-style: none`.
  return position === "inside" ? `${type} inside none` : `${type} outside none`;
}

function isVisibleLength(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  return Boolean(trimmed) && !/^0+(?:px|em|rem|%)?$/.test(trimmed);
}

function hasStartPadding(node: ElementNode, styles: Record<string, string>): boolean {
  if (
    isVisibleLength(styles["padding-inline-start"])
    || isVisibleLength(styles["padding-left"])
    || isVisibleLength(styles["padding-inline"])
    || isVisibleLength(styles.padding)
  ) return true;
  return classTokens(node).some((token) =>
    START_PADDING_UTILITY.test(token) && !ZERO_PADDING_UTILITY.test(token)
  );
}

function syncOutsideMarkerIndent(
  node: ElementNode,
  styles: Record<string, string>,
  type: string,
  position: string,
) {
  const indent = styles["padding-inline-start"];
  if (type === "none" || position !== "outside") {
    if (indent === LIST_OUTSIDE_MARKER_INDENT) delete styles["padding-inline-start"];
    return;
  }
  if (!hasStartPadding(node, styles)) {
    styles["padding-inline-start"] = LIST_OUTSIDE_MARKER_INDENT;
  }
}

export function applyListPresentation(
  node: ElementNode,
  next: ListPresentationUpdate,
): boolean {
  if (node.props.style && node.props.style.type !== "string") return false;
  const mode = elementListMode(node);
  const type = next.type ?? resolveListMarker(node, mode);
  const position = next.position ?? resolveListPosition(node);
  const styles = styleMap(node);
  for (const key of LIST_PRESENTATION_PROPERTIES) delete styles[key];
  styles["list-style"] = serializeListStyleShorthand(type, position);
  stripListStyleUtilities(node);
  syncOutsideMarkerIndent(node, styles, type, position);
  writeStyleMap(node, styles);
  return true;
}

export function clearListPresentation(node: ElementNode): boolean {
  if (node.props.style && node.props.style.type !== "string") {
    stripListStyleUtilities(node);
    return false;
  }
  const styles = styleMap(node);
  for (const key of LIST_PRESENTATION_PROPERTIES) delete styles[key];
  if (styles["padding-inline-start"] === LIST_OUTSIDE_MARKER_INDENT) {
    delete styles["padding-inline-start"];
  }
  stripListStyleUtilities(node);
  writeStyleMap(node, styles);
  return true;
}

export function syncListMarkerForMode(
  node: ElementNode,
  mode: ListMode,
  fromMarker = resolveListMarker(node),
): void {
  if (mode === "description") {
    clearListPresentation(node);
    return;
  }
  applyListPresentation(node, {
    type: compatibleListMarker(mode, fromMarker),
  });
}

export function listPresentationCss(node: ElementNode | null | undefined): string {
  if (!node) return "";
  const styles = styleMap(node);
  const shorthand = styles["list-style"];
  return serializeStyleAttr({
    "list-style": shorthand,
    ...(shorthand
      ? {}
      : {
          "list-style-type": styles["list-style-type"],
          "list-style-position": styles["list-style-position"],
        }),
    "padding-inline-start": styles["padding-inline-start"],
  });
}

export function elementListHasPresentationChanges(
  node: ElementNode,
  mode: ListMode = elementListMode(node),
): boolean {
  if (mode !== "unordered") return true;
  const styles = styleMap(node);
  if (LIST_PRESENTATION_PROPERTIES.some((key) => styles[key])) return true;
  return classTokens(node).some(isListStyleUtility);
}

export function elementListStyleIsExpression(node: ElementNode): boolean {
  return Boolean(node.props.style && node.props.style.type !== "string");
}
