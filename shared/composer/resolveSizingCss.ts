/**
 * Figma-like Hug / Fill / Exact sizing.
 *
 * Modes persist as CSS custom properties on the inline style attribute
 * (`--aria-width-sizing`, `--aria-height-sizing`) and compile to real CSS
 * from the parent's layout (block / flex / grid).
 *
 * Only axes the user actually authored are resolved. The other axis is left
 * to CSS defaults so clicking Fill on width does not also hug height.
 */

import { peekAgentNodeClassTokens } from "./agentNodeClasses";
import { parentPathOf } from "./mutate";
import { nodeAtMarkerPath } from "./paths";
import { parseStyleAttr, setStyleProp } from "./styleAttr";
import type { AstroPropMap, EditableNode } from "./types";

export type SizeMode = "hug" | "fill" | "exact";
export type SizeAxis = "width" | "height";

export type ParentLayoutContext = {
  display: string;
  flexDirection: string;
  alignItems: string;
};

export const WIDTH_SIZING_PROP = "--aria-width-sizing";
export const HEIGHT_SIZING_PROP = "--aria-height-sizing";

export const RESOLVED_SIZING_PROPS = [
  "width",
  "height",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-self",
  "justify-self",
] as const;

export const SIZE_SECTION_PROPERTIES = [
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  WIDTH_SIZING_PROP,
  HEIGHT_SIZING_PROP,
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-self",
  "justify-self",
] as const;

const DISPLAY_UTILITY_TO_VALUE: Record<string, string> = {
  block: "block",
  "inline-block": "inline-block",
  inline: "inline",
  flex: "flex",
  "inline-flex": "inline-flex",
  grid: "grid",
  "inline-grid": "inline-grid",
  "grid-lanes": "grid-lanes",
  hidden: "none",
  table: "table",
  "inline-table": "inline-table",
  "flow-root": "flow-root",
  contents: "contents",
  "list-item": "list-item",
};

const FLEX_DIRECTION_UTILITY_TO_VALUE: Record<string, string> = {
  "flex-row": "row",
  "flex-col": "column",
  "flex-row-reverse": "row-reverse",
  "flex-col-reverse": "column-reverse",
};

const SIZE_KEYWORDS = [
  "auto",
  "none",
  "100%",
  "fit-content",
  "min-content",
  "max-content",
] as const;

function sizingProp(axis: SizeAxis): typeof WIDTH_SIZING_PROP | typeof HEIGHT_SIZING_PROP {
  return axis === "width" ? WIDTH_SIZING_PROP : HEIGHT_SIZING_PROP;
}

function stripVariantPrefixes(token: string): string {
  const parts = token.split(":");
  return parts[parts.length - 1] ?? token;
}

function classTokens(className: string | readonly string[] | undefined): string[] {
  if (!className) return [];
  const parts = typeof className === "string" ? [className] : [...className];
  return parts.flatMap((token) => token.split(/\s+/)).filter(Boolean);
}

function utilityValue(
  tokens: readonly string[],
  table: Record<string, string>,
): string | undefined {
  let found: string | undefined;
  for (const token of tokens) {
    const value = table[stripVariantPrefixes(token.trim())];
    if (value) found = value;
  }
  return found;
}

export function inferSizeModeFromCSSValue(value: string | undefined): SizeMode {
  if (!value) return "hug";
  const trimmed = value.trim();
  if (trimmed === "100%") return "fill";
  if (
    trimmed === "auto" ||
    trimmed === "fit-content" ||
    trimmed === "min-content" ||
    trimmed === "max-content"
  ) {
    return "hug";
  }
  return "exact";
}

export function resolveSizeMode(
  styles: Readonly<Record<string, string>>,
  axis: SizeAxis,
): SizeMode {
  const stored = styles[sizingProp(axis)]?.trim();
  if (stored === "hug" || stored === "fill" || stored === "exact") return stored;
  return inferSizeModeFromCSSValue(styles[axis]);
}

export function axisHasExplicitSizing(
  styles: Readonly<Record<string, string>> | undefined,
  axis: SizeAxis,
): boolean {
  if (!styles) return false;
  const stored = styles[sizingProp(axis)]?.trim();
  if (stored === "hug" || stored === "fill" || stored === "exact") return true;
  const dimension = styles[axis]?.trim();
  return Boolean(dimension) && dimension !== "auto";
}

export function nodeHasExplicitSizing(
  styles: Readonly<Record<string, string>> | undefined,
): boolean {
  return axisHasExplicitSizing(styles, "width") || axisHasExplicitSizing(styles, "height");
}

export function resolveParentLayoutContext(
  parentStyles: Readonly<Record<string, string>> | null | undefined,
  parentClassName?: string | readonly string[],
): ParentLayoutContext {
  const tokens = classTokens(parentClassName);
  const display =
    parentStyles?.display?.trim() ||
    utilityValue(tokens, DISPLAY_UTILITY_TO_VALUE) ||
    "block";
  return {
    display,
    flexDirection:
      parentStyles?.["flex-direction"]?.trim() ||
      utilityValue(tokens, FLEX_DIRECTION_UTILITY_TO_VALUE) ||
      "row",
    alignItems: parentStyles?.["align-items"]?.trim() || "stretch",
  };
}

export function mergeParentLayoutContext(
  authored: ParentLayoutContext | null,
  computed?: { display?: string; flexDirection?: string } | null,
): ParentLayoutContext | null {
  const display = computed?.display?.trim() || authored?.display || "";
  if (!display && !authored) return null;
  return {
    display: display || "block",
    flexDirection:
      computed?.flexDirection?.trim() || authored?.flexDirection || "row",
    alignItems: authored?.alignItems || "stretch",
  };
}

function stringProp(props: AstroPropMap, name: string): string {
  const value = props[name];
  return value?.type === "string" ? value.value : "";
}

export function layoutParentContextForPath(
  nodes: EditableNode[],
  path: string,
): ParentLayoutContext | null {
  let candidate = parentPathOf(path);
  while (candidate) {
    const node = nodeAtMarkerPath(nodes, candidate);
    if (node && (node.kind === "element" || node.kind === "component")) {
      const tokens = peekAgentNodeClassTokens(node.props).tokens;
      return resolveParentLayoutContext(
        parseStyleAttr(stringProp(node.props, "style")),
        tokens,
      );
    }
    candidate = parentPathOf(candidate);
  }
  return null;
}

function isFlexDisplay(display: string): boolean {
  return display === "flex" || display === "inline-flex";
}

function isGridDisplay(display: string): boolean {
  return display === "grid" || display === "inline-grid" || display === "grid-lanes";
}

function isColumnFlexDirection(flexDirection: string): boolean {
  return flexDirection.startsWith("column");
}

function isFlexPrimaryAxis(
  parent: ParentLayoutContext,
  axis: SizeAxis,
): boolean {
  const columnFlex = isColumnFlexDirection(parent.flexDirection);
  return (axis === "width" && !columnFlex) || (axis === "height" && columnFlex);
}

function applyFlexPrimaryFill(declarations: Record<string, string>): void {
  declarations["flex-grow"] = "1";
  declarations["flex-shrink"] = "1";
  declarations["flex-basis"] = "0";
}

function applyFlexPrimaryHug(declarations: Record<string, string>): void {
  declarations["flex-grow"] = "0";
  declarations["flex-shrink"] = "1";
  declarations["flex-basis"] = "auto";
}

function applyFlexCrossFill(
  declarations: Record<string, string>,
  axis: SizeAxis,
): void {
  declarations["align-self"] = "stretch";
  declarations[axis] = "auto";
}

function applyFlexCrossHug(
  declarations: Record<string, string>,
  axis: SizeAxis,
): void {
  declarations["align-self"] = "flex-start";
  declarations[axis] = "fit-content";
}

function applyBlockAxis(
  declarations: Record<string, string>,
  axis: SizeAxis,
  mode: SizeMode,
  exactValue?: string,
): void {
  if (mode === "exact") {
    if (exactValue) declarations[axis] = exactValue;
    return;
  }
  declarations[axis] = mode === "fill" ? "100%" : "fit-content";
}

function propsOwnedByAxis(
  axis: SizeAxis,
  parent: ParentLayoutContext | null,
): readonly string[] {
  if (parent && isFlexDisplay(parent.display)) {
    return isFlexPrimaryAxis(parent, axis)
      ? [axis, "flex-grow", "flex-shrink", "flex-basis"]
      : [axis, "align-self"];
  }
  if (parent && isGridDisplay(parent.display)) {
    return axis === "width" ? [axis, "justify-self"] : [axis, "align-self"];
  }
  return [axis];
}

function resolveAxisDeclarations(
  styles: Readonly<Record<string, string>>,
  parent: ParentLayoutContext | null,
  axis: SizeAxis,
): Record<string, string> {
  const mode = resolveSizeMode(styles, axis);
  const exactValue = mode === "exact" ? styles[axis] : undefined;
  const declarations: Record<string, string> = {};

  if (mode === "exact") {
    applyBlockAxis(declarations, axis, mode, exactValue);
    return declarations;
  }

  if (parent && isFlexDisplay(parent.display)) {
    if (isFlexPrimaryAxis(parent, axis)) {
      if (mode === "fill") applyFlexPrimaryFill(declarations);
      else applyFlexPrimaryHug(declarations);
      return declarations;
    }
    if (mode === "fill") applyFlexCrossFill(declarations, axis);
    else applyFlexCrossHug(declarations, axis);
    return declarations;
  }

  if (parent && isGridDisplay(parent.display)) {
    if (mode === "fill") {
      declarations[axis] = "100%";
      if (axis === "width") declarations["justify-self"] = "stretch";
      else declarations["align-self"] = "stretch";
    } else {
      declarations[axis] = "fit-content";
    }
    return declarations;
  }

  applyBlockAxis(declarations, axis, mode, exactValue);
  return declarations;
}

export function resolveSizingCss(
  styles: Readonly<Record<string, string>>,
  parent: ParentLayoutContext | null,
  axes?: readonly SizeAxis[],
): Record<string, string> {
  const resolvedAxes = axes ?? (["width", "height"] as const).filter((axis) =>
    axisHasExplicitSizing(styles, axis),
  );
  const declarations: Record<string, string> = {};
  for (const axis of resolvedAxes) {
    Object.assign(declarations, resolveAxisDeclarations(styles, parent, axis));
  }
  return declarations;
}

export function applySizingResolution(
  styles: Readonly<Record<string, string>>,
  parent: ParentLayoutContext | null,
  axes?: readonly SizeAxis[],
): Record<string, string> {
  const resolvedAxes = axes ?? (["width", "height"] as const).filter((axis) =>
    axisHasExplicitSizing(styles, axis),
  );
  if (resolvedAxes.length === 0) return { ...styles };

  const next = { ...styles };
  for (const axis of resolvedAxes) {
    for (const property of propsOwnedByAxis(axis, parent)) {
      delete next[property];
    }
  }
  Object.assign(next, resolveSizingCss(styles, parent, resolvedAxes));
  return next;
}

export function formatExactInputValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    trimmed === "auto" ||
    trimmed === "fit-content" ||
    trimmed === "min-content" ||
    trimmed === "max-content"
  ) {
    return "";
  }
  const pxMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)px$/i);
  if (pxMatch) return pxMatch[1] ?? "";
  return trimmed;
}

export function normalizeSizeValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("var(")) return trimmed;
  if ((SIZE_KEYWORDS as readonly string[]).includes(trimmed)) return trimmed;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return `${trimmed}px`;
  }
  return trimmed;
}

export function applySizeMode(
  styles: Readonly<Record<string, string>>,
  axis: SizeAxis,
  mode: SizeMode,
  parent: ParentLayoutContext | null,
  exactValue?: string,
): Record<string, string> {
  let next = setStyleProp({ ...styles }, sizingProp(axis), mode);
  if (mode === "exact") {
    if (exactValue !== undefined) {
      next = setStyleProp(next, axis, normalizeSizeValue(exactValue));
    }
  } else {
    next = setStyleProp(next, axis, "");
  }
  return applySizingResolution(next, parent, [axis]);
}

export function applyExactDimensions(
  styles: Readonly<Record<string, string>>,
  dimensions: { width?: number; height?: number },
  parent: ParentLayoutContext | null = null,
): Record<string, string> {
  let next = { ...styles };
  const axes: SizeAxis[] = [];
  if (dimensions.width != null) {
    next = setStyleProp(next, WIDTH_SIZING_PROP, "exact");
    next = setStyleProp(next, "width", `${Math.round(dimensions.width)}px`);
    axes.push("width");
  }
  if (dimensions.height != null) {
    next = setStyleProp(next, HEIGHT_SIZING_PROP, "exact");
    next = setStyleProp(next, "height", `${Math.round(dimensions.height)}px`);
    axes.push("height");
  }
  return axes.length ? applySizingResolution(next, parent, axes) : next;
}

export function resizeAxesForHandle(handle: string): {
  width: boolean;
  height: boolean;
} {
  return {
    width: handle.includes("e") || handle.includes("w"),
    height: handle.includes("n") || handle.includes("s"),
  };
}
