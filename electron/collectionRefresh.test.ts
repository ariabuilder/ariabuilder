import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { refreshCollectionSource, sanitizeCollectionRefreshError } from "./collectionRefresh";

describe("collection refresh error sanitization", () => {
  it("redacts bearer tokens, secret values, and JWTs", () => {
    const message = sanitizeCollectionRefreshError(
      "Bearer abc.def.ghi api_key=super-secret token:another eyJabcdefghijk.abcdefghijkl.abcdefghijkl",
    );
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("another");
    expect(message).not.toContain("eyJabcdefghijk");
    expect(message).toContain("[redacted]");
  });

  it("rescans static local sources without requiring Astro dependencies", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "aria-local-refresh-"));
    mkdirSync(path.join(root, ".aria"), { recursive: true });
    mkdirSync(path.join(root, "src/content/blog"), { recursive: true });
    writeFileSync(path.join(root, ".aria/collections.json"), '{"collections":[]}');
    writeFileSync(path.join(root, "src/content/blog/post.md"), "---\ntitle: Post\n---\nBody\n");
    writeFileSync(path.join(root, "src/content.config.ts"), `
      const blog = defineCollection({ loader: glob({ base: "src/content/blog", pattern: "**/*.md" }) });
      export const collections = { blog };
    `);

    await expect(refreshCollectionSource(root, "blog")).resolves.toMatchObject({
      collectionId: "astro:content:blog",
    });
  });
});
