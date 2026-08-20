import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { serializeAstroMarked } from "./serializeAstro";
import {
  bareMarkerPath,
  buildStructureTree,
  markerPathAtSourceOffset,
  markerPathForNodeId,
  nodeAtMarkerPath,
  overlayInfoForPath,
} from "./paths";

describe("marker paths", () => {
  it("strips component-drill namespace", () => {
    expect(bareMarkerPath("src/components/Card.astro|0.1")).toBe("0.1");
    expect(bareMarkerPath("0.1.2")).toBe("0.1.2");
  });

  it("builds scoped marker paths for drill-in", async () => {
    const { markerScopeForFile, scopedMarkerPath, isMarkerPathInScope } =
      await import("./paths");
    const scope = markerScopeForFile("src/components/Card.astro");
    expect(scope).toBe("src/components/Card.astro|");
    expect(scopedMarkerPath("0.1", scope)).toBe("src/components/Card.astro|0.1");
    expect(isMarkerPathInScope("src/components/Card.astro|0.1", scope)).toBe(
      true,
    );
    expect(isMarkerPathInScope("0.1", "")).toBe(true);
    expect(isMarkerPathInScope("src/components/Card.astro|0.1", "")).toBe(
      false,
    );
  });

  it("round-trips paths against serializeAstroMarked", async () => {
    const source = `---
---
<div>
  <header>Hi</header>
  {items.map((item) => (
    <li>{item}</li>
  ))}
  { Cond && (
    <span>yes</span>
  )}
  { Cond ? (
    <em>a</em>
  ) : (
    <em>b</em>
  )}
</div>
`;
    const result = await parseAstro(source);
    expect(result.editable).toBe(true);
    if (!result.editable) return;

    const marked = serializeAstroMarked(result.model);
    const paths = [...marked.matchAll(/data-aria-s="([^"]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(paths.length).toBeGreaterThan(3);

    for (const p of paths) {
      const node = nodeAtMarkerPath(result.model.nodes, p);
      expect(node, `missing node for ${p}`).toBeTruthy();
      if (!node) continue;
      const back = markerPathForNodeId(result.model.nodes, node.id);
      expect(back).toBe(bareMarkerPath(p));
    }
  });

  it("maps a source cursor to the deepest projected node", async () => {
    const source = `<section><p>Hello</p></section>`;
    const result = await parseAstro(source);
    if (!result.editable) throw new Error(result.reason);
    expect(markerPathAtSourceOffset(result.model.nodes, source.indexOf("Hello") + 2)).toBe(
      "0.0.0",
    );
    expect(markerPathAtSourceOffset(result.model.nodes, source.indexOf("<p>"))).toBe(
      "0.0",
    );
  });

  it("builds a structure tree with selectable paths", async () => {
    const result = await parseAstro(`---
import Card from '../components/Card.astro';
---
<section>
  <h1>Title</h1>
  <Card />
</section>
`);
    expect(result.editable).toBe(true);
    if (!result.editable) return;

    const tree = buildStructureTree(result.model.nodes);
    expect(tree[0]?.label).toBe("section");
    expect(tree[0]?.path).toBe("0");
    const labels = tree[0]?.children.map((c) => c.label) ?? [];
    expect(labels).toContain("h1");
    expect(labels).toContain("Card");

    const h1 = tree[0]?.children.find((c) => c.label === "h1");
    expect(h1?.path).toBe("0.0");
    expect(overlayInfoForPath(result.model.nodes, h1!.path)?.kind).toBe(
      "element",
    );
    const card = tree[0]?.children.find((c) => c.label === "Card");
    expect(card).toBeTruthy();
    expect(overlayInfoForPath(result.model.nodes, card!.path)?.kind).toBe(
      "component",
    );
  });
});
