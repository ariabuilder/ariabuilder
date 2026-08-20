import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function fixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aria-registry-"));
  mkdirSync(path.join(root, ".aria"), { recursive: true });
  mkdirSync(path.join(root, ".astro", "collections"), { recursive: true });
  mkdirSync(path.join(root, "src", "content", "posts"), { recursive: true });
  writeFileSync(path.join(root, ".aria", "collections.json"), JSON.stringify({ collections: [{
    id: "managed", name: "news", label: "News", kind: "content", urlPattern: null,
    listPageFile: null, templatePageFile: null, schema: { version: 1, fields: [] },
  }] }));
  writeFileSync(path.join(root, ".astro", "content.d.ts"), `type DataEntryMap = {
    "posts": Record<string, { id: string }>;
    "articles": Record<string, { id: string }>;
    "generic": Record<string, { id: string }>;
  \t};`);
  writeFileSync(path.join(root, ".astro", "collections", "articles.schema.json"), JSON.stringify({
    type: "object", properties: { title: { type: "string" }, publishedAt: { type: "string", format: "date-time" } }, required: ["title"],
  }));
  writeFileSync(path.join(root, "src", "content.config.ts"), `import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { sanityLoader } from "@sanity/astro";
const articlesCollection = defineCollection({ loader: sanityLoader() });
const genericCollection = defineCollection({ loader: customLoader() });
const postsCollection = defineCollection({ loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" }), schema: z.object({ title: z.string() }) });
export const collections = {
  articles: articlesCollection,
  generic: genericCollection,
  posts: postsCollection,
};`);
  return root;
}
