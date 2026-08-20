import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { setPropAtPath, setTextAtPath } from "./mutate";
import { patchComposerModelSource } from "./sourcePatches";

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
});
