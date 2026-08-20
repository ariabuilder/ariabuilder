import { describe, expect, it } from "vitest";
import {
  ARIA_PALETTE_PRIMITIVES,
  BLOCK_DEFINITIONS,
  COMPOSER_BLOCK_IDS,
  blankPageAstroSource,
  createAriaPrimitiveNode,
  insertAriaPrimitiveAt,
  isAriaPrimitiveId,
} from "./ariaPrimitives";
import { parseAstro } from "./parseAstro";
import { serializeAstro } from "./serializeAstro";

describe("ariaPrimitives", () => {
  it("exposes palette ids used by the Aria group", () => {
    expect(ARIA_PALETTE_PRIMITIVES.map((p) => p.id)).toEqual([
      "section",
      "container",
      "div",
      "heading",
      "text",
      "rich-text",
      "span",
      "quote",
      "accordion",
      "popover",
      "dialog",
      "datalist",
      "progress",
      "meter",
      "divider",
      "button",
      "image",
      "video",
      "embed",
      "icon",
      "icon-list",
      "svg",
      "list",
      "link",
      "code",
      "comment",
      "pagination",
      "navigation",
      "input",
      "textarea",
      "select",
      "checkbox",
      "radio",
      "field",
      "card",
      "alert",
      "badge",
      "avatar",
    ]);
    expect(COMPOSER_BLOCK_IDS).toHaveLength(39);
    expect(BLOCK_DEFINITIONS.find((block) => block.id === "component")).toMatchObject({
      projectComponent: true,
      rootTag: null,
    });
    expect(isAriaPrimitiveId("section")).toBe(true);
    expect(isAriaPrimitiveId("div")).toBe(true);
  });

  it("round-trips every real-Astro block factory without marker metadata", async () => {
    for (const block of ARIA_PALETTE_PRIMITIVES) {
      const source = serializeAstro({
        imports: [],
        extraFrontmatter: "",
        nodes: [createAriaPrimitiveNode(block.id)],
        propSchema: [],
        slots: [],
        extendsTag: null,
      });
      expect(source, block.id).not.toContain("data-aria-p");
      expect(source, block.id).not.toContain(".aria/composer");
      const parsed = await parseAstro(source);
      expect(parsed.editable, block.id).toBe(true);
    }
  });

  it("emits Section with data-aria-type and nested Container", () => {
    const node = createAriaPrimitiveNode("section");
    expect(node.name).toBe("section");
    expect(node.props["data-aria-type"]).toEqual({
      type: "string",
      value: "Section",
    });
    expect(node.children).toHaveLength(1);
    const child = node.children![0]!;
    expect(child.kind).toBe("element");
    if (child.kind !== "element") throw new Error("expected element");
    expect(child.name).toBe("div");
    expect(child.props["data-aria-type"]).toEqual({
      type: "string",
      value: "Container",
    });
  });

  it("emits Div as an empty unstyled native element", async () => {
    const node = createAriaPrimitiveNode("div");
    expect(node.name).toBe("div");
    expect(node.props).toEqual({});
    expect(node.children).toEqual([]);

    const source = serializeAstro({
      imports: [],
      extraFrontmatter: "",
      nodes: [node],
      propSchema: [],
      slots: [],
      extendsTag: null,
    });
    expect(source).toContain("<div></div>");
    expect(source).not.toContain("data-aria-type");
    expect(source).not.toContain("class=");
    expect(source).not.toContain("style=");

    const parsed = await parseAstro(source);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable");
    expect(serializeAstro(parsed.model)).toContain("<div></div>");
  });

  it("emits Span as editable inline text", () => {
    const node = createAriaPrimitiveNode("span");
    expect(node.name).toBe("span");
    expect(node.props).toEqual({});
    expect(node.children).toHaveLength(1);
    expect(node.children?.[0]).toMatchObject({ kind: "text", value: "Span" });
  });

  it("emits Quote with semantic quote and citation content", () => {
    const node = createAriaPrimitiveNode("quote");
    expect(node.name).toBe("blockquote");
    expect(node.props).toEqual({});
    expect(node.children).toHaveLength(2);
    expect(node.children?.[0]).toMatchObject({ kind: "element", name: "p" });
    expect(node.children?.[1]).toMatchObject({ kind: "element", name: "cite" });
  });

  it("emits an open native Accordion for canvas editability", () => {
    const node = createAriaPrimitiveNode("accordion");
    expect(node.name).toBe("details");
    expect(node.props.open).toEqual({ type: "bare" });
    expect(node.children).toHaveLength(2);
    expect(node.children?.[0]).toMatchObject({
      kind: "element",
      name: "summary",
    });
    expect(node.children?.[1]).toMatchObject({ kind: "element", name: "p" });
  });

  it("emits a declarative native Popover trigger and target", () => {
    const node = createAriaPrimitiveNode("popover");
    expect(node.name).toBe("div");
    expect(node.children).toHaveLength(2);
    const trigger = node.children?.[0];
    const target = node.children?.[1];
    expect(trigger).toMatchObject({ kind: "element", name: "button" });
    expect(target).toMatchObject({ kind: "element", name: "div" });
    if (trigger?.kind !== "element" || target?.kind !== "element") {
      throw new Error("expected Popover elements");
    }
    expect(trigger.props.popovertarget).toEqual(target.props.id);
    expect(target.props.popover).toEqual({ type: "bare" });
    expect(target.props["aria-labelledby"]).toBeTruthy();
    expect(target.props.style).toMatchObject({ type: "string" });
    expect(target.children).toHaveLength(3);
    expect(target.children?.[0]).toMatchObject({ kind: "element", name: "h2" });
    expect(target.children?.[2]).toMatchObject({
      kind: "element",
      name: "button",
      props: {
        popovertarget: target.props.id,
        popovertargetaction: { type: "string", value: "hide" },
      },
    });
  });

  it("selects Popover content rather than its wrapper after insertion", async () => {
    const result = await parseAstro(`---\n---\n<div></div>\n`);
    if (!result.editable) throw new Error("expected editable");
    const inserted = insertAriaPrimitiveAt(result.model, "popover", { parentPath: null, index: 1 });
    expect(inserted).toMatchObject({ ok: true, selectPath: "1.1" });
  });

  it("emits a declarative native modal Dialog", () => {
    const node = createAriaPrimitiveNode("dialog");
    expect(node.name).toBe("div");
    expect(node.children).toHaveLength(2);
    const trigger = node.children?.[0];
    const target = node.children?.[1];
    expect(trigger).toMatchObject({ kind: "element", name: "button" });
    expect(target).toMatchObject({ kind: "element", name: "dialog" });
    if (trigger?.kind !== "element" || target?.kind !== "element") {
      throw new Error("expected Dialog elements");
    }
    expect(trigger.props.command).toEqual({
      type: "string",
      value: "show-modal",
    });
    expect(trigger.props.commandfor).toEqual(target.props.id);
    expect(target.children?.[2]).toMatchObject({
      kind: "element",
      name: "form",
      props: { method: { type: "string", value: "dialog" } },
    });
  });

  it("emits a labeled Datalist with linked native controls", () => {
    const node = createAriaPrimitiveNode("datalist");
    expect(node.children).toHaveLength(3);
    const label = node.children?.[0];
    const input = node.children?.[1];
    const list = node.children?.[2];
    if (
      label?.kind !== "element" ||
      input?.kind !== "element" ||
      list?.kind !== "element"
    ) {
      throw new Error("expected Datalist elements");
    }
    expect(label.name).toBe("label");
    expect(input.name).toBe("input");
    expect(list.name).toBe("datalist");
    expect(label.props.for).toEqual(input.props.id);
    expect(input.props.list).toEqual(list.props.id);
    expect(list.children).toHaveLength(2);
  });

  it("emits native Progress and Meter values with text fallbacks", () => {
    const progress = createAriaPrimitiveNode("progress");
    expect(progress).toMatchObject({
      name: "progress",
      props: {
        value: { type: "string", value: "50" },
        max: { type: "string", value: "100" },
      },
    });
    expect(progress.children?.[0]).toMatchObject({
      kind: "text",
      value: "50%",
    });

    const meter = createAriaPrimitiveNode("meter");
    expect(meter).toMatchObject({
      name: "meter",
      props: {
        min: { type: "string", value: "0" },
        max: { type: "string", value: "100" },
        value: { type: "string", value: "50" },
      },
    });
    expect(meter.children?.[0]).toMatchObject({
      kind: "text",
      value: "50 out of 100",
    });
  });

  it("emits Divider as a void element", () => {
    const node = createAriaPrimitiveNode("divider");
    expect(node.name).toBe("hr");
    expect(node.props).toEqual({});
    expect(node.children).toBeNull();
  });

  it("emits Rich Text as plain Astro with a starter paragraph", () => {
    const node = createAriaPrimitiveNode("rich-text");
    expect(node).toMatchObject({
      kind: "element",
      name: "div",
      props: { "data-aria-type": { type: "string", value: "RichText" } },
    });
    expect(node.children?.[0]).toMatchObject({
      kind: "element",
      name: "p",
      children: [expect.objectContaining({ kind: "text", value: "Rich text" })],
    });
  });

  it("emits Embed with a safe source and accessible name", () => {
    const node = createAriaPrimitiveNode("embed");
    expect(node.name).toBe("iframe");
    expect(node.props).toEqual({
      src: { type: "string", value: "about:blank" },
      title: { type: "string", value: "Embedded content" },
      loading: { type: "string", value: "lazy" },
    });
    expect(node.children).toEqual([]);
  });

  it("applies native containment rules when inserting Div", async () => {
    const result = await parseAstro(`---
---
<p></p>
`);
    expect(result.editable).toBe(true);
    if (!result.editable) throw new Error("expected editable");

    const rejected = insertAriaPrimitiveAt(result.model, "div", {
      parentPath: "0",
      index: 0,
    });
    expect(rejected.ok).toBe(false);

    const inserted = insertAriaPrimitiveAt(result.model, "div", {
      parentPath: null,
      index: result.model.nodes.length,
    });
    expect(inserted.ok).toBe(true);
    expect(serializeAstro(result.model)).toContain("<div></div>");
  });

  it("serializes Section/Container to clean Astro with managed selectors", async () => {
    const source = serializeAstro({
      imports: [],
      extraFrontmatter: "",
      nodes: [createAriaPrimitiveNode("section")],
      propSchema: [],
      slots: [],
      extendsTag: null,
    });
    expect(source).toContain('data-aria-type="Section"');
    expect(source).toContain('data-aria-type="Container"');
    expect(source).not.toContain(".aria/composer");

    const parsed = await parseAstro(source);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable");
    const again = serializeAstro(parsed.model);
    expect(again).toContain('data-aria-type="Section"');
    expect(again).toContain('data-aria-type="Container"');
  });

  it("emits Button with data-button-variant for Design globals", () => {
    const node = createAriaPrimitiveNode("button");
    expect(node.name).toBe("button");
    expect(node.props.type).toEqual({ type: "string", value: "button" });
    expect(node.props["data-button-variant"]).toEqual({
      type: "string",
      value: "primary",
    });
  });

  it("emits an editable Astro comment with conventional spacing", async () => {
    const node = createAriaPrimitiveNode("comment");
    expect(node).toMatchObject({ kind: "comment", value: " Comment " });

    const source = serializeAstro({
      imports: [],
      extraFrontmatter: "",
      nodes: [node],
      propSchema: [],
      slots: [],
      extendsTag: null,
    });
    expect(source).toContain("<!-- Comment -->");

    const parsed = await parseAstro(source);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable");
    expect(parsed.model.nodes).toContainEqual(
      expect.objectContaining({ kind: "comment", value: " Comment " }),
    );
  });

  it("inserts Comment without applying element containment rules", async () => {
    const result = await parseAstro(`---
---
<p>Text</p>
`);
    expect(result.editable).toBe(true);
    if (!result.editable) throw new Error("expected editable");
    const paragraph = result.model.nodes.find((node) => node.kind === "element");
    expect(paragraph?.kind).toBe("element");
    if (!paragraph || paragraph.kind !== "element") throw new Error("expected paragraph");

    const insert = insertAriaPrimitiveAt(result.model, "comment", {
      parentPath: "0",
      index: paragraph.children?.length ?? 0,
    });
    expect(insert.ok).toBe(true);
    expect(serializeAstro(result.model)).toContain("<p>\n  Text\n  <!-- Comment -->\n</p>");
  });

  it("inserts Aria Section into an editable page model", async () => {
    const result = await parseAstro(`---
---
<body></body>
`);
    expect(result.editable).toBe(true);
    if (!result.editable) throw new Error("expected editable");
    const body = result.model.nodes.find(
      (n) => n.kind === "element" && n.name === "body",
    );
    // Flat models may put body as root child of html — find via serialize path.
    const insert = insertAriaPrimitiveAt(result.model, "section", {
      parentPath: null,
      index: result.model.nodes.length,
    });
    expect(insert.ok).toBe(true);
    const out = serializeAstro(result.model);
    expect(out).toContain('data-aria-type="Section"');
    void body;
  });

  it("blank page scaffold includes Section+Container by default", async () => {
    const source = blankPageAstroSource({
      styleImport: "import '../styles/global.css';\n",
    });
    expect(source).toContain("import '../styles/global.css';");
    expect(source).toContain('data-aria-type="Section"');
    expect(source).toContain('data-aria-type="Container"');
    expect(source).not.toMatch(/\.aria\/composer/);

    const parsed = await parseAstro(source);
    expect(parsed.editable).toBe(true);
  });

  it("can omit Aria scaffold when requested", () => {
    const source = blankPageAstroSource({ withAriaScaffold: false });
    expect(source).toContain("<body></body>");
    expect(source).not.toContain("data-aria-type");
  });

  it("emits form and display primitives with BEM classes and no inline styles", () => {
    const ids = [
      "input",
      "textarea",
      "select",
      "checkbox",
      "radio",
      "field",
      "card",
      "alert",
      "badge",
      "avatar",
    ] as const;
    for (const id of ids) {
      const node = createAriaPrimitiveNode(id);
      expect(node.kind).toBe("element");
      const source = serializeAstro({
        imports: [],
        extraFrontmatter: "",
        nodes: [node],
        propSchema: [],
        slots: [],
        extendsTag: null,
      });
      expect(source, id).not.toContain("style=");
      expect(source, id).toContain("data-aria-type=");
      expect(source, id).toMatch(/class="aria-/);
    }

    const card = serializeAstro({
      imports: [],
      extraFrontmatter: "",
      nodes: [createAriaPrimitiveNode("card")],
      propSchema: [],
      slots: [],
      extendsTag: null,
    });
    expect(card).toContain('data-aria-type="Card"');
    expect(card).toContain('class="aria-card"');
    expect(card).toContain("aria-card__media");
    expect(card).toContain("aria-card__header");
    expect(card).toContain("aria-card__body");
    expect(card).toContain("aria-card__actions");

    const alert = serializeAstro({
      imports: [],
      extraFrontmatter: "",
      nodes: [createAriaPrimitiveNode("alert")],
      propSchema: [],
      slots: [],
      extendsTag: null,
    });
    expect(alert).toContain('role="status"');
    expect(alert).toContain("aria-alert--info");
    expect(alert).toContain("aria-alert__icon");
    expect(alert).toContain('data-aria-alert-icon="info"');
    expect(alert).toContain('width="18"');
    expect(alert).toContain('height="18"');
    expect(alert).not.toContain("style=");

    const field = createAriaPrimitiveNode("field");
    expect(field.props.class).toEqual({ type: "string", value: "aria-field" });
    const checkbox = createAriaPrimitiveNode("checkbox");
    expect(checkbox.props.class).toEqual({
      type: "string",
      value: "aria-field aria-field--check",
    });
  });
});
