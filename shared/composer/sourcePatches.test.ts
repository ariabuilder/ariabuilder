import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { setPropAtPath, setTextAtPath } from "./mutate";
import { patchComposerModelSource } from "./sourcePatches";
import { ensureTranslationContext } from "./translationBindings";
import {
  bindCmsTextAtPath,
  unbindCmsTextAtPath,
  upsertCmsCollectionQuery,
} from "./cmsBindings";

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("patchComposerModelSource", () => {
  it("patches a nested visual edit while preserving unrelated formatting", async () => {
    const source = `---\nconst untouched =  true\n---\n<section   data-note='keep'><p class="old">Hello</p></section>\n`;
    const parsed = await parseAstro(source);
    if (!parsed.editable) throw new Error(parsed.reason);
    const next = clone(parsed.model);
    expect(setTextAtPath(next, "0.0.0", "Welcome").ok).toBe(true);
    const patched = patchComposerModelSource(source, parsed.model, next);
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.source).toContain("const untouched =  true");
    expect(patched.source).toContain("<section   data-note='keep'>");
    expect(patched.source).toContain("<p class=\"old\">Welcome</p>");
  });

  it("rebases text ranges across consecutive shorter replacements", async () => {
    let source = `<section><p>Builder</p><ul><li>Keep</li></ul></section>`;
    const parsed = await parseAstro(source);
    if (!parsed.editable) throw new Error(parsed.reason);
    let current = parsed.model;

    for (const value of ["Builde", "Build", "Buil", "Built"]) {
      const next = clone(current);
      expect(setTextAtPath(next, "0.0.0", value).ok).toBe(true);
      const patched = patchComposerModelSource(source, current, next);
      expect(patched.ok, patched.ok ? "" : patched.reason).toBe(true);
      if (!patched.ok) return;
      source = patched.source;
      current = next;
    }

    expect(source).toBe(
      `<section><p>Built</p><ul><li>Keep</li></ul></section>`,
    );
  });

  it("replaces only an indented CMS expression before an adjacent sibling", async () => {
    const beforeExpression = '{heroCopy?.data?.["heading"] ?? /* @aria-cms-fallback */ "Your Astro project, now visual."}';
    const afterExpression = '{heroCopy?.data?.["title"] ?? /* @aria-cms-fallback */ "Your Astro project, now visual."}';
    const source = `<section>
  <h1 class="hero__title reveal reveal--d1" id="hero-title">
    ${beforeExpression}
  </h1>
  <p class="hero__lede reveal reveal--d3">
    Build pages on a visual canvas.
  </p>
</section>`;
    const parsed = await parseAstro(source);
    if (!parsed.editable) throw new Error(parsed.reason);
    const section = parsed.model.nodes[0];
    const heading = section?.kind === "element" ? section.children?.[0] : null;
    const expression = heading?.kind === "element" ? heading.children?.[1] : null;
    expect(expression?.kind).toBe("expr");
    expect(expression?.sourceRange && source.slice(
      expression.sourceRange.from,
      expression.sourceRange.to,
    )).toBe(beforeExpression);

    const next = clone(parsed.model);
    expect(setTextAtPath(next, "0.0.1", afterExpression).ok).toBe(true);
    const patched = patchComposerModelSource(source, parsed.model, next);
    expect(patched.ok, patched.ok ? "" : patched.reason).toBe(true);
    if (!patched.ok) return;
    expect(patched.source).toBe(source.replace(beforeExpression, afterExpression));
    expect(patched.source).toContain("</h1>\n  <p class=\"hero__lede reveal reveal--d3\">");
  });

  it("keeps repeated CMS bind, rebind, and unbind patches inside the text node", async () => {
    let source = `<section>\n  <h1>Static heading</h1>\n  <p>Keep this sibling.</p>\n</section>`;
    const parsed = await parseAstro(source);
    if (!parsed.editable) throw new Error(parsed.reason);
    let current = parsed.model;

    const bind = clone(current);
    expect(bindCmsTextAtPath(bind, "0.0.0", {
      contextVariable: "heroCopy",
      field: "heading",
    }).ok).toBe(true);
    const firstPatch = patchComposerModelSource(source, current, bind);
    expect(firstPatch.ok, firstPatch.ok ? "" : firstPatch.reason).toBe(true);
    if (!firstPatch.ok) return;
    source = firstPatch.source;
    current = bind;

    const rebind = clone(current);
    expect(setTextAtPath(
      rebind,
      "0.0.0",
      '{heroCopy?.data?.["title"] ?? /* @aria-cms-fallback */ "Static heading"}',
    ).ok).toBe(true);
    const secondPatch = patchComposerModelSource(source, current, rebind);
    expect(secondPatch.ok, secondPatch.ok ? "" : secondPatch.reason).toBe(true);
    if (!secondPatch.ok) return;
    source = secondPatch.source;
    current = rebind;

    const unbind = clone(current);
    expect(unbindCmsTextAtPath(unbind, "0.0.0").ok).toBe(true);
    const thirdPatch = patchComposerModelSource(source, current, unbind);
    expect(thirdPatch.ok, thirdPatch.ok ? "" : thirdPatch.reason).toBe(true);
    if (!thirdPatch.ok) return;
    expect(thirdPatch.source).toBe(
      `<section>\n  <h1>Static heading</h1>\n  <p>Keep this sibling.</p>\n</section>`,
    );
  });

  it("fails closed when an expression range includes adjacent markup", async () => {
    const source = `<section><h1>{heroCopy?.data?.["heading"]}</h1><p>Keep</p></section>`;
    const parsed = await parseAstro(source);
    if (!parsed.editable) throw new Error(parsed.reason);
    const poisoned = clone(parsed.model);
    const heading = poisoned.nodes[0]?.kind === "element"
      && poisoned.nodes[0].children?.[0]?.kind === "element"
      ? poisoned.nodes[0].children[0].children?.[0]
      : null;
    if (!heading || heading.kind !== "expr" || !heading.sourceRange) {
      throw new Error("expression missing");
    }
    heading.sourceRange.to += "</h1><p>".length;
    const next = clone(poisoned);
    expect(setTextAtPath(next, "0.0.0", "{heroCopy?.data?.[\"title\"]}").ok).toBe(true);
    const patched = patchComposerModelSource(source, poisoned, next);
    expect(patched).toEqual({
      ok: false,
      reason: "The changed node has no safe source range.",
    });
  });

  it("keeps canvas text literal when it contains Astro syntax", async () => {
    const source = `<h1>Hello</h1>`;
    const parsed = await parseAstro(source);
    if (!parsed.editable) throw new Error(parsed.reason);

    for (const value of ["<b>bold</b>", "{name}", "A & B"]) {
      const next = clone(parsed.model);
      expect(setTextAtPath(next, "0.0", value).ok).toBe(true);
      const patched = patchComposerModelSource(source, parsed.model, next);
      expect(patched.ok, patched.ok ? "" : patched.reason).toBe(true);
      if (!patched.ok) continue;
      const reparsed = await parseAstro(patched.source);
      expect(reparsed.editable).toBe(true);
      if (!reparsed.editable) continue;
      const heading = reparsed.model.nodes[0];
      expect(heading?.kind).toBe("element");
      if (heading?.kind !== "element") continue;
      expect(heading.children).toHaveLength(1);
      expect(heading.children?.[0]).toMatchObject({ kind: "text", value });
    }
  });

  it("replaces only the selected element when its props change", async () => {
    const source = `<main>\n  <p class="old">Keep me</p>\n  <aside   data-x='exact'>Aside</aside>\n</main>`;
    const parsed = await parseAstro(source);
    if (!parsed.editable) throw new Error(parsed.reason);
    const next = clone(parsed.model);
    expect(setPropAtPath(next, "0.0", "class", { type: "string", value: "new" }).ok).toBe(true);
    const patched = patchComposerModelSource(source, parsed.model, next);
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.source).toContain('<p class="new">Keep me</p>');
    expect(patched.source).toContain("<aside   data-x='exact'>Aside</aside>");
  });

  it("keeps child and surrounding source exact across repeated prop edits", async () => {
    let source = `---\nconst untouched =  true\n---\n<section   data-note='keep'>\n  <!-- keep this comment -->\n  <Card title="Builder" data-config={{ width: 10 > 5 ? 2 : 1 }} />\n</section>\n`;
    const parsed = await parseAstro(source);
    if (!parsed.editable) throw new Error(parsed.reason);
    let current = parsed.model;

    for (const value of ["Builde", "Build", "Built"]) {
      const next = clone(current);
      expect(setPropAtPath(next, "0.1", "title", { type: "string", value }).ok).toBe(true);
      const patched = patchComposerModelSource(source, current, next);
      expect(patched.ok, patched.ok ? "" : patched.reason).toBe(true);
      if (!patched.ok) return;
      source = patched.source;
      current = next;
    }

    expect(source).toContain("const untouched =  true");
    expect(source).toContain("<section   data-note='keep'>");
    expect(source).toContain("  <!-- keep this comment -->");
    expect(source).toContain('title="Built"');
    expect(source).toContain('data-config={{ width: 10 > 5 ? 2 : 1 }}');
  });

  it("adds a component import without reformatting existing frontmatter", async () => {
    const source = `---\nconst exact =  true\n---\n<main></main>\n`;
    const parsed = await parseAstro(source);
    if (!parsed.editable) throw new Error(parsed.reason);
    const next = clone(parsed.model);
    next.imports.push({ name: "Card", path: "../components/Card.astro" });
    const patched = patchComposerModelSource(source, parsed.model, next);
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.source).toContain("const exact =  true");
    expect(patched.source).toContain("import Card from '../components/Card.astro';");
  });

  it("patches managed frontmatter without moving interleaved default imports", async () => {
    const source = `---\nconst exact =  true\n\nimport Card from '../Card.astro';\n\nconst tail = "keep";\n---\n<Card />\n`;
    const parsed = await parseAstro(source);
    if (!parsed.editable) throw new Error(parsed.reason);
    const next = clone(parsed.model);
    upsertCmsCollectionQuery(next, { id: "posts", collection: "blog" });
    const patched = patchComposerModelSource(source, parsed.model, next);
    expect(patched.ok, patched.ok ? "" : patched.reason).toBe(true);
    if (!patched.ok) return;
    expect(patched.source).toContain("const exact =  true");
    expect(patched.source).toContain("\nimport Card from '../Card.astro';\n");
    expect(patched.source).toContain('const tail = "keep";');
    expect(patched.source).toContain("@aria-cms-query:posts");
  });

  it("patches managed translation context additions in exact frontmatter", async () => {
    const source = `---\nconst exact =  true\n---\n<h1>Pricing</h1>\n`;
    const parsed = await parseAstro(source);
    if (!parsed.editable) throw new Error(parsed.reason);
    const next = clone(parsed.model);
    ensureTranslationContext(next, {
      catalogId: "catalog",
      importPath: "../i18n/catalog",
      catalogExportName: "translations",
      namespace: "pricing",
      locales: ["en", "fr"],
      defaultLocale: "en",
      resolver: { kind: "query-param", parameter: "lang" },
    });
    const patched = patchComposerModelSource(source, parsed.model, next);
    expect(patched.ok, patched.ok ? "" : patched.reason).toBe(true);
    if (!patched.ok) return;
    expect(patched.source).toContain("const exact =  true");
    expect(patched.source).toContain("@aria-translation-context:catalog:pricing");
  });

  it("removes managed frontmatter while preserving a default import in place", async () => {
    const source = `---\nimport { getCollection } from "astro:content";\n\nconst exact =  true\n\nimport Card from '../Card.astro';\n\n/* @aria-cms-query:posts */\nconst posts = await getCollection("blog");\n/* @aria-cms-query-end:posts */\n---\n<Card />\n`;
    const parsed = await parseAstro(source);
    if (!parsed.editable) throw new Error(parsed.reason);
    const next = clone(parsed.model);
    next.extraFrontmatter = "const exact =  true";
    const patched = patchComposerModelSource(source, parsed.model, next);
    expect(patched.ok, patched.ok ? "" : patched.reason).toBe(true);
    if (!patched.ok) return;
    expect(patched.source).toContain("const exact =  true");
    expect(patched.source).toContain("\nimport Card from '../Card.astro';\n");
    expect(patched.source).not.toContain("@aria-cms-query");
    expect(patched.source).not.toContain("getCollection");
  });
});
