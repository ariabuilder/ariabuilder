import { describe, expect, it } from "vitest";
import { parseAstro } from "../../../../shared/composer/parseAstro";
import type { AriaCollectionDef } from "../../../../shared/types";
import { conditionSourcesForDocument } from "./conditionSources";

const postsCollection: AriaCollectionDef = {
  id: "posts",
  name: "posts",
  label: "Posts",
  kind: "content",
  urlPattern: "/posts/{slug}",
  listPageFile: null,
  templatePageFile: null,
  schema: {
    version: 1,
    fields: [
      { key: "title", label: "Title", type: "string" },
      { key: "featured", label: "Featured", type: "boolean" },
      { key: "publishedAt", label: "Published at", type: "date" },
      {
        key: "author",
        label: "Author",
        type: "object",
        fields: [{ key: "name", label: "Name", type: "string" }],
      },
    ],
  },
};

describe("conditionSourcesForDocument", () => {
  it("offers fields from the current CMS loop item", async () => {
    const parsed = await parseAstro(`---
const posts = await getCollection("posts")
---
{posts.map((post) => (
  <article data-slug={post.id}><h2>{post.data.title}</h2></article>
))}
`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    parsed.model.collectionBindings = {
      posts: { collections: ["posts"], cardinality: "many" },
    };
    const sources = conditionSourcesForDocument(parsed.model, "0.0", [postsCollection]);
    expect(sources.some((source) => source.source.provider === "cms" && source.source.path.join(".") === "post.id")).toBe(true);
    expect(sources.some((source) => source.source.provider === "cms" && source.source.path.join(".") === "post.data.title")).toBe(true);
    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: { provider: "cms", path: ["post", "data", "featured"] }, valueType: "boolean" }),
      expect.objectContaining({ source: { provider: "cms", path: ["post", "data", "publishedAt"] }, valueType: "date" }),
      expect.objectContaining({ source: { provider: "cms", path: ["post", "data", "author", "name"] }, valueType: "string" }),
    ]));
  });

  it("offers loaded collection counts and single-entry schema fields", async () => {
    const parsed = await parseAstro(`---
const posts = await getCollection("posts")
const featuredPost = await getEntry("posts", "featured")
---
<main />
`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    parsed.model.collectionBindings = {
      posts: { collections: ["posts"], cardinality: "many" },
      featuredPost: { collections: ["posts"], cardinality: "one" },
    };
    const sources = conditionSourcesForDocument(parsed.model, "0", [postsCollection]);
    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: { provider: "cms", path: ["posts", "length"] }, valueType: "number" }),
      expect.objectContaining({ source: { provider: "cms", path: ["featuredPost", "data", "featured"] }, valueType: "boolean" }),
      expect.objectContaining({ source: { provider: "cms", path: ["featuredPost", "id"] }, valueType: "string" }),
    ]));
  });

  it("does not expose an unrelated collection outside Astro variable scope", async () => {
    const parsed = await parseAstro(`<main><h1>Static page</h1></main>`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const sources = conditionSourcesForDocument(parsed.model, "0", [postsCollection]);
    expect(sources.some((source) => source.source.provider === "cms")).toBe(false);
  });
});
