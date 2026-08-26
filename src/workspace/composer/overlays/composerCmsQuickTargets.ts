import {
  describeComposerCmsSelection,
  labelForNode,
  markerPathForNodeId,
  nodeAtMarkerPath,
} from "../../../../shared/composer";
import type { AstroDocumentModel, EditableNode } from "../../../../shared/composer/types";
import type { CmsQuickTargetKind } from "../../../../shared/composer/cmsFieldOptions";

export type ComposerCmsQuickControl = "text" | "image" | "link" | "loop";

export type ComposerCmsQuickTarget = {
  id: string;
  nodeId: string;
  path: string;
  nodeLabel: string;
  targetKind: CmsQuickTargetKind;
  bindingKind: "text" | "prop";
  propName?: string;
};

function tagName(node: EditableNode | null | undefined): string {
  return node && node.kind === "element" ? node.name.toLowerCase() : "";
}

function children(node: EditableNode): EditableNode[] {
  if (node.kind === "conditional") return [...node.consequent, ...(node.alternate ?? [])];
  if (node.kind === "element" || node.kind === "component" || node.kind === "fragment" || node.kind === "slot" || node.kind === "map") {
    return node.children ?? [];
  }
  return [];
}

function textTarget(model: AstroDocumentModel, path: string): ComposerCmsQuickTarget | null {
  const owner = nodeAtMarkerPath(model.nodes, path);
  const targetPath = describeComposerCmsSelection(model, path).textTargetPath;
  const target = targetPath ? nodeAtMarkerPath(model.nodes, targetPath) : null;
  if (!owner || !target || (target.kind !== "text" && target.kind !== "expr")) return null;
  return {
    id: `${target.id}:text`,
    nodeId: target.id,
    path: targetPath!,
    nodeLabel: labelForNode(owner),
    targetKind: "text",
    bindingKind: "text",
  };
}

function propTarget(
  node: EditableNode,
  path: string,
  propName: string,
  targetKind: CmsQuickTargetKind,
  label: string,
): ComposerCmsQuickTarget | null {
  if (!(node.kind === "element" || node.kind === "component" || node.kind === "slot" || node.kind === "raw")) return null;
  return {
    id: `${node.id}:${propName}`,
    nodeId: node.id,
    path,
    nodeLabel: label,
    targetKind,
    bindingKind: "prop",
    propName,
  };
}

function imageTargets(node: EditableNode, path: string): ComposerCmsQuickTarget[] {
  if (tagName(node) !== "img") return [];
  const label = labelForNode(node);
  return [
    propTarget(node, path, "src", "image", `${label} source`),
    propTarget(node, path, "alt", "alt", `${label} alt text`),
  ].filter((target): target is ComposerCmsQuickTarget => Boolean(target));
}

function linkTargets(model: AstroDocumentModel, node: EditableNode, path: string): ComposerCmsQuickTarget[] {
  if (tagName(node) !== "a") return [];
  const label = labelForNode(node);
  return [
    propTarget(node, path, "href", "link", `${label} destination`),
    textTarget(model, path),
  ].filter((target): target is ComposerCmsQuickTarget => Boolean(target));
}

function visit(
  model: AstroDocumentModel,
  node: EditableNode,
  output: ComposerCmsQuickTarget[],
): void {
  const path = markerPathForNodeId(model.nodes, node.id);
  if (!path) return;
  const tag = tagName(node);
  if (tag === "img") output.push(...imageTargets(node, path));
  else if (tag === "a") output.push(...linkTargets(model, node, path));
  else if (/^h[1-6]$/.test(tag) || ["p", "span", "li", "dt", "dd", "figcaption", "blockquote", "time", "button"].includes(tag)) {
    const target = textTarget(model, path);
    if (target) output.push(target);
  }
  for (const child of children(node)) visit(model, child, output);
}

export function composerCmsQuickTargets(
  model: AstroDocumentModel,
  selectedPath: string,
  control: ComposerCmsQuickControl,
): ComposerCmsQuickTarget[] {
  const selected = nodeAtMarkerPath(model.nodes, selectedPath);
  if (!selected) return [];
  if (control === "text") {
    const target = textTarget(model, selectedPath);
    return target ? [target] : [];
  }
  if (control === "image") {
    if (tagName(selected) === "img") return imageTargets(selected, selectedPath);
    const output: ComposerCmsQuickTarget[] = [];
    visit(model, selected, output);
    return output.filter((target) => target.targetKind === "image" || target.targetKind === "alt");
  }
  if (control === "link") return linkTargets(model, selected, selectedPath);
  const output: ComposerCmsQuickTarget[] = [];
  visit(model, selected, output);
  const seen = new Set<string>();
  return output.filter((target) => {
    if (seen.has(target.id)) return false;
    seen.add(target.id);
    return true;
  });
}

export function composerCmsQuickTargetExpression(
  model: AstroDocumentModel,
  target: ComposerCmsQuickTarget,
): string {
  const node = nodeAtMarkerPath(model.nodes, target.path);
  if (target.bindingKind === "text") return node?.kind === "expr" ? node.value : "";
  const owner = nodeAtMarkerPath(model.nodes, target.path);
  if (!owner || !("props" in owner) || !target.propName) return "";
  const prop = owner.props[target.propName];
  return prop?.type === "expr" ? prop.value : "";
}
