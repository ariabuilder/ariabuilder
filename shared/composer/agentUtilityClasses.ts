import { isLikelyUtilityClass, type ComposerFrameworkCapabilities } from "./frameworks";
import { splitClassNames } from "./classAttr";
import type { AstroPropMap, EditableNode } from "./types";

export function composerUtilityClassesEnabled(
  framework: ComposerFrameworkCapabilities | null | undefined,
): boolean {
  return Boolean(
    framework &&
    framework.primary !== "none" &&
    framework.confidence === "configured",
  );
}

export function unsupportedUtilityClassTokens(
  tokens: readonly string[],
  framework: ComposerFrameworkCapabilities | null | undefined,
  knownCustomClasses: ReadonlySet<string> = new Set(),
): string[] {
  if (composerUtilityClassesEnabled(framework)) return [];
  return [...new Set(tokens.filter(
    (token) => isLikelyUtilityClass(token) && !knownCustomClasses.has(token),
  ))].sort();
}

function staticClassTokens(props: AstroPropMap): string[] {
  const value = props["class:list"] ?? props.class;
  return value?.type === "string" ? splitClassNames(value.value) : [];
}

function childrenOf(node: EditableNode): EditableNode[] {
  if (node.kind === "conditional") {
    return [...node.consequent, ...(node.alternate ?? [])];
  }
  if (
    node.kind === "element" ||
    node.kind === "component" ||
    node.kind === "fragment" ||
    node.kind === "slot" ||
    node.kind === "map"
  ) {
    return node.children ?? [];
  }
  return [];
}

export function unsupportedUtilityClassesInNodes(input: {
  nodes: readonly EditableNode[];
  framework: ComposerFrameworkCapabilities | null | undefined;
  knownCustomClasses?: ReadonlySet<string>;
}): string[] {
  const tokens: string[] = [];
  const visit = (node: EditableNode) => {
    if ("props" in node && node.props) tokens.push(...staticClassTokens(node.props));
    for (const child of childrenOf(node)) visit(child);
  };
  for (const node of input.nodes) visit(node);
  return unsupportedUtilityClassTokens(
    tokens,
    input.framework,
    input.knownCustomClasses,
  );
}
