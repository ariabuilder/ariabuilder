import { describe, expect, it } from "vitest";
import {
  CORNER_SHAPE_OPTIONS,
  buildCornerShapeShorthand,
  canonicalRadiusUpdates,
  canonicalShapeUpdates,
  cornerShapeCurvature,
  cornerShapeFromCurvature,
  formatRadiusInput,
  normalizeRadiusValue,
  parseBorderRadiusShorthand,
  parseCornerShapeShorthand,
  resolveCornerStyleState,
} from "./cornerCss";

describe("corner CSS", () => {
  it("expands ordinary and elliptical border-radius shorthand", () => {
    expect(parseBorderRadiusShorthand("8px")).toEqual({
      topLeft: "8px", topRight: "8px", bottomRight: "8px", bottomLeft: "8px",
    });
    expect(parseBorderRadiusShorthand("1px 2px 3px 4px")).toEqual({
      topLeft: "1px", topRight: "2px", bottomRight: "3px", bottomLeft: "4px",
    });
    expect(parseBorderRadiusShorthand("10px 20px / 30px 40px")).toEqual({
      topLeft: "10px 30px",
      topRight: "20px 40px",
      bottomRight: "10px 30px",
      bottomLeft: "20px 40px",
    });
    expect(parseBorderRadiusShorthand("calc(10px + 2%) 20px / clamp(4px, 5%, 8px) 30%"))
      .toEqual({
        topLeft: "calc(10px + 2%) clamp(4px, 5%, 8px)",
        topRight: "20px 30%",
        bottomRight: "calc(10px + 2%) clamp(4px, 5%, 8px)",
        bottomLeft: "20px 30%",
      });
    expect(parseBorderRadiusShorthand("var(--radius)")).toBeNull();
    expect(parseBorderRadiusShorthand("1px 2px 3px 4px 5px")).toBeNull();
    expect(parseBorderRadiusShorthand("future-radius(1)")).toBeNull();
    expect(parseBorderRadiusShorthand("10px /")).toBeNull();
    expect(parseBorderRadiusShorthand("/ 10px")).toBeNull();
    expect(parseBorderRadiusShorthand("10px // 20px")).toBeNull();
  });

  it("normalizes direct radius input without damaging CSS functions", () => {
    expect(normalizeRadiusValue("12")).toBe("12px");
    expect(normalizeRadiusValue(".5")).toBe("0.5px");
    expect(normalizeRadiusValue("var(--radius)")).toBe("var(--radius)");
    expect(normalizeRadiusValue("calc(1rem + 2px)")).toBe("calc(1rem + 2px)");
    expect(formatRadiusInput("12px")).toBe("12");
    expect(formatRadiusInput("1rem")).toBe("1rem");
  });

  it("parses and compacts per-corner shape shorthand", () => {
    expect(parseCornerShapeShorthand("round squircle bevel scoop")).toEqual({
      topLeft: "round",
      topRight: "squircle",
      bottomRight: "bevel",
      bottomLeft: "scoop",
    });
    expect(buildCornerShapeShorthand({
      topLeft: "round",
      topRight: "scoop",
      bottomRight: "round",
      bottomLeft: "scoop",
    })).toBe("round scoop");
    expect(parseCornerShapeShorthand("custom-shape").topLeft).toBe("custom-shape");
  });

  it("preserves case-sensitive custom properties while editing another shape", () => {
    const parsed = parseCornerShapeShorthand("round var(--CardShape) var(--CardShape)");
    expect(parsed.topRight).toBe("var(--CardShape)");
    expect(canonicalShapeUpdates({ ...parsed, topLeft: "scoop" })["corner-shape"])
      .toBe("scoop var(--CardShape) var(--CardShape)");
  });

  it("maps the complete shape catalog and curvature slider", () => {
    expect(CORNER_SHAPE_OPTIONS).toHaveLength(10);
    expect(cornerShapeCurvature("scoop")).toBe(-1);
    expect(cornerShapeCurvature("square")).toBeNull();
    expect(cornerShapeFromCurvature(-0.1)).toBe("superellipse(-0.1)");
    expect(cornerShapeFromCurvature(2)).toBe("squircle");
    expect(cornerShapeCurvature("superellipse(8)")).toBe(5);
  });

  it("resolves shorthand, legacy logical values, and physical overrides", () => {
    const state = resolveCornerStyleState(
      { "border-radius": "4px", "corner-shape": "squircle" },
      {
        "border-start-start-radius": "8px",
        "border-top-right-radius": "12px",
        "corner-top-left-shape": "scoop",
      },
    );
    expect(state.radius).toEqual({
      topLeft: "8px", topRight: "12px", bottomRight: "4px", bottomLeft: "4px",
    });
    expect(state.shape).toEqual({
      topLeft: "scoop", topRight: "squircle", bottomRight: "squircle", bottomLeft: "squircle",
    });
    expect(state.radiusLinked).toBe(false);
    expect(state.shapeLinked).toBe(false);
    expect(state.logicalRadiusNeedsResolution).toBe(true);
  });

  it("adopts computed physical geometry before clearing logical radii", () => {
    const rendered = {
      topLeft: "1px",
      topRight: "20px",
      bottomRight: "3px",
      bottomLeft: "4px",
    };
    const state = resolveCornerStyleState(
      {},
      { "border-start-start-radius": "20px", direction: "rtl" },
      rendered,
    );
    expect(state.radius).toEqual(rendered);
    expect(state.logicalRadiusNeedsResolution).toBe(true);
  });

  it("canonicalizes a user edit without a background migration", () => {
    expect(canonicalRadiusUpdates({
      topLeft: "1px", topRight: "2px", bottomRight: "3px", bottomLeft: "4px",
    })).toMatchObject({
      "border-radius": "",
      "border-start-start-radius": "",
      "border-start-end-radius": "",
      "border-end-end-radius": "",
      "border-end-start-radius": "",
      "border-top-left-radius": "1px",
      "border-top-right-radius": "2px",
      "border-bottom-right-radius": "3px",
      "border-bottom-left-radius": "4px",
    });
  });

  it("reports an unsafe current shorthand without discarding inherited geometry", () => {
    const state = resolveCornerStyleState(
      { "border-radius": "6px" },
      { "border-radius": "one two three four five" },
    );
    expect(state.radius).toEqual({
      topLeft: "6px", topRight: "6px", bottomRight: "6px", bottomLeft: "6px",
    });
    expect(state.unsafeRadiusShorthand).toBe("one two three four five");
  });

  it("carries an unresolved inherited shorthand until the current layer fully overrides it", () => {
    const unsafe = resolveCornerStyleState(
      { "border-radius": "future-radius(1)" },
      { "border-top-left-radius": "2px" },
    );
    expect(unsafe.unsafeRadiusShorthand).toBe("future-radius(1)");

    const resolved = resolveCornerStyleState(
      { "border-radius": "future-radius(1)" },
      {
        "border-top-left-radius": "1px",
        "border-top-right-radius": "2px",
        "border-bottom-right-radius": "3px",
        "border-bottom-left-radius": "4px",
      },
    );
    expect(resolved.unsafeRadiusShorthand).toBeNull();
    expect(resolved.radius).toEqual({
      topLeft: "1px", topRight: "2px", bottomRight: "3px", bottomLeft: "4px",
    });
  });
});
