import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessCollectionMigration,
  migrateCollectionToAria,
  readCollectionRegistry,
} from "@electron/collectionRegistry";
import { writeCollectionsWithContentConfig } from "@electron/cms/contentSync";
import { runCmsTransaction } from "@electron/cms/mutationCoordinator";
import { listEntries as listStoredEntries } from "@electron/cms/store";
import { readCollections } from "@electron/collections";
import { fixtureRoot } from "./collectionRegistry.fixture";

describe("collection registry migration", () => {
  it("migrates an assessed external collection, cuts over its Astro definition, and preserves structured values", async () => {
    const root = fixtureRoot();
    mkdirSync(path.join(root, "node_modules", ".astro"), { recursive: true });
    mkdirSync(path.join(root, "node_modules", "devalue"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", ".astro", "data-store.json"), "fixture");
    writeFileSync(path.join(root, "node_modules", "devalue", "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(path.join(root, "node_modules", "devalue", "index.js"), `
      export function parse() {
        return new Map([["articles", new Map([
          ["one", { data: { title: "First", slug: "first", count: 2, details: { featured: true }, locale: "en", apiToken: "hidden" }, body: "First body" }],
          ["two", { data: { title: "Second", count: 3, locale: "fr" }, body: "Second body" }],
        ])]]);
      }
    `);
    const configFile = path.join(root, "src", "content.config.ts");
    const assessment = await assessCollectionMigration(root, "articles");

    const result = await migrateCollectionToAria(
      root,
      "articles",
      assessment.previewHash,
    );

    expect(result).toMatchObject({
      ok: true,
      collectionName: "articles",
      importedEntries: 2,
      initialStatus: "draft",
      sourceChanged: true,
      routesChanged: false,
    });
    expect(readFileSync(configFile, "utf8")).toContain("aria:collection-config-begin articles");
    expect(readFileSync(configFile, "utf8")).toContain('base: "./src/content/articles"');
    const managed = readCollections(root).collections.find((item) => item.id === result.collectionId);
    expect(managed?.schema?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "count", type: "integer" }),
      expect.objectContaining({ key: "details", type: "object" }),
    ]));
    expect(managed?.schema?.fields.map((field) => field.key)).not.toContain("title");
    const entries = listStoredEntries(root, result.collectionId);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.entry.status === "draft")).toBe(true);
    expect(entries.map((entry) => entry.locales[0]?.locale).sort()).toEqual(["en", "fr"]);
    expect(entries[0]?.locales[0]?.frontmatter).not.toHaveProperty("apiToken");
    expect(entries.find((entry) => entry.locales[0]?.slug === "first")?.locales[0]?.frontmatter.details).toEqual({ featured: true });
    expect(existsSync(path.join(root, "src/content/articles/first.md"))).toBe(true);
    expect(readCollectionRegistry(root).collections.find((item) => item.name === "articles")?.source?.label).toBe("Aria CMS");
  });

  it("migrates a file() collection and removes its original aggregate only after cutover", async () => {
    const root = fixtureRoot();
    writeFileSync(path.join(root, "src/data.json"), JSON.stringify([
      { id: "one", title: "One", category: "news" },
      { id: "two", title: "Two", category: "guides" },
    ]));
    writeFileSync(path.join(root, "src/content.config.ts"), `
      import { defineCollection } from "astro:content";
      import { file } from "astro/loaders";
      const catalog = defineCollection({ loader: file("src/data.json") });
      export const collections = { catalog };
    `);

    const discovered = readCollectionRegistry(root).collections.find((item) => item.name === "catalog");
    expect(discovered?.source).toMatchObject({ adapter: "astro-file", migrationMode: "automatic" });
    const assessment = await assessCollectionMigration(root, "catalog");
    const result = await migrateCollectionToAria(root, "catalog", assessment.previewHash);

    expect(result.importedEntries).toBe(2);
    expect(existsSync(path.join(root, "src/data.json"))).toBe(false);
    expect(existsSync(path.join(root, "src/content/catalog/one.md"))).toBe(true);
    expect(existsSync(path.join(root, "src/content/catalog/two.md"))).toBe(true);
    expect(readFileSync(path.join(root, "src/content.config.ts"), "utf8")).toContain("aria:collection-config-begin catalog");
  });

  it("detects a src/data glob collection and preserves status, nested fields, and Astro images during cutover", async () => {
    const root = fixtureRoot();
    mkdirSync(path.join(root, "src/data/projects/one"), { recursive: true });
    mkdirSync(path.join(root, "src/assets/images"), { recursive: true });
    mkdirSync(path.join(root, "node_modules/.astro"), { recursive: true });
    mkdirSync(path.join(root, "node_modules/devalue"), { recursive: true });
    writeFileSync(path.join(root, "src/data/projects/one/index.mdx"), `---
title: Project One
status: complete
thumbnail: ../../../assets/images/project.png
tech:
  - Astro
  - Aria
specs:
  - label: Runtime
    value: Astro
challenge:
  title: Old source
  body: Migrate it
---

Project body
`);
    writeFileSync(path.join(root, "src/assets/images/project.png"), Buffer.from("project-image"));
    writeFileSync(path.join(root, ".astro/content.d.ts"), `type DataEntryMap = {
      "projects": Record<string, { id: string }>;
    \t};`);
    writeFileSync(path.join(root, ".astro/collections/projects.schema.json"), JSON.stringify({
      type: "object",
      properties: {
        title: { type: "string" },
        status: { type: "string", enum: ["complete", "in-progress"] },
        thumbnail: { type: "string" },
        tech: { type: "array", items: { type: "string" } },
        specs: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, value: { type: "string" } },
            required: ["label", "value"],
          },
        },
        challenge: {
          type: "object",
          properties: { title: { type: "string" }, body: { type: "string" } },
          required: ["title", "body"],
        },
        $schema: { type: "string" },
      },
      required: ["title", "status", "thumbnail", "tech", "specs", "challenge"],
    }));
    writeFileSync(path.join(root, "src/content.config.ts"), `import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
const projectsCollection = defineCollection({
  loader: glob({ pattern: "**/[^_]*{md,mdx}", base: "./src/data/projects" }),
  schema: z.object({ title: z.string() }),
});
export const collections = { projects: projectsCollection };
`);
    writeFileSync(path.join(root, "node_modules/.astro/data-store.json"), "projects-cache");
    writeFileSync(path.join(root, "node_modules/devalue/package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(path.join(root, "node_modules/devalue/index.js"), `
      export function parse() {
        return new Map([["projects", new Map([["one", {
          filePath: "src/data/projects/one/index.mdx",
          data: {
            title: "Project One",
            status: "complete",
            thumbnail: "__ASTRO_IMAGE_../../../assets/images/project.png",
            tech: ["Astro", "Aria"],
            specs: [{ label: "Runtime", value: "Astro" }],
            challenge: { title: "Old source", body: "Migrate it" },
          },
          body: "Project body",
        }]] )]]);
      }
    `);

    const discovered = readCollectionRegistry(root).collections.find((item) => item.name === "projects");
    expect(discovered?.source).toMatchObject({
      kind: "astro-local",
      label: "Local Astro",
      contentDirectory: "src/data/projects",
    });
    const assessment = await assessCollectionMigration(root, "projects");
    expect(assessment.requiresExplicitMapping).toBe(false);
    expect(assessment.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "status", type: "select" }),
      expect.objectContaining({ key: "thumbnail", type: "image" }),
      expect.objectContaining({ key: "tech", type: "multiSelect" }),
      expect.objectContaining({ key: "specs", type: "repeater" }),
      expect.objectContaining({ key: "challenge", type: "object" }),
    ]));
    expect(assessment.fields.map((field) => field.key)).not.toContain("$schema");

    const result = await migrateCollectionToAria(root, "projects", assessment.previewHash);
    const managed = readCollections(root).collections.find((item) => item.id === result.collectionId)!;
    const record = listStoredEntries(root, result.collectionId)[0]!;
    expect(managed.contentDirectory).toBe("src/content/projects");
    expect(record.locales[0]?.frontmatter).toMatchObject({
      status: "complete",
      tech: ["Astro", "Aria"],
      specs: [{ label: "Runtime", value: "Astro" }],
      challenge: { title: "Old source", body: "Migrate it" },
      thumbnail: expect.objectContaining({ mediaId: expect.stringMatching(/^public\/uploads\/aria-cms\//) }),
    });
    expect(existsSync(path.join(root, "src/data/projects/one/index.mdx"))).toBe(false);
    const projected = readFileSync(path.join(root, "src/content/projects/one.md"), "utf8");
    expect(projected).toContain("status: complete");
    expect(projected).toContain("specs:");
    expect(projected).toContain("thumbnail: /uploads/aria-cms/");
    const config = readFileSync(path.join(root, "src/content.config.ts"), "utf8");
    expect(config).toContain("aria:collection-config-begin projects");
    expect(config).toContain('base: "./src/content/projects"');
    writeCollectionsWithContentConfig(root, {
      collections: [{
        ...managed,
        schema: {
          ...managed.schema!,
          fields: [...managed.schema!.fields, { key: "summary", label: "Summary", type: "text" }],
        },
      }],
    });
    expect(readFileSync(path.join(root, "src/content.config.ts"), "utf8")).toContain("summary: z.string().optional()");
  });

  it("rejects a stale migration review before creating an Aria collection", async () => {
    const root = fixtureRoot();
    mkdirSync(path.join(root, "node_modules", ".astro"), { recursive: true });
    mkdirSync(path.join(root, "node_modules", "devalue"), { recursive: true });
    const cacheFile = path.join(root, "node_modules", ".astro", "data-store.json");
    writeFileSync(cacheFile, "first snapshot");
    writeFileSync(path.join(root, "node_modules", "devalue", "package.json"), JSON.stringify({ type: "module" }));
    const devalueFile = path.join(root, "node_modules", "devalue", "index.js");
    writeFileSync(devalueFile, `
      export function parse() {
        return new Map([["articles", new Map([["one", { data: { title: "First" } }]])]]);
      }
    `);
    const assessment = await assessCollectionMigration(root, "articles");
    writeFileSync(cacheFile, "changed snapshot");
    writeFileSync(devalueFile, `
      export function parse() {
        return new Map([["articles", new Map([["one", { data: { title: "Changed" } }]])]]);
      }
    `);

    await expect(
      migrateCollectionToAria(root, "articles", assessment.previewHash),
    ).rejects.toThrow("COLLECTION_MIGRATION_CONFLICT");
    expect(readCollections(root).collections.map((item) => item.name)).toEqual(["news"]);
  });

  it("rolls config, collection state, and projected files back when migration fails", async () => {
    const root = fixtureRoot();
    mkdirSync(path.join(root, "node_modules/.astro"), { recursive: true });
    mkdirSync(path.join(root, "node_modules/devalue"), { recursive: true });
    writeFileSync(path.join(root, "node_modules/.astro/data-store.json"), "fixture");
    writeFileSync(path.join(root, "node_modules/devalue/package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(path.join(root, "node_modules/devalue/index.js"), `
      export function parse() {
        return new Map([["articles", new Map([["one", { data: {
          title: "Broken media",
          featuredImage: "/missing-image.png",
        } }]])]]);
      }
    `);
    const configFile = path.join(root, "src/content.config.ts");
    const configBefore = readFileSync(configFile, "utf8");
    const collectionsBefore = readFileSync(path.join(root, ".aria/collections.json"), "utf8");
    const assessment = await assessCollectionMigration(root, "articles");

    await expect(runCmsTransaction(root, "migrate articles", () =>
      migrateCollectionToAria(root, "articles", assessment.previewHash)))
      .rejects.toThrow("Media file not found");

    expect(readFileSync(configFile, "utf8")).toBe(configBefore);
    expect(readFileSync(path.join(root, ".aria/collections.json"), "utf8")).toBe(collectionsBefore);
    expect(existsSync(path.join(root, "src/content/articles"))).toBe(false);
  });
})
