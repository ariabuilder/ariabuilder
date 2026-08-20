import { describe, expect, it, vi } from "vitest";
import {
  COMPOSER_FILTER_EFFECTS,
  defaultComposerFilterState,
  enableComposerFilterEffect,
  isComposerFilterEffectEnabled,
  parseComposerFilterCss,
  resetComposerFilterEffect,
  serializeComposerFilterCss,
  validateComposerFilterCss,
} from "./filterCss";

describe("Composer filter CSS", () => {
  it("uses identity defaults and serializes an untouched state as none", () => {
    const parsed = parseComposerFilterCss("none");
    expect(parsed.opaque).toBe(false);
    expect(parsed.state).toEqual(defaultComposerFilterState());
    expect(serializeComposerFilterCss(parsed, parsed.state)).toBe("none");
    expect(COMPOSER_FILTER_EFFECTS.every((effect) =>
      !isComposerFilterEffectEnabled(parsed.state, effect),
    )).toBe(true);

    const explicitIdentity = parseComposerFilterCss("blur(0px) brightness(100%) contrast(1)");
    expect(serializeComposerFilterCss(explicitIdentity, explicitIdentity.state)).toBe("none");
  });

  it("parses every modeled function including nested drop-shadow colors", () => {
    const css = [
      "blur(4.5px)",
      "brightness(80%)",
      "contrast(120%)",
      "grayscale(20%)",
      "hue-rotate(45deg)",
      "invert(10%)",
      "saturate(150%)",
      "sepia(30%)",
      "drop-shadow(-2px 4px 8px color-mix(in srgb, black 25%, transparent))",
    ].join(" ");
    const parsed = parseComposerFilterCss(css);

    expect(parsed.opaque).toBe(false);
    expect(parsed.state).toMatchObject({
      blur: "4.5",
      brightness: "80",
      contrast: "120",
      grayscale: "20",
      hueRotate: "45",
      invert: "10",
      saturate: "150",
      sepia: "30",
      dropShadowX: "-2",
      dropShadowY: "4",
      dropShadowBlur: "8",
      dropShadowColor: "color-mix(in srgb, black 25%, transparent)",
    });
    expect(serializeComposerFilterCss(parsed, parsed.state)).toBe(css);

    const colorWithoutBlur = parseComposerFilterCss("drop-shadow(2px 4px rebeccapurple)");
    expect(colorWithoutBlur.state).toMatchObject({
      dropShadowX: "2",
      dropShadowY: "4",
      dropShadowBlur: "0",
      dropShadowColor: "rebeccapurple",
    });

    const colorFirst = parseComposerFilterCss("drop-shadow(rgb(0 0 0 / 25%) 2px 4px 8px)");
    expect(colorFirst).toMatchObject({ opaque: false, structurallyValid: true });
    expect(colorFirst.state).toMatchObject({
      dropShadowX: "2",
      dropShadowY: "4",
      dropShadowBlur: "8",
      dropShadowColor: "rgb(0 0 0 / 25%)",
    });

    expect(parseComposerFilterCss("drop-shadow(var(--shadow-part) 2px 4px)"))
      .toMatchObject({ opaque: true, structurallyValid: true });
  });

  it("preserves variables, decimals, and the original syntax for untouched effects", () => {
    const css = "blur(var(--blur-strength)) brightness(.8) contrast(calc(100% + 5%))";
    const parsed = parseComposerFilterCss(css);
    const next = { ...parsed.state, sepia: "12.5" };

    expect(parsed.state.blur).toBe("var(--blur-strength)");
    expect(parsed.state.brightness).toBe("80");
    expect(serializeComposerFilterCss(parsed, next)).toBe(
      `${css} sepia(12.5%)`,
    );
  });

  it("retains combinable unmodeled functions in their original position", () => {
    const parsed = parseComposerFilterCss("url(#noise) opacity(75%) blur(2px)");
    const next = { ...parsed.state, blur: "8", contrast: "110" };

    expect(parsed.opaque).toBe(false);
    expect(serializeComposerFilterCss(parsed, next)).toBe(
      "url(#noise) opacity(75%) blur(8px) contrast(110%)",
    );
  });

  it("locks duplicate modeled functions and whole-property expressions", () => {
    const duplicate = parseComposerFilterCss("blur(2px) blur(4px)");
    const variable = parseComposerFilterCss("var(--site-filter)");
    const keyword = parseComposerFilterCss("inherit");

    expect(duplicate).toMatchObject({ opaque: true, structurallyValid: true });
    expect(variable).toMatchObject({ opaque: true, structurallyValid: true });
    expect(keyword).toMatchObject({ opaque: true, structurallyValid: true });
    expect(serializeComposerFilterCss(duplicate, { ...duplicate.state, blur: "20" }))
      .toBe("blur(2px) blur(4px)");
  });

  it("rejects malformed top-level syntax", () => {
    expect(parseComposerFilterCss("blur(2px")).toMatchObject({
      opaque: true,
      structurallyValid: false,
    });
    expect(parseComposerFilterCss("none blur(2px)").structurallyValid).toBe(false);
    expect(parseComposerFilterCss("var(--site-filter").structurallyValid).toBe(false);
    expect(parseComposerFilterCss("unsupported(2)").structurallyValid).toBe(false);
    expect(parseComposerFilterCss("opacity(bogus)").structurallyValid).toBe(false);
    expect(parseComposerFilterCss("blur(bogus)")).toMatchObject({
      opaque: true,
      structurallyValid: false,
    });
    expect(parseComposerFilterCss("drop-shadow(red blue)")).toMatchObject({
      opaque: true,
      structurallyValid: false,
    });
    expect(validateComposerFilterCss("filter", "blur(bogus)")).toBe(false);
  });

  it("enables presets and resets only the requested effect", () => {
    const initial = defaultComposerFilterState();
    const enabled = enableComposerFilterEffect(initial, "dropShadow");
    const withBlur = enableComposerFilterEffect(enabled, "blur");
    const reset = resetComposerFilterEffect(withBlur, "dropShadow");

    expect(isComposerFilterEffectEnabled(enabled, "dropShadow")).toBe(true);
    expect(isComposerFilterEffectEnabled(withBlur, "blur")).toBe(true);
    expect(isComposerFilterEffectEnabled(reset, "dropShadow")).toBe(false);
    expect(isComposerFilterEffectEnabled(reset, "blur")).toBe(true);
  });

  it("uses CSS.supports when the runtime exposes it", () => {
    const original = globalThis.CSS;
    const supports = vi.fn((_property: string, value: string) => value !== "broken()")
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { supports },
    });
    try {
      expect(validateComposerFilterCss("filter", "blur(2px)")).toBe(true);
      expect(validateComposerFilterCss("filter", "broken()")).toBe(false);
      expect(supports).toHaveBeenCalledWith("filter", "blur(2px)");
    } finally {
      Object.defineProperty(globalThis, "CSS", {
        configurable: true,
        value: original,
      });
    }
  });
});
