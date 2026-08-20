import { bareMarkerPath } from "./paths";
import type { AstroDocumentModel, EditableNode, PropValue } from "./types";

export type ComposerCanvasTreeNode =
  | {
      id: string;
      kind: "element";
      path: string;
      tagName: string;
      attributes: Record<string, string>;
      children: ComposerCanvasTreeNode[];
    }
  | { id: string; kind: "text"; path: string; text: string }
  | { id: string; kind: "opaque"; path: string };

export type ComposerCanvasBoundary = {
  path: string;
  before: ComposerCanvasTreeNode[];
  after: ComposerCanvasTreeNode[];
};

export type ComposerPropertyPatch = {
  kind: "properties";
  path: string;
  occurrence?: number;
  tagName?: string;
  attributes?: Record<string, string | null>;
  text?: string;
};

export type ComposerStaticTreePatch = {
  kind: "static-tree";
  boundaries: ComposerCanvasBoundary[];
};

export type ComposerDomPatch = ComposerPropertyPatch | ComposerStaticTreePatch;

export type ComposerPreviewDiff =
  | { kind: "dom-patch"; paths: string[]; patches: ComposerDomPatch[]; reason: string }
  | { kind: "server-reconcile"; paths: string[]; reason: string }
  | { kind: "hard-reload"; paths: string[]; reason: string };

function childrenOf(node: EditableNode): EditableNode[] | null {
  if (node.kind === "conditional") {
    return node.mode === "ternary" ? [...node.consequent, ...(node.alternate ?? [])] : node.consequent;
  }
  if ("children" in node && Array.isArray(node.children)) return node.children;
  return null;
}

function staticAttribute(value: PropValue): string | null | undefined {
  if (value.type === "string") return value.value;
  if (value.type === "bare") return "";
  return undefined;
}

const STRUCTURAL_UNSAFE_TAGS = new Set([
  "base", "head", "html", "link", "meta", "noscript", "script", "style", "title",
]);

function staticPropMap(
  props: Record<string, PropValue>,
): Record<string, string> | null {
  const output: Record<string, string> = {};
  for (const [name, prop] of Object.entries(props)) {
    if (name === "data-aria-p" || /^on/i.test(name)) return null;
    const value = staticAttribute(prop);
    if (value === undefined || value === null) return null;
    output[name] = value;
  }
  return output;
}

function canvasPath(base: string, index: number): string {
  return base ? `${base}.${index}` : String(index);
}

function projectCanvasNode(
  node: EditableNode,
  path: string,
): ComposerCanvasTreeNode {
  if (node.kind === "text") {
    return { id: node.id, kind: "text", path, text: node.value };
  }
  if (node.kind === "element") {
    const tagName = node.name;
    const normalizedTagName = tagName.toLowerCase();
    const attributes = staticPropMap(node.props);
    if (
      !node.dynamicTag &&
      !tagName.includes("-") &&
      !STRUCTURAL_UNSAFE_TAGS.has(normalizedTagName) &&
      attributes
    ) {
      return {
        id: node.id,
        kind: "element",
        path,
        tagName,
        attributes,
        children: Array.isArray(node.children)
          ? node.children.map((child, index) =>
              projectCanvasNode(child, `${path}.${index}`),
            )
          : [],
      };
    }
  }
  return { id: node.id, kind: "opaque", path };
}

function projectCanvasForest(
  nodes: EditableNode[],
  base: string,
): ComposerCanvasTreeNode[] {
  return nodes.map((node, index) => projectCanvasNode(node, canvasPath(base, index)));
}

type OpaqueMetadata = {
  fingerprint: string;
  parentId: string | null;
};

function opaqueMetadata(
  nodes: EditableNode[],
  parentId: string | null,
  output = new Map<string, OpaqueMetadata>(),
): Map<string, OpaqueMetadata> {
  for (const node of nodes) {
    const projected = projectCanvasNode(node, "0");
    if (projected.kind === "opaque") {
      output.set(node.id, {
        fingerprint: JSON.stringify(node),
        parentId,
      });
      continue;
    }
    if (node.kind === "element" && Array.isArray(node.children)) {
      opaqueMetadata(node.children, node.id, output);
    }
  }
  return output;
}

function opaqueAnchorsAreStable(
  before: EditableNode[],
  after: EditableNode[],
): boolean {
  const previous = opaqueMetadata(before, null);
  const next = opaqueMetadata(after, null);
  if (previous.size !== next.size) return false;
  for (const [id, oldMeta] of previous) {
    const newMeta = next.get(id);
    if (
      !newMeta ||
      oldMeta.fingerprint !== newMeta.fingerprint ||
      oldMeta.parentId !== newMeta.parentId
    ) return false;
  }
  return true;
}

function staticAttributes(
  before: Record<string, PropValue>,
  after: Record<string, PropValue>,
): Record<string, string | null> | null {
  const output: Record<string, string | null> = {};
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const previous = before[name];
    const next = after[name];
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    if (!next) {
      output[name] = null;
      continue;
    }
    const value = staticAttribute(next);
    if (value === undefined) return null;
    output[name] = value;
  }
  return output;
}

function parentPath(path: string): string {
  const bare = bareMarkerPath(path);
  const separator = bare.lastIndexOf(".");
  return separator < 0 ? bare : bare.slice(0, separator);
}

export function consolidateComposerPreviewPaths(paths: readonly string[]): string[] {
  const sorted = [...new Set(paths.map(bareMarkerPath).filter(Boolean))].sort(
    (a, b) => a.split(".").length - b.split(".").length || a.localeCompare(b),
  );
  return sorted.filter(
    (path) => !sorted.some((candidate) => candidate !== path && path.startsWith(`${candidate}.`)),
  );
}

/** Browser-safe mutations patch immediately; everything requiring Astro is reconciled. */
export function classifyComposerPreviewDiff(
  before: AstroDocumentModel,
  after: AstroDocumentModel,
): ComposerPreviewDiff {
  if (JSON.stringify(before.imports) !== JSON.stringify(after.imports)) {
    return { kind: "hard-reload", paths: ["$document"], reason: "imports-changed" };
  }
  if (before.extraFrontmatter !== after.extraFrontmatter) {
    return { kind: "server-reconcile", paths: ["$document"], reason: "module-input-changed" };
  }

  const propertyPatches: ComposerPropertyPatch[] = [];
  const structuralBoundaries: ComposerCanvasBoundary[] = [];
  const reconcilePaths: string[] = [];
  const visit = (previous: EditableNode[], next: EditableNode[], base = "") => {
    if (previous.length !== next.length || previous.some((node, index) => node.id !== next[index]?.id)) {
      if (opaqueAnchorsAreStable(previous, next)) {
        structuralBoundaries.push({
          path: base || "$document",
          before: projectCanvasForest(previous, base),
          after: projectCanvasForest(next, base),
        });
      } else {
        reconcilePaths.push(base || "$document");
      }
      return;
    }
    previous.forEach((oldNode, index) => {
      const newNode = next[index]!;
      const path = base ? `${base}.${index}` : String(index);
      if (oldNode.kind !== newNode.kind) {
        reconcilePaths.push(parentPath(path) || path);
        return;
      }
      if (oldNode.kind === "text" && newNode.kind === "text") {
        if (oldNode.value !== newNode.value) {
          propertyPatches.push({ kind: "properties", path, text: newNode.value });
        }
        return;
      }
      if (oldNode.kind === "comment" || oldNode.kind === "doctype") {
        if (JSON.stringify(oldNode) !== JSON.stringify(newNode)) reconcilePaths.push(path);
        return;
      }
      if (
        oldNode.kind === "expr" || oldNode.kind === "map" || oldNode.kind === "conditional" ||
        oldNode.kind === "raw" || oldNode.kind === "component" || oldNode.kind === "fragment" ||
        oldNode.kind === "slot"
      ) {
        if (JSON.stringify(oldNode) !== JSON.stringify(newNode)) reconcilePaths.push(path);
        return;
      }
      if (oldNode.kind === "element" && newNode.kind === "element") {
        // A dynamic/custom/runtime-owned element is one opaque Astro unit. Do
        // not let an otherwise-static child or attribute edit tunnel through
        // that ownership boundary into the browser patch lane.
        const oldProjection = projectCanvasNode(oldNode, path);
        const newProjection = projectCanvasNode(newNode, path);
        if (oldProjection.kind !== "element" || newProjection.kind !== "element") {
          if (JSON.stringify(oldNode) !== JSON.stringify(newNode)) reconcilePaths.push(path);
          return;
        }
        const attributes = staticAttributes(oldNode.props, newNode.props);
        const changedProps = JSON.stringify(oldNode.props) !== JSON.stringify(newNode.props);
        if (changedProps && attributes === null) {
          reconcilePaths.push(path);
          return;
        }
        const patch: ComposerPropertyPatch = { kind: "properties", path };
        if (oldNode.name !== newNode.name) patch.tagName = newNode.name;
        if (attributes && Object.keys(attributes).length) patch.attributes = attributes;
        if (patch.tagName || patch.attributes) propertyPatches.push(patch);
        const oldChildren = childrenOf(oldNode);
        const newChildren = childrenOf(newNode);
        if (oldChildren && newChildren) visit(oldChildren, newChildren, path);
        else if (oldChildren !== newChildren) reconcilePaths.push(path);
      }
    });
  };

  visit(before.nodes, after.nodes);
  if (reconcilePaths.length) {
    return {
      kind: "server-reconcile",
      paths: consolidateComposerPreviewPaths([
        ...reconcilePaths,
        ...propertyPatches.map((patch) => patch.path),
        ...structuralBoundaries.map((boundary) => boundary.path),
      ]),
      reason: "astro-render-required",
    };
  }
  return {
    kind: "dom-patch",
    paths: consolidateComposerPreviewPaths([
      ...propertyPatches.map((patch) => patch.path),
      ...structuralBoundaries.map((boundary) => boundary.path),
    ]),
    patches: [
      ...propertyPatches,
      ...(structuralBoundaries.length
        ? [{ kind: "static-tree" as const, boundaries: structuralBoundaries }]
        : []),
    ],
    reason: "browser-safe-static-change",
  };
}
