import { describe, expect, it } from "vitest";
import {
  ariaBemBlockClass,
  ariaBemModifierClass,
  ariaBemPresetOnNode,
  ariaBemVisualPresets,
  forkAriaBemModifier,
  isAriaBemBlockClass,
  isAriaBemSlug,
  isAriaBemSystemClass,
  isAriaBemUserModifierClass,
  parseAriaBemToken,
  renameAriaBemModifierOnNode,
  setAriaBemPresetModifier,
  sourceUsesAriaBemPrimitives,
} from "./ariaBem";

describe("ariaBem", () => {
  it("parses block, element, preset and user modifiers", () => {
    expect(parseAriaBemToken("aria-card")).toMatchObject({ kind: "block", block: "card" });
    expect(parseAriaBemToken("aria-card__body")).toMatchObject({
      kind: "element",
      element: "body",
    });
    expect(parseAriaBemToken("aria-alert__icon")).toMatchObject({
      kind: "element",
      block: "alert",
      element: "icon",
    });
    expect(parseAriaBemToken("aria-alert--info")).toMatchObject({
      kind: "modifier",
      preset: true,
    });
    expect(parseAriaBemToken("aria-card--products")).toMatchObject({
      kind: "modifier",
      preset: false,
      modifier: "products",
    });
    expect(parseAriaBemToken("aria-motion")).toBeNull();
    expect(parseAriaBemToken("aria-card__unknown")).toBeNull();
  });

  it("treats block, element, and preset modifiers as system classes", () => {
    expect(isAriaBemSystemClass("aria-card")).toBe(true);
    expect(isAriaBemSystemClass("aria-card__header")).toBe(true);
    expect(isAriaBemSystemClass("aria-alert--warning")).toBe(true);
    expect(isAriaBemSystemClass("aria-card--products")).toBe(false);
    expect(isAriaBemUserModifierClass("aria-card--products")).toBe(true);
    expect(isAriaBemBlockClass("aria-field")).toBe(true);
  });

  it("forks a named modifier without renaming the block class", () => {
    const forked = forkAriaBemModifier(["aria-card", "extra"], "aria-card", "Products");
    expect(forked).toEqual({
      ok: true,
      names: ["aria-card", "extra", "aria-card--products"],
      modifier: "aria-card--products",
    });
    expect(forkAriaBemModifier(["aria-card"], "aria-card", "info").ok).toBe(true);
    expect(forkAriaBemModifier(["aria-alert"], "aria-alert", "info")).toMatchObject({
      ok: false,
    });
    expect(forkAriaBemModifier(["aria-card"], "aria-card", "Bad Slug!").ok).toBe(false);
  });

  it("renames a user modifier on the selected node only", () => {
    const renamed = renameAriaBemModifierOnNode(
      ["aria-card", "aria-card--products"],
      "aria-card--products",
      "testimonials",
    );
    expect(renamed).toEqual({
      ok: true,
      names: ["aria-card", "aria-card--testimonials"],
      from: "aria-card--products",
      to: "aria-card--testimonials",
    });
    expect(
      renameAriaBemModifierOnNode(["aria-alert", "aria-alert--info"], "aria-alert--info", "note").ok,
    ).toBe(false);
  });

  it("detects BEM primitive usage in Astro source", () => {
    expect(sourceUsesAriaBemPrimitives('<article class="aria-card">')).toBe(true);
    expect(sourceUsesAriaBemPrimitives('<span class="aria-badge--muted">')).toBe(true);
    expect(sourceUsesAriaBemPrimitives('<div class="aria-motion">')).toBe(false);
    expect(isAriaBemSlug("testimonial")).toBe(true);
    expect(ariaBemBlockClass("card")).toBe("aria-card");
    expect(ariaBemModifierClass("card", "products")).toBe("aria-card--products");
  });

  it("swaps a visual preset without dropping a user modifier", () => {
    expect(ariaBemVisualPresets("alert")).toEqual(["info", "success", "warning", "danger"]);
    expect(ariaBemVisualPresets("badge")).toEqual(["muted", "primary"]);
    expect(ariaBemVisualPresets("card")).toBeNull();
    expect(ariaBemPresetOnNode(["aria-alert", "aria-alert--info"], "alert")).toBe("info");

    expect(setAriaBemPresetModifier(
      ["aria-alert", "aria-alert--info", "aria-alert--products"],
      "alert",
      "warning",
    )).toEqual({
      ok: true,
      names: ["aria-alert", "aria-alert--warning", "aria-alert--products"],
    });
    expect(setAriaBemPresetModifier(["aria-badge", "aria-badge--muted"], "badge", null)).toEqual({
      ok: true,
      names: ["aria-badge"],
    });
    expect(setAriaBemPresetModifier(["aria-badge"], "badge", "primary")).toEqual({
      ok: true,
      names: ["aria-badge", "aria-badge--primary"],
    });
    expect(setAriaBemPresetModifier(["aria-card"], "card", "products").ok).toBe(false);
    expect(setAriaBemPresetModifier(["aria-alert--info"], "alert", "danger").ok).toBe(false);
  });
});
