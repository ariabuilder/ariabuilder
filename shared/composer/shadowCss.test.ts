import { describe, expect, it } from "vitest";
import {
  createDefaultShadowLayer,
  parseShadowValue,
  serializeShadowValue,
} from "./shadowCss";

describe("shadow CSS", () => {
  it("represents unset and none values as no layers", () => {
    expect(parseShadowValue("box", "")).toEqual({ mode: "layers", layers: [] });
    expect(parseShadowValue("text", "none")).toEqual({ mode: "layers", layers: [] });
    expect(serializeShadowValue("box", [])).toBe("none");
  });

  it("parses and canonicalizes a single box shadow", () => {
    const parsed = parseShadowValue("box", "2px -3.5rem 8px #0008");
    expect(parsed).toEqual({
      mode: "layers",
      layers: [{
        offsetX: "2px",
        offsetY: "-3.5rem",
        blur: "8px",
        spread: "0px",
        color: "#0008",
        inset: false,
      }],
    });
    expect(parsed.mode === "layers" && serializeShadowValue("box", parsed.layers))
      .toBe("2px -3.5rem 8px 0px #0008");
  });

  it("preserves multiple layers, inset, and colors containing spaces and commas", () => {
    const source = "inset 0 1px 2px -1px rgb(0, 0, 0, .2), oklch(60% .2 25 / 40%) 0 8px 20px 2px";
    const parsed = parseShadowValue("box", source);
    expect(parsed.mode).toBe("layers");
    if (parsed.mode !== "layers") return;
    expect(parsed.layers).toHaveLength(2);
    expect(parsed.layers[0]).toMatchObject({ inset: true, color: "rgb(0, 0, 0, .2)", spread: "-1px" });
    expect(parsed.layers[1]).toMatchObject({ inset: false, color: "oklch(60% .2 25 / 40%)", blur: "20px" });
    expect(serializeShadowValue("box", parsed.layers)).toContain(", ");
  });

  it("supports text shadows without box-only spread or inset", () => {
    const parsed = parseShadowValue("text", "1px 2px 3px red, -1px 0 blue");
    expect(parsed.mode).toBe("layers");
    if (parsed.mode !== "layers") return;
    expect(parsed.layers[0]?.spread).toBe("");
    expect(serializeShadowValue("text", parsed.layers)).toBe("1px 2px 3px red, -1px 0px 0px blue");
    expect(parseShadowValue("text", "inset 0 0 2px red").mode).toBe("raw");
  });

  it("supports functions and unambiguous per-part variables", () => {
    const parsed = parseShadowValue(
      "box",
      "calc(var(--x) + 1px) var(--y) clamp(0px, 2vw, 20px) var(--spread) rgb(0 0 0 / 25%)",
    );
    expect(parsed.mode).toBe("layers");
    if (parsed.mode !== "layers") return;
    expect(parsed.layers[0]).toMatchObject({
      offsetX: "calc(var(--x) + 1px)",
      offsetY: "var(--y)",
      spread: "var(--spread)",
    });
    expect(parseShadowValue("box", "0 10px 20px 0 var(--shadow-brand)")).toMatchObject({
      mode: "layers",
      layers: [{ color: "var(--shadow-brand)" }],
    });
  });

  it("keeps whole variables, CSS-wide values, and ambiguous syntax raw", () => {
    expect(parseShadowValue("box", "var(--card-shadow)")).toEqual({
      mode: "raw",
      value: "var(--card-shadow)",
      reason: "whole-variable",
    });
    expect(parseShadowValue("text", "inherit")).toMatchObject({ mode: "raw", reason: "css-wide" });
    expect(parseShadowValue("box", "0 0 var(--unknown)")).toMatchObject({ mode: "raw", reason: "ambiguous" });
    expect(parseShadowValue("box", "0 0 2px var(--spread-or-color)")).toMatchObject({
      mode: "raw",
      reason: "ambiguous",
    });
    expect(parseShadowValue("box", "0 0 -2px red")).toMatchObject({ mode: "raw", reason: "invalid" });
  });

  it("creates reference-compatible default layers", () => {
    expect(serializeShadowValue("box", [createDefaultShadowLayer("box")]))
      .toBe("0px 4px 8px 0px rgb(0 0 0 / 25%)");
    expect(serializeShadowValue("text", [createDefaultShadowLayer("text")]))
      .toBe("0px 4px 8px rgb(0 0 0 / 25%)");
  });
});
