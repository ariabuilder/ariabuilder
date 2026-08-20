import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { nodeAtMarkerPath } from "./paths";
import {
  composerRichTextFromJson,
  composerRichTextMode,
  composerRichTextOwnerPath,
  composerRichTextToJson,
  isComposerRichTextBlock,
} from "./richText";
import { serializeAstro } from "./serializeAstro";
import type { AstroDocumentModel, ElementNode } from "./types";

async function elementFor(source: string, path = "0"): Promise<{ node: ElementNode; model: AstroDocumentModel }> {
  const parsed = await parseAstro(`---\n---\n${source}`);
  expect(parsed.editable).toBe(true);
  if (!parsed.editable) throw new Error("expected editable source");
  const node = nodeAtMarkerPath(parsed.model.nodes, path);
  expect(node?.kind).toBe("element");
  return { node: node as ElementNode, model: parsed.model };
}

describe("Composer rich text", () => {
  it("preserves Unicode punctuation and internal source whitespace", async () => {
    const value = "We’re ready—really. 2010–2020 “quoted” café 👩🏽‍💻\n\tNext line.";
    const { node, model } = await elementFor(`<p>${value}</p>`);
    const document = composerRichTextToJson(node);
    expect(document.json.content?.[0]?.content?.[0]?.text).toBe(value);

    node.children = composerRichTextFromJson(document, document.json);
    expect(node.children?.[0]?.kind).toBe("text");
    expect(node.children?.[0]?.kind === "text" ? node.children[0].value : "").toBe(value);
    const source = serializeAstro(model);
    expect(source).toContain("We’re ready—really. 2010–2020 “quoted” café 👩🏽‍💻");
    expect(source).toContain("\n\tNext line.");
    expect(source).not.toContain("â");
  });

  it("round-trips mixed inline formatting through Tiptap JSON", async () => {
    const { node, model } = await elementFor(
      '<h1>Real Projects. <strong>Real <em>Results.</em></strong><br />Done</h1>',
    );
    const document = composerRichTextToJson(node);
    expect(document.mode).toBe("inline");
    expect(document.json.content?.[0]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: "Real Projects. " }),
      expect.objectContaining({
        type: "text",
        text: "Real ",
        marks: expect.arrayContaining([expect.objectContaining({ type: "bold" })]),
      }),
      expect.objectContaining({ type: "hardBreak" }),
    ]));

    node.children = composerRichTextFromJson(document, document.json);
    const source = serializeAstro(model);
    expect(source).toContain("<h1>Real Projects. <strong>Real </strong>");
    expect(source).toContain("<strong>Results.</strong>");
    expect(source).toContain("<br />Done</h1>");
  });

  it("resolves static span wrappers so their text stays editable", async () => {
    const { node, model } = await elementFor(
      "<h1>Build visually.<br /><span>Own every file.</span></h1>",
    );
    const document = composerRichTextToJson(node);
    expect(document.lockedNodes).toEqual({});
    expect(document.json.content?.[0]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: "Build visually." }),
      expect.objectContaining({ type: "hardBreak" }),
      expect.objectContaining({
        type: "text",
        text: "Own every file.",
        marks: expect.arrayContaining([
          expect.objectContaining({
            type: "composerSpan",
            attrs: expect.objectContaining({ htmlAttrs: {}, sourcePath: "2" }),
          }),
        ]),
      }),
    ]));

    const owned = document.json.content?.[0]?.content?.find(
      (item) => item.text === "Own every file.",
    );
    if (owned) owned.text = "Own your files.";
    node.children = composerRichTextFromJson(document, document.json);
    expect(serializeAstro(model)).toContain("<span>Own your files.</span>");
  });

  it("round-trips every supported inline mark, link attribute, and line break", async () => {
    const { node, model } = await elementFor(
      '<p><strong>bold</strong> <em>italic</em> <u>underline</u> <s>strike</s> <code>inline</code> <strong><em>nested</em></strong> <a href="/work" target="_blank" rel="noopener" title="Work">link</a><br />next</p>',
    );
    const document = composerRichTextToJson(node);
    const content = document.json.content?.[0]?.content ?? [];
    expect(content.flatMap((item) => item.marks?.map((mark) => mark.type) ?? []))
      .toEqual(expect.arrayContaining([
        "bold", "italic", "underline", "strike", "code", "link",
      ]));

    node.children = composerRichTextFromJson(document, document.json);
    const source = serializeAstro(model);
    expect(source).toContain("<strong>bold</strong>");
    expect(source).toContain("<em>italic</em>");
    expect(source).toContain("<u>underline</u>");
    expect(source).toContain("<s>strike</s>");
    expect(source).toContain("<code>inline</code>");
    expect(source).toContain("<em><strong>nested</strong></em>");
    expect(source).toContain('<a href="/work" target="_blank" rel="noopener" title="Work">link</a>');
    expect(source).toContain("<br />next");
  });

  it("round-trips literal and variable-backed text colors as static Astro spans", async () => {
    const { node, model } = await elementFor(
      '<h1>Real Projects. <span style="color: var(--color-primary)">Real Results.</span></h1>',
    );
    const document = composerRichTextToJson(node);
    const colored = document.json.content?.[0]?.content?.find(
      (item) => item.marks?.some((mark) => mark.type === "textColor"),
    );
    expect(colored?.marks).toContainEqual({
      type: "textColor",
      attrs: { color: "var(--color-primary)", sourcePath: "1" },
    });

    node.children = composerRichTextFromJson(document, document.json);
    expect(serializeAstro(model)).toContain(
      '<span style="color: var(--color-primary)">Real Results.</span>',
    );
  });

  it("round-trips classed spans as editable text while preserving attributes", async () => {
    const { node, model } = await elementFor(
      '<p>Hello <span class="accent">today</span>.</p>',
    );
    const document = composerRichTextToJson(node);
    const content = document.json.content?.[0]?.content ?? [];
    expect(content.filter((item) => item.type === "composerLockedInline")).toHaveLength(0);
    expect(content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "text",
        text: "today",
        marks: expect.arrayContaining([
          expect.objectContaining({
            type: "composerSpan",
            attrs: expect.objectContaining({
              htmlAttrs: { class: "accent" },
            }),
          }),
        ]),
      }),
    ]));

    node.children = composerRichTextFromJson(document, document.json);
    expect(serializeAstro(model)).toContain('<span class="accent">today</span>');
  });

  it("round-trips spans with additional style declarations without locking the text", async () => {
    const { node, model } = await elementFor(
      '<p><span style="color: red; font-size: 2rem">Styled</span></p>',
    );
    const document = composerRichTextToJson(node);
    expect(document.json.content?.[0]?.content?.[0]).toEqual(expect.objectContaining({
      type: "text",
      text: "Styled",
      marks: expect.arrayContaining([
        expect.objectContaining({ type: "composerSpan" }),
      ]),
    }));

    node.children = composerRichTextFromJson(document, document.json);
    expect(serializeAstro(model)).toContain('style="color: red; font-size: 2rem"');
    expect(serializeAstro(model)).toContain("Styled");
  });

  it("marks nested images as removable locked tokens", async () => {
    const { node } = await elementFor(
      '<p>Copy <img src="/src/assets/images/photo.webp" alt="" /> more</p>',
    );
    const document = composerRichTextToJson(node);
    const locked = document.json.content?.[0]?.content?.find(
      (item) => item.type === "composerLockedInline",
    );
    expect(locked?.attrs).toEqual(expect.objectContaining({
      label: "<img>",
      removable: true,
    }));

    const withoutImage = {
      ...document.json,
      content: [{
        ...document.json.content?.[0],
        content: (document.json.content?.[0]?.content ?? []).filter(
          (item) => item.type !== "composerLockedInline",
        ),
      }],
    };
    node.children = composerRichTextFromJson(document, withoutImage);
    expect(node.children?.some((child) => child.kind === "element" && child.name === "img")).toBe(false);
  });

  it("preserves expressions as locked nodes", async () => {
    const { node, model } = await elementFor(
      "<p>Hello {name} tomorrow.</p>",
    );
    const document = composerRichTextToJson(node);
    const content = document.json.content?.[0]?.content ?? [];
    expect(content.filter((item) => item.type === "composerLockedInline")).toHaveLength(1);

    const firstText = content.find((item) => item.type === "text");
    if (firstText) firstText.text = "Welcome ";
    node.children = composerRichTextFromJson(document, document.json);
    const source = serializeAstro(model);
    expect(source).toContain("Welcome {name}");
    expect(source).toContain("tomorrow.");
  });

  it("locks spans with expression-bound attributes", async () => {
    const { node, model } = await elementFor(
      "<p>Hello <span class={tone}>today</span>.</p>",
    );
    const document = composerRichTextToJson(node);
    expect(document.json.content?.[0]?.content?.filter(
      (item) => item.type === "composerLockedInline",
    )).toHaveLength(1);

    node.children = composerRichTextFromJson(document, document.json);
    expect(serializeAstro(model)).toContain('<span class={tone}>today</span>');
  });

  it("locks a formatting wrapper when it contains dynamic Astro content", async () => {
    const { node, model } = await elementFor("<p><strong>{name}</strong> follows</p>");
    const document = composerRichTextToJson(node);
    expect(document.json.content?.[0]?.content?.[0]?.type).toBe("composerLockedInline");
    node.children = composerRichTextFromJson(document, document.json);
    expect(serializeAstro(model)).toContain("<strong>{name}</strong> follows");
  });

  it("locks dynamic links and inline components byte-semantically", async () => {
    const { node, model } = await elementFor(
      '<p>Before <a href={project.url}>project</a> <Badge label="New" /> after</p>',
    );
    const document = composerRichTextToJson(node);
    expect(document.json.content?.[0]?.content?.filter(
      (item) => item.type === "composerLockedInline",
    )).toHaveLength(2);

    node.children = composerRichTextFromJson(document, document.json);
    const source = serializeAstro(model);
    expect(source).toContain('<a href={project.url}>project</a>');
    expect(source).toContain('<Badge label="New" />');
  });

  it("round-trips a multi-block Rich Text region", async () => {
    const { node, model } = await elementFor(
      '<div data-aria-type="RichText"><h2>Title</h2><p>Body <a href="/work">link</a>.</p><ul><li>One</li><li>Two</li></ul></div>',
    );
    expect(isComposerRichTextBlock(node)).toBe(true);
    const document = composerRichTextToJson(node);
    expect(document.mode).toBe("block");
    expect(document.json.content?.map((item) => item.type)).toEqual([
      "heading",
      "paragraph",
      "bulletList",
    ]);

    node.children = composerRichTextFromJson(document, document.json);
    const source = serializeAstro(model);
    expect(source).toContain('<div data-aria-type="RichText">');
    expect(source).toContain('<p>Body <a href="/work">link</a>.</p>');
    expect(source).toContain("<ul>");
  });

  it("round-trips headings, quotes, ordered lists, and nested list blocks", async () => {
    const { node, model } = await elementFor(
      '<div data-aria-type="RichText"><h3>Details</h3><h4>Notes</h4><blockquote><p>Quoted <em>copy</em></p></blockquote><ol><li>First</li><li><p>Second</p><ul><li>Nested</li></ul></li></ol></div>',
    );
    const document = composerRichTextToJson(node);
    expect(document.json.content?.map((item) => item.type)).toEqual([
      "heading", "heading", "blockquote", "orderedList",
    ]);

    node.children = composerRichTextFromJson(document, document.json);
    const source = serializeAstro(model);
    expect(source).toContain("<h3>Details</h3>");
    expect(source).toContain("<h4>Notes</h4>");
    expect(source).toContain("<blockquote>");
    expect(source).toContain("<ol>");
    expect(source).toContain("<ul>");
  });

  it("promotes an inline descendant selection to its visible owner", async () => {
    const { model } = await elementFor('<h1>Lead <strong>result</strong></h1>');
    expect(composerRichTextOwnerPath(model, "0.1.0")).toBe("0");
    expect(composerRichTextOwnerPath(model, "0")).toBe("0");
  });

  it("keeps a block child as the visible owner of a flow-content link", async () => {
    const { model } = await elementFor("<a><h2>Linked heading</h2></a>");
    expect(composerRichTextOwnerPath(model, "0.0")).toBe("0.0");
    expect(composerRichTextOwnerPath(model, "0.0.0")).toBe("0.0");
  });

  it("keeps an image as the visible owner of an image-only link", async () => {
    const { model } = await elementFor('<a href="/work"><img src="/work.jpg" alt="Work" /></a>');
    expect(composerRichTextOwnerPath(model, "0.0")).toBe("0.0");
  });

  it("does not treat an Avatar as an inline rich-text host", async () => {
    const { node, model } = await elementFor(
      '<span data-aria-type="Avatar" class="aria-avatar"><img class="aria-avatar__image" src="/face.jpg" alt="" /><span class="aria-avatar__fallback">AA</span></span>',
    );
    expect(composerRichTextMode(node)).toBeNull();
    expect(composerRichTextOwnerPath(model, "0.0")).toBe("0.0");
    expect(composerRichTextOwnerPath(model, "0.1")).toBe("0.1");
  });
});
