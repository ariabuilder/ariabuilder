import type { EditableNode, PropValue } from "./types";

function isDynamicProp(value: PropValue): boolean {
  return value.type !== "string" && value.type !== "bare";
}

function nodeHasDynamicProps(node: EditableNode): boolean {
  if (!("props" in node)) return false;
  return Object.values(node.props).some(isDynamicProp);
}

/**
 * Detects Astro values that cannot be safely cleared by an Inspector reset.
 * This intentionally walks through static formatting elements because their
 * descendants can still contain expressions or expression-valued attributes.
 */
export function containsDynamicAstroContent(
  nodes: readonly EditableNode[] | null | undefined,
): boolean {
  if (!nodes) return false;
  return nodes.some((node) => {
    if (
      node.kind === "expr"
      || node.kind === "map"
      || node.kind === "conditional"
      || node.kind === "raw"
    ) return true;
    if (nodeHasDynamicProps(node)) return true;
    if ("children" in node && Array.isArray(node.children)) {
      return containsDynamicAstroContent(node.children);
    }
    return false;
  });
}
