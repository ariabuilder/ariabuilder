/**
 * Shared insert contract used by the Composer agent host and acceptance tests.
 * Keeps normalize → mutate → flushSave as one sequenced boundary.
 */

import {
  formatAgentNodeNormalizationIssues,
  normalizeAgentNodeTreeForInsert,
} from "./agentNodeNormalizer";
import {
  insertNodesAt,
  locateAtPath,
  resolveInsertTarget,
  type InsertTarget,
  type MutateResult,
} from "./mutate";
import {
  isComposerContentPath,
  resolvePageContentParentPath,
} from "./layers";
import type { AstroDocumentModel, EditableNode } from "./types";

export type AgentComposerInsertPrepareResult =
  | { ok: true; nodes: EditableNode[] }
  | { ok: false; message: string; suggestedFix: string };

export type AgentComposerInsertPlacementReason =
  | "document-root-to-primary-content"
  | "document-shell-to-primary-content"
  | "outside-content-to-primary-content";

export type AgentComposerInsertPlacement = {
  /** Exact target supplied by the agent, or null when placement was inferred. */
  requestedTarget: InsertTarget | null;
  resolvedTarget: InsertTarget;
  normalized: boolean;
  reason?: AgentComposerInsertPlacementReason;
};

export type AgentComposerInsertResult = MutateResult & {
  placement?: AgentComposerInsertPlacement;
};

export function prepareAgentComposerInsert(
  supplied: readonly unknown[],
): AgentComposerInsertPrepareResult {
  if (!supplied.length) {
    return {
      ok: false,
      message: "Provide one or more Composer nodes.",
      suggestedFix: "Pass nodes: [{ primitive: \"section\" }] or an element tree.",
    };
  }
  const normalized = normalizeAgentNodeTreeForInsert(supplied);
  if (!normalized.ok) {
    return {
      ok: false,
      message: "Provide one or more valid Composer nodes.",
      suggestedFix: formatAgentNodeNormalizationIssues(normalized.issues),
    };
  }
  return { ok: true, nodes: normalized.nodes };
}

function editableChildEntries(
  node: EditableNode,
  path: string,
): Array<{ node: EditableNode; path: string }> {
  if (node.kind === "conditional") {
    if (node.mode === "ternary") {
      return [
        ...node.consequent.map((child, index) => ({ node: child, path: `${path}.t.${index}` })),
        ...(node.alternate ?? []).map((child, index) => ({ node: child, path: `${path}.f.${index}` })),
      ];
    }
    return node.consequent.map((child, index) => ({ node: child, path: `${path}.${index}` }));
  }
  if (
    node.kind === "element" ||
    node.kind === "component" ||
    node.kind === "fragment" ||
    node.kind === "slot" ||
    node.kind === "map"
  ) {
    return (node.children ?? []).map((child, index) => ({
      node: child,
      path: `${path}.${index}`,
    }));
  }
  return [];
}

function uniqueMainPath(
  model: AstroDocumentModel,
  contentParentPath: string,
): string | null {
  const parent = locateAtPath(model.nodes, contentParentPath)?.node;
  if (!parent) return null;
  const matches: string[] = [];
  const visit = (node: EditableNode, path: string) => {
    if (node.kind === "element" && node.name.toLowerCase() === "main") {
      matches.push(path);
    }
    for (const child of editableChildEntries(node, path)) visit(child.node, child.path);
  };
  for (const child of editableChildEntries(parent, contentParentPath)) {
    visit(child.node, child.path);
  }
  return matches.length === 1 ? matches[0]! : null;
}

function childCountAtPath(model: AstroDocumentModel, parentPath: string): number {
  const parent = locateAtPath(model.nodes, parentPath)?.node;
  return parent ? editableChildEntries(parent, parentPath).length : 0;
}

function targetExists(model: AstroDocumentModel, target: InsertTarget): boolean {
  if (target.parentPath == null || target.parentPath === "") return true;
  if (locateAtPath(model.nodes, target.parentPath)) return true;
  const branch = /^(.*)\.(t|f)$/.exec(target.parentPath);
  if (!branch) return false;
  const conditional = locateAtPath(model.nodes, branch[1]!)?.node;
  return conditional?.kind === "conditional" && conditional.mode === "ternary";
}

export function resolveAgentComposerInsertPlacement(input: {
  model: AstroDocumentModel;
  target?: InsertTarget;
  selectedPath?: string | null;
  childTag?: string | null;
}): AgentComposerInsertPlacement | null {
  const contentParentPath = resolvePageContentParentPath(input.model);
  const requestedTarget = input.target ?? null;

  // Fragment/component documents intentionally retain root placement.
  if (!contentParentPath) {
    const resolvedTarget = input.target ?? resolveInsertTarget(
      input.model,
      input.selectedPath ?? null,
      input.childTag ?? null,
    );
    return targetExists(input.model, resolvedTarget)
      ? { requestedTarget, resolvedTarget, normalized: false }
      : null;
  }

  const mainPath = uniqueMainPath(input.model, contentParentPath);
  const preferredParentPath = mainPath ?? contentParentPath;
  const primaryEndTarget = (): InsertTarget => ({
    parentPath: preferredParentPath,
    index: childCountAtPath(input.model, preferredParentPath),
  });

  if (input.target) {
    if (!targetExists(input.model, input.target)) return null;
    if (input.target.parentPath === null || input.target.parentPath === "") {
      return {
        requestedTarget,
        resolvedTarget: { parentPath: preferredParentPath, index: input.target.index },
        normalized: true,
        reason: "document-root-to-primary-content",
      };
    }
    if (!isComposerContentPath(input.target.parentPath, contentParentPath)) {
      const node = locateAtPath(input.model.nodes, input.target.parentPath)?.node;
      const shell = node?.kind === "doctype" ||
        (node?.kind === "element" && ["html", "head"].includes(node.name.toLowerCase()));
      return {
        requestedTarget,
        resolvedTarget: { parentPath: preferredParentPath, index: input.target.index },
        normalized: true,
        reason: shell
          ? "document-shell-to-primary-content"
          : "outside-content-to-primary-content",
      };
    }
    return { requestedTarget, resolvedTarget: input.target, normalized: false };
  }

  const selectedPath = input.selectedPath ?? null;
  const selectedIsUsable = Boolean(
    selectedPath &&
    locateAtPath(input.model.nodes, selectedPath) &&
    isComposerContentPath(selectedPath, contentParentPath),
  );
  const resolvedTarget = selectedIsUsable
    ? resolveInsertTarget(input.model, selectedPath, input.childTag ?? null)
    : primaryEndTarget();
  return { requestedTarget, resolvedTarget, normalized: false };
}

export function applyAgentComposerInsert(input: {
  model: AstroDocumentModel;
  nodes: EditableNode[];
  target?: InsertTarget;
  selectedPath?: string | null;
}): AgentComposerInsertResult {
  const firstTag = input.nodes[0]?.kind === "element" ? input.nodes[0].name : null;
  const placement = resolveAgentComposerInsertPlacement({
    model: input.model,
    target: input.target,
    selectedPath: input.selectedPath,
    childTag: firstTag,
  });
  if (!placement) {
    return { ok: false, selectPath: null, reason: "Invalid insert target" };
  }

  // Run the whole batch against a clone so a rejected containment check cannot
  // create a branch/list or otherwise leak a partial source mutation.
  const working = structuredClone(input.model) as AstroDocumentModel;
  const result = insertNodesAt(working, input.nodes, placement.resolvedTarget);
  if (!result.ok) return { ...result, placement };
  Object.assign(input.model, working);
  return { ...result, placement };
}

/**
 * Full agent insert boundary: normalize, mutate, then await flushSave.
 * Used by acceptance tests to prove the save contract without Electron.
 */
export async function runAgentComposerInsertBoundary(input: {
  model: AstroDocumentModel;
  supplied: readonly unknown[];
  target?: InsertTarget;
  selectedPath?: string | null;
  mutateModel: (fn: (model: AstroDocumentModel) => MutateResult) => boolean;
  flushSave: () => Promise<void>;
}): Promise<
  | { ok: true; fileSaved: true; nodeCount: number; placement: AgentComposerInsertPlacement }
  | { ok: false; message: string; suggestedFix?: string }
> {
  const prepared = prepareAgentComposerInsert(input.supplied);
  if (!prepared.ok) {
    return {
      ok: false,
      message: prepared.message,
      suggestedFix: prepared.suggestedFix,
    };
  }
  const mutation: { value?: AgentComposerInsertResult } = {};
  const changed = input.mutateModel((model) => {
    mutation.value = applyAgentComposerInsert({
      model,
      nodes: prepared.nodes,
      target: input.target,
      selectedPath: input.selectedPath,
    });
    return mutation.value;
  });
  if (!changed) {
    return {
      ok: false,
      message: mutation.value?.reason ?? "The nodes cannot be inserted at that location.",
      suggestedFix: "Use a current path from the Composer Layers outline, or omit target to use safe placement.",
    };
  }
  await input.flushSave();
  if (!mutation.value?.placement) {
    return { ok: false, message: "Composer did not resolve an insert placement." };
  }
  return {
    ok: true,
    fileSaved: true,
    nodeCount: prepared.nodes.length,
    placement: mutation.value.placement,
  };
}
