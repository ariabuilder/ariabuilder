/**
 * Initial selection when opening a component/layout file for drill-in.
 * Prefer <body> (layouts), else first element/component, else first node.
 */

import type { EditableNode } from "./types";
import { markerPathForNodeId } from "./paths";

function findElementByTag(
  nodes: EditableNode[],
  tag: string,
): EditableNode | null {
  const want = tag.toLowerCase();
  for (const n of nodes) {
    if (n.kind === "element" && n.name.toLowerCase() === want) return n;
    if (
      (n.kind === "element" ||
        n.kind === "component" ||
        n.kind === "fragment" ||
        n.kind === "slot" ||
        n.kind === "map") &&
      Array.isArray(n.children)
    ) {
      const found = findElementByTag(n.children, tag);
      if (found) return found;
    }
  }
  return null;
}

export function openingSelectionNode(
  nodes: EditableNode[],
): EditableNode | null {
  const list = Array.isArray(nodes) ? nodes : [];
  return (
    findElementByTag(list, "body") ||
    list.find((n) => n.kind === "element" || n.kind === "component") ||
    list[0] ||
    null
  );
}

/** Marker path for the opening selection, or null. */
export function openingSelectionPath(nodes: EditableNode[]): string | null {
  const node = openingSelectionNode(nodes);
  if (!node) return null;
  return markerPathForNodeId(nodes, node.id);
}
