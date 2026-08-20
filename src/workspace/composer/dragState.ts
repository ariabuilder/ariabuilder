/**
 * Cross-panel drag payload for Composer palette ↔ structure DnD.
 *
 * `dragover` cannot read dataTransfer payloads (only type names), so drop
 * targets consult this module for containment checks while the pointer moves.
 */

import type { AriaPrimitiveId } from "../../../shared/composer/ariaPrimitives";

export type ComposerDragPayload =
  | {
      kind: "element";
      tag: string;
    }
  | {
      kind: "primitive";
      id: AriaPrimitiveId;
      /** Root HTML tag for containment; null for non-element nodes. */
      tag: string | null;
    }
  | {
      kind: "component";
      name: string;
      file: string;
    }
  | {
      kind: "node";
      path: string;
      nodeKind: string;
      tag?: string;
    };

export const ARIA_DND_ELEMENT = "application/x-aria-composer-element";
export const ARIA_DND_PRIMITIVE = "application/x-aria-composer-primitive";
export const ARIA_DND_COMPONENT = "application/x-aria-composer-component";
export const ARIA_DND_NODE = "application/x-aria-composer-node";

let current: ComposerDragPayload | null = null;

export const COMPOSER_DRAG_CHANGE_EVENT = "aria:composer-drag-change";

function announceDragChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COMPOSER_DRAG_CHANGE_EVENT));
}

export function setComposerDrag(info: ComposerDragPayload | null): void {
  current = info;
  announceDragChange();
}

export function clearComposerDrag(): void {
  current = null;
  announceDragChange();
}

export function getComposerDrag(): ComposerDragPayload | null {
  return current;
}

export function isComposerDndPayload(types: DOMStringList | readonly string[]): boolean {
  const list = Array.from(types as ArrayLike<string>);
  return (
    list.includes(ARIA_DND_ELEMENT) ||
    list.includes(ARIA_DND_PRIMITIVE) ||
    list.includes(ARIA_DND_COMPONENT) ||
    list.includes(ARIA_DND_NODE)
  );
}

/** Child tag for containment checks (null = component / opaque). */
export function dragChildTag(drag: ComposerDragPayload | null): string | null {
  if (!drag) return null;
  if (drag.kind === "element") return drag.tag;
  if (drag.kind === "primitive") return drag.tag;
  if (drag.kind === "node" && drag.nodeKind === "element" && drag.tag) {
    return drag.tag;
  }
  return null;
}
