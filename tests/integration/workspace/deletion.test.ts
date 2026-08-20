import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCollections, writeCollections } from "@electron/collections";
import { deleteComponent, deletePage } from "@electron/workspace";

describe("workspace usage-aware deletion", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-workspace-delete-"));
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "site" }));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("blocks deleting a component imported by another source file", () => {
    const component = path.join(root, "src", "components", "Card.astro");
    const page = path.join(root, "src", "pages", "index.astro");
    fs.writeFileSync(component, "<article><slot /></article>\n");
    fs.writeFileSync(page, '---\nimport Card from "../components/Card.astro";\n---\n<Card />\n');

    expect(() => deleteComponent(root, "src/components/Card.astro")).toThrow(
      /COMPONENT_IN_USE.*src\/pages\/index\.astro:2/,
    );
    expect(fs.existsSync(component)).toBe(true);
  });

  it("blocks deleting a page assigned to a CMS collection", () => {
    const page = path.join(root, "src", "pages", "blog", "index.astro");
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(page, "<h1>Blog</h1>\n");
    writeCollections(root, {
      collections: [{
        id: "blog",
        name: "blog",
        label: "Blog",
        kind: "content",
        urlPattern: "/blog/{slug}",
        listPageFile: "src/pages/blog/index.astro",
        templatePageFile: null,
      }],
    });

    expect(() => deletePage(root, "src/pages/blog/index.astro")).toThrow(
      /PAGE_IN_USE.*Blog list page/,
    );
    expect(fs.existsSync(page)).toBe(true);
  });

  it("unassigns a confirmed CMS page before deleting it", () => {
    const page = path.join(root, "src", "pages", "blog", "index.astro");
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(page, "<h1>Blog</h1>\n");
    writeCollections(root, {
      collections: [{
        id: "blog",
        name: "blog",
        label: "Blog",
        kind: "content",
        urlPattern: "/blog/{slug}",
        listPageFile: "src/pages/blog/index.astro",
        templatePageFile: "src/pages/blog/[...id].astro",
      }],
    });

    expect(
      deletePage(root, "src/pages/blog/index.astro", { unassignCms: true }),
    ).toEqual({ ok: true });

    expect(fs.existsSync(page)).toBe(false);
    expect(readCollections(root).collections[0]).toMatchObject({
      listPageFile: null,
      templatePageFile: "src/pages/blog/[...id].astro",
    });
  });
});
