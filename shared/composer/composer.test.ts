import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ARIA_MARKER_END,
  ARIA_MARKER_START,
  BAIL_TAXONOMY,
  COMPOSER_SOT_POLICY,
  OPAQUE_NOT_BAIL,
  extractPropSchema,
  parseAstro,
  serializeAstro,
  serializeAstroMarked,
} from "./index";
import { resolveRawChunks } from "./rawChunks";
import type { EditableNode } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(here, "fixtures");

function readFixture(...parts: string[]): string {
  return fs.readFileSync(path.join(fixturesRoot, ...parts), "utf8");
}

function collectKinds(nodes: EditableNode[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    out.add(n.kind);
    if (n.kind === "map" || n.kind === "fragment") {
      collectKinds(n.children, out);
    } else if (n.kind === "conditional") {
      collectKinds(n.consequent, out);
      if (n.alternate) collectKinds(n.alternate, out);
    } else if (
      (n.kind === "element" || n.kind === "component" || n.kind === "slot") &&
      Array.isArray(n.children)
    ) {
      collectKinds(n.children, out);
    }
  }
  return out;
}

function collectIds(nodes: EditableNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    out.push(node.id);
    if (node.kind === "map" || node.kind === "fragment") {
      collectIds(node.children, out);
    } else if (node.kind === "conditional") {
      collectIds(node.consequent, out);
      if (node.alternate) collectIds(node.alternate, out);
    } else if (
      (node.kind === "element" || node.kind === "component" || node.kind === "slot") &&
      Array.isArray(node.children)
    ) {
      collectIds(node.children, out);
    }
  }
  return out;
}

describe("COMPOSER_SOT_POLICY", () => {
  it("rejects JSON DSL sidecar as SoT", () => {
    expect(COMPOSER_SOT_POLICY.documentSot).toBe(".astro on disk");
    expect(COMPOSER_SOT_POLICY.rejectedSidecar).toBe(".aria/composer/*.json");
  });
});

describe("bail taxonomy", () => {
  it("documents all bail codes", () => {
    expect(Object.keys(BAIL_TAXONOMY).sort()).toEqual(
      ["compiler_error", "markdown_mdx", "parse_exception", "unsafe_rewrite"].sort(),
    );
    expect(OPAQUE_NOT_BAIL.length).toBeGreaterThan(3);
  });

  it("bails markdown/mdx by filename policy", async () => {
    const source = readFixture("synthetic", "bail.mdx");
    const result = await parseAstro(source, { filename: "posts/hello.mdx" });
    expect(result.editable).toBe(false);
    if (!result.editable) {
      expect(result.bail.code).toBe("markdown_mdx");
      expect(result.source).toBe(source);
    }
  });
});

describe("parseAstro + serializeAstro round-trip", () => {
  const cases = [
    "synthetic/nested-layout.astro",
    "synthetic/props-slots.astro",
    "synthetic/expressions.astro",
    "synthetic/directives-fragment.astro",
    "starters/blog-index.astro",
    "starters/portfolio.astro",
    "starters/ecommerce.astro",
    "starters/docs-page.astro",
  ];

  for (const rel of cases) {
    it(`parses and re-serializes ${rel}`, async () => {
      const source = readFixture(...rel.split("/"));
      const first = await parseAstro(source, { filename: rel });
      expect(first.editable, `${rel} should be editable`).toBe(true);
      if (!first.editable) return;

      const serialized = serializeAstro(first.model);
      expect(serialized).toContain("---");
      expect(serialized).not.toContain(ARIA_MARKER_START);
      expect(serialized).not.toContain(ARIA_MARKER_END);

      const second = await parseAstro(serialized, { filename: rel });
      expect(second.editable).toBe(true);
      if (!second.editable) return;

      // Stable printer: second serialize matches first serialize (semantic lock).
      expect(serializeAstro(second.model)).toBe(serialized);
    });
  }

  it("keeps a paragraph with an inline image in a stable inline run", async () => {
    const source = `---
---
<p>With years of experience <img src="/src/assets/images/photo.webp" alt="" /> unique features.</p>
`;
    const first = await parseAstro(source, { filename: "src/pages/index.astro" });
    expect(first.editable).toBe(true);
    if (!first.editable) return;

    const serialized = serializeAstro(first.model);
    expect(serialized).toContain(
      '<p>With years of experience <img src="/src/assets/images/photo.webp" alt="" /> unique features.</p>',
    );
    expect(serialized).not.toMatch(/<p>\s*\n/);

    const second = await parseAstro(serialized, { filename: "src/pages/index.astro" });
    expect(second.editable).toBe(true);
    if (!second.editable) return;
    expect(serializeAstro(second.model)).toBe(serialized);
  });

  it("models nested layout, components, and text", async () => {
    const result = await parseAstro(readFixture("synthetic", "nested-layout.astro"));
    expect(result.editable).toBe(true);
    if (!result.editable) return;
    const kinds = collectKinds(result.model.nodes);
    expect(kinds.has("component")).toBe(true);
    expect(kinds.has("element")).toBe(true);
    expect(kinds.has("text")).toBe(true);
    expect(result.model.imports.map((i) => i.name).sort()).toEqual([
      "Card",
      "Layout",
    ]);
    expect(result.model.nodes.some((n) => n.id === "layout")).toBe(true);
  });

  it("keeps exact source and exposes CodeMirror UTF-16 node ranges", async () => {
    const source = `---\nconst greeting = "héllo";\n---\n<section><p>👋 café</p></section>`;
    const result = await parseAstro(source, { filename: "src/pages/index.astro" });
    expect(result.editable).toBe(true);
    if (!result.editable) return;

    expect(result.source).toBe(source);
    const section = result.model.nodes[0]!;
    expect(source.slice(section.sourceRange?.from, section.sourceRange?.to)).toBe(
      "<section><p>👋 café</p></section>",
    );
    if (section.kind !== "element" || !section.children) return;
    const paragraph = section.children[0]!;
    expect(source.slice(paragraph.sourceRange?.from, paragraph.sourceRange?.to)).toBe(
      "<p>👋 café</p>",
    );
  });

  it("isolates node IDs and UTF-16 ranges across concurrent parses", async () => {
    const firstSource = `---\nconst greeting = "héllø 👋";\n---\n<section><p>Crème brûlée</p><p>Après</p></section>`;
    const secondSource = `<main><article>ASCII only</article></main>`;
    const [first, second] = await Promise.all([
      parseAstro(firstSource),
      parseAstro(secondSource),
    ]);

    expect(first.editable).toBe(true);
    expect(second.editable).toBe(true);
    if (!first.editable || !second.editable) return;

    const firstRoot = first.model.nodes[0]!;
    const secondRoot = second.model.nodes[0]!;
    expect(firstSource.slice(firstRoot.sourceRange?.from, firstRoot.sourceRange?.to))
      .toBe("<section><p>Crème brûlée</p><p>Après</p></section>");
    expect(secondSource.slice(secondRoot.sourceRange?.from, secondRoot.sourceRange?.to))
      .toBe(secondSource);

    for (const model of [first.model, second.model]) {
      const ids = collectIds(model.nodes);
      expect(ids).toContain("n1");
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("structures map and conditional expressions", async () => {
    const result = await parseAstro(readFixture("synthetic", "expressions.astro"));
    expect(result.editable).toBe(true);
    if (!result.editable) return;
    const kinds = collectKinds(result.model.nodes);
    expect(kinds.has("map")).toBe(true);
    expect(kinds.has("conditional")).toBe(true);
  });

  it("preserves class:list, set:*, client directives, fragments, comments, style", async () => {
    const result = await parseAstro(
      readFixture("synthetic", "directives-fragment.astro"),
    );
    expect(result.editable).toBe(true);
    if (!result.editable) return;
    const kinds = collectKinds(result.model.nodes);
    expect(kinds.has("fragment")).toBe(true);
    expect(kinds.has("comment")).toBe(true);
    expect(kinds.has("raw")).toBe(true);

    const serialized = serializeAstro(result.model);
    expect(serialized).toContain("class:list=");
    expect(serialized).toContain("set:text=");
    expect(serialized).toContain("set:html=");
    expect(serialized).toContain("client:load");
    expect(serialized).toMatch(/<!--\s*note\s*-->/);
    expect(serialized).toContain("<style>");
  });
});

describe("serializeAstroMarked", () => {
  it("emits aria markers and never used for disk Sot", async () => {
    const result = await parseAstro(readFixture("synthetic", "nested-layout.astro"));
    expect(result.editable).toBe(true);
    if (!result.editable) return;

    const marked = serializeAstroMarked(result.model, "Card.astro|");
    expect(marked).toContain(`${ARIA_MARKER_START}="Card.astro|0"`);
    expect(marked).toContain(`${ARIA_MARKER_END}="Card.astro|0"`);
    expect(marked).toMatch(/data-aria-s="/);
    expect(marked).not.toMatch(/data-avb-/);

    const clean = serializeAstro(result.model);
    expect(clean).not.toContain("data-aria-");
  });

  it("preserves the newline between a line comment and a map callback", async () => {
    const result = await parseAstro(`---
const items = [{ title: "One" }];
---
{
  // Render every item
  items.map((item) => <p>{item.title}</p>)
}
`);
    expect(result.editable).toBe(true);
    if (!result.editable) return;

    const marked = serializeAstroMarked(result.model);
    expect(marked).toMatch(/\/\/ Render every item\n\s*items\.map\(/);
    expect(marked).not.toContain("// Render every item items.map(");

    const reparsed = await parseAstro(marked);
    expect(reparsed.editable).toBe(true);
  });

  it("marks inline links and expressions without changing phrasing whitespace", async () => {
    const result = await parseAstro(`---
const amount = "132K";
---
<p> Read <a href="/blog">Blog</a> {amount} </p>
`);
    expect(result.editable).toBe(true);
    if (!result.editable) return;

    const clean = serializeAstro(result.model);
    const marked = serializeAstroMarked(result.model, "Stats.astro|");
    expect(marked).toContain(`${ARIA_MARKER_START}="Stats.astro|0.1"`);
    expect(marked).not.toContain(`${ARIA_MARKER_START}="Stats.astro|0.1.0"`);
    expect(marked).toContain(`${ARIA_MARKER_START}="Stats.astro|0.3"`);

    const marker = /<template data-aria-[se]="[^"]+"><\/template>/g;
    const cleanInline = clean.match(/<p>([\s\S]*?)<\/p>/)?.[1];
    const markedInline = marked.match(/<p>([\s\S]*?)<\/p>/)?.[1];
    expect(markedInline?.replace(marker, "")).toBe(cleanInline);

    const reparsed = await parseAstro(marked);
    expect(reparsed.editable).toBe(true);
  });
});

describe("extractPropSchema", () => {
  it("reads interface Props and Astro.props defaults", () => {
    const source = readFixture("synthetic", "props-slots.astro");
    const schema = extractPropSchema(source);
    const byName = Object.fromEntries(schema.fields.map((f) => [f.name, f]));
    expect(byName.title?.type).toBe("string");
    expect(byName.title?.optional).toBe(false);
    expect(byName.count?.type).toBe("number");
    expect(byName.count?.default).toBe(1);
    expect(byName.variant?.type).toBe("enum");
    expect(byName.variant?.options).toEqual(["primary", "secondary"]);
    expect(byName.open?.default).toBe(false);
    expect(schema.slots).toEqual(["default", "footer"]);
    expect(schema.hasRest).toBe(false);
  });

  it("detects ...rest on Astro.props", () => {
    const schema = extractPropSchema(`---
interface Props { title: string }
const { title, ...rest } = Astro.props;
---
<div {...rest}>{title}</div>
`);
    expect(schema.hasRest).toBe(true);
    expect(schema.fields.some((f) => f.name === "title")).toBe(true);
  });

  it("treats CollectionEntry layout destructure as required except truthy-guarded fields", () => {
    const schema = extractPropSchema(`---
import type { CollectionEntry } from 'astro:content';
import FormattedDate from '../components/FormattedDate.astro';
type Props = CollectionEntry<'blog'>['data'];
const { title, description, pubDate, updatedDate, heroImage } = Astro.props;
---
<html>
  <body>
    {heroImage && <img src={heroImage} alt="" />}
    <FormattedDate date={pubDate} />
    {updatedDate && <FormattedDate date={updatedDate} />}
    <h1>{title}</h1>
    <p>{description}</p>
    <slot />
  </body>
</html>
`);
    const byName = Object.fromEntries(schema.fields.map((field) => [field.name, field]));
    expect(byName.title).toMatchObject({ type: "string", optional: false });
    expect(byName.description).toMatchObject({ type: "string", optional: false });
    expect(byName.pubDate).toMatchObject({ type: "date", optional: false });
    expect(byName.updatedDate).toMatchObject({ type: "date", optional: true });
    expect(byName.heroImage).toMatchObject({ optional: true });
  });
});

describe("resolveRawChunks", () => {
  it("attaches HTML ?raw chunk children when resolvable", async () => {
    const pagePath = path.join(fixturesRoot, "synthetic", "raw-chunk.astro");
    const source = fs.readFileSync(pagePath, "utf8");
    const result = await parseAstro(source);
    expect(result.editable).toBe(true);
    if (!result.editable) return;

    await resolveRawChunks(result.model, pagePath);
    const frag = result.model.nodes.find(
      (n) =>
        (n.kind === "fragment" || n.kind === "component") &&
        n.props["set:html"],
    );
    expect(frag).toBeTruthy();
    if (frag && (frag.kind === "fragment" || frag.kind === "component")) {
      expect(frag.chunkFile).toBeTruthy();
      expect(Array.isArray(frag.children) && frag.children.length > 0).toBe(
        true,
      );
      // Disk serialize must keep Fragment self-closing — never inline chunk DOM.
      const disk = serializeAstro(result.model);
      expect(disk).toMatch(/<Fragment\s+set:html=\{hero\}\s*\/>/);
      expect(disk).not.toContain("Chunk hero");
      const marked = serializeAstroMarked(result.model);
      expect(marked).toMatch(/<Fragment\s+set:html=\{hero\}\s*\/>/);
      expect(marked).not.toContain("Chunk hero");
    }
  });
});

describe("corpus coverage gate", () => {
  it("tracks editable + stable round-trip rates across fixture corpus", async () => {
    const files: string[] = [];
    for (const dir of ["synthetic", "starters"] as const) {
      const abs = path.join(fixturesRoot, dir);
      for (const name of fs.readdirSync(abs)) {
        if (name.endsWith(".astro") || name.endsWith(".mdx") || name.endsWith(".md")) {
          files.push(path.join(dir, name));
        }
      }
    }

    let editable = 0;
    let roundTrip = 0;
    const bails: Array<{ file: string; code: string }> = [];

    for (const rel of files) {
      const source = readFixture(...rel.split("/"));
      const filename = rel;
      const parsed = await parseAstro(source, { filename });
      if (!parsed.editable) {
        bails.push({ file: rel, code: parsed.bail.code });
        continue;
      }
      editable += 1;
      const once = serializeAstro(parsed.model);
      const again = await parseAstro(once, { filename });
      if (again.editable && serializeAstro(again.model) === once) {
        roundTrip += 1;
      }
    }

    const editableRate = editable / files.length;
    const roundTripRate = roundTrip / files.length;

    // Vast majority of starter/synthetic .astro pages editable; mdx is expected bail.
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(editableRate).toBeGreaterThanOrEqual(0.85);
    expect(roundTripRate).toBeGreaterThanOrEqual(0.85);
    expect(bails.every((b) => b.code === "markdown_mdx")).toBe(true);
  });
});
