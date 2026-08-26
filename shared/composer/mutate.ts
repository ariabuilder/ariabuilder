/**
 * Editable-tree mutations for Composer (Phase 4+).
 *
 * Operate on marker paths (same identity as selection / serializeAstroMarked).
 * Callers own history snapshots + serialize write-back.
 */

import { ARIA_LAYER_LABEL_ATTR, VOID_ELEMENTS } from "./constants";
import { canContainTag, VOID_TAGS } from "./elementSchemas";
import {
  isComposerContentPath,
  resolvePageContentParentPath,
} from "./layers";
import {
  composerRichTextOwnerPath,
  isComposerRichTextHost,
  isComposerVisualTag,
} from "./richText";
import {
  markerPathForNodeId,
  parseMarkerPath,
  tryParseMarkerPath,
  type MarkerPathSeg,
} from "./paths";
import type {
  AstroDocumentModel,
  AstroPropMap,
  ComponentNode,
  EditableNode,
  ElementNode,
  PropValue,
} from "./types";

/** Default text placeholders for common palette elements. */
export const DEFAULT_ELEMENT_TEXT: Record<string, string> = {
  h1: "Heading",
  h2: "Heading",
  h3: "Heading",
  h4: "Heading",
  h5: "Heading",
  h6: "Heading",
  p: "Paragraph",
  a: "Link",
  button: "Button",
  span: "Text",
  li: "Item",
};

export type ParentListLocation = {
  list: EditableNode[];
  index: number;
  node: EditableNode;
};

export type InsertTarget = {
  /** null = page root (`model.nodes`). */
  parentPath: string | null;
  index: number;
};

export type MutateResult = {
  /** Path to select after the mutation (null = clear selection). */
  selectPath: string | null;
  /** Multi-selection after a batch insert/delete; primary is first. */
  selectPaths?: string[];
  ok: boolean;
  reason?: string;
};

let nextCloneId = 1;

/** Fresh ephemeral id for inserted / duplicated nodes. */
export function allocNodeId(): string {
  return `c${nextCloneId++}`;
}

export type CloneNodeForestOptions = {
  rewriteDomIds?: boolean;
  /** When supplied, preserve authored IDs that do not collide with the target. */
  existingDomIds?: Iterable<string>;
};

export type CloneNodeForestResult = {
  nodes: EditableNode[];
  rewrittenDomIds: Map<string, string>;
};

function visitNodeForest(
  nodes: readonly EditableNode[],
  visitor: (node: EditableNode) => void,
): void {
  const walk = (n: EditableNode) => {
    visitor(n);
    if (n.kind === "conditional") {
      for (const c of n.consequent) walk(c);
      for (const c of n.alternate ?? []) walk(c);
      return;
    }
    if (n.kind === "map" || n.kind === "fragment") {
      for (const c of n.children) walk(c);
      return;
    }
    if (
      (n.kind === "element" ||
        n.kind === "component" ||
        n.kind === "slot") &&
      Array.isArray(n.children)
    ) {
      for (const c of n.children) walk(c);
    }
  };
  for (const node of nodes) walk(node);
}

/** Deep-clone a node forest with one shared ephemeral/DOM identity pass. */
export function cloneNodesWithNewIds(
  nodes: readonly EditableNode[],
  options: CloneNodeForestOptions = {},
): CloneNodeForestResult {
  const clones = structuredClone(nodes) as EditableNode[];
  visitNodeForest(clones, (node) => {
    node.id = allocNodeId();
    delete node.sourceRange;
  });
  const rewrittenDomIds = options.rewriteDomIds
    ? rewriteClonedDomIds(clones, options.existingDomIds)
    : new Map<string, string>();
  return { nodes: clones, rewrittenDomIds };
}

/** Deep-clone one node with new ids throughout (including conditional branches). */
export function cloneNodeWithNewIds(
  node: EditableNode,
  options: CloneNodeForestOptions = {},
): EditableNode {
  return cloneNodesWithNewIds([node], options).nodes[0]!;
}

const SINGLE_DOM_ID_REFERENCE_PROPS = new Set([
  "aria-activedescendant",
  "commandfor",
  "for",
  "form",
  "list",
  "popovertarget",
]);

const DOM_ID_REFERENCE_LIST_PROPS = new Set([
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-labelledby",
  "aria-owns",
  "headers",
]);

/** Keep internal HTML ID references intact when duplicating or pasting a forest. */
function rewriteClonedDomIds(
  roots: readonly EditableNode[],
  existingDomIds?: Iterable<string>,
): Map<string, string> {
  const propNodes: Array<ElementNode | ComponentNode> = [];
  const visit = (node: EditableNode) => {
    if (node.kind === "conditional") {
      for (const child of node.consequent) visit(child);
      for (const child of node.alternate ?? []) visit(child);
      return;
    }
    if (node.kind === "map" || node.kind === "fragment") {
      for (const child of node.children) visit(child);
      return;
    }
    if (node.kind === "element" || node.kind === "component") propNodes.push(node);
    if (
      (node.kind === "element" ||
        node.kind === "component" ||
        node.kind === "slot") &&
      Array.isArray(node.children)
    ) {
      for (const child of node.children) visit(child);
    }
  };
  for (const root of roots) visit(root);

  const replacements = new Map<string, string>();
  const reserved = existingDomIds ? new Set(existingDomIds) : null;
  for (const node of propNodes) {
    const id = node.props.id;
    if (id?.type !== "string" || !id.value) continue;
    if (reserved && !reserved.has(id.value)) {
      reserved.add(id.value);
      continue;
    }
    let replacement = replacements.get(id.value);
    if (!replacement) {
      do {
        replacement = `${id.value}-copy-${allocNodeId()}`;
      } while (reserved?.has(replacement));
      replacements.set(id.value, replacement);
      reserved?.add(replacement);
    }
    id.value = replacement;
  }
  if (!replacements.size) return replacements;

  for (const node of propNodes) {
    for (const [name, prop] of Object.entries(node.props)) {
      if (prop.type !== "string") continue;
      if (SINGLE_DOM_ID_REFERENCE_PROPS.has(name)) {
        prop.value = replacements.get(prop.value) ?? prop.value;
        continue;
      }
      if (DOM_ID_REFERENCE_LIST_PROPS.has(name)) {
        prop.value = prop.value
          .split(/\s+/)
          .map((token) => replacements.get(token) ?? token)
          .join(" ");
        continue;
      }
      if ((name === "href" || name === "xlink:href") && prop.value.startsWith("#")) {
        const replacement = replacements.get(prop.value.slice(1));
        if (replacement) prop.value = `#${replacement}`;
      }
      prop.value = prop.value.replace(
        /url\(\s*(["']?)#([^)'"\s]+)\1\s*\)/g,
        (match, quote: string, id: string) => {
          const replacement = replacements.get(id);
          return replacement ? `url(${quote}#${replacement}${quote})` : match;
        },
      );
    }
  }
  return replacements;
}

/** Static authored DOM IDs already present in a document model. */
export function collectStaticDomIds(model: AstroDocumentModel): Set<string> {
  const ids = new Set<string>();
  visitNodeForest(model.nodes, (node) => {
    if (node.kind !== "element" && node.kind !== "component") return;
    const id = node.props.id;
    if (id?.type === "string" && id.value) ids.add(id.value);
  });
  return ids;
}

function childListOf(node: EditableNode): EditableNode[] | null {
  switch (node.kind) {
    case "element":
    case "component":
    case "fragment":
    case "slot":
    case "map":
      return Array.isArray(node.children) ? node.children : null;
    default:
      return null;
  }
}

/**
 * Resolve the sibling list + index for a marker path.
 * Supports ternary `.t` / `.f` and `&&` / map numeric children.
 */
export function locateAtPath(
  nodes: EditableNode[],
  path: string,
): ParentListLocation | null {
  const segs = tryParseMarkerPath(path);
  if (!segs || segs.length === 0) return null;
  return locateAtSegs(nodes, segs, 0);
}

function locateAtSegs(
  list: EditableNode[],
  segs: MarkerPathSeg[],
  offset: number,
): ParentListLocation | null {
  if (offset >= segs.length) return null;
  const seg = segs[offset];
  if (seg === "t" || seg === "f") return null;
  const node = list[seg];
  if (!node) return null;
  if (offset === segs.length - 1) {
    return { list, index: seg, node };
  }

  const next = segs[offset + 1];
  if (
    node.kind === "conditional" &&
    node.mode === "ternary" &&
    (next === "t" || next === "f")
  ) {
    const branch =
      next === "t" ? node.consequent : (node.alternate ??= []);
    return locateAtSegs(branch, segs, offset + 2);
  }

  if (node.kind === "conditional" && node.mode === "and") {
    return locateAtSegs(node.consequent, segs, offset + 1);
  }

  const kids = childListOf(node);
  if (!kids) return null;
  return locateAtSegs(kids, segs, offset + 1);
}

function pathFromSegs(segs: MarkerPathSeg[]): string {
  return segs
    .map((s) => (typeof s === "number" ? String(s) : s))
    .join(".");
}

/**
 * Sibling list for an insert target (creates empty children array when needed).
 * Supports ternary branch roots (`0.3.t` / `0.3.f`) used by Structure gaps.
 */
export function listForInsertTarget(
  model: AstroDocumentModel,
  target: InsertTarget,
): EditableNode[] | null {
  if (target.parentPath == null || target.parentPath === "") {
    return model.nodes;
  }
  const segs = tryParseMarkerPath(target.parentPath);
  if (!segs || segs.length === 0) return null;

  const last = segs[segs.length - 1];
  if (last === "t" || last === "f") {
    if (segs.length < 2) return null;
    const condLoc = locateAtPath(model.nodes, pathFromSegs(segs.slice(0, -1)));
    if (!condLoc || condLoc.node.kind !== "conditional") return null;
    if (condLoc.node.mode !== "ternary") return null;
    if (last === "t") return condLoc.node.consequent;
    return (condLoc.node.alternate ??= []);
  }

  const parentLoc = locateAtPath(model.nodes, target.parentPath);
  if (!parentLoc) return null;
  const parent = parentLoc.node;
  if (parent.kind === "conditional") {
    // Insert into consequent for `&&`; ternary needs explicit branch path.
    return parent.consequent;
  }
  if (
    parent.kind === "element" ||
    parent.kind === "component" ||
    parent.kind === "slot"
  ) {
    if (parent.children === null) parent.children = [];
    return parent.children;
  }
  if (parent.kind === "fragment" || parent.kind === "map") {
    return parent.children;
  }
  return null;
}

/**
 * Whether `parentPath` (null = page root, or a ternary `.t`/`.f` branch) can
 * host `childTag`. Components / opaque drags pass `childTag: null`.
 */
export function parentAcceptsChildAtPath(
  model: AstroDocumentModel,
  parentPath: string | null,
  childTag: string | null = null,
): boolean {
  if (parentPath == null || parentPath === "") {
    return childTag ? canContainTag(null, childTag) : true;
  }
  const segs = tryParseMarkerPath(parentPath);
  if (!segs || segs.length === 0) return false;
  const last = segs[segs.length - 1];
  if (last === "t" || last === "f") {
    // Branch root is a fragment-like list — apply flow containment only.
    if (!listForInsertTarget(model, { parentPath, index: 0 })) return false;
    return childTag ? canContainTag(null, childTag) : true;
  }
  const parentLoc = locateAtPath(model.nodes, parentPath);
  if (!parentLoc) return false;
  return nodeAcceptsChild(parentLoc.node, childTag);
}

export function parentPathOf(path: string): string | null {
  const segs = tryParseMarkerPath(path);
  if (!segs || segs.length <= 1) return null;
  const last = segs[segs.length - 1];
  if (typeof last !== "number") return null;
  const parentSegs = segs.slice(0, -1);
  // Drop trailing `.t` / `.f` only when they would be the whole parent path
  // for a branch root — keep them as path segments for children.
  return parentSegs
    .map((s) => (typeof s === "number" ? String(s) : s))
    .join(".");
}

function rejectsVisualInsideRichText(
  parent: EditableNode | null | undefined,
  childTag: string | null,
): boolean {
  return isComposerRichTextHost(parent) && isComposerVisualTag(childTag);
}

function siblingAfterRichTextHost(
  model: AstroDocumentModel,
  path: string | null,
  childTag: string | null,
): InsertTarget | null {
  if (!path || !isComposerVisualTag(childTag)) return null;
  const hostPath = composerRichTextOwnerPath(model, path) ?? path;
  const loc = locateAtPath(model.nodes, hostPath);
  if (!loc || !rejectsVisualInsideRichText(loc.node, childTag)) return null;
  const parentPath = parentPathOf(hostPath);
  if (!parentAcceptsChildAtPath(model, parentPath, childTag)) return null;
  return { parentPath, index: loc.index + 1 };
}

/** Convert a preview DOM hit into a validated source-model insertion target. */
export function resolveCanvasDropTarget(
  model: AstroDocumentModel,
  path: string | null,
  mode: "before" | "after" | "inside",
  childTag: string | null,
): InsertTarget {
  if (!path) return resolveInsertTarget(model, null, childTag);
  // The canvas bridge can hit a source text/mark path that Layers intentionally
  // folds into one visible rich-text row. Anchor structural drops to that same
  // visible owner so "before" / "after" cannot hide a new node inside the
  // paragraph as a locked Content token.
  const visiblePath = composerRichTextOwnerPath(model, path) ?? path;
  const loc = locateAtPath(model.nodes, visiblePath);
  if (!loc) return resolveInsertTarget(model, null, childTag);
  const nestVisualInside = mode === "inside" && rejectsVisualInsideRichText(loc.node, childTag);
  if (mode === "inside" && !nestVisualInside && nodeAcceptsChild(loc.node, childTag)) {
    const children = childListOf(loc.node);
    return {
      parentPath: visiblePath,
      index: Array.isArray(children) ? children.length : 0,
    };
  }
  const parentPath = parentPathOf(visiblePath);
  if (parentAcceptsChildAtPath(model, parentPath, childTag)) {
    return {
      parentPath,
      index: loc.index + (mode === "after" || nestVisualInside ? 1 : 0),
    };
  }
  return resolveInsertTarget(model, visiblePath, childTag);
}

function pathWithIndex(parentPath: string | null, index: number): string {
  return parentPath == null || parentPath === ""
    ? String(index)
    : `${parentPath}.${index}`;
}

function collectUsedComponentNames(
  nodes: EditableNode[],
  used: Set<string>,
): void {
  for (const node of nodes) {
    if (node.kind === "component" && node.name) used.add(node.name);
    if (node.kind === "conditional") {
      collectUsedComponentNames(node.consequent, used);
      if (node.alternate) collectUsedComponentNames(node.alternate, used);
      continue;
    }
    const kids = childListOf(node);
    if (kids) collectUsedComponentNames(kids, used);
  }
}

/** Drop unused `.astro` default imports after delete / reparent. */
export function pruneImports(model: AstroDocumentModel): void {
  const used = new Set<string>();
  collectUsedComponentNames(model.nodes, used);
  model.imports = model.imports.filter(
    (imp) => !imp.path.endsWith(".astro") || used.has(imp.name),
  );
}

function isDescendantPath(ancestor: string, candidate: string): boolean {
  if (ancestor === candidate) return true;
  return candidate.startsWith(`${ancestor}.`);
}

/**
 * Comment immediately above `index` in the same list — Structure folds it
 * into the next row; moves/deletes carry it along (Stacki pattern).
 */
function noteIndexAbove(list: EditableNode[], index: number): number {
  const prev = index > 0 ? list[index - 1] : null;
  return prev && prev.kind === "comment" ? index - 1 : -1;
}

function staticPopoverIdsIn(node: EditableNode): Set<string> {
  const ids = new Set<string>();
  const visit = (candidate: EditableNode) => {
    if (candidate.kind === "element" && candidate.props.popover != null) {
      const id = candidate.props.id;
      if (id?.type === "string" && id.value.trim()) ids.add(id.value.trim());
    }
    if (candidate.kind === "conditional") {
      candidate.consequent.forEach(visit);
      (candidate.alternate ?? []).forEach(visit);
      return;
    }
    const children = childListOf(candidate);
    children?.forEach(visit);
  };
  visit(node);
  return ids;
}

function clearDeletedPopoverReferences(nodes: EditableNode[], deletedIds: Set<string>): void {
  if (!deletedIds.size) return;
  const visit = (node: EditableNode) => {
    if (node.kind === "element") {
      const target = node.props.popovertarget;
      if (target?.type === "string" && deletedIds.has(target.value.trim())) {
        delete node.props.popovertarget;
        delete node.props.popovertargetaction;
      }
    }
    if (node.kind === "conditional") {
      node.consequent.forEach(visit);
      (node.alternate ?? []).forEach(visit);
      return;
    }
    childListOf(node)?.forEach(visit);
  };
  nodes.forEach(visit);
}

export function deleteNodeAtPath(
  model: AstroDocumentModel,
  path: string,
): MutateResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc) return { ok: false, selectPath: path, reason: "Node not found" };

  const deletedPopoverIds = staticPopoverIdsIn(loc.node);

  const noteAt = noteIndexAbove(loc.list, loc.index);
  if (noteAt === -1) loc.list.splice(loc.index, 1);
  else loc.list.splice(noteAt, 2);

  clearDeletedPopoverReferences(model.nodes, deletedPopoverIds);

  pruneImports(model);

  const parent = parentPathOf(path);
  const nextIndex = Math.max(0, (noteAt === -1 ? loc.index : noteAt) - 0);
  // Prefer previous sibling, else next at same index, else parent.
  if (loc.list.length === 0) {
    return { ok: true, selectPath: parent };
  }
  const pick = Math.min(nextIndex, loc.list.length - 1);
  // Skip leading note comments when selecting.
  let selectIdx = pick;
  if (loc.list[selectIdx]?.kind === "comment" && selectIdx + 1 < loc.list.length) {
    selectIdx += 1;
  }
  return { ok: true, selectPath: pathWithIndex(parent, selectIdx) };
}

export function duplicateNodeAtPath(
  model: AstroDocumentModel,
  path: string,
): MutateResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc) return { ok: false, selectPath: path, reason: "Node not found" };
  if (loc.node.kind === "doctype") {
    return {
      ok: false,
      selectPath: path,
      reason: "Cannot duplicate doctype",
    };
  }
  if (
    (loc.node.kind === "component" || loc.node.kind === "fragment") &&
    loc.node.chunkFile
  ) {
    return {
      ok: false,
      selectPath: path,
      reason: "Chunk sections cannot be duplicated here",
    };
  }

  const clone = cloneNodeWithNewIds(loc.node, { rewriteDomIds: true });
  loc.list.splice(loc.index + 1, 0, clone);
  const parent = parentPathOf(path);
  return { ok: true, selectPath: pathWithIndex(parent, loc.index + 1) };
}

/**
 * Wrap selected sibling nodes in one element. The primary path determines the
 * sibling list; selections from other parents are ignored, matching Layers UX.
 * Folded comments travel inside the wrapper with their associated node.
 */
export function wrapNodesAtPaths(
  model: AstroDocumentModel,
  paths: readonly string[],
  primaryPath: string,
  wrapper: ElementNode,
): MutateResult {
  const primary = locateAtPath(model.nodes, primaryPath);
  if (!primary) {
    return { ok: false, selectPath: primaryPath, reason: "Node not found" };
  }
  if (!Array.isArray(wrapper.children)) {
    return { ok: false, selectPath: primaryPath, reason: "Wrapper cannot contain children" };
  }

  const wrapperTag = String(wrapper.name).toLowerCase();
  if (!parentAcceptsChildAtPath(model, parentPathOf(primaryPath), wrapperTag)) {
    return { ok: false, selectPath: primaryPath, reason: "Invalid wrapper containment" };
  }

  const candidates = dedupeMovePaths([primaryPath, ...paths])
    .map((path) => locateAtPath(model.nodes, path))
    .filter((loc): loc is ParentListLocation => Boolean(loc && loc.list === primary.list))
    .filter((loc, index, all) => all.findIndex((item) => item.node.id === loc.node.id) === index)
    .sort((left, right) => left.index - right.index);

  for (const loc of candidates) {
    const childTag = loc.node.kind === "element"
      ? String(loc.node.name).toLowerCase()
      : null;
    if (!nodeAcceptsChild(wrapper, childTag)) {
      return { ok: false, selectPath: primaryPath, reason: "Wrapper cannot contain selection" };
    }
  }

  const blocks = candidates.map((loc) => {
    const noteAt = noteIndexAbove(loc.list, loc.index);
    const start = noteAt === -1 ? loc.index : noteAt;
    return { start, count: noteAt === -1 ? 1 : 2 };
  });
  const insertIndex = blocks[0]?.start;
  if (insertIndex === undefined) {
    return { ok: false, selectPath: primaryPath, reason: "Nothing to wrap" };
  }

  const children: EditableNode[] = [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]!;
    children.unshift(...primary.list.splice(block.start, block.count));
  }
  wrapper.children = children;
  primary.list.splice(insertIndex, 0, wrapper);
  return {
    ok: true,
    selectPath: pathWithIndex(parentPathOf(primaryPath), insertIndex),
  };
}

export type ReorderDirection = "up" | "down";

export function canReorder(
  model: AstroDocumentModel,
  path: string,
  direction: ReorderDirection,
): boolean {
  const loc = locateAtPath(model.nodes, path);
  if (!loc) return false;
  const noteAt = noteIndexAbove(loc.list, loc.index);
  const blockStart = noteAt === -1 ? loc.index : noteAt;
  const blockEnd = loc.index;
  if (direction === "up") return blockStart > 0;
  return blockEnd < loc.list.length - 1;
}

/** Swap a node (and its folded comment) with the previous/next sibling block. */
export function reorderNodeAtPath(
  model: AstroDocumentModel,
  path: string,
  direction: ReorderDirection,
): MutateResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc) return { ok: false, selectPath: path, reason: "Node not found" };
  if (!canReorder(model, path, direction)) {
    return { ok: false, selectPath: path, reason: "Cannot move further" };
  }

  const noteAt = noteIndexAbove(loc.list, loc.index);
  const blockStart = noteAt === -1 ? loc.index : noteAt;
  const blockEnd = loc.index;
  const thisBlock = loc.list.slice(blockStart, blockEnd + 1);
  const parent = parentPathOf(path);

  if (direction === "up") {
    const prevNodeIndex = blockStart - 1;
    const prevNote = noteIndexAbove(loc.list, prevNodeIndex);
    const prevStart = prevNote === -1 ? prevNodeIndex : prevNote;
    const prevBlock = loc.list.slice(prevStart, blockStart);
    loc.list.splice(
      prevStart,
      prevBlock.length + thisBlock.length,
      ...thisBlock,
      ...prevBlock,
    );
    const newIndex = prevStart + (thisBlock.length === 2 ? 1 : 0);
    return { ok: true, selectPath: pathWithIndex(parent, newIndex) };
  }

  const nextStart = blockEnd + 1;
  let nextEnd = nextStart;
  if (
    loc.list[nextStart]?.kind === "comment" &&
    nextStart + 1 < loc.list.length
  ) {
    nextEnd = nextStart + 1;
  }
  const nextBlock = loc.list.slice(nextStart, nextEnd + 1);
  loc.list.splice(
    blockStart,
    thisBlock.length + nextBlock.length,
    ...nextBlock,
    ...thisBlock,
  );
  const newIndex =
    blockStart + nextBlock.length + (thisBlock.length === 2 ? 1 : 0);
  return { ok: true, selectPath: pathWithIndex(parent, newIndex) };
}

/**
 * Move a node to a new parent/index. Prevents dropping into own subtree.
 * `target.parentPath` null = page root.
 */
export function reparentNodeAtPath(
  model: AstroDocumentModel,
  path: string,
  target: InsertTarget,
): MutateResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc) return { ok: false, selectPath: path, reason: "Node not found" };

  if (target.parentPath != null && isDescendantPath(path, target.parentPath)) {
    return {
      ok: false,
      selectPath: path,
      reason: "Cannot move into own subtree",
    };
  }
  if (target.parentPath === path) {
    return {
      ok: false,
      selectPath: path,
      reason: "Cannot move into self",
    };
  }

  const childTag =
    loc.node.kind === "element" ? String(loc.node.name).toLowerCase() : null;
  if (!parentAcceptsChildAtPath(model, target.parentPath, childTag)) {
    return {
      ok: false,
      selectPath: path,
      reason: "Invalid containment for drop target",
    };
  }

  const dest = listForInsertTarget(model, target);
  if (!dest) {
    return { ok: false, selectPath: path, reason: "Invalid drop target" };
  }

  const noteAt = noteIndexAbove(loc.list, loc.index);
  const start = noteAt === -1 ? loc.index : noteAt;
  const count = noteAt === -1 ? 1 : 2;
  const sameList = loc.list === dest;
  const removed = loc.list.splice(start, count);

  let index = Math.max(0, Math.min(target.index, dest.length));
  if (sameList && index > start) {
    index = Math.max(start, index - count);
  }
  dest.splice(index, 0, ...removed);

  const nodeOffset = count === 2 ? 1 : 0;
  const newIndex = index + nodeOffset;
  const parentPath = target.parentPath;
  return { ok: true, selectPath: pathWithIndex(parentPath, newIndex) };
}

type MoveBlock = {
  id: string;
  order: number;
  list: EditableNode[];
  start: number;
  count: number;
  nodes: EditableNode[];
};

function sourceOrderById(nodes: EditableNode[]): Map<string, number> {
  const result = new Map<string, number>();
  let order = 0;
  const visit = (items: EditableNode[]) => {
    for (const node of items) {
      result.set(node.id, order++);
      if (node.kind === "conditional") {
        visit(node.consequent);
        visit(node.alternate ?? []);
      } else {
        const children = childListOf(node);
        if (children) visit(children);
      }
    }
  };
  visit(nodes);
  return result;
}

function dedupeMovePaths(paths: readonly string[]): string[] {
  const unique: string[] = [];
  for (const path of paths) {
    const normalized = path.trim();
    if (!normalized || unique.includes(normalized)) continue;
    unique.push(normalized);
  }
  return unique.filter(
    (path) => !unique.some((other) => other !== path && isDescendantPath(other, path)),
  );
}

type TargetParentAnchor =
  | { kind: "root" }
  | { kind: "node"; id: string }
  | { kind: "branch"; id: string; branch: "t" | "f" };

function targetParentAnchor(
  model: AstroDocumentModel,
  parentPath: string | null,
): TargetParentAnchor | null {
  if (parentPath == null || parentPath === "") return { kind: "root" };
  const segments = tryParseMarkerPath(parentPath);
  if (!segments?.length) return null;
  const tail = segments[segments.length - 1];
  if (tail === "t" || tail === "f") {
    const base = segments
      .slice(0, -1)
      .map((segment) => String(segment))
      .join(".");
    const loc = locateAtPath(model.nodes, base);
    return loc?.node.kind === "conditional"
      ? { kind: "branch", id: loc.node.id, branch: tail }
      : null;
  }
  const loc = locateAtPath(model.nodes, parentPath);
  return loc ? { kind: "node", id: loc.node.id } : null;
}

function pathForTargetAnchor(
  model: AstroDocumentModel,
  anchor: TargetParentAnchor,
): string | null | undefined {
  if (anchor.kind === "root") return null;
  const path = markerPathForNodeId(model.nodes, anchor.id);
  if (!path) return undefined;
  return anchor.kind === "branch" ? `${path}.${anchor.branch}` : path;
}

/**
 * Atomically move a source-ordered node batch. Paths are deduplicated by
 * ancestry, containment is preflighted for every node, and comments folded
 * above moved nodes travel with their node.
 */
export function reparentNodesAtPaths(
  model: AstroDocumentModel,
  paths: readonly string[],
  target: InsertTarget,
): MutateResult {
  const sourcePaths = dedupeMovePaths(paths);
  if (!sourcePaths.length) {
    return { ok: false, selectPath: null, reason: "Nothing to move" };
  }
  if (
    target.parentPath &&
    sourcePaths.some((path) => isDescendantPath(path, target.parentPath!))
  ) {
    return {
      ok: false,
      selectPath: sourcePaths[0] ?? null,
      reason: "Cannot move a selection into itself",
    };
  }

  const working = structuredClone(model) as AstroDocumentModel;
  const anchor = targetParentAnchor(working, target.parentPath);
  if (!anchor) {
    return {
      ok: false,
      selectPath: sourcePaths[0] ?? null,
      reason: "Invalid drop target",
    };
  }
  const targetListBefore = listForInsertTarget(working, target);
  if (!targetListBefore) {
    return {
      ok: false,
      selectPath: sourcePaths[0] ?? null,
      reason: "Invalid drop target",
    };
  }

  const orderById = sourceOrderById(working.nodes);
  const blocks: MoveBlock[] = [];
  for (const path of sourcePaths) {
    const loc = locateAtPath(working.nodes, path);
    if (!loc) {
      return { ok: false, selectPath: path, reason: "Node not found" };
    }
    const tag = loc.node.kind === "element" ? loc.node.name.toLowerCase() : null;
    if (!parentAcceptsChildAtPath(working, target.parentPath, tag)) {
      return {
        ok: false,
        selectPath: path,
        reason: `Invalid containment for ${tag ?? loc.node.kind}`,
      };
    }
    const noteAt = noteIndexAbove(loc.list, loc.index);
    const start = noteAt === -1 ? loc.index : noteAt;
    const count = noteAt === -1 ? 1 : 2;
    blocks.push({
      id: loc.node.id,
      order: orderById.get(loc.node.id) ?? Number.MAX_SAFE_INTEGER,
      list: loc.list,
      start,
      count,
      nodes: loc.list.slice(start, start + count),
    });
  }

  blocks.sort((a, b) => a.order - b.order);
  const removedBeforeTarget = blocks
    .filter((block) => block.list === targetListBefore && block.start < target.index)
    .reduce((sum, block) => sum + block.count, 0);

  const lists = new Map<EditableNode[], MoveBlock[]>();
  for (const block of blocks) {
    const group = lists.get(block.list) ?? [];
    group.push(block);
    lists.set(block.list, group);
  }
  for (const group of lists.values()) {
    group.sort((a, b) => b.start - a.start);
    for (const block of group) block.list.splice(block.start, block.count);
  }

  const resolvedParentPath = pathForTargetAnchor(working, anchor);
  if (resolvedParentPath === undefined) {
    return {
      ok: false,
      selectPath: sourcePaths[0] ?? null,
      reason: "Drop target moved with the selection",
    };
  }
  const destination = listForInsertTarget(working, {
    parentPath: resolvedParentPath,
    index: 0,
  });
  if (!destination) {
    return {
      ok: false,
      selectPath: sourcePaths[0] ?? null,
      reason: "Invalid drop target",
    };
  }
  const insertionIndex = Math.max(
    0,
    Math.min(target.index - removedBeforeTarget, destination.length),
  );
  destination.splice(insertionIndex, 0, ...blocks.flatMap((block) => block.nodes));
  pruneImports(working);

  Object.assign(model, working);
  const selectPaths = blocks
    .map((block) => markerPathForNodeId(model.nodes, block.id))
    .filter((path): path is string => Boolean(path));
  return {
    ok: true,
    selectPath: selectPaths[0] ?? null,
    selectPaths,
  };
}

/** Minimal insert helper. */
export function insertNodeAt(
  model: AstroDocumentModel,
  node: EditableNode,
  target: InsertTarget,
): MutateResult {
  const dest = listForInsertTarget(model, target);
  if (!dest) {
    return { ok: false, selectPath: null, reason: "Invalid insert target" };
  }
  const index = Math.max(0, Math.min(target.index, dest.length));
  dest.splice(index, 0, node);
  return {
    ok: true,
    selectPath: pathWithIndex(target.parentPath, index),
  };
}

/** Insert a node batch without splitting history or containment validation. */
export function insertNodesAt(
  model: AstroDocumentModel,
  nodes: EditableNode[],
  target: InsertTarget,
): MutateResult {
  if (!nodes.length) {
    return { ok: false, selectPath: null, reason: "Nothing to insert" };
  }
  const dest = listForInsertTarget(model, target);
  if (!dest) {
    return { ok: false, selectPath: null, reason: "Invalid insert target" };
  }
  for (const node of nodes) {
    const tag = node.kind === "element" ? node.name.toLowerCase() : null;
    if (!parentAcceptsChildAtPath(model, target.parentPath, tag)) {
      return {
        ok: false,
        selectPath: null,
        reason: `Invalid containment for ${tag ?? node.kind}`,
      };
    }
  }
  const index = Math.max(0, Math.min(target.index, dest.length));
  dest.splice(index, 0, ...nodes);
  const selectPaths = nodes.map((_, offset) =>
    pathWithIndex(target.parentPath, index + offset),
  );
  return {
    ok: true,
    selectPath: selectPaths[0] ?? null,
    selectPaths,
  };
}

/** Create an HTML element node ready for insert. */
export function createElementNode(tag: string): ElementNode {
  const name = tag.trim() || "div";
  const lower = name.toLowerCase();
  if (VOID_ELEMENTS.has(lower) || VOID_TAGS.has(lower)) {
    return {
      id: allocNodeId(),
      kind: "element",
      name: lower,
      props: {},
      children: null,
    };
  }
  if (lower === "ul" || lower === "ol") {
    return {
      id: allocNodeId(),
      kind: "element",
      name: lower,
      props: {},
      children: [createElementNode("li")],
    };
  }
  const placeholder = DEFAULT_ELEMENT_TEXT[lower];
  const children: EditableNode[] = placeholder
    ? [{ id: allocNodeId(), kind: "text", value: placeholder }]
    : [];
  return {
    id: allocNodeId(),
    kind: "element",
    name: lower,
    props: {},
    children,
  };
}

/** Create a self-closing component instance. */
export function createComponentNode(name: string): ComponentNode {
  return {
    id: allocNodeId(),
    kind: "component",
    name,
    props: {},
    children: null,
  };
}

/**
 * Ensure a default `.astro` import exists for `name`.
 * No-op when the binding is already present.
 */
export function ensureComponentImport(
  model: AstroDocumentModel,
  name: string,
  importPath: string,
): void {
  if (model.imports.some((i) => i.name === name)) return;
  model.imports.push({ name, path: importPath });
}

/**
 * Whether `parent` can host a child. When `childTag` is set (HTML insert /
 * element move), apply containment rules. Components are opaque — always ok.
 */
export function nodeAcceptsChild(
  parent: EditableNode | null | undefined,
  childTag: string | null = null,
): boolean {
  if (!parent) return true;
  if (parent.kind === "element") {
    const tag = String(parent.name).toLowerCase();
    if (VOID_ELEMENTS.has(tag) || VOID_TAGS.has(tag)) return false;
    if (parent.children === null) return false;
    return childTag ? canContainTag(tag, childTag) : true;
  }
  if (
    parent.kind === "component" ||
    parent.kind === "fragment" ||
    parent.kind === "slot" ||
    parent.kind === "map"
  ) {
    return true;
  }
  if (parent.kind === "conditional") return true;
  return false;
}

/** Append at the end of Layers Content (body / layout slot host) when present. */
function defaultContentInsertTarget(model: AstroDocumentModel): InsertTarget {
  const contentParentPath = resolvePageContentParentPath(model);
  if (!contentParentPath) {
    return { parentPath: null, index: model.nodes.length };
  }
  const kids = listForInsertTarget(model, {
    parentPath: contentParentPath,
    index: 0,
  });
  return {
    parentPath: contentParentPath,
    index: kids?.length ?? 0,
  };
}

/**
 * Where a new node goes: inside the selection when it accepts children,
 * otherwise right after it (climbing out of illegal ancestors); with no
 * selection (or a Document-shell selection), at the end of page content
 * (body, or layout default slot — never a sibling of the layout/html shell).
 */
export function resolveInsertTarget(
  model: AstroDocumentModel,
  selectedPath: string | null,
  childTag: string | null = null,
): InsertTarget {
  const contentParentPath = resolvePageContentParentPath(model);
  const contentFallback = (): InsertTarget => defaultContentInsertTarget(model);

  if (!selectedPath) {
    return contentFallback();
  }

  const loc = locateAtPath(model.nodes, selectedPath);
  if (!loc) {
    return contentFallback();
  }

  // Document shell / orphans outside Content → append into body/layout.
  if (
    contentParentPath &&
    !isComposerContentPath(selectedPath, contentParentPath)
  ) {
    return contentFallback();
  }

  const visualSibling = siblingAfterRichTextHost(model, selectedPath, childTag);
  if (visualSibling) return visualSibling;

  if (nodeAcceptsChild(loc.node, childTag) && !rejectsVisualInsideRichText(loc.node, childTag)) {
    const kids = childListOf(loc.node);
    // Open self-closing components / slots when inserting into them.
    if (
      kids === null &&
      (loc.node.kind === "component" ||
        loc.node.kind === "slot" ||
        loc.node.kind === "element")
    ) {
      if (loc.node.kind === "element") {
        const tag = String(loc.node.name).toLowerCase();
        if (VOID_ELEMENTS.has(tag) || VOID_TAGS.has(tag)) {
          /* fall through to sibling insert */
        } else {
          loc.node.children = [];
          return { parentPath: selectedPath, index: 0 };
        }
      } else {
        loc.node.children = [];
        return { parentPath: selectedPath, index: 0 };
      }
    } else if (kids) {
      return { parentPath: selectedPath, index: kids.length };
    }
  }

  // Sibling insert — climb out of ancestors that can't legally hold the child.
  let childPath = selectedPath;
  for (let depth = 0; depth < 50; depth++) {
    const childLoc = locateAtPath(model.nodes, childPath);
    if (!childLoc) break;
    const parent = parentPathOf(childPath);
    if (parentAcceptsChildAtPath(model, parent, childTag)) {
      const parentNode = parent ? locateAtPath(model.nodes, parent)?.node : null;
      if (rejectsVisualInsideRichText(parentNode, childTag)) {
        if (parent == null) break;
        childPath = parent;
        continue;
      }
      // Prefer Content over document-root siblings of <html>.
      if (
        contentParentPath &&
        (parent == null || !isComposerContentPath(parent, contentParentPath)) &&
        parent !== contentParentPath
      ) {
        return contentFallback();
      }
      return { parentPath: parent, index: childLoc.index + 1 };
    }
    if (parent == null) break;
    childPath = parent;
  }

  // Last resort: end of page content (body), not document root.
  return contentFallback();
}

/** Insert an HTML element (void-aware, with placeholders). */
export function insertElementAt(
  model: AstroDocumentModel,
  tag: string,
  target: InsertTarget,
): MutateResult {
  const childTag = tag.trim().toLowerCase() || "div";
  if (!parentAcceptsChildAtPath(model, target.parentPath, childTag)) {
    return {
      ok: false,
      selectPath: null,
      reason: "Invalid containment for insert target",
    };
  }
  return insertNodeAt(model, createElementNode(childTag), target);
}

/**
 * Insert a project component and ensure its import line exists.
 */
export function insertComponentAt(
  model: AstroDocumentModel,
  options: { name: string; importPath: string },
  target: InsertTarget,
): MutateResult {
  ensureComponentImport(model, options.name, options.importPath);
  return insertNodeAt(model, createComponentNode(options.name), target);
}

/** @deprecated Prefer insertElementAt — kept for call-site compatibility. */
export function insertDebugElement(
  model: AstroDocumentModel,
  tag: string,
  target: InsertTarget,
): MutateResult {
  return insertElementAt(model, tag, target);
}

function propsOf(node: EditableNode): AstroPropMap | null {
  if (
    node.kind === "element" ||
    node.kind === "component" ||
    node.kind === "fragment" ||
    node.kind === "slot" ||
    node.kind === "raw"
  ) {
    return node.props;
  }
  return null;
}

/**
 * Set / clear a prop on the node at `path`.
 * `value === undefined` deletes the prop.
 */
export function setPropAtPath(
  model: AstroDocumentModel,
  path: string,
  propName: string,
  value: PropValue | undefined,
): MutateResult {
  const name = propName.trim();
  if (!name) {
    return { ok: false, selectPath: path, reason: "Empty prop name" };
  }
  const loc = locateAtPath(model.nodes, path);
  if (!loc) return { ok: false, selectPath: path, reason: "Node not found" };
  const props = propsOf(loc.node);
  if (!props) {
    return {
      ok: false,
      selectPath: path,
      reason: "Node has no props",
    };
  }
  if (value === undefined) delete props[name];
  else props[name] = value;
  return { ok: true, selectPath: path };
}

/** Persist a custom Layers-only label without changing content or semantics. */
export function setComposerLayerLabelAtPath(
  model: AstroDocumentModel,
  path: string,
  label: string,
): MutateResult {
  const value = label.trim();
  if (value.length > 100) {
    return { ok: false, selectPath: path, reason: "Layer name must be 100 characters or fewer" };
  }
  const loc = locateAtPath(model.nodes, path);
  if (!loc || (loc.node.kind !== "element" && loc.node.kind !== "component")) {
    return { ok: false, selectPath: path, reason: "Only HTML element and component layers can be renamed" };
  }
  return setPropAtPath(
    model,
    path,
    ARIA_LAYER_LABEL_ATTR,
    value ? { type: "string", value } : undefined,
  );
}

/**
 * Rename a prop key in place, preserving value and relative order.
 */
export function renamePropAtPath(
  model: AstroDocumentModel,
  path: string,
  oldName: string,
  newName: string,
): MutateResult {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from === to) {
    return { ok: true, selectPath: path };
  }
  const loc = locateAtPath(model.nodes, path);
  if (!loc) return { ok: false, selectPath: path, reason: "Node not found" };
  const props = propsOf(loc.node);
  if (!props || !(from in props)) {
    return { ok: false, selectPath: path, reason: "Prop not found" };
  }
  if (to in props && to !== from) {
    return { ok: false, selectPath: path, reason: "Prop already exists" };
  }
  const next: AstroPropMap = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === from) next[to] = v;
    else next[k] = v;
  }
  if (
    loc.node.kind === "element" ||
    loc.node.kind === "component" ||
    loc.node.kind === "fragment" ||
    loc.node.kind === "slot" ||
    loc.node.kind === "raw"
  ) {
    loc.node.props = next;
  }
  return { ok: true, selectPath: path };
}

/**
 * Update text / comment / expr / map-head content at `path`.
 */
export function setTextAtPath(
  model: AstroDocumentModel,
  path: string,
  value: string,
): MutateResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc) return { ok: false, selectPath: path, reason: "Node not found" };
  const node = loc.node;
  if (node.kind === "text" || node.kind === "comment") {
    node.value = value;
    return { ok: true, selectPath: path };
  }
  if (node.kind === "expr") {
    const trimmed = value.trim();
    node.value =
      trimmed.startsWith("{") && trimmed.endsWith("}")
        ? trimmed
        : `{${trimmed}}`;
    return { ok: true, selectPath: path };
  }
  if (node.kind === "map") {
    node.head = value;
    return { ok: true, selectPath: path };
  }
  return {
    ok: false,
    selectPath: path,
    reason: "Node has no editable text",
  };
}

/** Change a literal HTML element tag without touching its props or children. */
export function setTagAtPath(
  model: AstroDocumentModel,
  path: string,
  tag: string,
): MutateResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc || loc.node.kind !== "element") {
    return { ok: false, selectPath: path, reason: "Element not found" };
  }
  const next = tag.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(next)) {
    return { ok: false, selectPath: path, reason: "Invalid HTML tag" };
  }
  const current = loc.node.name.toLowerCase();
  if (next === current) return { ok: true, selectPath: path };
  if (next === "a" || next === "button" || current === "a" || current === "button") {
    const interactiveTag = next === "a" || next === "button" ? next : current;
    return {
      ok: false,
      selectPath: path,
      reason: `Use the ${interactiveTag === "a" ? "Link" : "Button"} controls to change interactive elements`,
    };
  }
  const parentPath = parentPathOf(path);
  if (!parentAcceptsChildAtPath(model, parentPath, next)) {
    return { ok: false, selectPath: path, reason: `A <${next}> is invalid in this parent` };
  }
  if (
    (VOID_ELEMENTS.has(next) || VOID_TAGS.has(next)) &&
    Array.isArray(loc.node.children) &&
    loc.node.children.length
  ) {
    return {
      ok: false,
      selectPath: path,
      reason: "Cannot change an element with children to a void tag",
    };
  }
  if (Array.isArray(loc.node.children)) {
    for (const child of loc.node.children) {
      if (child.kind === "element" && !canContainTag(next, child.name)) {
        return {
          ok: false,
          selectPath: path,
          reason: `A <${next}> cannot contain <${child.name.toLowerCase()}>`,
        };
      }
    }
  }
  loc.node.name = next;
  if (VOID_ELEMENTS.has(next) || VOID_TAGS.has(next)) loc.node.children = null;
  return { ok: true, selectPath: path };
}

/** Validate path parses (exported for tests). */
export function assertValidPath(path: string): MarkerPathSeg[] {
  return parseMarkerPath(path);
}
