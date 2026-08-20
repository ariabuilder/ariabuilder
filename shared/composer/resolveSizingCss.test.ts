import { describe, expect, it } from "vitest";
import {
  applyExactDimensions,
  applySizeMode,
  applySizingResolution,
  formatExactInputValue,
  inferSizeModeFromCSSValue,
  layoutParentContextForPath,
  mergeParentLayoutContext,
  normalizeSizeValue,
  resizeAxesForHandle,
  resolveParentLayoutContext,
  resolveSizeMode,
  resolveSizingCss,
  WIDTH_SIZING_PROP,
  HEIGHT_SIZING_PROP,
} from "./resolveSizingCss";
import type { EditableNode, ElementNode } from "./types";

function element(
  id: string,
  name: string,
  props: ElementNode["props"],
  children: EditableNode[] = [],
): EditableNode {
  return { id, kind: "element", name, props, children };
}

describe("resolveSizingCss", () => {
  it("infers legacy CSS values into sizing modes", () => {
    expect(inferSizeModeFromCSSValue("auto")).toBe("hug");
    expect(inferSizeModeFromCSSValue("fit-content")).toBe("hug");
    expect(inferSizeModeFromCSSValue("100%")).toBe("fill");
    expect(inferSizeModeFromCSSValue("320px")).toBe("exact");
    expect(inferSizeModeFromCSSValue(undefined)).toBe("hug");
  });

  it("prefers stored sizing modes over legacy width values", () => {
    expect(
      resolveSizeMode(
        { [WIDTH_SIZING_PROP]: "fill", width: "320px" },
        "width",
      ),
    ).toBe("fill");
  });

  it("resolves block hug to fit-content", () => {
    expect(
      resolveSizingCss({ [WIDTH_SIZING_PROP]: "hug" }, null).width,
    ).toBe("fit-content");
  });

  it("resolves block fill to 100%", () => {
    expect(
      resolveSizingCss({ [WIDTH_SIZING_PROP]: "fill" }, null).width,
    ).toBe("100%");
  });

  it("resolves flex row primary fill with flex-grow", () => {
    const parent = resolveParentLayoutContext({
      display: "flex",
      "flex-direction": "row",
    });
    const css = resolveSizingCss({ [WIDTH_SIZING_PROP]: "fill" }, parent);
    expect(css["flex-grow"]).toBe("1");
    expect(css["flex-basis"]).toBe("0");
    expect(css.width).toBeUndefined();
  });

  it("resolves flex column primary fill on height", () => {
    const parent = resolveParentLayoutContext({
      display: "flex",
      "flex-direction": "column",
    });
    const css = resolveSizingCss({ [HEIGHT_SIZING_PROP]: "fill" }, parent);
    expect(css["flex-grow"]).toBe("1");
    expect(css["flex-basis"]).toBe("0");
  });

  it("resolves flex row cross-axis hug with fit-content height", () => {
    const parent = resolveParentLayoutContext({
      display: "flex",
      "flex-direction": "row",
    });
    const css = resolveSizingCss({ [HEIGHT_SIZING_PROP]: "hug" }, parent);
    expect(css["align-self"]).toBe("flex-start");
    expect(css.height).toBe("fit-content");
  });

  it("resolves grid fill with the matching self alignment", () => {
    const parent = resolveParentLayoutContext({ display: "grid" });
    const width = resolveSizingCss({ [WIDTH_SIZING_PROP]: "fill" }, parent);
    expect(width.width).toBe("100%");
    expect(width["justify-self"]).toBe("stretch");
    const height = resolveSizingCss({ [HEIGHT_SIZING_PROP]: "fill" }, parent);
    expect(height.height).toBe("100%");
    expect(height["align-self"]).toBe("stretch");
  });

  it("treats grid-lanes as a grid parent", () => {
    const parent = resolveParentLayoutContext({ display: "grid-lanes" });
    const css = resolveSizingCss({ [WIDTH_SIZING_PROP]: "fill" }, parent);
    expect(css.width).toBe("100%");
    expect(css["justify-self"]).toBe("stretch");
  });

  it("reads parent display and direction from utility classes", () => {
    const parent = resolveParentLayoutContext({}, "md:flex flex-col items-center");
    expect(parent.display).toBe("flex");
    expect(parent.flexDirection).toBe("column");
  });

  it("prefers computed parent layout over authored utilities", () => {
    const merged = mergeParentLayoutContext(
      resolveParentLayoutContext({}, "block"),
      { display: "flex", flexDirection: "column" },
    );
    expect(merged?.display).toBe("flex");
    expect(merged?.flexDirection).toBe("column");
  });

  it("keeps exact width values and persists sizing metadata", () => {
    const merged = applySizingResolution(
      {
        [WIDTH_SIZING_PROP]: "exact",
        width: "320px",
        [HEIGHT_SIZING_PROP]: "hug",
        color: "red",
      },
      null,
    );
    expect(merged[WIDTH_SIZING_PROP]).toBe("exact");
    expect(merged[HEIGHT_SIZING_PROP]).toBe("hug");
    expect(merged.width).toBe("320px");
    expect(merged.height).toBe("fit-content");
    expect(merged.color).toBe("red");
  });

  it("does not hug height when only width is authored", () => {
    const merged = applySizeMode({}, "width", "fill", null);
    expect(merged[WIDTH_SIZING_PROP]).toBe("fill");
    expect(merged.width).toBe("100%");
    expect(merged[HEIGHT_SIZING_PROP]).toBeUndefined();
    expect(merged.height).toBeUndefined();
  });

  it("preserves a hand-authored align-self when filling the flex primary axis", () => {
    const parent = resolveParentLayoutContext({
      display: "flex",
      "flex-direction": "row",
    });
    const merged = applySizeMode(
      { "align-self": "center" },
      "width",
      "fill",
      parent,
    );
    expect(merged["flex-grow"]).toBe("1");
    expect(merged["align-self"]).toBe("center");
  });

  it("maps legacy fill width to resolved fill CSS in a flex parent", () => {
    const parent = resolveParentLayoutContext({
      display: "flex",
      "flex-direction": "row",
    });
    const merged = applySizingResolution({ width: "100%" }, parent);
    expect(merged.width).toBeUndefined();
    expect(merged["flex-grow"]).toBe("1");
    expect(merged.height).toBeUndefined();
  });

  it("does not inject sizing CSS when no sizing is authored", () => {
    const merged = applySizingResolution(
      { "background-color": "#ffffff" },
      null,
    );
    expect(merged.width).toBeUndefined();
    expect(merged.height).toBeUndefined();
    expect(merged["flex-grow"]).toBeUndefined();
  });

  it("treats leftover auto width as unset", () => {
    const merged = applySizingResolution({ width: "auto", color: "red" }, null);
    expect(merged.width).toBe("auto");
    expect(merged.height).toBeUndefined();
  });

  it("clears previous flex fill when switching an axis to hug", () => {
    const parent = resolveParentLayoutContext({
      display: "flex",
      "flex-direction": "row",
    });
    const filled = applySizeMode({}, "width", "fill", parent);
    expect(filled["flex-grow"]).toBe("1");
    const hugged = applySizeMode(filled, "width", "hug", parent);
    expect(hugged[WIDTH_SIZING_PROP]).toBe("hug");
    expect(hugged["flex-grow"]).toBe("0");
    expect(hugged["flex-basis"]).toBe("auto");
    expect(hugged.width).toBeUndefined();
  });

  it("writes exact dimensions only for resized axes", () => {
    const parent = resolveParentLayoutContext({
      display: "flex",
      "flex-direction": "row",
    });
    const filled = applySizeMode({}, "width", "fill", parent);
    const widthOnly = applyExactDimensions(filled, { width: 240 }, parent);
    expect(widthOnly[WIDTH_SIZING_PROP]).toBe("exact");
    expect(widthOnly.width).toBe("240px");
    expect(widthOnly[HEIGHT_SIZING_PROP]).toBeUndefined();
    expect(widthOnly.height).toBeUndefined();
    expect(widthOnly["flex-grow"]).toBeUndefined();

    const both = applyExactDimensions(filled, { width: 240, height: 80 }, parent);
    expect(both[HEIGHT_SIZING_PROP]).toBe("exact");
    expect(both.height).toBe("80px");
  });

  it("maps resize handles to axes", () => {
    expect(resizeAxesForHandle("e")).toEqual({ width: true, height: false });
    expect(resizeAxesForHandle("n")).toEqual({ width: false, height: true });
    expect(resizeAxesForHandle("se")).toEqual({ width: true, height: true });
  });

  it("formats exact inputs and normalizes bare numbers without rounding fractions", () => {
    expect(formatExactInputValue("320px")).toBe("320");
    expect(formatExactInputValue("auto")).toBe("");
    expect(formatExactInputValue("fit-content")).toBe("");
    expect(formatExactInputValue("50%")).toBe("50%");
    expect(normalizeSizeValue("320")).toBe("320px");
    expect(normalizeSizeValue("1.5")).toBe("1.5px");
    expect(normalizeSizeValue("var(--space-lg)")).toBe("var(--space-lg)");
    expect(normalizeSizeValue("")).toBe("");
  });

  it("walks fragment parents and reads class:list tokens", () => {
    const tree: EditableNode[] = [
      element("parent", "div", {
        "class:list": { type: "string", value: "flex flex-col" },
      }, [
        { id: "frag", kind: "fragment", name: "", props: {}, children: [
          element("child", "span", {}),
        ] },
      ]),
    ];
    const context = layoutParentContextForPath(tree, "0.0.0");
    expect(context?.display).toBe("flex");
    expect(context?.flexDirection).toBe("column");
  });
});
