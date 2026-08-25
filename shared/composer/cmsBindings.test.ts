import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { serializeAstro } from "./serializeAstro";
import {
  adoptCmsLoop,
  bindCmsPropAtPath,
  bindCmsTextAtPath,
  detectCmsContext,
  describeComposerCmsSelection,
  resolveDirectCmsTextBinding,
  parseCmsContentExposure,
  mapSuggestedCmsFieldsAtPath,
  setCmsContentExposureAtPath,
  unwrapCmsLoop,
  upsertCmsCollectionQuery,
  wrapNodeInCmsLoop,
  unbindCmsPropAtPath,
  unbindCmsTextAtPath,
} from "./cmsBindings";

async function model(source: string) {
  const parsed = await parseAstro(source);
  expect(parsed.editable).toBe(true);
  if (!parsed.editable) throw new Error("not editable");
  return parsed.model;
}

describe("Astro-native CMS bindings", () => {
  it("binds props and text while preserving static fallbacks", async () => {
    const doc = await model("---\nconst { post } = Astro.props;\n---\n<h1 title=\"Original\">Original title</h1>");
    expect(bindCmsPropAtPath(doc, "0", "title", { contextVariable: "post", field: "title" }).ok).toBe(true);
    expect(bindCmsTextAtPath(doc, "0.0", { contextVariable: "post", field: "title" }).ok).toBe(true);
    const source = serializeAstro(doc);
    expect(source).toContain('title={post?.data?.["title"] ?? /* @aria-cms-fallback */ "Original"}');
    expect(source).toContain('{post?.data?.["title"] ?? /* @aria-cms-fallback */ "Original title"}');
    expect(detectCmsContext(doc, "0")).toContain("post");
    expect(unbindCmsPropAtPath(doc, "0", "title").ok).toBe(true);
    expect(unbindCmsTextAtPath(doc, "0.0").ok).toBe(true);
    expect(serializeAstro(doc)).toContain('title="Original"');
    expect(serializeAstro(doc)).toContain("Original title");
  });

  it("creates and updates one managed query block with a deduped import", async () => {
    const doc = await model('---\nimport { render } from "astro:content";\n---\n<div />');
    const query = {
      id: "blog-list",
      collection: "blog",
      filters: [{ field: "featured", operator: "equals" as const, value: true }],
      sort: { field: "publishedDate", direction: "desc" as const },
      limit: 6,
    };
    const first = upsertCmsCollectionQuery(doc, query);
    upsertCmsCollectionQuery(doc, { ...query, limit: 3 });
    expect(first.variable).toMatch(/^ariaCmsBlog/);
    expect(doc.extraFrontmatter.match(/getCollection/g)).toHaveLength(2); // import + call
    expect(doc.extraFrontmatter.match(/@aria-cms-query:blog-list/g)).toHaveLength(1);
    expect(doc.extraFrontmatter).toContain(".slice(0, 3)");
    expect(doc.extraFrontmatter).toContain("import { render, getCollection }");
  });

  it("wraps and unwraps a real MapNode without losing the template", async () => {
    const doc = await model("---\n---\n<article><h2>Title</h2></article>");
    const result = wrapNodeInCmsLoop(doc, "0", {
      id: "posts",
      collection: "blog",
      entryVariable: "post",
      limit: 10,
    });
    expect(result.ok).toBe(true);
    expect(doc.nodes[0]?.kind).toBe("map");
    expect(serializeAstro(doc)).toContain(".map((post) => (");
    expect(unwrapCmsLoop(doc, "0").ok).toBe(true);
    expect(doc.nodes[0]?.kind).toBe("element");
    expect(doc.extraFrontmatter).not.toContain("@aria-cms-query:posts");
  });

  it("supports static-entry queries through a collection lookup", async () => {
    const doc = await model("---\n---\n<div />");
    const result = upsertCmsCollectionQuery(doc, {
      id: "featured-entry",
      collection: "blog",
      entrySlug: "hello-world",
      variable: "featuredPost",
    });
    expect(result.variable).toBe("featuredPost");
    expect(doc.extraFrontmatter).toContain('.find((entry) => (entry.data.slug ?? entry.id) === "hello-world")');
  });

  it("resolves a managed direct-entry text field for visual editing", async () => {
    const doc = await model(`---
import { getCollection } from "astro:content";
/* @aria-cms-query:hero-copy */
const heroCopy = (await getCollection("site-copy"))
  .find((entry) => (entry.data.slug ?? entry.id) === "hero");
/* @aria-cms-query-end:hero-copy */
---
<p class="badge">
  <span class="badge__dot" />
  {heroCopy?.data?.["eyebrow"] ?? /* @aria-cms-fallback */ "Fallback"}
</p>`);
    expect(resolveDirectCmsTextBinding(doc, "0")).toEqual({
      path: "0.3",
      collection: "site-copy",
      entrySlug: "hero",
      contextVariable: "heroCopy",
      field: "eyebrow",
      contentExposure: "editable",
    });
    expect(describeComposerCmsSelection(doc, "0").textTargetPath).toBe("0.3");

    doc.nodes.push((await model(`<a data-button-variant="primary">
  <Icon />
  {heroCopy?.data?.["primaryActionLabel"] ?? /* @aria-cms-fallback */ "Download"}
</a>`)).nodes[0]!);
    expect(resolveDirectCmsTextBinding(doc, "1")).toMatchObject({
      path: "1.2",
      field: "primaryActionLabel",
    });
  });

  it("restores an adopted project-data loop without removing the template", async () => {
    const doc = await model(`---
import { getCollection } from "astro:content";
/* @aria-cms-query:project-data-portfolio-data */
const ariaCmsPortfolioData = (await getCollection("portfolio-data")).find((entry) => entry.id === "portfolio-data");
/* @aria-cms-query-end:project-data-portfolio-data */
const bio = ["One"];
---
{(ariaCmsPortfolioData?.data?.["profile"]?.["bio"]?.map((item) => item?.value) ?? /* @aria-cms-fallback */ (bio)).map((para) => (<p>{para}</p>))}`);
    expect(doc.nodes[0]?.kind).toBe("map");
    expect(unwrapCmsLoop(doc, "0").ok).toBe(true);
    expect(doc.nodes[0]?.kind).toBe("map");
    expect(serializeAstro(doc)).toContain("bio.map((para) => (");
    expect(doc.extraFrontmatter).not.toContain("@aria-cms-query:project-data-portfolio-data");
  });

  it("restores expression fallbacks containing nullish coalescing", async () => {
    const doc = await model('---\nconst { post, fallback } = Astro.props;\n---\n<Card title={fallback ?? "Untitled"} />');
    expect(bindCmsPropAtPath(doc, "0", "title", {
      contextVariable: "post",
      field: "title",
    }).ok).toBe(true);
    expect(serializeAstro(doc)).toContain("@aria-cms-fallback");
    expect(unbindCmsPropAtPath(doc, "0", "title").ok).toBe(true);
    expect(serializeAstro(doc)).toContain('title={fallback ?? "Untitled"}');
  });

  it("describes a hand-written collection loop and adopts it without rewriting its body", async () => {
    const doc = await model(`---
import { getCollection } from "astro:content";
const posts = await getCollection("blog");
---
{posts.map((post) => (<a href={post.data.slug}>{post.data.title}</a>))}`);
    expect(describeComposerCmsSelection(doc, "0")).toMatchObject({
      collection: "blog",
      ownership: "adoptable",
      summary: "Blog collection loop",
      canRepeat: true,
    });
    const beforeLoop = (doc.nodes[0] as { head: string }).head;
    expect(adoptCmsLoop(doc, "0").ok).toBe(true);
    expect((doc.nodes[0] as { head: string }).head).toBe(beforeLoop);
    expect(doc.extraFrontmatter).toContain("/* @aria-cms-query:");
    expect(doc.extraFrontmatter).toContain('const posts = await getCollection("blog");');
    expect(describeComposerCmsSelection(doc, "0").ownership).toBe("managed");
  });

  it("refuses to adopt a custom collection pipeline", async () => {
    const doc = await model(`---
import { getCollection } from "astro:content";
const posts = (await getCollection("blog")).filter((post) => post.data.featured);
---
{posts.map((post) => (<p>{post.data.title}</p>))}`);
    const before = serializeAstro(doc);
    expect(adoptCmsLoop(doc, "0").ok).toBe(false);
    expect(serializeAstro(doc)).toBe(before);
  });

  it("compiles offset, status, locale, and relation-aware collection queries", async () => {
    const doc = await model("---\nconst { category } = Astro.props;\n---\n<div />");
    upsertCmsCollectionQuery(doc, {
      id: "related-posts",
      collection: "blog",
      status: "published",
      locale: "en-CA",
      offset: 2,
      limit: 4,
      archiveFilter: {
        mode: "relation",
        field: "categories",
        contextVariable: "category",
      },
    });
    expect(doc.extraFrontmatter).toContain('["status"] === "published"');
    expect(doc.extraFrontmatter).toContain('["locale"] === "en-CA"');
    expect(doc.extraFrontmatter).toContain("Array.isArray");
    expect(doc.extraFrontmatter).toContain(".slice(2, 6)");
  });

  it("stores content-detail exposure inside the bound Astro expression", async () => {
    const doc = await model("---\nconst { post } = Astro.props;\n---\n<h1>Fallback title</h1>");
    expect(bindCmsTextAtPath(doc, "0.0", { contextVariable: "post", field: "title" }).ok).toBe(true);
    expect(setCmsContentExposureAtPath(doc, "0.0", "locked").ok).toBe(true);
    const locked = serializeAstro(doc);
    expect(locked).toContain("/* @aria-content:locked */");
    expect(locked).not.toContain("data-aria-content");
    expect(parseCmsContentExposure((doc.nodes[0] as { children: Array<{ value: string }> }).children[0]!.value)).toBe("locked");
    expect(setCmsContentExposureAtPath(doc, "0.0", "editable").ok).toBe(true);
    expect(serializeAstro(doc)).not.toContain("@aria-content:");
    expect(unbindCmsTextAtPath(doc, "0.0").ok).toBe(true);
    expect(serializeAstro(doc)).toContain("Fallback title");
  });

  it("maps conservative matching fields across a selected card", async () => {
    const doc = await model(`---
const { post } = Astro.props;
---
<article><img src="fallback.jpg" alt="Fallback" /><h2>Fallback title</h2><p>Fallback summary</p><a href="/fallback">Read more</a></article>`);
    const result = mapSuggestedCmsFieldsAtPath(
      doc,
      "0",
      "post",
      ["cover", "title", "summary", "slug"],
    );
    expect(result.ok).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(5);
    const source = serializeAstro(doc);
    expect(source).toContain('post?.data?.["cover"]');
    expect(source).toContain('post?.data?.["title"]');
    expect(source).toContain('post?.data?.["summary"]');
    expect(source).toContain("post?.data?.slug ?? post?.id");
  });
});
