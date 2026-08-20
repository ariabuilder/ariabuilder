import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { serializeAstro } from "./serializeAstro";
import {
  canReorder,
  deleteNodeAtPath,
  duplicateNodeAtPath,
  insertDebugElement,
  locateAtPath,
  renamePropAtPath,
  reorderNodeAtPath,
  reparentNodeAtPath,
  reparentNodesAtPaths,
  resolveCanvasDropTarget,
  resolveInsertTarget,
  insertNodesAt,
  createElementNode,
  setComposerLayerLabelAtPath,
  setPropAtPath,
  setTextAtPath,
  setTagAtPath,
  wrapNodesAtPaths,
} from "./mutate";
import { createAriaPrimitiveNode } from "./ariaPrimitives";
import { nodeAtMarkerPath } from "./paths";

async function editableModel(source: string) {
  const result = await parseAstro(source);
  expect(result.editable).toBe(true);
  if (!result.editable) throw new Error("expected editable");
  return result.model;
}

describe("composer mutate", () => {
  it("rejects invalid and interactive generic tag conversions", async () => {
    const list = await editableModel("<ul><li>Item</li></ul>");
    const before = serializeAstro(list);
    expect(setTagAtPath(list, "0.0", "div")).toMatchObject({ ok: false });
    expect(serializeAstro(list)).toBe(before);

    const heading = await editableModel("<h2>Heading</h2>");
    expect(setTagAtPath(heading, "0", "a")).toMatchObject({ ok: false });
    expect(setTagAtPath(heading, "0", "button")).toMatchObject({ ok: false });
    expect(setTagAtPath(heading, "0", "h3")).toMatchObject({ ok: true });
    expect(serializeAstro(heading)).toContain("<h3>Heading</h3>");

    const link = await editableModel('<a href="/about" target="_blank">About</a>');
    const linkBefore = serializeAstro(link);
    expect(setTagAtPath(link, "0", "h2")).toMatchObject({ ok: false });
    expect(serializeAstro(link)).toBe(linkBefore);

    const button = await editableModel('<button type="submit" disabled>Save</button>');
    const buttonBefore = serializeAstro(button);
    expect(setTagAtPath(button, "0", "div")).toMatchObject({ ok: false });
    expect(serializeAstro(button)).toBe(buttonBefore);
  });
  it("deletes a node and reselects a sibling", async () => {
    const model = await editableModel(`---
---
<section>
  <h1>Title</h1>
  <p>Body</p>
</section>
`);
    const result = deleteNodeAtPath(model, "0.0");
    expect(result.ok).toBe(true);
    expect(result.selectPath).toBe("0.0");
    expect(nodeAtMarkerPath(model.nodes, "0.0")?.kind).toBe("element");
    expect(
      nodeAtMarkerPath(model.nodes, "0.0") &&
        "name" in nodeAtMarkerPath(model.nodes, "0.0")!
        ? (nodeAtMarkerPath(model.nodes, "0.0") as { name: string }).name
        : null,
    ).toBe("p");
  });

  it("duplicates a node after the original", async () => {
    const model = await editableModel(`---
---
<div>
  <span>A</span>
</div>
`);
    // Marker paths include whitespace text siblings — find the span.
    const div = locateAtPath(model.nodes, "0");
    expect(div?.node.kind).toBe("element");
    const kids =
      div && "children" in div.node && Array.isArray(div.node.children)
        ? div.node.children
        : [];
    const spanIndex = kids.findIndex(
      (n) => n.kind === "element" && n.name === "span",
    );
    expect(spanIndex).toBeGreaterThanOrEqual(0);
    const spanPath = `0.${spanIndex}`;
    const result = duplicateNodeAtPath(model, spanPath);
    expect(result.ok).toBe(true);
    expect(result.selectPath).toBe(`0.${spanIndex + 1}`);
    const a = locateAtPath(model.nodes, spanPath);
    const b = locateAtPath(model.nodes, `0.${spanIndex + 1}`);
    expect(a?.node.id).not.toBe(b?.node.id);
    expect(a?.node.kind).toBe("element");
    expect(b?.node.kind).toBe("element");
  });

  it("rewrites linked DOM ids when duplicating an interactive block", async () => {
    const model = await editableModel(`---
---
<div><button popovertarget="popover-1">Open</button><div id="popover-1" popover>Content</div></div>
`);
    expect(duplicateNodeAtPath(model, "0").ok).toBe(true);

    const source = serializeAstro(model);
    const targets = [...source.matchAll(/popovertarget="([^"]+)"/g)].map(
      (match) => match[1],
    );
    const ids = [...source.matchAll(/id="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(targets).toHaveLength(2);
    expect(ids).toHaveLength(2);
    expect(targets[0]).toBe(ids[0]);
    expect(targets[1]).toBe(ids[1]);
    expect(targets[1]).not.toBe(targets[0]);
  });

  it("reorders siblings up and down", async () => {
    const model = await editableModel(`---
---
<ul>
  <li>One</li>
  <li>Two</li>
  <li>Three</li>
</ul>
`);
    expect(canReorder(model, "0.1", "up")).toBe(true);
    expect(canReorder(model, "0.0", "up")).toBe(false);

    let result = reorderNodeAtPath(model, "0.1", "up");
    expect(result.ok).toBe(true);
    expect(result.selectPath).toBe("0.0");
    const first = nodeAtMarkerPath(model.nodes, "0.0");
    expect(first && "children" in first ? first.children?.[0] : null).toMatchObject({
      kind: "text",
      value: "Two",
    });

    result = reorderNodeAtPath(model, "0.0", "down");
    expect(result.ok).toBe(true);
    expect(result.selectPath).toBe("0.1");
  });

  it("reparents a node under another element", async () => {
    const model = await editableModel(`---
---
<section>
  <header></header>
  <p>Move me</p>
</section>
`);
    const result = reparentNodeAtPath(model, "0.1", {
      parentPath: "0.0",
      index: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.selectPath).toBe("0.0.0");
    const header = nodeAtMarkerPath(model.nodes, "0.0");
    expect(header?.kind).toBe("element");
    expect(
      header && "children" in header ? header.children?.length : 0,
    ).toBe(1);
  });

  it("moves a multi-selection atomically in stable source order", async () => {
    const model = await editableModel(`---\n---\n<section><p>One</p><p>Two</p><p>Three</p></section><aside></aside>`);
    const result = reparentNodesAtPaths(model, ["0.2", "0.0"], {
      parentPath: "1",
      index: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.selectPaths).toEqual(["1.0", "1.1"]);
    expect(serializeAstro(model)).toContain(
      "<aside>\n  <p>One</p>\n  <p>Three</p>\n</aside>",
    );
  });

  it("deduplicates descendants when their selected ancestor moves", async () => {
    const model = await editableModel(`---\n---\n<section><div><span>A</span></div></section><main></main>`);
    const result = reparentNodesAtPaths(model, ["0.0", "0.0.0"], {
      parentPath: "1",
      index: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.selectPaths).toEqual(["1.0"]);
    expect(serializeAstro(model).match(/<span>A<\/span>/g)).toHaveLength(1);
  });

  it("rejects an invalid multi-move without partially mutating source", async () => {
    const model = await editableModel(`---\n---\n<section><p>Text</p><div>Block</div></section><ul></ul>`);
    const before = serializeAstro(model);
    const result = reparentNodesAtPaths(model, ["0.0", "0.1"], {
      parentPath: "1",
      index: 0,
    });
    expect(result.ok).toBe(false);
    expect(serializeAstro(model)).toBe(before);
  });

  it("wraps selected siblings together in source order", async () => {
    const model = await editableModel(`---\n---\n<main><p>One</p><p>Two</p><p>Three</p></main>`);
    const result = wrapNodesAtPaths(
      model,
      ["0.2", "0.0"],
      "0.0",
      createAriaPrimitiveNode("container"),
    );
    expect(result).toMatchObject({ ok: true, selectPath: "0.0" });
    expect(serializeAstro(model)).toContain(
      '<div data-aria-type="Container">\n    <p>One</p>\n    <p>Three</p>\n  </div>\n  <p>Two</p>',
    );
  });

  it("keeps Div wrappers neutral and ignores selections from other parents", async () => {
    const model = await editableModel(`---\n---\n<main><p>One</p></main><aside><p>Other</p></aside>`);
    const result = wrapNodesAtPaths(
      model,
      ["0.0", "1.0"],
      "0.0",
      createAriaPrimitiveNode("div"),
    );
    expect(result.ok).toBe(true);
    const source = serializeAstro(model);
    expect(source).toContain("<main>\n  <div>\n    <p>One</p>\n  </div>\n</main>");
    expect(source).toContain("<aside>\n  <p>Other</p>\n</aside>");
    expect(source).not.toContain('data-aria-type="Div"');
  });

  it("inserts a debug element and serializes clean astro", async () => {
    const model = await editableModel(`---
---
<main></main>
`);
    const result = insertDebugElement(model, "div", {
      parentPath: "0",
      index: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.selectPath).toBe("0.0");
    const out = serializeAstro(model);
    expect(out).toContain("<div></div>");
    expect(out).not.toContain("data-aria-");
    expect(out).not.toContain("aria-s");
  });

  it("prunes unused component imports on delete", async () => {
    const model = await editableModel(`---
import Card from '../components/Card.astro';
---
<section>
  <Card />
</section>
`);
    expect(model.imports).toHaveLength(1);
    deleteNodeAtPath(model, "0.0");
    expect(model.imports).toHaveLength(0);
  });

  it("sets and clears props while preserving value kinds", async () => {
    const model = await editableModel(`---
---
<a href="/about" class={activeClass} disabled>Go</a>
`);
    const result = setPropAtPath(model, "0", "href", {
      type: "string",
      value: "/contact",
    });
    expect(result.ok).toBe(true);
    const node = locateAtPath(model.nodes, "0")?.node;
    expect(node?.kind).toBe("element");
    if (node?.kind !== "element") throw new Error("expected element");
    expect(node.props.href).toEqual({ type: "string", value: "/contact" });
    expect(node.props.class).toEqual({ type: "expr", value: "activeClass" });
    expect(node.props.disabled).toEqual({ type: "bare" });

    setPropAtPath(model, "0", "disabled", undefined);
    expect(node.props.disabled).toBeUndefined();

    const out = serializeAstro(model);
    expect(out).toContain('href="/contact"');
    expect(out).toContain("class={activeClass}");
    expect(out).not.toContain("disabled");
  });

  it("renames props in place", async () => {
    const model = await editableModel(`---
---
<img src="/a.png" alt="A" />
`);
    const result = renamePropAtPath(model, "0", "alt", "title");
    expect(result.ok).toBe(true);
    const node = locateAtPath(model.nodes, "0")?.node;
    expect(node?.kind).toBe("element");
    if (node?.kind !== "element") throw new Error("expected element");
    expect(node.props.alt).toBeUndefined();
    expect(node.props.title).toEqual({ type: "string", value: "A" });
  });

  it("persists a trimmed custom layer label on prop-bearing nodes", async () => {
    const model = await editableModel(`<section><h2>Heading</h2></section>`);
    expect(setComposerLayerLabelAtPath(model, "0", "  Campaign hero  ")).toMatchObject({
      ok: true,
      selectPath: "0",
    });
    expect(serializeAstro(model)).toContain('data-aria-layer-label="Campaign hero"');
    expect(setComposerLayerLabelAtPath(model, "0.0.0", "Text label")).toMatchObject({
      ok: false,
      reason: "Only HTML element layers can be renamed",
    });
    expect(setComposerLayerLabelAtPath(model, "0", "   ")).toMatchObject({ ok: true });
    expect(serializeAstro(model)).not.toContain("data-aria-layer-label");
  });

  it("updates text node content", async () => {
    const model = await editableModel(`---
---
<p>Hello</p>
`);
    const p = locateAtPath(model.nodes, "0");
    expect(p?.node.kind).toBe("element");
    const kids =
      p && "children" in p.node && Array.isArray(p.node.children)
        ? p.node.children
        : [];
    const textIndex = kids.findIndex((n) => n.kind === "text");
    expect(textIndex).toBeGreaterThanOrEqual(0);
    const path = `0.${textIndex}`;
    setTextAtPath(model, path, "World");
    expect(serializeAstro(model)).toContain("World");
  });

  it("converts canvas hits into validated inside and sibling targets", async () => {
    const model = await editableModel(`---\n---\n<section><div></div><p>Body</p></section>\n`);
    expect(resolveCanvasDropTarget(model, "0.0", "inside", "span")).toEqual({
      parentPath: "0.0",
      index: 0,
    });
    expect(resolveCanvasDropTarget(model, "0.1", "before", "div")).toEqual({
      parentPath: "0",
      index: 1,
    });
  });

  it("anchors canvas sibling drops to the visible rich-text layer", async () => {
    const model = await editableModel(
      `---\n---\n<section><p>Body <strong>copy</strong></p><button>Continue</button></section>\n`,
    );

    const target = resolveCanvasDropTarget(model, "0.0.1.0", "after", "img");
    expect(target).toEqual({ parentPath: "0", index: 1 });

    const inserted = insertNodesAt(model, [createAriaPrimitiveNode("image")], target);
    expect(inserted.ok).toBe(true);
    const section = nodeAtMarkerPath(model.nodes, "0");
    expect(section?.kind).toBe("element");
    expect(section?.kind === "element"
      ? section.children?.map((node) => node.kind === "element" ? node.name : node.kind)
      : []).toEqual(["p", "img", "button"]);
  });

  it("places an image dropped inside a paragraph beside the paragraph", async () => {
    const model = await editableModel(`---\n---\n<section><p>Body copy</p></section>\n`);
    expect(resolveCanvasDropTarget(model, "0.0", "inside", "img")).toEqual({
      parentPath: "0",
      index: 1,
    });
  });

  it("inserts Image beside a selected paragraph instead of inside it", async () => {
    const model = await editableModel(`---\n---\n<section><p>Body copy</p></section>\n`);
    const target = resolveInsertTarget(model, "0.0", "img");
    expect(target).toEqual({ parentPath: "0", index: 1 });

    const inserted = insertNodesAt(model, [createAriaPrimitiveNode("image")], target);
    expect(inserted.ok).toBe(true);
    const section = nodeAtMarkerPath(model.nodes, "0");
    expect(section?.kind === "element"
      ? section.children?.map((node) => node.kind === "element" ? node.name : node.kind)
      : []).toEqual(["p", "img"]);
  });

  it("validates every node before a multi-node paste mutates source", async () => {
    const model = await editableModel(`---\n---\n<ul></ul>\n`);
    const result = insertNodesAt(
      model,
      [createElementNode("li"), createElementNode("div")],
      { parentPath: "0", index: 0 },
    );
    expect(result.ok).toBe(false);
    expect(nodeAtMarkerPath(model.nodes, "0")?.kind).toBe("element");
    const list = nodeAtMarkerPath(model.nodes, "0");
    expect(list && "children" in list ? list.children : null).toEqual([]);
  });
});
