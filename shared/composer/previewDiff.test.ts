import { describe, expect, it } from "vitest";
import { classifyComposerPreviewDiff } from "./previewDiff";
import { parseAstro } from "./parseAstro";
import {
  addElementListItemAtPath,
  addNavigationItemAtPath,
  applyElementListStyleAtPath,
  convertElementListAtPath,
  setElementLinkAtPath,
} from "./elementInspector";
import type { AstroDocumentModel } from "./types";

const model = (): AstroDocumentModel => ({
  imports: [], extraFrontmatter: "", propSchema: [], slots: [], extendsTag: null,
  nodes: [{ id: "root", kind: "element", name: "section", props: { class: { type: "string", value: "old" } }, children: [{ id: "text", kind: "text", value: "Hello" }] }],
});

describe("classifyComposerPreviewDiff", () => {
  it("patches static attributes and leaf text", () => {
    const before = model();
    const after = structuredClone(before);
    const root = after.nodes[0]!;
    if (root.kind !== "element" || !root.children?.[0] || root.children[0].kind !== "text") throw new Error();
    root.props.class = { type: "string", value: "new" };
    root.children[0].value = "World";
    expect(classifyComposerPreviewDiff(before, after)).toMatchObject({
      kind: "dom-patch",
      patches: [{ path: "0", attributes: { class: "new" } }, { path: "0.0", text: "World" }],
    });
  });

  it("removes a detached static class from the live canvas", () => {
    const before = model();
    const after = structuredClone(before);
    const root = after.nodes[0]!;
    if (root.kind !== "element") throw new Error();
    root.props.class = { type: "string", value: "" };
    expect(classifyComposerPreviewDiff(before, after)).toMatchObject({
      kind: "dom-patch",
      patches: [{ path: "0", attributes: { class: "" } }],
    });
  });

  it("reconciles expressions and patches static structural changes", () => {
    const before = model();
    const expression = structuredClone(before);
    const root = expression.nodes[0]!;
    if (root.kind !== "element") throw new Error();
    root.props.class = { type: "expr", value: "activeClass" };
    expect(classifyComposerPreviewDiff(before, expression).kind).toBe("server-reconcile");
    const structural = structuredClone(before);
    structural.nodes.push({ id: "second", kind: "element", name: "p", props: {}, children: [] });
    expect(classifyComposerPreviewDiff(before, structural)).toMatchObject({
      kind: "dom-patch",
      paths: ["$document"],
      patches: [{ kind: "static-tree", boundaries: [{ path: "$document" }] }],
    });
  });

  it("requests a controlled reload for import ownership changes", () => {
    const before = model();
    const after = structuredClone(before);
    after.imports.push({ name: "Card", path: "../components/Card.astro" });
    expect(classifyComposerPreviewDiff(before, after)).toEqual({
      kind: "hard-reload",
      paths: ["$document"],
      reason: "imports-changed",
    });
  });

  it("patches a newly wrapped static link at its containing element", async () => {
    const parsed = await parseAstro('<div><p>Upload files</p></div>');
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable Astro");
    const before = structuredClone(parsed.model);
    expect(setElementLinkAtPath(parsed.model, "0.0", { href: { type: "string", value: "" } }).ok).toBe(true);
    expect(classifyComposerPreviewDiff(before, parsed.model)).toMatchObject({
      kind: "dom-patch",
      paths: ["0"],
      patches: [{ kind: "static-tree", boundaries: [{ path: "0" }] }],
    });
  });

  it("classifies core static structure operations as one keyed transaction", async () => {
    const parsed = await parseAstro('<main><section><p>One</p><p>Two</p></section><aside></aside></main>');
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable Astro");

    const before = structuredClone(parsed.model);
    const main = parsed.model.nodes[0];
    if (main?.kind !== "element" || !main.children) throw new Error();
    const section = main.children[0];
    const aside = main.children[1];
    if (section?.kind !== "element" || !section.children || aside?.kind !== "element") throw new Error();
    const moved = section.children.shift()!;
    section.children.reverse();
    aside.children = [moved, {
      id: "inserted", kind: "element", name: "button", props: {},
      children: [{ id: "inserted-text", kind: "text", value: "New" }],
    }];

    const diff = classifyComposerPreviewDiff(before, parsed.model);
    expect(diff).toMatchObject({
      kind: "dom-patch",
      paths: ["0.0", "0.1"],
      patches: [{
        kind: "static-tree",
        boundaries: [{ path: "0.0" }, { path: "0.1" }],
      }],
    });
  });

  it("keeps list conversion and item creation on the static lane", async () => {
    const parsed = await parseAstro('<ul><li>One</li><li>Two</li></ul>');
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable Astro");
    const before = structuredClone(parsed.model);

    expect(convertElementListAtPath(parsed.model, "0", "ordered").ok).toBe(true);
    expect(addElementListItemAtPath(parsed.model, "0").ok).toBe(true);
    expect(classifyComposerPreviewDiff(before, parsed.model)).toMatchObject({
      kind: "dom-patch",
      patches: expect.arrayContaining([
        expect.objectContaining({
          kind: "properties",
          path: "0",
          tagName: "ol",
          attributes: expect.objectContaining({
            style: "list-style: decimal outside none; padding-inline-start: 1.5em",
          }),
        }),
      ]),
    });
  });

  it("patches list-disc removal together with list-style: none", async () => {
    const parsed = await parseAstro('<ul class="list-disc space-y-2"><li>One</li></ul>');
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable Astro");
    const before = structuredClone(parsed.model);
    expect(applyElementListStyleAtPath(parsed.model, "0", { type: "none" }).ok).toBe(true);
    expect(classifyComposerPreviewDiff(before, parsed.model)).toMatchObject({
      kind: "dom-patch",
      patches: expect.arrayContaining([
        expect.objectContaining({
          kind: "properties",
          path: "0",
          attributes: {
            class: "space-y-2",
            style: "list-style: none",
          },
        }),
      ]),
    });
  });

  it("patches none-to-circle as shorthand plus outside indent", async () => {
    const parsed = await parseAstro('<ul style="list-style: none"><li>One</li></ul>');
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable Astro");
    const before = structuredClone(parsed.model);
    expect(applyElementListStyleAtPath(parsed.model, "0", { type: "circle" }).ok).toBe(true);
    expect(classifyComposerPreviewDiff(before, parsed.model)).toMatchObject({
      kind: "dom-patch",
      patches: expect.arrayContaining([
        expect.objectContaining({
          kind: "properties",
          path: "0",
          attributes: {
            style: "list-style: circle outside none; padding-inline-start: 1.5em",
          },
        }),
      ]),
    });
  });

  it("keeps navigation item creation on the static lane", async () => {
    const parsed = await parseAstro('<nav><ul><li><a href="/">Item 1</a></li></ul></nav>');
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable Astro");
    const before = structuredClone(parsed.model);

    expect(addNavigationItemAtPath(parsed.model, "0").ok).toBe(true);
    expect(classifyComposerPreviewDiff(before, parsed.model)).toMatchObject({
      kind: "dom-patch",
      paths: ["0.0"],
      patches: [{ kind: "static-tree", boundaries: [{ path: "0.0" }] }],
    });
  });

  it("allows unchanged dynamic siblings only as opaque anchors", async () => {
    const parsed = await parseAstro(`---\nimport Card from "../components/Card.astro";\n---\n<main><Card title="A" /><p>After</p></main>`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable Astro");
    const before = structuredClone(parsed.model);
    const main = parsed.model.nodes[0];
    if (main?.kind !== "element" || !main.children) throw new Error();
    main.children.push({ id: "static", kind: "element", name: "hr", props: {}, children: [] });

    expect(classifyComposerPreviewDiff(before, parsed.model)).toMatchObject({
      kind: "dom-patch",
      patches: [{
        kind: "static-tree",
        boundaries: [{
          path: "0",
          before: expect.arrayContaining([expect.objectContaining({ kind: "opaque" })]),
          after: expect.arrayContaining([expect.objectContaining({ kind: "opaque" })]),
        }],
      }],
    });

    const changed = structuredClone(before);
    const changedMain = changed.nodes[0];
    if (changedMain?.kind !== "element" || changedMain.children?.[0]?.kind !== "component") throw new Error();
    changedMain.children[0].props.title = { type: "string", value: "B" };
    expect(classifyComposerPreviewDiff(before, changed).kind).toBe("server-reconcile");
  });

  it("fails closed for custom, dynamic-property, and protected runtime elements", async () => {
    const cases = [
      '<my-widget title="A"><span>Before</span></my-widget>',
      '<div class={active}>Before</div>',
      '<div><style>.before { color: red; }</style></div>',
    ];
    for (const source of cases) {
      const parsed = await parseAstro(source);
      expect(parsed.editable).toBe(true);
      if (!parsed.editable) throw new Error("expected editable Astro");
      const before = structuredClone(parsed.model);
      const root = parsed.model.nodes[0];
      if (!root) throw new Error();
      if ((root.kind === "element" || root.kind === "component")) {
        const protectedChild = root.kind === "element" ? root.children?.[0] : null;
        if (protectedChild?.kind === "element" && protectedChild.name === "style") {
          protectedChild.props.media = { type: "string", value: "screen" };
        } else if (protectedChild?.kind === "raw") {
          protectedChild.inner += " .after { color: blue; }";
        } else {
          root.props.title = { type: "string", value: "changed" };
        }
      } else {
        throw new Error(`unexpected parsed root: ${root.kind}`);
      }
      expect(classifyComposerPreviewDiff(before, parsed.model).kind, source).toBe("server-reconcile");
    }
  });
});
