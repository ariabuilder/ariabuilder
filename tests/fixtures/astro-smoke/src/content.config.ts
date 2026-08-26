import { defineCollection, reference, z } from "astro:content";
import { glob } from "astro/loaders";

const authors = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/authors" }),
  schema: z.object({ name: z.string() }),
});

const tags = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/tags" }),
  schema: z.object({ label: z.string() }),
});

const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    author: reference("authors"),
    tags: z.array(reference("tags")),
  }),
});

export const collections = { authors, posts, tags };
