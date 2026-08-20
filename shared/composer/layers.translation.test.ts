import { describe, expect, it } from "vitest";
import { buildComposerLayerTree } from "./layers";
import type { AstroDocumentModel } from "./types";

describe("translation layer semantics", () => {
  it("labels a Panam-style alias by namespace and key", () => {
    const model: AstroDocumentModel = {
      imports: [],
      extraFrontmatter: 'import { translations } from "../i18n/translations";\nconst t = translations[currentLanguage].hero2;',
      propSchema: [], slots: [], extendsTag: null,
      nodes: [{ id: "title", kind: "expr", value: "{t.title}" }],
    };
    const tree = buildComposerLayerTree(model);
    expect(tree.content[0]).toMatchObject({
      label: "hero2.title",
      translationBinding: { namespace: "hero2", keyPath: ["title"] },
    });
  });
});
