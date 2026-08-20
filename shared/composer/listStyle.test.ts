import { describe, expect, it } from "vitest";
import {
  applyListPresentation,
  applyListPresentationToStyles,
  clearListPresentation,
  clearListPresentationFromStyles,
  compatibleListMarker,
  isListStyleUtility,
  listPresentationCss,
  listPresentationHasChangesFromStyles,
  parseListStyleShorthand,
  resolveListMarker,
  resolveListPosition,
  resolveListPresentationFromStyles,
  syncListMarkerForMode,
} from "./listStyle";
import type { ElementNode } from "./types";

function list(props: ElementNode["props"], name = "ul"): ElementNode {
  return {
    id: "list",
    kind: "element",
    name,
    props,
    children: [],
  };
}

describe("list presentation", () => {
  it("parses list-style shorthand type and position", () => {
    expect(parseListStyleShorthand("disc")).toEqual({ type: "disc" });
    expect(parseListStyleShorthand("none")).toEqual({ type: "none" });
    expect(parseListStyleShorthand("disc inside")).toEqual({
      type: "disc",
      position: "inside",
    });
    expect(parseListStyleShorthand("inside decimal")).toEqual({
      type: "decimal",
      position: "inside",
    });
    expect(parseListStyleShorthand("circle outside none")).toEqual({
      type: "circle",
      position: "outside",
    });
  });

  it("reads marker and position from a class declaration map", () => {
    expect(resolveListPresentationFromStyles({
      display: "flex",
      "list-style": "none",
      gap: "1.5rem",
    })).toEqual({ type: "none" });
    expect(resolveListPresentationFromStyles({
      "list-style-type": "none",
    })).toEqual({ type: "none" });
    expect(applyListPresentationToStyles(
      { display: "flex", "list-style": "none" },
      { type: "square" },
      { type: "disc", position: "outside" },
    )).toEqual({
      display: "flex",
      "list-style": "square outside none",
    });
    expect(listPresentationHasChangesFromStyles({ "list-style": "none" })).toBe(true);
    expect(clearListPresentationFromStyles({
      display: "flex",
      "list-style": "none",
    })).toEqual({ display: "flex" });
  });

  it("reads marker from Tailwind list utilities including variants", () => {
    expect(isListStyleUtility("list-disc")).toBe(true);
    expect(isListStyleUtility("md:list-none")).toBe(true);
    expect(isListStyleUtility("list-inside")).toBe(true);
    expect(isListStyleUtility("space-y-2")).toBe(false);
    expect(resolveListMarker(list({
      class: { type: "string", value: "space-y-2 list-disc" },
    }))).toBe("disc");
    expect(resolveListPosition(list({
      class: { type: "string", value: "list-inside" },
    }))).toBe("inside");
  });

  it("writes list-style: none and strips list-disc", () => {
    const node = list({ class: { type: "string", value: "space-y-2 list-disc md:list-decimal" } });
    expect(applyListPresentation(node, { type: "none" })).toBe(true);
    expect(node.props.style).toEqual({ type: "string", value: "list-style: none" });
    expect(node.props.class).toEqual({ type: "string", value: "space-y-2" });
  });

  it("replaces a list-style shorthand instead of stacking longhands", () => {
    const node = list({ style: { type: "string", value: "color: red; list-style: disc" } });
    expect(applyListPresentation(node, { type: "none" })).toBe(true);
    expect(node.props.style).toEqual({
      type: "string",
      value: "color: red; list-style: none",
    });
  });

  it("maps incompatible markers when converting list type", () => {
    expect(compatibleListMarker("ordered", "disc")).toBe("decimal");
    expect(compatibleListMarker("ordered", "none")).toBe("decimal");
    expect(compatibleListMarker("unordered", "decimal")).toBe("none");
    expect(compatibleListMarker("unordered", "lower-alpha")).toBe("none");
    expect(compatibleListMarker("ordered", "upper-roman")).toBe("upper-roman");
  });

  it("syncs an unordered list with bullets to decimal when becoming ordered", () => {
    const node = list({
      class: { type: "string", value: "list-disc" },
      style: { type: "string", value: "list-style: disc" },
    });
    node.name = "ol";
    syncListMarkerForMode(node, "ordered", "disc");
    expect(node.props.style).toEqual({
      type: "string",
      value: "list-style: decimal outside none; padding-inline-start: 1.5em",
    });
    expect(node.props.class).toBeUndefined();
  });

  it("restores circle after none with an outside indent so the canvas can paint markers", () => {
    const node = list({ style: { type: "string", value: "list-style: none" } });
    expect(applyListPresentation(node, { type: "circle" })).toBe(true);
    expect(node.props.style).toEqual({
      type: "string",
      value: "list-style: circle outside none; padding-inline-start: 1.5em",
    });
    expect(listPresentationCss(node)).toBe(
      "list-style: circle outside none; padding-inline-start: 1.5em",
    );
  });

  it("removes the invented indent when hiding markers again", () => {
    const node = list({});
    expect(applyListPresentation(node, { type: "circle" })).toBe(true);
    expect(applyListPresentation(node, { type: "none" })).toBe(true);
    expect(node.props.style).toEqual({ type: "string", value: "list-style: none" });
  });

  it("does not invent padding when the list already has a start indent utility", () => {
    const node = list({ class: { type: "string", value: "pl-6" } });
    expect(applyListPresentation(node, { type: "circle" })).toBe(true);
    expect(node.props.style).toEqual({
      type: "string",
      value: "list-style: circle outside none",
    });
    expect(node.props.class).toEqual({ type: "string", value: "pl-6" });
  });

  it("still adds an outside indent when existing padding is zero", () => {
    const node = list({ style: { type: "string", value: "padding: 0" } });
    expect(applyListPresentation(node, { type: "circle" })).toBe(true);
    expect(node.props.style).toEqual({
      type: "string",
      value: "padding: 0; list-style: circle outside none; padding-inline-start: 1.5em",
    });
  });

  it("treats p-0 as no start padding", () => {
    const node = list({ class: { type: "string", value: "p-0" } });
    expect(applyListPresentation(node, { type: "circle" })).toBe(true);
    expect(node.props.style).toEqual({
      type: "string",
      value: "list-style: circle outside none; padding-inline-start: 1.5em",
    });
    expect(node.props.class).toEqual({ type: "string", value: "p-0" });
  });

  it("clears list presentation on description lists", () => {
    const node = list({
      class: { type: "string", value: "list-decimal" },
      style: { type: "string", value: "list-style: decimal" },
    }, "dl");
    syncListMarkerForMode(node, "description");
    expect(node.props.style).toBeUndefined();
    expect(node.props.class).toBeUndefined();
  });

  it("refuses expression-bound style but still allows a no-op clear of utilities", () => {
    const node = list({
      class: { type: "string", value: "list-disc" },
      style: { type: "expr", value: "entry.listStyle" },
    });
    expect(applyListPresentation(node, { type: "none" })).toBe(false);
    expect(node.props.style).toEqual({ type: "expr", value: "entry.listStyle" });
    expect(clearListPresentation(node)).toBe(false);
    expect(node.props.class).toBeUndefined();
  });
});
