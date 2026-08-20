import { nodeAtMarkerPath } from "./paths";
import type { AstroCollectionBinding, AstroDocumentModel, EditableNode } from "./types";

export type AstroCollectionBindingMap = Readonly<Record<string, AstroCollectionBinding>>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mergeAstroCollectionBindings(
  bindings: readonly (AstroCollectionBinding | null | undefined)[],
): AstroCollectionBinding | null {
  const present = bindings.filter((binding): binding is AstroCollectionBinding => Boolean(binding));
  if (!present.length) return null;
  const cardinalities = new Set(present.map((binding) => binding.cardinality));
  return {
    collections: [...new Set(present.flatMap((binding) => binding.collections))].sort(),
    cardinality: cardinalities.size === 1 ? present[0]!.cardinality : "unknown",
    dynamic: present.some((binding) => binding.dynamic) || undefined,
  };
}

export function astroCollectionBindingForExpression(
  expression: string,
  bindings: AstroCollectionBindingMap,
): AstroCollectionBinding | null {
  return mergeAstroCollectionBindings(Object.entries(bindings).map(([variable, binding]) =>
    new RegExp(`\\b${escapeRegExp(variable)}\\b`).test(expression) ? binding : null,
  ));
}

function propsForNode(node: EditableNode) {
  return node.kind === "element" || node.kind === "component" || node.kind === "slot" || node.kind === "raw"
    ? node.props
    : null;
}

export function astroCollectionBindingForNode(
  node: EditableNode,
  bindings: AstroCollectionBindingMap,
): AstroCollectionBinding | null {
  const candidates: string[] = [];
  if (node.kind === "expr") candidates.push(node.value);
  if (node.kind === "map") candidates.push(node.head);
  if (node.kind === "conditional") candidates.push(node.test);
  const props = propsForNode(node);
  if (props) {
    for (const prop of Object.values(props)) {
      if (prop.type === "expr" || prop.type === "shorthand" || prop.type === "spread") candidates.push(prop.value);
    }
  }
  if (node.kind === "element" && Array.isArray(node.children)) {
    for (const child of node.children) if (child.kind === "expr") candidates.push(child.value);
  }
  return mergeAstroCollectionBindings(candidates.map((candidate) =>
    astroCollectionBindingForExpression(candidate, bindings),
  ));
}

/** Collection provenance for the exact selected source node. */
export function detectAstroCollectionsAtPath(
  model: AstroDocumentModel,
  path: string,
): string[] {
  const node = nodeAtMarkerPath(model.nodes, path);
  if (!node) return [];
  return astroCollectionBindingForNode(node, model.collectionBindings ?? {})?.collections ?? [];
}

/** Collection bindings passed through the props of a component invocation. */
export function astroCollectionPropsForComponent(
  node: EditableNode,
  bindings: AstroCollectionBindingMap,
): Record<string, AstroCollectionBinding> {
  if (node.kind !== "component") return {};
  const props: Record<string, AstroCollectionBinding> = {};
  for (const [name, prop] of Object.entries(node.props)) {
    if (prop.type !== "expr" && prop.type !== "shorthand") continue;
    const binding = astroCollectionBindingForExpression(prop.value, bindings);
    if (binding) props[name] = binding;
  }
  return props;
}
