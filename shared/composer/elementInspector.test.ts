import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { serializeAstro } from "./serializeAstro";
import { buildComposerLayerTree } from "./layers";
import {
  addElementListItemAtPath,
  addNavigationItemAtPath,
  applyElementListStyleAtPath,
  convertElementListAtPath,
  isComposerButtonNode,
  resolveComposerAvatarParts,
  resolveComposerButtonPropNames,
  resolveElementInspectorTarget,
  resetElementButtonAtPath,
  resetElementListAtPath,
  setElementLinkAtPath,
} from "./elementInspector";

async function model(source: string) {
  const parsed = await parseAstro(source);
  expect(parsed.editable).toBe(true);
  if (!parsed.editable) throw new Error("expected editable Astro");
  return parsed.model;
}

describe("element-aware Inspector mutations", () => {
  it("recognizes native, styled-link, and Astro component buttons", async () => {
    const doc = await model(`---\nimport Button from "../components/Button.astro";\n---\n<div><button>Native</button><a data-button-variant="primary" href="/go">Link</a><Button variant="secondary">Component</Button></div>`);
    const native = resolveElementInspectorTarget(doc, "0.0");
    const styledLink = resolveElementInspectorTarget(doc, "0.1");
    const component = resolveElementInspectorTarget(doc, "0.2");

    expect(isComposerButtonNode(native?.primaryNode)).toBe(true);
    expect(isComposerButtonNode(styledLink?.primaryNode)).toBe(true);
    expect(isComposerButtonNode(component?.primaryNode)).toBe(true);
    expect(native?.sections).toContain("button");
    expect(styledLink?.sections).toContain("button");
    expect(component?.sections).toContain("button");
    expect(native?.sections).not.toContain("link");
    expect(styledLink?.sections).not.toContain("link");
  });

  it("adapts Button controls to component schema aliases", async () => {
    const doc = await model(`---\nimport Button from "../components/Button.astro";\n---\n<Button link="/pricing">Pricing</Button>`);
    const node = resolveElementInspectorTarget(doc, "0")?.primaryNode;
    expect(isComposerButtonNode(node)).toBe(true);
    if (!isComposerButtonNode(node)) return;

    expect(resolveComposerButtonPropNames(node)).toMatchObject({
      variant: "style",
      href: "link",
    });

    expect(resolveComposerButtonPropNames(node, [
      { name: "style" },
      { name: "link" },
      { name: "size" },
      { name: "variation" },
    ])).toMatchObject({
      variant: "style",
      href: "link",
      size: "size",
    });
  });

  it("resolves link and list context from a selected descendant", async () => {
    const doc = await model('<ul><li><a href="/"><img src="/a.jpg" alt="A" /></a></li></ul>');
    const target = resolveElementInspectorTarget(doc, "0.0.0.0");
    expect(target?.linkPath).toBe("0.0.0");
    expect(target?.listItemPath).toBe("0.0");
    expect(target?.listPath).toBe("0");
    expect(target?.sections).toEqual(expect.arrayContaining(["image", "link", "list"]));
  });

  it("wraps an image in a link and selects the wrapper", async () => {
    const doc = await model('<div><img src="/a.jpg" alt="A" /></div>');
    const image = doc.nodes[0];
    const originalId = image?.kind === "element" ? image.children?.[0]?.id : null;
    const wrapped = setElementLinkAtPath(doc, "0.0", {
      href: { type: "string", value: "/about" },
      target: { type: "string", value: "_self" },
    });
    expect(wrapped).toMatchObject({ ok: true, selectPath: "0.0" });
    expect(serializeAstro(doc)).toContain('<a href="/about" target="_self">');
    const wrapper = resolveElementInspectorTarget(doc, "0.0");
    expect(wrapper).toMatchObject({
      primaryNode: { kind: "element", name: "a" },
      linkPath: "0.0",
    });
    expect(resolveElementInspectorTarget(doc, "0.0.0")?.primaryNode).toMatchObject({
      kind: "element",
      name: "img",
      id: originalId,
    });
    expect(buildComposerLayerTree(doc).content[0]?.children[0]?.children[0]).toMatchObject({
      path: "0.0.0",
      semanticType: "image",
      label: "A",
      id: originalId,
    });
    const unwrapped = setElementLinkAtPath(doc, "0.0", null);
    expect(unwrapped).toMatchObject({ ok: true, selectPath: "0.0" });
    expect(serializeAstro(doc)).not.toContain("<a");
    expect(resolveElementInspectorTarget(doc, "0.0")?.primaryNode).toMatchObject({
      kind: "element",
      name: "img",
      id: originalId,
    });
  });

  it("selects the created link instead of the inner heading", async () => {
    const doc = await model('<section><h2>Hello, I\'m Sasha</h2></section>');
    const heading = doc.nodes[0];
    const originalId = heading?.kind === "element" ? heading.children?.[0]?.id : null;
    const wrapped = setElementLinkAtPath(doc, "0.0", {
      href: { type: "string", value: "/" },
    });
    expect(wrapped).toMatchObject({ ok: true, selectPath: "0.0" });
    expect(resolveElementInspectorTarget(doc, "0.0")).toMatchObject({
      primaryNode: { kind: "element", name: "a" },
      linkPath: "0.0",
    });
    expect(resolveElementInspectorTarget(doc, "0.0.0")?.primaryNode).toMatchObject({
      kind: "element",
      name: "h2",
      id: originalId,
    });

    const unwrapped = setElementLinkAtPath(doc, "0.0", null);
    expect(unwrapped).toMatchObject({ ok: true, selectPath: "0.0" });
    expect(serializeAstro(doc)).toContain("<h2>Hello, I'm Sasha</h2>");
    expect(serializeAstro(doc)).not.toContain("<a");
    expect(resolveElementInspectorTarget(doc, "0.0")).toMatchObject({
      primaryNode: { kind: "element", name: "h2" },
      linkNode: null,
      sections: expect.arrayContaining(["content", "typography", "link"]),
    });
    expect(buildComposerLayerTree(doc).content[0]?.children[0]).toMatchObject({
      path: "0.0",
      semanticType: "heading",
      label: "Hello, I'm Sasha",
    });
  });

  it("selects the nearest designable parent when unlinking to bare text", async () => {
    const doc = await model('<div><p><a href="/about">About us</a></p></div>');
    const result = setElementLinkAtPath(doc, "0.0.0", null);

    expect(result).toMatchObject({ ok: true, selectPath: "0.0" });
    expect(serializeAstro(doc)).toContain("<p>About us</p>");
    expect(resolveElementInspectorTarget(doc, result.selectPath!)).toMatchObject({
      primaryNode: { kind: "element", name: "p" },
    });
  });

  it("identifies legacy empty wrappers and preserves anchors with authored attributes", async () => {
    const empty = await model("<a><h2>Heading</h2></a>");
    expect(resolveElementInspectorTarget(empty, "0.0")).toMatchObject({
      emptyLinkWrapperPath: "0",
      emptyLinkWrapperNode: { kind: "element", name: "a" },
    });
    expect(setElementLinkAtPath(empty, "0.0", null)).toMatchObject({ ok: true, selectPath: "0" });
    expect(serializeAstro(empty)).toContain("<h2>Heading</h2>");

    const authored = await model('<a class="card" href="/work"><h2>Heading</h2></a>');
    const before = serializeAstro(authored);
    expect(setElementLinkAtPath(authored, "0.0", null)).toMatchObject({ ok: false });
    expect(serializeAstro(authored)).toBe(before);
  });

  it("edits an ancestor link from a selected text node", async () => {
    const doc = await model('<a href="/old"><span>Label</span></a>');
    expect(setElementLinkAtPath(doc, "0.0.0", { href: { type: "string", value: "/new" } }).ok).toBe(true);
    expect(serializeAstro(doc)).toContain('<a href="/new"><span>Label</span></a>');
  });

  it("rejects wrappers around nested interactive content without mutation", async () => {
    const doc = await model("<div><button>Go</button></div>");
    const before = serializeAstro(doc);
    expect(setElementLinkAtPath(doc, "0", { href: { type: "string", value: "/" } })).toMatchObject({ ok: false });
    expect(serializeAstro(doc)).toBe(before);
  });

  it("converts button links without retaining invalid attributes", async () => {
    const doc = await model('<button type="button" disabled data-button-variant="primary">Go</button>');
    expect(setElementLinkAtPath(doc, "0", { href: { type: "string", value: "/go" } }).ok).toBe(true);
    expect(serializeAstro(doc)).toContain('<a data-button-variant="primary" href="/go">');
    expect(setElementLinkAtPath(doc, "0", null).ok).toBe(true);
    expect(serializeAstro(doc)).toContain('<button data-button-variant="primary" type="button">');
  });

  it("links a list row or only its text content", async () => {
    const row = await model("<ul><li><span>One</span><span>More</span></li></ul>");
    expect(setElementLinkAtPath(row, "0.0", { href: { type: "string", value: "/one" } }, { scope: "row" })).toMatchObject({
      ok: true,
      selectPath: "0.0.0",
    });
    expect(serializeAstro(row)).toContain('<li><a href="/one"><span>One</span><span>More</span></a></li>');

    const text = await model("<ul><li><span>One</span><span>More</span></li></ul>");
    expect(setElementLinkAtPath(text, "0.0", { href: { type: "string", value: "/one" } }, { scope: "text" })).toMatchObject({
      ok: true,
      selectPath: "0.0.0",
    });
    const output = serializeAstro(text);
    expect(output).toContain('<a href="/one"><span>One</span></a>');
    expect(output).toContain("<span>More</span>");
    expect(resolveElementInspectorTarget(text, "0.0.0")?.primaryNode).toMatchObject({
      kind: "element",
      name: "a",
    });
  });

  it("hides markers by writing list-style: none and stripping list-disc", async () => {
    const doc = await model('<ul class="list-disc space-y-2"><li>One</li></ul>');
    expect(applyElementListStyleAtPath(doc, "0", { type: "none" })).toMatchObject({
      ok: true,
      selectPath: "0",
    });
    const output = serializeAstro(doc);
    expect(output).toContain("list-style: none");
    expect(output).toContain("space-y-2");
    expect(output).not.toContain("list-disc");
  });

  it("replaces an existing list-style shorthand when hiding markers", async () => {
    const doc = await model('<ul style="list-style: disc"><li>One</li></ul>');
    expect(applyElementListStyleAtPath(doc, "0.0", { type: "none" }).ok).toBe(true);
    const output = serializeAstro(doc);
    expect(output).toContain("list-style: none");
    expect(output).not.toContain("list-style: disc");
    expect(output).not.toContain("list-style-type");
  });

  it("restores a visible marker after none with an outside indent", async () => {
    const doc = await model('<ul class="list-disc space-y-2"><li>One</li></ul>');
    expect(applyElementListStyleAtPath(doc, "0", { type: "none" }).ok).toBe(true);
    expect(applyElementListStyleAtPath(doc, "0", { type: "circle" }).ok).toBe(true);
    const output = serializeAstro(doc);
    expect(output).toContain("list-style: circle outside none");
    expect(output).toContain("padding-inline-start: 1.5em");
    expect(output).toContain("space-y-2");
    expect(output).not.toContain("list-disc");
    expect(output).not.toContain("list-style: none");
  });

  it("converts unordered lists to ordered and swaps disc markers to decimal", async () => {
    const doc = await model('<ul class="list-disc"><li>One</li></ul>');
    expect(convertElementListAtPath(doc, "0", "ordered").ok).toBe(true);
    const output = serializeAstro(doc);
    expect(output).toContain("<ol");
    expect(output).toContain("list-style: decimal outside none");
    expect(output).not.toContain("list-disc");
  });

  it("converts list type without writing inline presentation when the class owns styles", async () => {
    const doc = await model('<ul class="hero__promise-list"><li>One</li></ul>');
    expect(convertElementListAtPath(doc, "0", "ordered", { syncPresentation: false }).ok).toBe(true);
    const output = serializeAstro(doc);
    expect(output).toContain("<ol");
    expect(output).toContain('class="hero__promise-list"');
    expect(output).not.toContain("list-style");
  });

  it("converts ordered lists to unordered and swaps decimal markers to none", async () => {
    const doc = await model('<ol style="list-style: decimal"><li>One</li></ol>');
    expect(convertElementListAtPath(doc, "0", "unordered").ok).toBe(true);
    const output = serializeAstro(doc);
    expect(output).toContain("<ul");
    expect(output).toContain("list-style: none");
    expect(output).not.toContain("list-style: decimal");
  });

  it("resets list type, inline list-style, and list utilities together", async () => {
    const doc = await model('<ol class="list-decimal" style="list-style: upper-roman inside"><li>One</li></ol>');
    expect(resetElementListAtPath(doc, "0")).toMatchObject({ ok: true, selectPath: "0" });
    const output = serializeAstro(doc);
    expect(output).toContain("<ul>");
    expect(output).not.toContain("list-style");
    expect(output).not.toContain("list-decimal");
  });

  it("converts ordinary and description lists and adds valid items", async () => {
    const doc = await model("<ul><li>One</li><li>Two</li></ul>");
    expect(convertElementListAtPath(doc, "0.0", "ordered").ok).toBe(true);
    expect(serializeAstro(doc)).toContain("<ol");
    expect(convertElementListAtPath(doc, "0", "description").ok).toBe(true);
    expect(serializeAstro(doc)).toContain("<dl>");
    expect(serializeAstro(doc)).toContain("<dt>One</dt>");
    expect(serializeAstro(doc)).not.toContain("Description");
    expect(addElementListItemAtPath(doc, "0.0").ok).toBe(true);
    expect(serializeAstro(doc)).toContain("Term 3");
    expect(convertElementListAtPath(doc, "0", "unordered").ok).toBe(true);
    expect(serializeAstro(doc)).toContain("<ul");
    expect(serializeAstro(doc)).toContain("<li>");
  });

  it("keeps multi-block list items grouped without multiplying content", async () => {
    const doc = await model("<ul><li><p>Term</p><p>Definition</p></li></ul>");
    const originalIds = JSON.stringify(doc.nodes).match(/\"id\":/g)?.length;
    for (const mode of ["description", "ordered", "description", "unordered"] as const) {
      expect(convertElementListAtPath(doc, "0", mode).ok).toBe(true);
      expect(JSON.stringify(doc.nodes).match(/\"id\":/g)?.length).toBe(originalIds);
    }
    const output = serializeAstro(doc);
    expect(output).toMatch(/<li>\s*<div>Term<\/div>\s*<div>Definition<\/div>\s*<\/li>/);
    expect(output.match(/Term/g)).toHaveLength(1);
    expect(output.match(/Definition/g)).toHaveLength(1);
  });

  it("keeps native term and description pairs together when converting through an ordinary list", async () => {
    const doc = await model("<dl><dt>Term</dt><dd>Description</dd></dl>");
    expect(convertElementListAtPath(doc, "0", "unordered").ok).toBe(true);
    expect(serializeAstro(doc)).toMatch(/<li>\s*<div>Term<\/div>\s*<div>Description<\/div>\s*<\/li>/);
    expect(convertElementListAtPath(doc, "0", "description").ok).toBe(true);
    const output = serializeAstro(doc);
    expect(output).toMatch(/<div>\s*<dt>Term<\/dt>\s*<dd>Description<\/dd>\s*<\/div>/);
    expect(output.match(/Term/g)).toHaveLength(1);
    expect(output.match(/Description/g)).toHaveLength(1);
  });

  it("targets a direct nested list when its owning row is selected", async () => {
    const doc = await model("<ul><li>Parent<ul><li>Child</li></ul></li></ul>");
    expect(resolveElementInspectorTarget(doc, "0.0")?.listPath).toBe("0.0.1");
  });

  it("resets only button-owned presentation and preserves formatted content", async () => {
    const doc = await model('<button data-button-variant="primary" aria-label="Go"><span data-aria-button-icon="true" class="icon"></span><strong>Keep me</strong></button>');
    expect(resetElementButtonAtPath(doc, "0")).toMatchObject({ ok: true, selectPath: "0" });
    const output = serializeAstro(doc);
    expect(output).toContain("<strong>Keep me</strong>");
    expect(output).not.toContain("data-button-variant");
    expect(output).not.toContain("data-aria-button-icon");
  });

  it("selects a new navigation link through the actual list index", async () => {
    const doc = await model('<nav><span>Menu</span><ul><li><a href="/">Item 1</a></li></ul></nav>');
    expect(addNavigationItemAtPath(doc, "0")).toMatchObject({ ok: true, selectPath: "0.1.1.0" });
    expect(serializeAstro(doc)).toContain('<a href="/">Item 2</a>');
  });

  it("wraps a paragraph without leaving selection on the inner text node", async () => {
    const doc = await model('<div><p class="text-sm">Upload files and get an instant share link.</p></div>');
    const paragraph = doc.nodes[0];
    const originalId = paragraph?.kind === "element" ? paragraph.children?.[0]?.id : null;
    expect(setElementLinkAtPath(doc, "0.0", { href: { type: "string", value: "" } })).toMatchObject({
      ok: true,
      selectPath: "0.0",
    });
    expect(serializeAstro(doc)).toContain("<a href=\"\">");
    expect(resolveElementInspectorTarget(doc, "0.0")).toMatchObject({
      primaryNode: { kind: "element", name: "a" },
      linkPath: "0.0",
      sections: expect.arrayContaining(["link"]),
    });
    expect(resolveElementInspectorTarget(doc, "0.0.0")?.primaryNode).toMatchObject({
      kind: "element",
      name: "p",
      id: originalId,
    });
  });

  it("exposes the Avatar image picker on the wrapper, not a content editor", async () => {
    const doc = await model(
      '<span data-aria-type="Avatar" class="aria-avatar"><img class="aria-avatar__image" src="/face.jpg" alt="" /><span class="aria-avatar__fallback">AA</span></span>',
    );
    const target = resolveElementInspectorTarget(doc, "0");
    expect(target?.sections).toContain("image");
    expect(target?.sections).not.toContain("content");
    expect(resolveComposerAvatarParts(target?.primaryNode ?? null, "0")).toMatchObject({
      image: { path: "0.0", node: { name: "img" } },
      fallback: { path: "0.1", node: { name: "span" } },
    });
  });

  it("exposes a variant section for Alert and Badge wrappers", async () => {
    const alert = await model(
      '<div data-aria-type="Alert" class="aria-alert aria-alert--info" role="status"><p class="aria-alert__title">Title</p></div>',
    );
    const badge = await model('<span data-aria-type="Badge" class="aria-badge">New</span>');
    expect(resolveElementInspectorTarget(alert, "0")?.sections).toContain("variant");
    expect(resolveElementInspectorTarget(badge, "0")?.sections).toContain("variant");
    expect(resolveElementInspectorTarget(badge, "0")?.sections).toContain("content");
  });
});
