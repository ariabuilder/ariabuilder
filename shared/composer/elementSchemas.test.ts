import { describe, expect, it } from "vitest";
import { canContainTag, VOID_TAGS } from "./elementSchemas";
import { chooseImportPath, importPathsFor } from "./importPath";
import { parseAstro } from "./parseAstro";
import { serializeAstro } from "./serializeAstro";
import {
  insertComponentAt,
  insertElementAt,
  resolveInsertTarget,
} from "./mutate";

describe("canContainTag", () => {
  it("blocks flow content inside paragraphs and headings", () => {
    expect(canContainTag("p", "div")).toBe(false);
    expect(canContainTag("h1", "section")).toBe(false);
    expect(canContainTag("p", "span")).toBe(true);
    expect(canContainTag("h2", "a")).toBe(true);
  });

  it("enforces list and void rules", () => {
    expect(canContainTag("ul", "li")).toBe(true);
    expect(canContainTag("ul", "div")).toBe(false);
    expect(canContainTag("img", "span")).toBe(false);
    expect(VOID_TAGS.has("img")).toBe(true);
  });

  it("treats page root as flow content (no bare li)", () => {
    expect(canContainTag(null, "li")).toBe(false);
    expect(canContainTag(null, "div")).toBe(true);
    expect(canContainTag("", "td")).toBe(false);
  });
});

describe("importPathsFor + chooseImportPath", () => {
  it("computes relative imports from page to component", () => {
    const paths = importPathsFor(
      "src/pages/index.astro",
      "src/components/Card.astro",
    );
    expect(paths.relative).toBe("../components/Card.astro");
    expect(paths.srcRelative).toBe("components/Card.astro");
  });

  it("reuses alias style when the page already uses one", async () => {
    const parsed = await parseAstro(`---
import Hero from '@/components/Hero.astro';
---
<section></section>
`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const paths = importPathsFor(
      "src/pages/index.astro",
      "src/components/Card.astro",
    );
    expect(chooseImportPath(parsed.model, paths)).toBe(
      "@/components/Card.astro",
    );
  });
});

describe("insert component + element", () => {
  it("adds an import line and serializes a clean component", async () => {
    const parsed = await parseAstro(`---
---
<main></main>
`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const model = parsed.model;
    const target = resolveInsertTarget(model, "0", null);
    const result = insertComponentAt(
      model,
      { name: "Card", importPath: "../components/Card.astro" },
      target,
    );
    expect(result.ok).toBe(true);
    expect(model.imports).toEqual([
      { name: "Card", path: "../components/Card.astro" },
    ]);
    const out = serializeAstro(model);
    expect(out).toContain("import Card from '../components/Card.astro';");
    expect(out).toContain("<Card />");
    expect(out).not.toContain("data-aria-");
  });

  it("inserts void img without children and li inside ul by default", async () => {
    const parsed = await parseAstro(`---
---
<section></section>
`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    insertElementAt(parsed.model, "img", { parentPath: "0", index: 0 });
    insertElementAt(parsed.model, "ul", { parentPath: "0", index: 1 });
    const out = serializeAstro(parsed.model);
    expect(out).toMatch(/<img\s*\/>/);
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>");
  });

  it("refuses to nest a div inside a paragraph via resolveInsertTarget", async () => {
    const parsed = await parseAstro(`---
---
<p>Hi</p>
`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const target = resolveInsertTarget(parsed.model, "0", "div");
    // Sibling after the paragraph, not inside it.
    expect(target).toEqual({ parentPath: null, index: 1 });
  });

  it("refuses bare li at page root", async () => {
    const parsed = await parseAstro(`---
---
<section></section>
`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const refused = insertElementAt(parsed.model, "li", {
      parentPath: null,
      index: 1,
    });
    expect(refused.ok).toBe(false);
    insertElementAt(parsed.model, "ul", { parentPath: null, index: 1 });
    const ulPath = "1";
    const ok = insertElementAt(parsed.model, "li", {
      parentPath: ulPath,
      index: 0,
    });
    // createElementNode("ul") already seeds one <li>; inserting another is fine.
    expect(ok.ok).toBe(true);
  });

  it("inserts into a ternary branch via .t parent path", async () => {
    const parsed = await parseAstro(`---
const on = true;
---
{on ? <span>A</span> : <span>B</span>}
`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const result = insertElementAt(parsed.model, "em", {
      parentPath: "0.t",
      index: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.selectPath).toBe("0.t.1");
    const out = serializeAstro(parsed.model);
    expect(out).toContain("<em>");
    expect(out).not.toContain("data-aria-");
  });

  it("defaults full-html inserts into body, not document root", async () => {
    const parsed = await parseAstro(`---
---
<html>
  <head></head>
  <body>
    <p>Hi</p>
  </body>
</html>
`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const model = parsed.model;
    const htmlIndex = model.nodes.findIndex(
      (n) => n.kind === "element" && n.name.toLowerCase() === "html",
    );
    expect(htmlIndex).toBeGreaterThanOrEqual(0);
    const html = model.nodes[htmlIndex]!;
    expect(html.kind).toBe("element");
    if (html.kind !== "element") return;
    const bodyIndex = html.children?.findIndex(
      (n) => n.kind === "element" && n.name.toLowerCase() === "body",
    ) ?? -1;
    expect(bodyIndex).toBeGreaterThanOrEqual(0);
    const bodyPath = `${htmlIndex}.${bodyIndex}`;

    expect(resolveInsertTarget(model, null, "progress")).toEqual({
      parentPath: bodyPath,
      index: 1,
    });
    expect(resolveInsertTarget(model, String(htmlIndex), "h1")).toEqual({
      parentPath: bodyPath,
      index: 1,
    });
    const doctypeIndex = model.nodes.findIndex((n) => n.kind === "doctype");
    if (doctypeIndex >= 0) {
      expect(resolveInsertTarget(model, String(doctypeIndex), "div")).toEqual({
        parentPath: bodyPath,
        index: 1,
      });
    }

    // Body child still inserts after that child inside body.
    const pPath = `${bodyPath}.0`;
    expect(resolveInsertTarget(model, pPath, "div")).toEqual({
      parentPath: bodyPath,
      index: 1,
    });

    const inserted = insertElementAt(
      model,
      "progress",
      resolveInsertTarget(model, null, "progress"),
    );
    expect(inserted.ok).toBe(true);
    expect(inserted.selectPath?.startsWith(`${bodyPath}.`)).toBe(true);
    expect(model.nodes.some((n) => n.kind === "element" && n.name === "progress")).toBe(
      false,
    );
  });

  it("keeps fragment-page root append when there is no html shell", async () => {
    const parsed = await parseAstro(`---
---
<main></main>
`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    expect(resolveInsertTarget(parsed.model, null, "div")).toEqual({
      parentPath: null,
      index: 1,
    });
  });

  it("defaults layout-page inserts into the layout, not after it", async () => {
    const parsed = await parseAstro(`---
import BaseLayout from "../layouts/BaseLayout.astro";
---
<BaseLayout title="Page not found">
  <main>
    <h1>404</h1>
  </main>
</BaseLayout>
`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const model = parsed.model;
    const layoutPath = "0";
    expect(model.nodes[0]?.kind).toBe("component");

    // No selection → append as last child of the layout (slot content),
    // not as a sibling after </BaseLayout> (which paints below the footer).
    expect(resolveInsertTarget(model, null, "section")).toEqual({
      parentPath: layoutPath,
      index: 1,
    });

    const inserted = insertElementAt(
      model,
      "section",
      resolveInsertTarget(model, null, "section"),
    );
    expect(inserted.ok).toBe(true);
    expect(inserted.selectPath).toBe(`${layoutPath}.1`);
    expect(model.nodes).toHaveLength(1);
    const layout = model.nodes[0]!;
    expect(layout.kind).toBe("component");
    if (layout.kind !== "component") return;
    expect(layout.children?.some((n) => n.kind === "element" && n.name === "section")).toBe(
      true,
    );
  });
});
