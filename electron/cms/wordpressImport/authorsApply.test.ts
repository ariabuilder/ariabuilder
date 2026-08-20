import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCollections, writeCollections } from "../../collections";
import { createEntry, listEntries } from "../services";
import { applyWxrWordPressImport, createWordPressImportBatch } from "./service";
import * as batchStore from "./batchStore";

const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aria-wp-authors-"));
  roots.push(root);
  mkdirSync(path.join(root, ".aria"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), '{"name":"t"}\n');
  // Seeded authors collection (blog seed shape) — missing WP login/email fields.
  writeCollections(root, {
    collections: [
      {
        id: "authors",
        name: "authors",
        label: "Authors",
        kind: "data",
        urlPattern: null,
        listPageFile: null,
        templatePageFile: null,
        supports: ["cover", "revisions"],
        scope: "global",
        schema: {
          version: 1,
          fields: [
            { key: "role", label: "Role", type: "string", required: true },
            { key: "bio", label: "Bio", type: "text", required: true },
          ],
        },
      },
    ],
  });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const MINIMAL_WXR = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:wp="http://wordpress.org/export/1.2/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example</title>
    <link>https://example.test</link>
    <wp:base_site_url>https://example.test</wp:base_site_url>
    <wp:base_blog_url>https://example.test</wp:base_blog_url>
    <wp:wxr_version>1.2</wp:wxr_version>
    <wp:author>
      <wp:author_id>1</wp:author_id>
      <wp:author_login>jane</wp:author_login>
      <wp:author_email>jane@example.test</wp:author_email>
      <wp:author_display_name>Jane Editor</wp:author_display_name>
      <wp:author_first_name>Jane</wp:author_first_name>
      <wp:author_last_name>Editor</wp:author_last_name>
    </wp:author>
    <item>
      <title>Hello</title>
      <wp:post_id>10</wp:post_id>
      <wp:post_name>hello</wp:post_name>
      <wp:post_type>post</wp:post_type>
      <wp:status>publish</wp:status>
      <dc:creator>jane</dc:creator>
      <content:encoded><![CDATA[<p>Hello</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

describe("WordPress author import against seeded authors collection", () => {
  it("merges login/email fields and creates a draft author entry", async () => {
    const root = fixture();
    const batch = createWordPressImportBatch({ sourceType: "wxr" });
    batchStore.saveWordPressImportBatch(root, batch);

    const result = await applyWxrWordPressImport({
      projectPath: root,
      batch,
      sourceText: MINIMAL_WXR,
      scope: {
        posts: true,
        pages: false,
        customPostTypes: false,
        attachments: false,
        authors: true,
        comments: false,
        terms: false,
        menus: false,
        customFields: false,
        seoFields: false,
      },
    });

    expect(result.status).toBe("completed");

    const authors = readCollections(root).collections.find(
      (collection) => collection.name === "authors",
    );
    expect(authors).toBeTruthy();
    const keys = new Set((authors?.schema?.fields ?? []).map((f) => f.key));
    expect(keys.has("login")).toBe(true);
    expect(keys.has("email")).toBe(true);
    expect(keys.has("role")).toBe(true);

    const entries = listEntries(root, { collectionId: "authors", limit: 50 });
    expect(entries.items.length).toBeGreaterThanOrEqual(1);
    const jane = entries.items.find((item) =>
      item.locales.some((locale) => locale.slug === "jane"),
    );
    expect(jane).toBeTruthy();
    expect(jane?.locales[0]?.frontmatter.login).toBe("jane");
    // Seeded authors require role/bio — import must pad them so Astro preview boots.
    expect(jane?.locales[0]?.frontmatter.role).toBe("Jane Editor");
    expect(jane?.locales[0]?.frontmatter.bio).toBe("Imported from WordPress.");
  });

  it("rejects unknown keys against seeded schema before merge (guard)", () => {
    const root = fixture();
    expect(() =>
      createEntry(root, {
        collectionId: "authors",
        title: "Jane",
        slug: "jane",
        status: "draft",
        frontmatter: {
          login: "jane",
          email: "jane@example.test",
        },
      }),
    ).toThrow(/VALIDATION_ERROR|Unrecognized/);
  });
});
