import { describe, expect, it } from "vitest";
import {
  extractClipboardFragment,
  importExternalComposerClipboard,
  unwrapEditorSourceHtml,
} from "./clipboardImport";

const SOURCE = `<section class="hero" id="home">
  <h1>Build visually</h1>
</section>`;

const EDITOR_HTML = `<html><body><!--StartFragment--><pre>&lt;section class=&quot;wrong-wrapper&quot;&gt;
  &lt;h1&gt;Build visually&lt;/h1&gt;
&lt;/section&gt;</pre><!--EndFragment--></body></html>`;

describe("external Composer clipboard import", () => {
  it("prefers plain structural source over an editor HTML wrapper", async () => {
    const result = await importExternalComposerClipboard({
      text: SOURCE,
      html: EDITOR_HTML,
    });

    expect(result).toMatchObject({ ok: true, kind: "source" });
    if (!result.ok) return;
    expect(result.nodes[0]).toMatchObject({
      kind: "element",
      name: "section",
      props: { class: { type: "string", value: "hero" } },
    });
  });

  it("extracts clipboard fragments and unwraps editor source markup", () => {
    expect(extractClipboardFragment(EDITOR_HTML)).toMatch(/^<pre>/);
    expect(unwrapEditorSourceHtml(EDITOR_HTML)).toContain('<section class="wrong-wrapper">');
  });

  it("accepts fenced source and normalizes common JSX attributes", async () => {
    const result = await importExternalComposerClipboard({
      text: "```jsx\n<div className=\"card\"><label htmlFor=\"email\">Email</label></div>\n```",
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "source",
      warnings: ["jsx-normalized"],
    });
    if (!result.ok) return;
    const root = result.nodes[0];
    expect(root).toMatchObject({
      kind: "element",
      props: { class: { type: "string", value: "card" } },
    });
    expect(root && "children" in root ? root.children?.[0] : null).toMatchObject({
      kind: "element",
      props: { for: { type: "string", value: "email" } },
    });
  });

  it("preserves semantic source, expressions, SVG, utility classes, and safe styles", async () => {
    const result = await importExternalComposerClipboard({
      text: `<style>.hero { display: grid; }</style>
<section class:list={["hero", active && "md:grid-cols-2"]} style="gap: 1rem">
  <svg viewBox="0 0 10 10"><path d="M0 0h10v10z" /></svg>
  {title}
</section>`,
    });

    expect(result).toMatchObject({ ok: true, kind: "source", warnings: [] });
    if (!result.ok) return;
    expect(result.nodes.map((node) => node.kind)).toEqual(["raw", "element"]);
    expect(result.nodes[1]).toMatchObject({
      kind: "element",
      name: "section",
      props: {
        "class:list": { type: "expr" },
        style: { type: "string", value: "gap: 1rem" },
      },
    });
  });

  it("sanitizes rich HTML and preserves ordinary text as a Text primitive", async () => {
    const html = await importExternalComposerClipboard({
      html: '<!--StartFragment--><section onclick="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">Go</a></section><!--EndFragment-->',
      text: "Go",
    });
    expect(html).toMatchObject({
      ok: true,
      kind: "html",
      warnings: ["unsafe-content-removed"],
    });
    if (html.ok) {
      expect(JSON.stringify(html.nodes)).not.toMatch(/onclick|javascript:|script/i);
    }

    const styledHtml = await importExternalComposerClipboard({
      html: "<!--StartFragment--><style>.card { color: red; }</style><article class=\"card\">Card</article><!--EndFragment-->",
      text: "Card",
    });
    expect(styledHtml).toMatchObject({
      ok: true,
      kind: "html",
      nodes: [{ kind: "raw", name: "style" }, { kind: "element", name: "article" }],
    });

    const text = await importExternalComposerClipboard({ text: "Ordinary clipboard text" });
    expect(text).toMatchObject({ ok: true, kind: "text" });

    await expect(importExternalComposerClipboard({
      html: "<!--StartFragment--><script>alert(1)</script><!--EndFragment-->",
    })).resolves.toMatchObject({ ok: false, code: "unsafe-source" });
  });

  it("rejects full documents, frontmatter, runtime scripts, and malformed source", async () => {
    await expect(importExternalComposerClipboard({
      text: "---\nconst title = 'Page';\n---\n<h1>{title}</h1>",
    })).resolves.toMatchObject({ ok: false, code: "unsupported-document" });
    await expect(importExternalComposerClipboard({
      text: "<!doctype html><html><body><main>Page</main></body></html>",
    })).resolves.toMatchObject({ ok: false, code: "unsupported-document" });
    await expect(importExternalComposerClipboard({
      text: "<section><script>window.run()</script></section>",
    })).resolves.toMatchObject({ ok: false, code: "unsafe-source" });
    await expect(importExternalComposerClipboard({
      text: '<section title="unterminated></section>',
    })).resolves.toMatchObject({ ok: false, code: "invalid-source" });
  });
});
