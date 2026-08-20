// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { parseSanitizedSvg } from "./svgImport";
import { serializeAstro } from "./serializeAstro";
import { resetElementButtonAtPath } from "./elementInspector";
import {
  setNativeButtonIconAtPath,
  setNativeButtonIconSettingAtPath,
  setNativeButtonIconSideAtPath,
  setNativeButtonIconSpaceBetweenAtPath,
} from "./buttonIcon";
import type { AstroDocumentModel } from "./types";

function buttonModel(): AstroDocumentModel {
  return {
    imports: [],
    extraFrontmatter: "",
    propSchema: [],
    slots: [],
    extendsTag: null,
    nodes: [{
      id: "button",
      kind: "element",
      name: "button",
      props: { style: { type: "string", value: "padding: 0.75rem; color: navy" } },
      children: [{ id: "label", kind: "text", value: "Continue" }],
    }],
  };
}

function iconSvg() {
  const parsed = parseSanitizedSvg(
    '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M4 12h16" stroke="currentColor" /></svg>',
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.node;
}

describe("native button icon authoring", () => {
  it("embeds a portable inline SVG that renders without an icon runtime", () => {
    const model = buttonModel();
    expect(setNativeButtonIconAtPath(model, "0", iconSvg(), "i-lucide:arrow-right").ok).toBe(true);

    const source = serializeAstro(model);
    expect(source).toContain("<svg");
    expect(source).toContain('data-aria-button-icon="true"');
    expect(source).toContain('data-aria-button-icon-value="i-lucide:arrow-right"');
    expect(source).toContain("inline-size: var(--aria-button-icon-size, 1em)");
    expect(source).toContain("color: var(--aria-button-icon-color, currentColor)");
    expect(source).toContain("display: inline-flex");
    expect(source).toContain("gap: var(--aria-button-icon-gap, 0.5rem)");
    expect(source).not.toMatch(/<svg[^>]+\swidth=/);
    expect(source).not.toMatch(/<svg[^>]+\sheight=/);
  });

  it("applies variable-friendly sizing, color, gap, side, and spacing", () => {
    const model = buttonModel();
    setNativeButtonIconAtPath(model, "0", iconSvg(), "i-lucide:arrow-right");
    expect(setNativeButtonIconSettingAtPath(model, "0", "size", "var(--icon-size)").ok).toBe(true);
    expect(setNativeButtonIconSettingAtPath(model, "0", "color", "oklch(0.7 0.2 250)").ok).toBe(true);
    expect(setNativeButtonIconSettingAtPath(model, "0", "gap", "0.75rem").ok).toBe(true);
    expect(setNativeButtonIconSideAtPath(model, "0", "right").ok).toBe(true);
    expect(setNativeButtonIconSpaceBetweenAtPath(model, "0", true).ok).toBe(true);

    const source = serializeAstro(model);
    expect(source).toContain("--aria-button-icon-size: var(--icon-size)");
    expect(source).toContain("--aria-button-icon-color: oklch(0.7 0.2 250)");
    expect(source).toContain("--aria-button-icon-gap: 0.75rem");
    expect(source).toContain("order: 1");
    expect(source).toContain("justify-content: space-between");
  });

  it("removes only managed icon styling when Button is reset", () => {
    const model = buttonModel();
    setNativeButtonIconAtPath(model, "0", iconSvg(), "i-lucide:arrow-right");
    setNativeButtonIconSettingAtPath(model, "0", "size", "1.5rem");
    expect(resetElementButtonAtPath(model, "0").ok).toBe(true);

    const source = serializeAstro(model);
    expect(source).not.toContain("data-aria-button-icon");
    expect(source).not.toContain("--aria-button-icon-");
    expect(source).not.toContain("display: inline-flex");
    expect(source).toContain("padding: 0.75rem");
    expect(source).toContain("color: navy");
    expect(source).toContain("Continue");
  });
});
