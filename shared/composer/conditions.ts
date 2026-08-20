import { managedConditionExpression } from "../conditions/astro";
import { cloneConditionSet, type ConditionSet } from "../conditions/types";
import { validateConditionSet } from "../conditions/validate";
import { allocNodeId, locateAtPath, parentPathOf, type MutateResult } from "./mutate";
import type { AstroDocumentModel, ConditionalNode, EditableNode } from "./types";

function pathWithIndex(parent: string | null, index: number): string {
  return parent ? `${parent}.${index}` : String(index);
}

export function conditionalPathAtOrAbove(
  model: AstroDocumentModel,
  path: string,
): string | null {
  const parts = path.split(".");
  for (let length = parts.length; length > 0; length -= 1) {
    const prefix = parts.slice(0, length);
    if (prefix.at(-1) === "t" || prefix.at(-1) === "f") continue;
    const candidate = prefix.join(".");
    if (locateAtPath(model.nodes, candidate)?.node.kind === "conditional") return candidate;
  }
  return null;
}

export function wrapNodesInConditionAtPaths(
  model: AstroDocumentModel,
  paths: readonly string[],
  primaryPath: string,
  condition: ConditionSet,
): MutateResult {
  const issues = validateConditionSet(condition);
  const test = managedConditionExpression(condition);
  if (issues.length || !test) {
    return { ok: false, selectPath: primaryPath, reason: issues[0]?.message ?? "This condition cannot be used in Astro." };
  }
  const requested = Array.from(new Set([primaryPath, ...paths]));
  const locations = requested.map((path) => ({ path, location: locateAtPath(model.nodes, path) }));
  if (locations.some((entry) => !entry.location)) {
    return { ok: false, selectPath: primaryPath, reason: "Select elements from the same level." };
  }
  const primary = locations.find((entry) => entry.path === primaryPath)?.location;
  if (!primary || locations.some((entry) => entry.location!.list !== primary.list)) {
    return { ok: false, selectPath: primaryPath, reason: "Select neighboring elements with the same parent." };
  }
  const sorted = locations
    .map((entry) => entry.location!)
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.node.id === entry.node.id) === index)
    .sort((left, right) => left.index - right.index);
  if (sorted.some((entry, index) => index > 0 && entry.index !== sorted[index - 1]!.index + 1)) {
    return { ok: false, selectPath: primaryPath, reason: "Select neighboring elements without gaps." };
  }
  const start = sorted[0]?.index;
  if (start == null) return { ok: false, selectPath: primaryPath, reason: "Nothing to condition." };
  const selectedIds = sorted.map((entry) => entry.node.id);
  const consequent = primary.list.splice(start, sorted.length);
  const node: ConditionalNode = {
    id: allocNodeId(),
    kind: "conditional",
    mode: "and",
    test,
    condition: cloneConditionSet(condition),
    consequent,
  };
  primary.list.splice(start, 0, node);
  const conditionPath = pathWithIndex(parentPathOf(primaryPath), start);
  const selectPaths = selectedIds.map((_, index) => `${conditionPath}.${index}`);
  const primaryId = primary.node.id;
  const primaryIndex = selectedIds.indexOf(primaryId);
  return {
    ok: true,
    selectPath: selectPaths[Math.max(0, primaryIndex)] ?? `${conditionPath}.0`,
    selectPaths,
  };
}

export function setConditionAtPath(
  model: AstroDocumentModel,
  path: string,
  condition: ConditionSet,
): MutateResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || location.node.kind !== "conditional") {
    return { ok: false, selectPath: path, reason: "Condition not found." };
  }
  const issues = validateConditionSet(condition);
  const test = managedConditionExpression(condition);
  if (issues.length || !test) {
    return { ok: false, selectPath: path, reason: issues[0]?.message ?? "This condition cannot be used in Astro." };
  }
  location.node.condition = cloneConditionSet(condition);
  location.node.test = test;
  return { ok: true, selectPath: path };
}

export function addOtherwiseBranchAtPath(
  model: AstroDocumentModel,
  path: string,
): MutateResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || location.node.kind !== "conditional") {
    return { ok: false, selectPath: path, reason: "Condition not found." };
  }
  location.node.mode = "ternary";
  location.node.alternate ??= [];
  return { ok: true, selectPath: path };
}

export function removeOtherwiseBranchAtPath(
  model: AstroDocumentModel,
  path: string,
): MutateResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || location.node.kind !== "conditional") {
    return { ok: false, selectPath: path, reason: "Condition not found." };
  }
  if ((location.node.alternate?.length ?? 0) > 0) {
    return { ok: false, selectPath: path, reason: "Move or remove Otherwise content first." };
  }
  location.node.mode = "and";
  delete location.node.alternate;
  return { ok: true, selectPath: path };
}

export type RemoveConditionChoice = "shown" | "otherwise" | "both";

export function removeConditionAtPath(
  model: AstroDocumentModel,
  path: string,
  choice: RemoveConditionChoice = "shown",
): MutateResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || location.node.kind !== "conditional") {
    return { ok: false, selectPath: path, reason: "Condition not found." };
  }
  const node = location.node;
  if (choice === "otherwise" && node.mode !== "ternary") {
    return { ok: false, selectPath: path, reason: "This condition has no Otherwise content." };
  }
  let kept: EditableNode[];
  if (choice === "shown") kept = node.consequent;
  else if (choice === "otherwise") kept = node.alternate ?? [];
  else kept = [...node.consequent, ...(node.alternate ?? [])];
  location.list.splice(location.index, 1, ...kept);
  const parent = parentPathOf(path);
  const selectPaths = kept.map((_, index) => pathWithIndex(parent, location.index + index));
  return {
    ok: true,
    selectPath: selectPaths[0] ?? null,
    selectPaths,
  };
}
