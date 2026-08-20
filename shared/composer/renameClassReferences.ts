/**
 * Rewrite class tokens on an EditableNode tree (Astro class / class:list).
 */

import { splitClassNames } from "./classAttr";
import type { EditableNode } from "./types";

function visitNodeTree(
  nodes: EditableNode[],
  visit: (node: EditableNode) => void,
): void {
  for (const node of nodes) {
    visit(node);
    if (node.kind === "conditional") {
      visitNodeTree(node.consequent, visit);
      if (node.alternate) visitNodeTree(node.alternate, visit);
      continue;
    }
    if ("children" in node && Array.isArray(node.children) && node.children.length) {
      visitNodeTree(node.children, visit);
    }
  }
}

/** Rename exact class tokens in props.class / props["class:list"]. */
export function renameClassReferences(
  nodes: EditableNode[],
  from: string,
  to: string,
): number {
  if (!from || !to || from === to) return 0;
  const quoted = new RegExp(
    `(["'])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`,
    "g",
  );
  let changed = 0;
  visitNodeTree(nodes, (node) => {
    if (node.kind === "raw" && node.name.toLowerCase() === "style") {
      const next = renameClassRuleCss(node.inner, from, to);
      if (next !== node.inner) {
        node.inner = next;
        changed += 1;
      }
    }
    if (
      node.kind !== "element" &&
      node.kind !== "component" &&
      node.kind !== "fragment" &&
      node.kind !== "slot" &&
      node.kind !== "raw"
    ) {
      return;
    }
    const plain = node.props?.class;
    if (plain?.type === "string") {
      const next = splitClassNames(plain.value)
        .map((name) => (name === from ? to : name))
        .join(" ");
      if (next !== plain.value) {
        plain.value = next;
        changed += 1;
      }
    }
    const list = node.props?.["class:list"];
    if (list?.type === "expr") {
      const next = list.value.replace(quoted, (_match, quote: string) => `${quote}${to}${quote}`);
      if (next !== list.value) {
        list.value = next;
        changed += 1;
      }
    } else if (list?.type === "string") {
      const next = splitClassNames(list.value)
        .map((name) => (name === from ? to : name))
        .join(" ");
      if (next !== list.value) {
        list.value = next;
        changed += 1;
      }
    }
  });
  return changed;
}

/** Rename `.from` selectors inside a CSS rule body. */
export function renameClassRuleCss(css: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.replace(new RegExp(`\\.${escaped}(?=[:\\s,{])`, "g"), `.${to}`);
}
