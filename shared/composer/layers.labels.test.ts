import { describe, expect, it } from "vitest";
import { buildComposerLayerTree } from "./layers";
import { parseAstro } from "./parseAstro";

async function modelFor(source: string) {
  const result = await parseAstro(source);
  expect(result.editable).toBe(true);
  if (!result.editable) throw new Error("expected editable source");
  return result.model;
}

describe("Composer Layers labels", () => {
  it("prefers a persisted custom layer label without changing its source label", async () => {
    const tree = buildComposerLayerTree(
      await modelFor('<section data-aria-layer-label="Campaign hero"><h1>Welcome</h1></section>'),
    );
    expect(tree.content[0]).toMatchObject({
      label: "Campaign hero",
      sourceLabel: "<section>",
      semanticType: "section",
    });
    expect(tree.content[0]?.searchText).toContain("campaign hero");
  });

  it("uses a persisted custom label for a component instance", async () => {
    const tree = buildComposerLayerTree(
      await modelFor(`---
import Hero from "./Hero.astro";
---
<Hero data-aria-layer-label="Primary hero" />`),
    );
    expect(tree.content[0]).toMatchObject({
      kind: "component",
      label: "Primary hero",
      sourceLabel: "<Hero>",
    });
  });
});
