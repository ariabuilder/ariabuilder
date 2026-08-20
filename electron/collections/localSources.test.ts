import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AriaCollectionDef } from "../../shared/types";
import { queryLocalCollectionSource } from "./localSources";

const roots: string[] = [];

function fixture(): { root: string; collection: AriaCollectionDef } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-local-collection-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "src", "content", "blog"), { recursive: true });
  return {
    root,
    collection: {
      id: "astro:content:blog",
      name: "blog",
      label: "Blog",
      kind: "content",
      urlPattern: null,
      listPageFile: null,
      templatePageFile: null,
      source: {
        kind: "astro-local",
        provider: "astro",
        label: "Local Astro",
        mode: "file",
        readOnly: true,
        adapter: "astro-glob",
        contentDirectory: "src/content/blog",
        filePattern: "**/*.md",
        schemaAvailable: true,
        cacheState: "fresh",
      },
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("local Astro collection sources", () => {
  it("matches Astro's permissive multiline quoted frontmatter", async () => {
    const { root, collection } = fixture();
    fs.writeFileSync(path.join(root, "src/content/blog/user-feedback.md"), `---
title: User feedback
description: "This quote closes on an invalid unindented line.
"
author: Eleni
---
Feedback.`);

    const result = await queryLocalCollectionSource(root, collection, { page: 1, limit: 50 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "user-feedback",
      data: {
        title: "User feedback",
        description: "This quote closes on an invalid unindented line. ",
        author: "Eleni",
      },
    });
    expect(result.total).toBe(1);
    expect(result.scannedTotal).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it("reads Astro TOML frontmatter", async () => {
    const { root, collection } = fixture();
    fs.writeFileSync(path.join(root, "src/content/blog/toml-post.md"), `+++
title = "TOML post"
tags = ["astro", "content"]
+++
Body.`);

    const result = await queryLocalCollectionSource(root, collection, {});

    expect(result.items[0]).toMatchObject({
      id: "toml-post",
      data: { title: "TOML post", tags: ["astro", "content"] },
    });
    expect(result.issues).toEqual([]);
  });

  it("keeps valid entries when one Markdown file cannot be parsed by Astro", async () => {
    const { root, collection } = fixture();
    fs.writeFileSync(path.join(root, "src/content/blog/welcome.md"), `---
title: Welcome
description: A valid post
---
Hello.`);
    fs.writeFileSync(path.join(root, "src/content/blog/broken.md"), `---
title: [Broken
---
Body.`);

    const result = await queryLocalCollectionSource(root, collection, { page: 1, limit: 50 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: "welcome", data: { title: "Welcome" } });
    expect(result.total).toBe(1);
    expect(result.scannedTotal).toBe(2);
    expect(result.issues[0]).toMatchObject({
      filePath: "src/content/blog/broken.md",
    });
    expect(result.issues[0]?.message).toContain("flow collection");
  });

  it("returns file issues instead of throwing when every glob entry is invalid", async () => {
    const { root, collection } = fixture();
    fs.writeFileSync(path.join(root, "src/content/blog/broken.md"), `---
title: [Broken
---
Body.`);

    const result = await queryLocalCollectionSource(root, collection, {});

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.scannedTotal).toBe(1);
    expect(result.issues[0]?.filePath).toBe("src/content/blog/broken.md");
  });
});
