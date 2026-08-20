import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createComponent, createLayout, createPage } from "@electron/workspace";

describe("createComponent", () => {
  it("creates an empty Astro fragment without importing project styles", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aria-create-component-"));
    mkdirSync(path.join(root, "src/styles"), { recursive: true });
    writeFileSync(path.join(root, "src/styles/global.css"), "body { color: red; }");

    const result = createComponent(root, "marketing/Hero");
    expect(result.file).toBe("src/components/marketing/Hero.astro");
    const source = readFileSync(path.join(root, result.file), "utf8");
    expect(source).toBe("---\n---\n");
    expect(source).not.toContain("global.css");
    expect(source).not.toContain("<div");
  });

  it("rejects duplicate component paths", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aria-create-component-"));
    createComponent(root, "Hero");
    expect(() => createComponent(root, "Hero.astro")).toThrow(/already exists/i);
  });
});

describe("createLayout", () => {
  it("creates a full Astro shell with one default slot", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aria-create-layout-"));
    const result = createLayout(root, "marketing/BaseLayout");
    expect(result.file).toBe("src/layouts/marketing/BaseLayout.astro");
    const source = readFileSync(path.join(root, result.file), "utf8");
    expect(source).toContain("<!doctype html>");
    expect(source).toContain('<meta charset="utf-8" />');
    expect(source.match(/<slot\s*\/>/g)).toHaveLength(1);
  });

  it("rejects duplicate layout paths", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aria-create-layout-"));
    createLayout(root, "Base");
    expect(() => createLayout(root, "Base.astro")).toThrow(/already exists/i);
  });
});

describe("createPage with layout", () => {
  it("wraps the initial scaffold and generates a relative layout import", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aria-create-page-layout-"));
    const layout = createLayout(root, "shells/BaseLayout");
    const page = createPage(root, "marketing/about", {
      layout: { name: layout.name, file: layout.file },
    });
    const source = readFileSync(path.join(root, page.file), "utf8");
    expect(source).toContain("import BaseLayout from '../../layouts/shells/BaseLayout.astro';");
    expect(source).toContain("<BaseLayout>");
    expect(source).toContain('data-aria-type="Section"');
    expect(source).not.toContain("<html");
  });

  it("seeds serializable layout props and still rejects opaque required values", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aria-create-page-layout-"));
    const layout = createLayout(root, "BaseLayout");
    writeFileSync(
      path.join(root, layout.file),
      `---\ninterface Props {\n  theme: "light" | "dark";\n  title: string;\n}\nconst { theme, title } = Astro.props;\n---\n<html><body><slot /></body></html>\n`,
    );
    const seeded = createPage(root, "missing", {
      layout: { name: layout.name, file: layout.file },
    });
    const seededSource = readFileSync(path.join(root, seeded.file), "utf8");
    expect(seededSource).toContain('title="Missing"');
    expect(seededSource).toContain('theme="light"');

    writeFileSync(
      path.join(root, layout.file),
      `---\ninterface Props {\n  config: Record<string, unknown>;\n}\nconst { config } = Astro.props;\n---\n<html><body><slot /></body></html>\n`,
    );
    expect(() =>
      createPage(root, "opaque", {
        layout: { name: layout.name, file: layout.file },
      }),
    ).toThrow(/config/i);
  });

  it("seeds pubDate for CollectionEntry blog layouts", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aria-create-page-blogpost-"));
    mkdirSync(path.join(root, "src/layouts"), { recursive: true });
    writeFileSync(
      path.join(root, "src/layouts/BlogPost.astro"),
      `---
import type { CollectionEntry } from 'astro:content';
type Props = CollectionEntry<'blog'>['data'];
const { title, description, pubDate, updatedDate, heroImage } = Astro.props;
---
<html>
  <body>
    {heroImage && <img src={heroImage} alt="" />}
    <time datetime={pubDate.toISOString()}>{title}</time>
    {updatedDate && <time>{updatedDate.toISOString()}</time>}
    <p>{description}</p>
    <slot />
  </body>
</html>
`,
    );
    const page = createPage(root, "test", {
      layout: { name: "BlogPost", file: "src/layouts/BlogPost.astro" },
    });
    const source = readFileSync(path.join(root, page.file), "utf8");
    expect(source).toContain('title="Test"');
    expect(source).toContain('description="Test"');
    expect(source).toMatch(/pubDate=\{new Date\("/);
    expect(source).not.toContain("updatedDate=");
    expect(source).not.toContain("heroImage=");
  });
});
