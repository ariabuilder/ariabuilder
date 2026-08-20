import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessCollectionMigration,
  getExternalEntry,
  listExternalEntries,
  readCollectionRegistry,
  readCollectionRegistryWithCache,
} from "@electron/collectionRegistry";
import { writeCollections } from "@electron/collections";
import { fixtureRoot } from "./collectionRegistry.fixture";

describe("collection registry discovery and cache", () => {
  it("merges managed, local Astro, and recognized external sources with capabilities", () => {
    const state = readCollectionRegistry(fixtureRoot());
    expect(state.collections.find((item) => item.name === "news")?.source?.label).toBe("Aria CMS");
    expect(state.collections.find((item) => item.name === "posts")?.source).toMatchObject({ label: "Local Astro", readOnly: true });
    expect(state.collections.find((item) => item.name === "articles")?.source).toMatchObject({ label: "Sanity", readOnly: true, mode: "build-time" });
    expect(state.collections.find((item) => item.name === "generic")?.source?.label).toBe("External CMS");
    expect(state.collections.find((item) => item.name === "articles")?.capabilities?.writeEntry).toBe(false);
    expect(state.collections.find((item) => item.name === "articles")?.schema?.fields).toEqual(expect.arrayContaining([expect.objectContaining({ key: "publishedAt", type: "datetime" })]));
  });

  it("never persists discovered external registry projections", () => {
    const root = fixtureRoot();
    const registry = readCollectionRegistry(root);
    writeCollections(root, registry);
    const persisted = JSON.parse(readFileSync(path.join(root, ".aria", "collections.json"), "utf8"));
    expect(persisted.collections.map((item: { name: string }) => item.name)).toEqual(["news"]);
  });

  it("reads local Astro Markdown and MDX entries directly when no Astro cache exists", async () => {
    const root = fixtureRoot();
    const posts = path.join(root, "src/content/posts");
    writeFileSync(path.join(posts, "first-post.md"), "---\ntitle: First post\ndescription: First description\npubDate: '2022-07-08'\napiToken: hidden\n---\n\nFirst body\n");
    writeFileSync(path.join(posts, "second-post.md"), "---\ntitle: Second post\ndescription: Second description\n---\n\nSecond body\n");
    writeFileSync(path.join(posts, "third-post.md"), "---\ntitle: Third post\ndescription: Third description\n---\n\nThird body\n");
    writeFileSync(path.join(posts, "markdown-style-guide.md"), "---\ntitle: Markdown style guide\n---\n\nGuide body\n");
    writeFileSync(path.join(posts, "using-mdx.mdx"), "---\ntitle: Using MDX\n---\n\nimport Example from './Example.astro';\n\n<Example />\n");

    const state = await readCollectionRegistryWithCache(root);
    const source = state.collections.find((item) => item.name === "posts")?.source;
    expect(source).toMatchObject({
      kind: "astro-local",
      contentDirectory: "src/content/posts",
      filePattern: "**/*.{md,mdx}",
      entryCount: 5,
    });
    expect(source?.error).toBeUndefined();

    const listed = await listExternalEntries(root, {
      collectionId: "astro:content:posts",
      sort: { field: "title", direction: "asc" },
    });
    expect(listed).toMatchObject({ total: 5, filteredTotal: 5, scannedTotal: 5, truncated: false });
    expect(listed.items.map((entry) => entry.id)).toEqual([
      "first-post",
      "markdown-style-guide",
      "second-post",
      "third-post",
      "using-mdx",
    ]);
    expect(listed.items[0]?.data).not.toHaveProperty("apiToken");
    expect(listed.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "title", type: "string" }),
      expect.objectContaining({ key: "pubDate", type: "date" }),
    ]));

    const mdx = await getExternalEntry(root, "posts", "using-mdx");
    expect(mdx?.entry.filePath).toBe("src/content/posts/using-mdx.mdx");
    expect(mdx?.entry.body).toContain("<Example />");

    const assessment = await assessCollectionMigration(root, "posts");
    expect(assessment.entryCount).toBe(5);
    expect(assessment.requiresExplicitMapping).toBe(false);
  });

  it("reads official glob and file loader formats without executing project config", async () => {
    const root = fixtureRoot();
    mkdirSync(path.join(root, "src/data/mixed"), { recursive: true });
    writeFileSync(path.join(root, "src/data/mixed/one.json"), JSON.stringify({ title: "JSON entry", locale: "en" }));
    writeFileSync(path.join(root, "src/data/mixed/two.yaml"), "title: YAML entry\nlocale: fr\n");
    writeFileSync(path.join(root, "src/data/mixed/three.toml"), 'title = "TOML entry"\nlocale = "de"\n');
    writeFileSync(path.join(root, "src/data/mixed/four.mdoc"), "---\ntitle: Markdoc entry\n---\n\n{% note %}Body{% /note %}\n");
    writeFileSync(path.join(root, "src/data/dogs.json"), JSON.stringify([
      { id: "spot", title: "Spot" },
      { id: 2, title: "Rover" },
    ]));
    writeFileSync(path.join(root, "src/data/authors.yaml"), "ada:\n  title: Ada\nlinus:\n  title: Linus\n");
    writeFileSync(path.join(root, "src/data/teams.toml"), '[core]\ntitle = "Core"\n[docs]\ntitle = "Docs"\n');
    writeFileSync(path.join(root, "src/data/single.json"), JSON.stringify({ id: "only", title: "Only entry" }));
    writeFileSync(path.join(root, "src/content.config.ts"), `
      import { defineCollection } from "astro:content";
      import { file, glob } from "astro/loaders";
      if (globalThis.process) throw new Error("CONFIG_MUST_NOT_EXECUTE");
      const mixed = defineCollection({ loader: glob({ base: "src/data/mixed", pattern: "**/*.{json,yaml,toml,mdoc}" }) });
      const dogs = defineCollection({ loader: file("src/data/dogs.json") });
      const authors = defineCollection({ loader: file("src/data/authors.yaml") });
      const teams = defineCollection({ loader: file("src/data/teams.toml") });
      const single = defineCollection({ loader: file("src/data/single.json") });
      const customIds = defineCollection({ loader: glob({ base: "src/data/mixed", pattern: "**/*.json", generateId: makeId }) });
      export const collections = { mixed, dogs, authors, teams, single, customIds };
    `);

    const registry = readCollectionRegistry(root);
    expect(registry.collections.find((item) => item.name === "mixed")?.source).toMatchObject({
      adapter: "astro-glob",
      availability: "ready",
      formats: ["markdoc", "json", "yaml", "toml"],
    });
    expect(registry.collections.find((item) => item.name === "dogs")?.source).toMatchObject({
      adapter: "astro-file",
      sourceFile: "src/data/dogs.json",
    });
    expect(registry.collections.find((item) => item.name === "customIds")?.source).toMatchObject({
      adapter: "astro-store",
      availability: "needs-refresh",
    });

    const mixed = await listExternalEntries(root, { collectionId: "mixed", limit: 20 });
    expect(mixed.items.map((entry) => entry.id)).toEqual(["four", "one", "three", "two"]);
    expect(mixed.items.find((entry) => entry.id === "four")?.body).toContain("{% note %}");
    expect((await listExternalEntries(root, { collectionId: "dogs" })).items.map((entry) => entry.id)).toEqual(["spot", "2"]);
    expect((await listExternalEntries(root, { collectionId: "authors" })).items.map((entry) => entry.id)).toEqual(["ada", "linus"]);
    expect((await listExternalEntries(root, { collectionId: "teams" })).items.map((entry) => entry.id)).toEqual(["core", "docs"]);
    expect((await listExternalEntries(root, { collectionId: "single" })).items.map((entry) => entry.id)).toEqual(["only"]);
    await expect(listExternalEntries(root, { collectionId: "customIds" }))
      .rejects.toThrow("No Astro cache is available");
  });

  it("classifies live collections explicitly instead of showing a fake empty cache", async () => {
    const root = fixtureRoot();
    writeFileSync(path.join(root, "src/live.config.ts"), `
      import { defineLiveCollection } from "astro:content";
      const inventory = defineLiveCollection({ loader: inventoryLoader() });
      export const collections = { inventory };
    `);
    const live = readCollectionRegistry(root).collections.find((item) => item.name === "inventory");
    expect(live?.source).toMatchObject({
      adapter: "astro-live",
      availability: "unavailable",
      migrationMode: "unavailable",
    });
    expect(live?.capabilities).toMatchObject({ read: false, refresh: false, migrate: false });
    await expect(listExternalEntries(root, { collectionId: "inventory" }))
      .rejects.toThrow("request time");
  });

  it("inspects bounded cache data in a child and removes credential-shaped fields", async () => {
    const root = fixtureRoot();
    mkdirSync(path.join(root, "node_modules", ".astro"), { recursive: true });
    mkdirSync(path.join(root, "node_modules", "devalue"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", ".astro", "data-store.json"), "fixture");
    writeFileSync(path.join(root, "node_modules", "devalue", "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(path.join(root, "node_modules", "devalue", "index.js"), `
      export function parse() {
        return new Map([
          ["articles", new Map([["one", { data: { title: "Hello", locale: "fr", apiToken: "hidden" }, body: "Body" }]])],
          ["news", new Map([["cached-copy", { data: { title: "Generated projection" } }]])],
        ]);
      }
    `);
    const state = await readCollectionRegistryWithCache(root);
    const source = state.collections.find((item) => item.name === "articles")?.source;
    expect(source?.entryCount).toBe(1);
    expect(source?.discoveredLocales).toEqual(["fr"]);
    expect(source?.inspectionEntries?.[0]?.data).toEqual({ title: "Hello", locale: "fr" });
    expect(state.collections.find((item) => item.name === "news")?.source?.entryCount).toBeUndefined();

    const assessment = await assessCollectionMigration(root, "articles");
    expect(assessment).toMatchObject({
      entryCount: 1,
      locales: ["fr"],
      initialImportStatus: "draft",
      mutatesExternalSource: true,
      requiresExplicitMapping: false,
    });
    expect(assessment.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(assessment.source.inspectionEntries).toBeUndefined();
  });

  it("lists, searches, sorts, paginates, and retrieves sanitized external entries", async () => {
    const root = fixtureRoot();
    mkdirSync(path.join(root, "node_modules", ".astro"), { recursive: true });
    mkdirSync(path.join(root, "node_modules", "devalue"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", ".astro", "data-store.json"), "fixture");
    writeFileSync(path.join(root, "node_modules", "devalue", "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(path.join(root, "node_modules", "devalue", "index.js"), `
      export function parse() {
        return new Map([["articles", new Map([
          ["one", { data: { title: "Zulu", count: 2, featuredImage: "/zulu.jpg", apiToken: "hidden", details: { secret: "hidden", safe: true } }, body: "First body" }],
          ["two", { data: { title: "Alpha", count: 1, publishedAt: "2026-08-01T12:00:00.000Z" }, body: "Needle body", filePath: "src/content/two.md" }],
          ["three", { data: { title: "Bravo", count: 3 }, body: "Third body" }],
        ])]]);
      }
    `);

    const before = readFileSync(path.join(root, ".aria", "collections.json"), "utf8");
    const firstPage = await listExternalEntries(root, {
      collectionId: "astro:content:articles",
      page: 1,
      limit: 2,
      sort: { field: "title", direction: "asc" },
    });
    expect(firstPage).toMatchObject({ total: 3, filteredTotal: 3, page: 1, limit: 2, truncated: false });
    expect(firstPage.items.map((entry) => entry.id)).toEqual(["two", "three"]);
    expect(firstPage.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "title", source: "schema", sortable: true }),
      expect.objectContaining({ key: "count", source: "inferred", type: "integer" }),
      expect.objectContaining({ key: "featuredImage", image: true }),
    ]));

    const searched = await listExternalEntries(root, {
      collectionId: "articles",
      query: "needle",
    });
    expect(searched.items.map((entry) => entry.id)).toEqual(["two"]);

    const detail = await getExternalEntry(root, "articles", "one");
    expect(detail?.entry.data).toEqual({
      title: "Zulu",
      count: 2,
      featuredImage: "/zulu.jpg",
      details: { safe: true },
    });
    expect(await getExternalEntry(root, "articles", "missing")).toBeNull();
    await expect(listExternalEntries(root, { collectionId: "generic" }))
      .rejects.toThrow("No Astro cache snapshot is available");
    expect(readFileSync(path.join(root, ".aria", "collections.json"), "utf8")).toBe(before);
  });

  it("caps nested values and reports stale cache metadata", async () => {
    const root = fixtureRoot();
    mkdirSync(path.join(root, "node_modules", ".astro"), { recursive: true });
    mkdirSync(path.join(root, "node_modules", "devalue"), { recursive: true });
    const store = path.join(root, "node_modules", ".astro", "data-store.json");
    writeFileSync(store, "fixture");
    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(store, stale, stale);
    writeFileSync(path.join(root, "node_modules", "devalue", "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(path.join(root, "node_modules", "devalue", "index.js"), `
      export function parse() {
        let nested = { value: "end" };
        for (let index = 0; index < 15; index += 1) nested = { child: nested };
        return new Map([["articles", new Map([["one", { data: {
          title: "Capped",
          nested,
          items: Array.from({ length: 600 }, (_, index) => index),
          description: "x".repeat(60000),
        } }]])]]);
      }
    `);

    expect(readCollectionRegistry(root).collections.find((item) => item.name === "articles")?.source?.cacheState).toBe("stale");
    const result = await listExternalEntries(root, { collectionId: "articles" });
    expect(result.items[0]?.data.items).toHaveLength(500);
    expect((result.items[0]?.data.description as string).length).toBe(50000);
    expect(JSON.stringify(result.items[0]?.data.nested)).toContain("[depth-limited]");
  });

  it("fails safely for unavailable and malformed cache data", async () => {
    const unavailableRoot = fixtureRoot();
    await expect(listExternalEntries(unavailableRoot, { collectionId: "articles" }))
      .rejects.toThrow("No Astro cache is available");

    const malformedRoot = fixtureRoot();
    mkdirSync(path.join(malformedRoot, "node_modules", ".astro"), { recursive: true });
    mkdirSync(path.join(malformedRoot, "node_modules", "devalue"), { recursive: true });
    writeFileSync(path.join(malformedRoot, "node_modules", ".astro", "data-store.json"), "fixture");
    writeFileSync(path.join(malformedRoot, "node_modules", "devalue", "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(path.join(malformedRoot, "node_modules", "devalue", "index.js"), `
      export function parse() { throw new Error("malformed"); }
    `);
    await expect(listExternalEntries(malformedRoot, { collectionId: "articles" }))
      .rejects.toThrow("Astro collection cache query failed");
  });
})
