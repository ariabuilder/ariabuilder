import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { cloneNodesWithNewIds, collectStaticDomIds } from "./mutate";

async function nodesFor(source: string) {
  const parsed = await parseAstro(source);
  if (!parsed.editable) throw new Error(parsed.reason);
  return parsed.model.nodes;
}

describe("Composer clipboard forest identity", () => {
  it("rewrites a colliding authored ID and references across sibling roots", async () => {
    const destination = await parseAstro('<div id="menu"></div>');
    if (!destination.editable) throw new Error(destination.reason);
    const source = await nodesFor(
      '<button popovertarget="menu" aria-controls="menu">Open</button><div id="menu" popover></div>',
    );

    const result = cloneNodesWithNewIds(source, {
      rewriteDomIds: true,
      existingDomIds: collectStaticDomIds(destination.model),
    });
    const replacement = result.rewrittenDomIds.get("menu");

    expect(replacement).toMatch(/^menu-copy-c\d+$/);
    expect(result.nodes[0]).toMatchObject({
      kind: "element",
      props: {
        popovertarget: { type: "string", value: replacement },
        "aria-controls": { type: "string", value: replacement },
      },
    });
    expect(result.nodes[1]).toMatchObject({
      kind: "element",
      props: { id: { type: "string", value: replacement } },
    });
    expect(JSON.stringify(result.nodes)).not.toContain("sourceRange");
  });

  it("preserves authored IDs that do not collide with the destination", async () => {
    const destination = await parseAstro("<main></main>");
    if (!destination.editable) throw new Error(destination.reason);
    const source = await nodesFor('<a href="#details">Jump</a><section id="details"></section>');

    const result = cloneNodesWithNewIds(source, {
      rewriteDomIds: true,
      existingDomIds: collectStaticDomIds(destination.model),
    });

    expect(result.rewrittenDomIds.size).toBe(0);
    expect(result.nodes[0]).toMatchObject({
      kind: "element",
      props: { href: { type: "string", value: "#details" } },
    });
    expect(result.nodes[1]).toMatchObject({
      kind: "element",
      props: { id: { type: "string", value: "details" } },
    });
  });

  it("rewrites SVG url references with the forest collision map", async () => {
    const destination = await parseAstro('<div id="paint"></div>');
    if (!destination.editable) throw new Error(destination.reason);
    const source = await nodesFor(
      '<svg><defs><linearGradient id="paint"></linearGradient></defs></svg><svg><rect fill="url(#paint)" /></svg>',
    );

    const result = cloneNodesWithNewIds(source, {
      rewriteDomIds: true,
      existingDomIds: collectStaticDomIds(destination.model),
    });
    const replacement = result.rewrittenDomIds.get("paint");

    expect(JSON.stringify(result.nodes)).toContain(`url(#${replacement})`);
  });
});
