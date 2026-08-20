import { describe, expect, it } from "vitest";
import {
  extractClassRuleCss,
  normalizeClassSelectorSuffix,
  parseCssRuleTree,
  patchClassDeclarations,
  preserveClassApplyDirectives,
  readClassDeclarations,
  writeClassDeclarations,
} from "./cssRuleAst";

describe("Composer CSS rule tree", () => {
  it("reads base, pseudo, and responsive class rules", () => {
    const css = `.card { color: red; }\n.card:hover { color: blue; }\n@media (min-width: 768px) { .card { display: grid; } }`;
    expect(parseCssRuleTree(css)).toHaveLength(3);
    expect(readClassDeclarations(css, "card")).toContain("color: red");
    expect(readClassDeclarations(css, "card", { pseudo: "hover" })).toContain("color: blue");
    expect(readClassDeclarations(css, "card", { minWidthPx: 768 })).toContain("display: grid");
  });

  it("updates one state without flattening surrounding CSS", () => {
    const before = `/* keep */\n.card { color: red; }\n@supports (display: grid) { .other { display: grid; } }\n`;
    const next = writeClassDeclarations(before, "card", "color: green; padding: 1rem");
    expect(next).toContain("/* keep */");
    expect(next).toContain("@supports (display: grid)");
    expect(readClassDeclarations(next, "card")).toContain("color: green");
    const responsive = writeClassDeclarations(next, "card", "display: grid", { minWidthPx: 768 });
    expect(responsive).toContain("@media (min-width: 768px)");
    expect(readClassDeclarations(responsive, "card", { minWidthPx: 768 })).toContain("display: grid");
  });

  it("removes an emptied class state while preserving neighboring rules", () => {
    const before = `.card { color: red; }\n.other { display: grid; }\n@media (min-width: 768px) { .card { gap: 1rem; } .other { gap: 2rem; } }`;
    const withoutBase = writeClassDeclarations(before, "card", "");
    expect(readClassDeclarations(withoutBase, "card")).toBe("");
    expect(withoutBase).not.toContain(".card { color: red; }");
    expect(withoutBase).toContain(".other { display: grid; }");

    const withoutResponsive = writeClassDeclarations(withoutBase, "card", "", { minWidthPx: 768 });
    expect(readClassDeclarations(withoutResponsive, "card", { minWidthPx: 768 })).toBe("");
    expect(withoutResponsive).toContain(".other { gap: 2rem; }");
  });

  it("removes empty responsive wrappers but preserves authored wrapper content", () => {
    const onlyRule = `@media (min-width: 768px) {\n  .card { gap: 1rem; }\n}`;
    expect(writeClassDeclarations(onlyRule, "card", "", { minWidthPx: 768 })).not.toContain("@media");

    const withComment = `@media (min-width: 768px) {\n  /* keep this breakpoint note */\n  .card { gap: 1rem; }\n}`;
    const next = writeClassDeclarations(withComment, "card", "", { minWidthPx: 768 });
    expect(next).toContain("@media (min-width: 768px)");
    expect(next).toContain("keep this breakpoint note");

    const unrelatedEmpty = `@supports (display: subgrid) {}\n${onlyRule}`;
    const scoped = writeClassDeclarations(unrelatedEmpty, "card", "", { minWidthPx: 768 });
    expect(scoped).toContain("@supports (display: subgrid) {}");
    expect(scoped).not.toContain("@media");
  });

  it("preserves framework apply directives during property-control edits", () => {
    const next = preserveClassApplyDirectives(
      "@apply text-lg leading-relaxed text-neutral-600;",
      "color: red;",
    );
    expect(next).toContain("@apply text-lg leading-relaxed text-neutral-600;");
    expect(next).toContain("color: red;");
  });

  it("patches class declarations without dropping unrelated properties", () => {
    expect(patchClassDeclarations(
      "corner-shape: squircle; border-top-left-radius: 203px",
      "border-color: #944ef5; border-width: 22px; border-style: dashed",
      ["border"],
    )).toBe(
      "corner-shape: squircle; border-top-left-radius: 203px; border-color: #944ef5; border-width: 22px; border-style: dashed",
    );
    expect(patchClassDeclarations(
      "border: 4px solid red; color: blue",
      "border-style: dashed",
      ["border"],
    )).toBe("color: blue; border-style: dashed");
  });

  it("extracts base, pseudo, and media rules for clipboard transfer", () => {
    const css = `.card { color: red; }\n.card:hover { color: blue; }\n.other { display: none; }\n@media (min-width: 768px) { .card { display: grid; } }`;
    const extracted = extractClassRuleCss(css, "card");
    expect(extracted).toContain(".card { color: red; }");
    expect(extracted).toContain(".card:hover { color: blue; }");
    expect(extracted).toContain("@media (min-width: 768px)");
    expect(extracted).not.toContain(".other");
  });

  it("supports pseudo-elements, relational selectors, and nested media rules", () => {
    const css = `/* keep */\n.card::before { content: ""; }\n@media (min-width: 768px) {\n  @supports (display: grid) {\n    .card:has(.icon) { display: grid; }\n    .other { color: hotpink; }\n  }\n}`;

    expect(readClassDeclarations(css, "card", { selectorSuffix: "::before" })).toContain('content: ""');
    expect(readClassDeclarations(css, "card", { selectorSuffix: ":has(.icon)", minWidthPx: 768 })).toContain("display: grid");

    const next = writeClassDeclarations(css, "card", "display: flex", {
      selectorSuffix: ":has(.icon)",
      minWidthPx: 768,
    });
    expect(next).toContain("@supports (display: grid)");
    expect(next).toContain(".other { color: hotpink; }");
    expect(readClassDeclarations(next, "card", { selectorSuffix: ":has(.icon)", minWidthPx: 768 })).toContain("display: flex");
  });

  it("rejects selector suffixes that can escape the selected class", () => {
    expect(normalizeClassSelectorSuffix("hover")).toBe(":hover");
    expect(normalizeClassSelectorSuffix("::after")).toBe("::after");
    expect(normalizeClassSelectorSuffix(":has(> img)")).toBe(":has(> img)");
    expect(normalizeClassSelectorSuffix(":is(:hover, :focus-visible)")).toBe(":is(:hover, :focus-visible)");
    expect(normalizeClassSelectorSuffix(":hover, .other")).toBeNull();
    expect(normalizeClassSelectorSuffix(":hover .child")).toBeNull();
    expect(normalizeClassSelectorSuffix("@media (min-width: 1px)")).toBeNull();
    expect(normalizeClassSelectorSuffix(":has(.icon")).toBeNull();
    expect(() => writeClassDeclarations("", "card", "color: red", { selectorSuffix: ":hover, .other" })).toThrow("Invalid class selector suffix");
  });

  it("does not treat descendant selectors as editable class state rules", () => {
    const css = `.card:hover { color: blue; }\n.card:hover .child { color: red; }`;
    const extracted = extractClassRuleCss(css, "card");
    expect(extracted).toContain(".card:hover");
    expect(extracted).not.toContain(".child");
  });
});
