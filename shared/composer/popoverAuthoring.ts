import {
  allocNodeId,
  locateAtPath,
  parentAcceptsChildAtPath,
  parentPathOf,
  type MutateResult,
} from "./mutate";
import type {
  AstroDocumentModel,
  EditableNode,
  ElementNode,
  PropValue,
} from "./types";

export type ComposerPopoverMode = "auto" | "hint" | "manual";
export type ComposerPopoverAction = "toggle" | "show" | "hide";
export type ComposerPopoverElement = ElementNode & {
  props: ElementNode["props"] & { popover: PropValue };
};
export type NativePopoverButtonElement = ElementNode & { name: "button" };

export type ComposerPopoverTrigger = {
  path: string;
  node: ElementNode;
  targetId: string;
  action: ComposerPopoverAction;
  label: string;
};

export type ComposerPopoverTarget = {
  path: string;
  node: ElementNode;
  id: string | null;
  idState: "static" | "missing" | "dynamic" | "duplicate";
  mode: ComposerPopoverMode | "dynamic";
  label: string;
  triggers: ComposerPopoverTrigger[];
};

type ElementEntry = { path: string; node: ElementNode };

function childEntries(node: EditableNode, path: string): Array<{ path: string; node: EditableNode }> {
  if (node.kind === "conditional") {
    if (node.mode === "ternary") {
      return [
        ...node.consequent.map((child, index) => ({ path: `${path}.t.${index}`, node: child })),
        ...(node.alternate ?? []).map((child, index) => ({ path: `${path}.f.${index}`, node: child })),
      ];
    }
    return node.consequent.map((child, index) => ({ path: `${path}.${index}`, node: child }));
  }
  if (
    node.kind === "element" || node.kind === "component" || node.kind === "fragment"
    || node.kind === "slot" || node.kind === "map"
  ) {
    return (node.children ?? []).map((child, index) => ({ path: `${path}.${index}`, node: child }));
  }
  return [];
}

function elementEntries(model: AstroDocumentModel): ElementEntry[] {
  const entries: ElementEntry[] = [];
  const visit = (node: EditableNode, path: string) => {
    if (node.kind === "element") entries.push({ path, node });
    for (const child of childEntries(node, path)) visit(child.node, child.path);
  };
  model.nodes.forEach((node, index) => visit(node, String(index)));
  return entries;
}

function staticProp(node: ElementNode, name: string): string | null {
  const value = node.props[name];
  return value?.type === "string" ? value.value.trim() || null : null;
}

function textLabel(node: EditableNode): string {
  const parts: string[] = [];
  const visit = (candidate: EditableNode) => {
    if (candidate.kind === "text") {
      const value = candidate.value.replace(/\s+/g, " ").trim();
      if (value) parts.push(value);
      return;
    }
    for (const child of childEntries(candidate, "")) visit(child.node);
  };
  visit(node);
  const text = parts.join(" ").trim();
  return text.length > 36 ? `${text.slice(0, 35)}…` : text;
}

function popoverMode(node: ElementNode): ComposerPopoverTarget["mode"] {
  const value = node.props.popover;
  if (!value || value.type === "bare") return "auto";
  if (value.type !== "string") return "dynamic";
  return value.value === "hint" || value.value === "manual" ? value.value : "auto";
}

function triggerAction(node: ElementNode): ComposerPopoverAction {
  const value = staticProp(node, "popovertargetaction");
  return value === "show" || value === "hide" ? value : "toggle";
}

export function isComposerPopoverTarget(node: EditableNode | null | undefined): node is ComposerPopoverElement {
  return Boolean(node?.kind === "element" && node.props.popover != null);
}

export function isNativePopoverTrigger(node: EditableNode | null | undefined): node is NativePopoverButtonElement {
  return Boolean(node?.kind === "element" && node.name.toLowerCase() === "button");
}

export function listComposerPopoverTargets(model: AstroDocumentModel): ComposerPopoverTarget[] {
  const entries = elementEntries(model);
  const ids = new Map<string, number>();
  for (const { node } of entries) {
    const id = staticProp(node, "id");
    if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  const triggers = entries
    .filter(({ node }) => isNativePopoverTrigger(node) && Boolean(staticProp(node, "popovertarget")))
    .map(({ path, node }): ComposerPopoverTrigger => ({
      path,
      node,
      targetId: staticProp(node, "popovertarget")!,
      action: triggerAction(node),
      label: textLabel(node) || "Button",
    }));
  return entries.filter(({ node }) => isComposerPopoverTarget(node)).map(({ path, node }) => {
    const prop = node.props.id;
    const id = staticProp(node, "id");
    const idState: ComposerPopoverTarget["idState"] = prop && prop.type !== "string"
      ? "dynamic"
      : !id
        ? "missing"
        : (ids.get(id) ?? 0) > 1 ? "duplicate" : "static";
    return {
      path,
      node,
      id,
      idState,
      mode: popoverMode(node),
      label: textLabel(node) || "Popover content",
      triggers: id ? triggers.filter((trigger) => trigger.targetId === id) : [],
    };
  });
}

export function listNativePopoverButtons(model: AstroDocumentModel): ComposerPopoverTrigger[] {
  return elementEntries(model)
    .filter(({ node }) => isNativePopoverTrigger(node))
    .map(({ path, node }) => ({
      path,
      node,
      targetId: staticProp(node, "popovertarget") ?? "",
      action: triggerAction(node),
      label: textLabel(node) || "Button",
    }));
}

export function composerPopoverTargetAtPath(
  model: AstroDocumentModel,
  path: string,
): ComposerPopoverTarget | null {
  return listComposerPopoverTargets(model).find((target) => target.path === path) ?? null;
}

function uniquePopoverId(model: AstroDocumentModel): string {
  const used = new Set(elementEntries(model).map(({ node }) => staticProp(node, "id")).filter(Boolean));
  let value = `aria-popover-${allocNodeId()}`;
  while (used.has(value)) value = `aria-popover-${allocNodeId()}`;
  return value;
}

export function ensureComposerPopoverId(
  model: AstroDocumentModel,
  targetPath: string,
): { ok: boolean; id?: string; reason?: string } {
  const loc = locateAtPath(model.nodes, targetPath);
  if (!loc || !isComposerPopoverTarget(loc.node)) return { ok: false, reason: "Popover target is unavailable" };
  const current = loc.node.props.id;
  if (current?.type === "string" && current.value.trim()) {
    const id = current.value.trim();
    const occurrences = elementEntries(model).filter(({ node }) => staticProp(node, "id") === id).length;
    return occurrences > 1
      ? { ok: false, reason: `Popover ID \"${id}\" is not unique` }
      : { ok: true, id };
  }
  if (current && current.type !== "string") return { ok: false, reason: "Popover ID is expression-bound" };
  const id = uniquePopoverId(model);
  loc.node.props.id = { type: "string", value: id };
  return { ok: true, id };
}

export function setComposerPopoverMode(
  model: AstroDocumentModel,
  targetPath: string,
  mode: ComposerPopoverMode,
): MutateResult {
  const loc = locateAtPath(model.nodes, targetPath);
  if (!loc || !isComposerPopoverTarget(loc.node)) return { ok: false, selectPath: targetPath, reason: "Popover target is unavailable" };
  const current = loc.node.props.popover;
  if (current && current.type !== "string" && current.type !== "bare") {
    return { ok: false, selectPath: targetPath, reason: "Popover behavior is expression-bound" };
  }
  loc.node.props.popover = mode === "auto" ? { type: "bare" } : { type: "string", value: mode };
  return { ok: true, selectPath: targetPath };
}

export function renameComposerPopoverId(
  model: AstroDocumentModel,
  targetPath: string,
  nextId: string,
): MutateResult {
  const target = composerPopoverTargetAtPath(model, targetPath);
  const value = nextId.trim();
  if (!target) return { ok: false, selectPath: targetPath, reason: "Popover target is unavailable" };
  if (!/^[A-Za-z][A-Za-z0-9_:.-]*$/.test(value)) {
    return { ok: false, selectPath: targetPath, reason: "Use a valid static HTML ID" };
  }
  if (target.node.props.id && target.node.props.id.type !== "string") {
    return { ok: false, selectPath: targetPath, reason: "Popover ID is expression-bound" };
  }
  const conflict = elementEntries(model).some(({ path, node }) => path !== targetPath && staticProp(node, "id") === value);
  if (conflict) return { ok: false, selectPath: targetPath, reason: `ID \"${value}\" is already used` };
  const previous = target.id;
  target.node.props.id = { type: "string", value };
  if (previous) {
    for (const trigger of listNativePopoverButtons(model)) {
      if (trigger.targetId === previous) trigger.node.props.popovertarget = { type: "string", value };
    }
  }
  return { ok: true, selectPath: targetPath };
}

export function setNativeButtonPopover(
  model: AstroDocumentModel,
  buttonPath: string,
  targetPath: string,
  action: ComposerPopoverAction = "toggle",
): MutateResult {
  const buttonLoc = locateAtPath(model.nodes, buttonPath);
  if (!buttonLoc || !isNativePopoverTrigger(buttonLoc.node)) {
    return { ok: false, selectPath: buttonPath, reason: "A native button is required" };
  }
  const ensured = ensureComposerPopoverId(model, targetPath);
  if (!ensured.ok || !ensured.id) return { ok: false, selectPath: buttonPath, reason: ensured.reason };
  buttonLoc.node.props.type = { type: "string", value: "button" };
  buttonLoc.node.props.popovertarget = { type: "string", value: ensured.id };
  if (action === "toggle") delete buttonLoc.node.props.popovertargetaction;
  else buttonLoc.node.props.popovertargetaction = { type: "string", value: action };
  return { ok: true, selectPath: buttonPath };
}

export function setNativeButtonPopoverAction(
  model: AstroDocumentModel,
  buttonPath: string,
  action: ComposerPopoverAction,
): MutateResult {
  const loc = locateAtPath(model.nodes, buttonPath);
  if (!loc || !isNativePopoverTrigger(loc.node)) return { ok: false, selectPath: buttonPath, reason: "A native button is required" };
  if (loc.node.props.popovertarget?.type !== "string") return { ok: false, selectPath: buttonPath, reason: "Popover target is unavailable" };
  if (action === "toggle") delete loc.node.props.popovertargetaction;
  else loc.node.props.popovertargetaction = { type: "string", value: action };
  return { ok: true, selectPath: buttonPath };
}

export function clearNativeButtonPopover(
  model: AstroDocumentModel,
  buttonPath: string,
): MutateResult {
  const loc = locateAtPath(model.nodes, buttonPath);
  if (!loc || !isNativePopoverTrigger(loc.node)) return { ok: false, selectPath: buttonPath, reason: "A native button is required" };
  delete loc.node.props.popovertarget;
  delete loc.node.props.popovertargetaction;
  return { ok: true, selectPath: buttonPath };
}

function buttonNode(label: string): ElementNode {
  return {
    id: allocNodeId(),
    kind: "element",
    name: "button",
    props: { type: { type: "string", value: "button" } },
    children: [{ id: allocNodeId(), kind: "text", value: label }],
  };
}

export function insertComposerPopoverTrigger(
  model: AstroDocumentModel,
  targetPath: string,
  action: ComposerPopoverAction = "toggle",
): MutateResult {
  const targetLoc = locateAtPath(model.nodes, targetPath);
  if (!targetLoc || !isComposerPopoverTarget(targetLoc.node)) return { ok: false, selectPath: targetPath, reason: "Popover target is unavailable" };
  const parentPath = parentPathOf(targetPath);
  if (!parentAcceptsChildAtPath(model, parentPath, "button")) return { ok: false, selectPath: targetPath, reason: "A trigger cannot be inserted here" };
  const ensured = ensureComposerPopoverId(model, targetPath);
  if (!ensured.ok || !ensured.id) return { ok: false, selectPath: targetPath, reason: ensured.reason };
  const button = buttonNode(action === "hide" ? "Close" : "Open popover");
  button.props.popovertarget = { type: "string", value: ensured.id };
  if (action !== "toggle") button.props.popovertargetaction = { type: "string", value: action };
  targetLoc.list.splice(targetLoc.index, 0, button);
  const prefix = parentPath ? `${parentPath}.` : "";
  return { ok: true, selectPath: `${prefix}${targetLoc.index}` };
}

export function insertComposerPopoverCloseButton(
  model: AstroDocumentModel,
  targetPath: string,
): MutateResult {
  const targetLoc = locateAtPath(model.nodes, targetPath);
  if (!targetLoc || !isComposerPopoverTarget(targetLoc.node) || !Array.isArray(targetLoc.node.children)) {
    return { ok: false, selectPath: targetPath, reason: "Popover content cannot contain a close button" };
  }
  const ensured = ensureComposerPopoverId(model, targetPath);
  if (!ensured.ok || !ensured.id) return { ok: false, selectPath: targetPath, reason: ensured.reason };
  const button = buttonNode("Close");
  button.props.popovertarget = { type: "string", value: ensured.id };
  button.props.popovertargetaction = { type: "string", value: "hide" };
  targetLoc.node.children.push(button);
  return { ok: true, selectPath: `${targetPath}.${targetLoc.node.children.length - 1}` };
}

export function popoverManagedPropNames(node: EditableNode | null | undefined): Set<string> {
  if (isComposerPopoverTarget(node)) return new Set(["popover", "id", "aria-labelledby"]);
  if (isNativePopoverTrigger(node)) return new Set(["popovertarget", "popovertargetaction"]);
  return new Set();
}

export function staticPopoverIdValue(value: PropValue | undefined): string | null {
  return value?.type === "string" ? value.value.trim() || null : null;
}
