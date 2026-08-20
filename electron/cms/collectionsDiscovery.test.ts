import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAstroCollections } from "../collections/discovery";

function project(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aria-collection-discovery-"));
  mkdirSync(path.join(root, "src", "content"), { recursive: true });
  return root;
}

describe("Astro collection discovery", () => {
  it("discovers shorthand, inline, spread, glob, file, custom, and live definitions", () => {
    const root = project();
    writeFileSync(path.join(root, "src/content.config.ts"), `
      import { defineCollection } from "astro:content";
      import { file, glob } from "astro/loaders";
      const blog = defineCollection({
        loader: glob({ base: "./src/content/blog", pattern: "**/*.{md,mdx}" }),
      });
      const dogs = defineCollection({ loader: file("src/data/dogs.json") });
      const dynamic = defineCollection({
        loader: glob({ base: getBase(), pattern: "**/*.yaml", generateId: ({ entry }) => entry }),
      });
      const custom = defineCollection({ loader: cmsLoader() });
      const grouped = { dogs };
      export const collections = {
        blog,
        ...grouped,
        inline: defineCollection({ loader: glob({ base: "src/data/inline", pattern: "**/*.toml" }) }),
        dynamic,
        custom,
      };
    `);
    writeFileSync(path.join(root, "src/live.config.ts"), `
      import { defineLiveCollection } from "astro:content";
      const inventory = defineLiveCollection({ loader: inventoryLoader() });
      export const collections = { inventory };
    `);

    const collections = discoverAstroCollections(root);
    expect(collections.find((item) => item.name === "blog")).toMatchObject({
      adapter: "astro-glob",
      contentDirectory: "src/content/blog",
      filePattern: "**/*.{md,mdx}",
      formats: ["markdown", "mdx"],
      idStrategy: "path",
      dynamic: false,
    });
    expect(collections.find((item) => item.name === "dogs")).toMatchObject({
      adapter: "astro-file",
      sourceFile: "src/data/dogs.json",
      formats: ["json"],
      idStrategy: "field",
    });
    expect(collections.find((item) => item.name === "inline")).toMatchObject({
      adapter: "astro-glob",
      formats: ["toml"],
    });
    expect(collections.find((item) => item.name === "dynamic")).toMatchObject({
      adapter: "astro-store",
      idStrategy: "custom",
      dynamic: true,
    });
    expect(collections.find((item) => item.name === "custom")).toMatchObject({
      adapter: "astro-store",
      loaderName: "cmsLoader",
    });
    expect(collections.find((item) => item.name === "inventory")).toMatchObject({
      adapter: "astro-live",
      live: true,
    });
  });

  it("discovers legacy content and data collections", () => {
    const root = project();
    writeFileSync(path.join(root, "src/content/config.ts"), `
      import { defineCollection } from "astro:content";
      const blog = defineCollection({ type: "content" });
      const authors = defineCollection({ type: "data" });
      export const collections = { blog, authors };
    `);

    expect(discoverAstroCollections(root)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "blog",
        adapter: "legacy-directory",
        contentDirectory: "src/content/blog",
      }),
      expect.objectContaining({
        name: "authors",
        adapter: "legacy-directory",
        contentDirectory: "src/content/authors",
      }),
    ]));
  });

  it("marks custom file parsers for the Astro runtime fallback", () => {
    const root = project();
    writeFileSync(path.join(root, "src/content.config.mjs"), `
      const cats = defineCollection({
        loader: file("src/data/cats.csv", { parser: parseCsv }),
      });
      export const collections = { cats };
    `);
    expect(discoverAstroCollections(root)[0]).toMatchObject({
      name: "cats",
      adapter: "astro-store",
      formats: ["custom"],
      dynamic: true,
    });
  });
});
