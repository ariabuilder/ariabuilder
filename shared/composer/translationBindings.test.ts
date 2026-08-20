import { describe, expect, it } from "vitest";
import type { AstroDocumentModel } from "./types";
import {
  bindTranslationPropAtPath,
  bindTranslationTextAtPath,
  detectTranslationContexts,
  ensureTranslationContext,
  unbindTranslationPropAtPath,
  unbindTranslationTextAtPath,
} from "./translationBindings";

function model(): AstroDocumentModel {
  return {
    imports: [], extraFrontmatter: "", propSchema: [], slots: [], extendsTag: null,
    nodes: [{ id: "heading", kind: "element", name: "h1", props: { title: { type: "string", value: "Original title" } }, children: [{ id: "copy", kind: "text", value: "Original copy" }] }],
  };
}

describe("project translation bindings", () => {
  it("reuses a Panam-style alias", () => {
    const doc = model();
    doc.extraFrontmatter = 'import { translations } from "../i18n/translations";\nconst t = translations[currentLanguage].hero2;';
    const context = ensureTranslationContext(doc, {
      catalogId: "catalog", catalogExportName: "translations", importPath: "../i18n/translations",
      namespace: "hero2", locales: ["en", "fr"], defaultLocale: "en", resolver: { kind: "query-param", parameter: "lang" },
    });
    expect(context.contextVariable).toBe("t");
    expect(detectTranslationContexts(doc.extraFrontmatter)).toHaveLength(1);
    expect(doc.extraFrontmatter).not.toContain("@aria-translation-context:");
  });

  it("creates one idempotent managed context and restores literal fallbacks", () => {
    const doc = model();
    const options = {
      catalogId: "catalog", catalogExportName: "translations", importPath: "../i18n/translations",
      namespace: "hero2", locales: ["en", "fr"], defaultLocale: "en", resolver: { kind: "query-param", parameter: "lang" } as const,
    };
    const first = ensureTranslationContext(doc, options);
    const second = ensureTranslationContext(doc, options);
    expect(second.contextVariable).toBe(first.contextVariable);
    expect(doc.extraFrontmatter.match(/@aria-translation-context:catalog:hero2/g)).toHaveLength(1);
    expect(doc.extraFrontmatter).toContain('searchParams.get("lang")');

    expect(bindTranslationTextAtPath(doc, "0.0", { catalogId: "catalog", namespace: "hero2", keyPath: ["title"], contextVariable: first.contextVariable }).ok).toBe(true);
    expect(bindTranslationPropAtPath(doc, "0", "title", { catalogId: "catalog", namespace: "hero2", keyPath: ["subtitle"], contextVariable: first.contextVariable }).ok).toBe(true);
    expect(JSON.stringify(doc.nodes)).toContain("@aria-translation-fallback");
    expect(unbindTranslationTextAtPath(doc, "0.0").ok).toBe(true);
    expect(unbindTranslationPropAtPath(doc, "0", "title").ok).toBe(true);
    expect(doc.nodes[0]).toMatchObject({ children: [{ kind: "text", value: "Original copy" }], props: { title: { value: "Original title" } } });
    expect(doc.extraFrontmatter).not.toContain("@aria-translation-context:");
    expect(doc.extraFrontmatter).not.toContain("@aria-translation-import:");
  });
});
