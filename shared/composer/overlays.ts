import type { OverlayInfo } from "./paths";
import type { AriaRect } from "./protocol";
import type { SelectionRef } from "./selection";
import type { EditableNode } from "./types";

export const COLLAPSED_AFFORDANCE_HEIGHT = 24;

export type OverlayDescriptor =
  | { kind: "hover"; key: string; rect: AriaRect; info: OverlayInfo }
  | {
      kind: "selection";
      key: string;
      rect: AriaRect;
      info: OverlayInfo;
      role: "primary" | "secondary" | "ghost";
      selection: SelectionRef;
    }
  | {
      kind: "insertion";
      key: string;
      rect: AriaRect;
      axis: "horizontal" | "vertical";
      operation: "insert" | "reorder";
    }
  | {
      kind: "target";
      key: string;
      rect: AriaRect;
      active: boolean;
    };

/** Editor-only hit rail for empty/zero-height authored nodes. */
export function visualAffordanceRect(rect: AriaRect): AriaRect {
  if (rect.h >= 1) return rect;
  return {
    x: rect.x,
    y: rect.y - COLLAPSED_AFFORDANCE_HEIGHT / 2,
    w: Math.max(rect.w, COLLAPSED_AFFORDANCE_HEIGHT),
    h: COLLAPSED_AFFORDANCE_HEIGHT,
  };
}

/**
 * A page layout owns the complete visible document surface, even though its
 * Astro invocation markers may only surround submitted slot content.
 */
export function composerOverlayRects(
  node: EditableNode | null,
  bridgeRects: AriaRect[] | null | undefined,
  viewport: { width: number; height: number } | null,
): AriaRect[] | null {
  if (
    node?.id === "layout" &&
    viewport &&
    viewport.width > 0 &&
    viewport.height > 0
  ) {
    return [{ x: 0, y: 0, w: viewport.width, h: viewport.height }];
  }
  return bridgeRects ?? null;
}

export type ResizeHandle =
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "nw";

export type ResizePreview = {
  selection: SelectionRef;
  handle: ResizeHandle;
  start: AriaRect;
  current: AriaRect;
  widthCss: string;
  heightCss: string;
};

export type CanvasDropCandidate = {
  parentPath: string | null;
  index: number;
  mode: "before" | "after" | "inside";
  axis: "horizontal" | "vertical";
  rect: AriaRect;
};
