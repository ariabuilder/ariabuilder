import { describe, expect, it } from "vitest";
import {
  getStyleProp,
  normalizePositionValue,
  parseSpacingShorthand,
  parseStyleAttr,
  resolveInsetSides,
  resolveSpacingSides,
  serializeStyleAttr,
  setStyleProp,
  withPreviewImportant,
} from "./styleAttr";

describe("styleAttr", () => {
  it("parses style declarations", () => {
    expect(parseStyleAttr("color: red; padding: 1rem")).toEqual({
      color: "red",
      padding: "1rem",
    });
    expect(parseStyleAttr("Color: var(--primary);")).toEqual({
      color: "var(--primary)",
    });
  });

  it("serializes and updates properties", () => {
    const base = parseStyleAttr("color: red; margin: 0");
    const next = setStyleProp(base, "color", "var(--fg)");
    expect(serializeStyleAttr(next)).toBe("color: var(--fg); margin: 0");
    expect(getStyleProp(setStyleProp(base, "color", ""), "color")).toBe("");
    expect(serializeStyleAttr(setStyleProp(base, "color", null))).toBe(
      "margin: 0",
    );
  });

  it("marks preview declarations as important without doubling the flag", () => {
    expect(withPreviewImportant("border-style: dashed; border-width: 22px")).toBe(
      "border-style: dashed !important; border-width: 22px !important",
    );
    expect(withPreviewImportant("color: red !important")).toBe("color: red !important");
  });

  it("expands spacing shorthand into four sides", () => {
    expect(parseSpacingShorthand("1rem")).toEqual({
      top: "1rem",
      right: "1rem",
      bottom: "1rem",
      left: "1rem",
    });
    expect(parseSpacingShorthand("8px 4px")).toEqual({
      top: "8px",
      right: "4px",
      bottom: "8px",
      left: "4px",
    });
    expect(parseSpacingShorthand("1px 2px 3px 4px")).toEqual({
      top: "1px",
      right: "2px",
      bottom: "3px",
      left: "4px",
    });
  });

  it("resolves spacing sides from shorthand when sides are unset", () => {
    expect(resolveSpacingSides(parseStyleAttr("padding: 8px 4px"), "padding")).toEqual({
      top: "8px",
      right: "4px",
      bottom: "8px",
      left: "4px",
    });
    expect(
      resolveSpacingSides(
        parseStyleAttr("padding: 8px; padding-top: 12px"),
        "padding",
      ),
    ).toEqual({
      top: "12px",
      right: "8px",
      bottom: "8px",
      left: "8px",
    });
  });

  it("expands inset shorthand into four sides", () => {
    expect(resolveInsetSides(parseStyleAttr("inset: 8px 4px"))).toEqual({
      top: "8px",
      right: "4px",
      bottom: "8px",
      left: "4px",
    });
  });

  it("lets inset longhands win over the shorthand", () => {
    expect(
      resolveInsetSides(parseStyleAttr("inset: 8px; top: 12px; left: 2px")),
    ).toEqual({
      top: "12px",
      right: "8px",
      bottom: "8px",
      left: "2px",
    });
  });

  it("normalizes position inspector values", () => {
    expect(normalizePositionValue("top", "")).toBe("");
    expect(normalizePositionValue("top", "  ")).toBe("");
    expect(normalizePositionValue("top", "12")).toBe("12px");
    expect(normalizePositionValue("top", "12px")).toBe("12px");
    expect(normalizePositionValue("top", "50%")).toBe("50%");
    expect(normalizePositionValue("top", "auto")).toBe("auto");
    expect(normalizePositionValue("top", "var(--space)")).toBe("var(--space)");
    expect(normalizePositionValue("top", "calc(100% - 8px)")).toBe(
      "calc(100% - 8px)",
    );
    expect(normalizePositionValue("z-index", "20")).toBe("20");
    expect(normalizePositionValue("z-index", "20.4")).toBe("20");
    expect(normalizePositionValue("z-index", "auto")).toBe("auto");
  });
});
