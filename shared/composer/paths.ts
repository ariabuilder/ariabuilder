/**
 * Marker path helpers — paths must match `serializeAstroMarked` exactly
 * (e.g. `0.1.2`, `0.3.t.0` for conditional consequent children).
 *
 * Selection identity for Composer is these path strings (+ occurrence index
 * for loop instances), not ephemeral parse `id`s.
 */

import type { EditableNode, ElementNode, PropValue } from "./types";

export type MarkerPathSeg = number | "t" | "f";

export type StructureKind =
  | EditableNode["kind"]
  | "conditional-branch";

export type StructureRow = {
  /** Marker path matching serializeAstroMarked / data-aria-p. */
  path: string;
  /** Ephemeral parse id (unstable across reloads). */
  id: string;
  kind: EditableNode["kind"];
  label: string;
  /**
   * Underlying HTML/component tag when applicable (DnD containment).
   * Distinct from `label` when `data-aria-type` is shown (e.g. Section).
   */
  tag?: string;
  children: StructureRow[];
};

/** Strip component-drill namespace (`src/…/Card.astro|0.1` → `0.1`). */
export function bareMarkerPath(path: string): string {
  const pipe = path.lastIndexOf("|");
  return pipe >= 0 ? path.slice(pipe + 1) : path;
}

/**
 * Marker path prefix for a non-page `.astro` file (matches Vite load plugin).
 * Example: `src/components/Card.astro` → `src/components/Card.astro|`
 */
export function markerScopeForFile(relativeFile: string): string {
  const rel = relativeFile.replace(/\\/g, "/").replace(/^\/+/, "");
  return rel ? `${rel}|` : "";
}

/** Prefix a bare tree path with a file scope (`0.1` → `src/…/Card.astro|0.1`). */
export function scopedMarkerPath(
  barePath: string,
  scope: string | null | undefined,
): string {
  const bare = bareMarkerPath(barePath);
  if (!scope) return bare;
  return `${scope}${bare}`;
}

/** True when `path` is inside an active drill scope (or unscoped page path). */
export function isMarkerPathInScope(
  path: string | null | undefined,
  scope: string | null | undefined,
): boolean {
  if (!path) return false;
  if (scope) return path.startsWith(scope);
  return !path.includes("|");
}

/**
 * True when `path` is the focus instance or a descendant on the page canvas
 * (used while drilling — clicks outside exit).
 */
export function isUnderFocusPath(
  path: string | null | undefined,
  focusPath: string | null | undefined,
): boolean {
  if (!path || !focusPath) return false;
  return path === focusPath || path.startsWith(`${focusPath}.`);
}

export function parseMarkerPath(path: string): MarkerPathSeg[] {
  const bare = bareMarkerPath(path);
  if (!bare) return [];
  return bare.split(".").map((seg) => {
    if (seg === "t" || seg === "f") return seg;
    const n = Number(seg);
    if (!Number.isInteger(n) || n < 0 || String(n) !== seg) {
      throw new Error(`Invalid marker path segment: ${seg}`);
    }
    return n;
  });
}

export function tryParseMarkerPath(path: string): MarkerPathSeg[] | null {
  try {
    return parseMarkerPath(path);
  } catch {
    return null;
  }
}

function childList(node: EditableNode): EditableNode[] | null {
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
 * Resolve a marker path against a root node list.
 * Conditional:
 * - `&&` children use `${path}.${i}` (same as map)
 * - ternary children use `${path}.t.${i}` / `${path}.f.${i}`
 */
export function nodeAtMarkerPath(
  nodes: EditableNode[],
  path: string,
): EditableNode | null {
  const segs = tryParseMarkerPath(path);
  if (!segs || segs.length === 0) return null;
  return nodeAtSegs(nodes, segs, 0);
}

/** Deepest projected marker path containing a CodeMirror UTF-16 offset. */
export function markerPathAtSourceOffset(
  nodes: EditableNode[],
  offset: number,
): string | null {
  let best: string | null = null;
  const visit = (list: EditableNode[], parentPath: string | null) => {
    for (let index = 0; index < list.length; index += 1) {
      const node = list[index]!;
      const path = parentPath == null ? String(index) : `${parentPath}.${index}`;
      const range = node.sourceRange;
      if (!range || offset < range.from || offset > range.to) continue;
      best = path;
      if (node.kind === "conditional") {
        if (node.mode === "ternary") {
          visit(node.consequent, `${path}.t`);
          visit(node.alternate ?? [], `${path}.f`);
        } else {
          visit(node.consequent, path);
        }
      } else {
        const children = childList(node);
        if (children) visit(children, path);
      }
    }
  };
  visit(nodes, null);
  return best;
}

function nodeAtSegs(
  list: EditableNode[],
  segs: MarkerPathSeg[],
  offset: number,
): EditableNode | null {
  if (offset >= segs.length) return null;
  const seg = segs[offset];
  if (seg === "t" || seg === "f") return null;
  const node = list[seg];
  if (!node) return null;
  if (offset === segs.length - 1) return node;

  const next = segs[offset + 1];
  if (
    node.kind === "conditional" &&
    node.mode === "ternary" &&
    (next === "t" || next === "f")
  ) {
    const branch =
      next === "t" ? node.consequent : (node.alternate ?? []);
    return nodeAtSegs(branch, segs, offset + 2);
  }

  // `&&` conditionals and maps/elements: numeric child index
  if (node.kind === "conditional" && node.mode === "and") {
    return nodeAtSegs(node.consequent, segs, offset + 1);
  }

  const kids = childList(node);
  if (!kids) return null;
  return nodeAtSegs(kids, segs, offset + 1);
}

/** Marker path for a node id, or null if not found. */
export function markerPathForNodeId(
  nodes: EditableNode[],
  id: string,
  parentPath: string | null = null,
): string | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const path = parentPath == null ? String(i) : `${parentPath}.${i}`;
    if (node.id === id) return path;

    if (node.kind === "conditional") {
      if (node.mode === "ternary") {
        const inThen = markerPathForNodeId(node.consequent, id, `${path}.t`);
        if (inThen) return inThen;
        const inElse = markerPathForNodeId(
          node.alternate ?? [],
          id,
          `${path}.f`,
        );
        if (inElse) return inElse;
      } else {
        const inAnd = markerPathForNodeId(node.consequent, id, path);
        if (inAnd) return inAnd;
      }
      continue;
    }

    const kids = childList(node);
    if (kids) {
      const found = markerPathForNodeId(kids, id, path);
      if (found) return found;
    }
  }
  return null;
}

export function labelForNode(node: EditableNode): string {
  // Layout wrapper on a page — the component name already communicates its role.
  if (
    node.id === "layout" &&
    (node.kind === "component" || node.kind === "element")
  ) {
    return node.name || "Layout";
  }
  switch (node.kind) {
    case "element":
    case "raw": {
      if (node.kind === "element" && node.props.popover != null) {
        return "Popover content";
      }
      if (node.kind === "element" && Array.isArray(node.children)) {
        const targetIds = new Set(node.children
          .filter((child): child is ElementNode => child.kind === "element" && child.props.popover != null)
          .map((child) => child.props.id)
          .filter((value): value is Extract<PropValue, { type: "string" }> => value?.type === "string")
          .map((value) => value.value));
        if (targetIds.size && node.children.some((child) =>
          child.kind === "element"
          && child.name.toLowerCase() === "button"
          && child.props.popovertarget?.type === "string"
          && targetIds.has(child.props.popovertarget.value))) {
          return "Popover";
        }
      }
      const ariaType = node.props?.["data-aria-type"];
      if (ariaType?.type === "string" && ariaType.value.trim()) {
        return ariaType.value.trim();
      }
      return node.name || node.kind;
    }
    case "component":
      return node.name || "Component";
    case "fragment":
      return node.name ? `<${node.name}>` : "<>";
    case "slot": {
      const nameProp = node.props?.name;
      const slotName =
        nameProp && nameProp.type === "string" ? nameProp.value : null;
      return slotName ? `slot:${slotName}` : "slot";
    }
    case "text": {
      const t = node.value.replace(/\s+/g, " ").trim();
      if (!t) return "(text)";
      return t.length > 28 ? `${t.slice(0, 27)}…` : t;
    }
    case "comment":
      return "<!-- -->";
    case "expr": {
      const v = node.value.replace(/\s+/g, " ").trim();
      return v.length > 28 ? `${v.slice(0, 27)}…` : v;
    }
    case "map": {
      const head = node.head.replace(/\s+/g, " ").trim();
      const short = head.length > 24 ? `${head.slice(0, 23)}…` : head;
      return short ? `{${short}}` : "{map}";
    }
    case "conditional":
      return node.mode === "ternary" ? "{?:}" : "{&&}";
    case "doctype":
      return "!doctype";
    default:
      return "node";
  }
}

/** Structure tree mirroring the marked editable model (paths = selection ids). */
export function buildStructureTree(
  nodes: EditableNode[],
  parentPath: string | null = null,
): StructureRow[] {
  const rows: StructureRow[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    // Skip pure whitespace text in the stub — still selectable via canvas.
    if (node.kind === "text" && !node.value.trim()) continue;
    const path = parentPath == null ? String(i) : `${parentPath}.${i}`;
    rows.push({
      path,
      id: node.id,
      kind: node.kind,
      label: labelForNode(node),
      tag:
        node.kind === "element" ||
        node.kind === "component" ||
        node.kind === "raw"
          ? node.name
          : undefined,
      children: structureChildren(node, path),
    });
  }
  return rows;
}

function structureChildren(
  node: EditableNode,
  path: string,
): StructureRow[] {
  if (node.kind === "conditional") {
    if (node.mode === "ternary") {
      return [
        ...buildStructureTree(node.consequent, `${path}.t`),
        ...buildStructureTree(node.alternate ?? [], `${path}.f`),
      ];
    }
    // `&&` — children share the same numeric namespace as serializeAstroMarked
    return buildStructureTree(node.consequent, path);
  }
  const kids = childList(node);
  if (!kids) return [];
  return buildStructureTree(kids, path);
}

export type OverlayInfo = {
  path: string;
  label: string;
  kind: "element" | "component" | "map" | "other";
};

export function overlayInfoForPath(
  nodes: EditableNode[],
  path: string,
): OverlayInfo | null {
  const node = nodeAtMarkerPath(nodes, path);
  if (!node) {
    return { path, label: path, kind: "other" };
  }
  const label = labelForNode(node);
  if (node.kind === "component" && !node.dynamicTag) {
    return { path, label, kind: "component" };
  }
  if (node.kind === "map") {
    return { path, label, kind: "map" };
  }
  if (node.kind === "element" || node.kind === "raw") {
    return { path, label, kind: "element" };
  }
  return { path, label, kind: "other" };
}
