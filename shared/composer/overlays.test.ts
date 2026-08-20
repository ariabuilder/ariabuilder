import { describe, expect, it } from "vitest";
import { composerOverlayRects } from "./overlays";
import type { EditableNode } from "./types";

const layoutNode: EditableNode = {
  id: "layout",
  kind: "component",
  name: "Layout",
  props: {},
  children: [],
};

describe("Composer overlay geometry", () => {
  it("wraps a page layout around the complete visible canvas", () => {
    expect(
      composerOverlayRects(
        layoutNode,
        [{ x: 0, y: 64, w: 1200, h: 736 }],
        { width: 1200, height: 800 },
      ),
    ).toEqual([{ x: 0, y: 0, w: 1200, h: 800 }]);
  });

  it("keeps marker geometry for ordinary elements", () => {
    const markerRects = [{ x: 20, y: 64, w: 400, h: 200 }];
    expect(
      composerOverlayRects(
        { ...layoutNode, id: "n1", kind: "element", name: "section" },
        markerRects,
        { width: 1200, height: 800 },
      ),
    ).toBe(markerRects);
  });
});
