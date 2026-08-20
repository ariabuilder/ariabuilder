import { describe, expect, it } from "vitest";
import { buildComposerLayerTree } from "../../shared/composer/layers";
import { astroCollectionPropsForComponent } from "../../shared/composer/collectionBindings";
import { parseAstro } from "../../shared/composer/parseAstro";
import { analyzeAstroCollectionProvenance } from "./collectionProvenance";

describe("Astro collection provenance", () => {
  it.each([
    [
      "named import",
      `import { getCollection } from "astro:content";\nconst posts = await getCollection("blog");`,
      "posts",
      { collections: ["blog"], cardinality: "many" },
    ],
    [
      "aliased import and constant collection name",
      `import { getCollection as load } from "astro:content";\nconst BLOG = "blog";\nconst posts = await load(BLOG);`,
      "posts",
      { collections: ["blog"], cardinality: "many" },
    ],
    [
      "namespace import",
      `import * as content from "astro:content";\nconst posts = await content.getCollection("blog");`,
      "posts",
      { collections: ["blog"], cardinality: "many" },
    ],
    [
      "helper and transforms",
      `import { getCollection } from "astro:content";\nconst loadPosts = () => getCollection("blog");\nconst posts = (await loadPosts()).filter(Boolean).sort(() => 0).slice(0, 3);`,
      "posts",
      { collections: ["blog"], cardinality: "many" },
    ],
    [
      "single entry",
      `import { getEntry } from "astro:content";\nconst post = await getEntry({ collection: "blog", id: "welcome" });`,
      "post",
      { collections: ["blog"], cardinality: "one" },
    ],
    [
      "array element destructuring",
      `import { getCollection } from "astro:content";\nconst posts = await getCollection("blog");\nconst [featured] = posts;`,
      "featured",
      { collections: ["blog"], cardinality: "one" },
    ],
    [
      "Promise.all entry loading",
      `import { getEntry } from "astro:content";\nconst posts = await Promise.all([getEntry("blog", "one"), getEntry("blog", "two")]);`,
      "posts",
      { collections: ["blog"], cardinality: "many" },
    ],
  ])("recognizes %s", (_label, frontmatter, variable, expected) => {
    expect(analyzeAstroCollectionProvenance(`---\n${frontmatter}\n---\n<main />`)[variable]).toMatchObject(expected);
  });

  it("marks a dynamic collection without pretending to know its name", () => {
    expect(analyzeAstroCollectionProvenance(`---
import { getCollection } from "astro:content";
const posts = await getCollection(Astro.params.collection);
---
<main />`).posts).toEqual({ collections: [], cardinality: "many", dynamic: true });
  });

  it("detects Foxi's collection when posts are passed to a component", async () => {
    const source = `---
import { getCollection } from "astro:content";
import BlogPosts from "../../components/blocks/blog/BlogPosts.astro";
const allPosts = await getCollection("blog");
---
<BlogPosts data={allPosts} />`;
    const parsed = await parseAstro(source);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable Astro source");
    parsed.model.collectionBindings = analyzeAstroCollectionProvenance(source);
    expect(astroCollectionPropsForComponent(
      parsed.model.nodes[0]!,
      parsed.model.collectionBindings,
    )).toEqual({
      data: { collections: ["blog"], cardinality: "many", dynamic: undefined },
    });
    expect(buildComposerLayerTree(parsed.model).content[0]).toMatchObject({
      label: "Blog content",
      hasCmsBinding: true,
      hasDataBinding: false,
      cmsCollections: ["blog"],
    });
  });

  it("carries the collection into nested map children", async () => {
    const source = `---
import { getCollection } from "astro:content";
const posts = await getCollection("blog");
---
{posts.map((post) => (<article><h2>{post.data.title}</h2></article>))}`;
    const parsed = await parseAstro(source);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable Astro source");
    parsed.model.collectionBindings = analyzeAstroCollectionProvenance(source);
    const loop = buildComposerLayerTree(parsed.model).content[0]!;
    expect(loop).toMatchObject({ hasCmsBinding: true, cmsCollections: ["blog"] });
    const descendants = loop.children.flatMap(function visit(row): typeof loop.children {
      return [row, ...row.children.flatMap(visit)];
    });
    expect(descendants.find((row) => row.hasCmsBinding)).toMatchObject({
      hasCmsBinding: true,
      cmsCollections: ["blog"],
    });
  });

  it("carries Foxi's data prop through its component aliases", async () => {
    const source = `---
type Props = { data: any };
const { data: allPosts } = Astro.props;
const sortedPosts = allPosts.sort((a: any, b: any) => 0);
---
{sortedPosts.map((post: any) => (<article>{post.data.title}</article>))}`;
    const bindings = analyzeAstroCollectionProvenance(source, {
      props: { data: { collections: ["blog"], cardinality: "many" } },
    });
    expect(bindings).toMatchObject({
      allPosts: { collections: ["blog"], cardinality: "many" },
      sortedPosts: { collections: ["blog"], cardinality: "many" },
    });
    const parsed = await parseAstro(source);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) throw new Error("expected editable Astro source");
    parsed.model.collectionBindings = bindings;
    expect(buildComposerLayerTree(parsed.model).content[0]).toMatchObject({
      hasCmsBinding: true,
      cmsCollections: ["blog"],
    });
  });
});
