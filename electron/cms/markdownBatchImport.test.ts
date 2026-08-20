import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCollections } from "../collections";
import {
  importMarkdownImportBatch,
  previewMarkdownImportBatch,
} from "./markdownBatchImport";

const dirs: string[] = [];

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aria-md-batch-"));
  dirs.push(dir);
  writeCollections(dir, {
    collections: [
      {
        id: "posts",
        name: "posts",
        label: "Posts",
        kind: "content",
        urlPattern: "/blog/{slug}",
        listPageFile: null,
        templatePageFile: null,
        schema: { fields: [], version: 1 },
        supports: ["body", "drafts"],
        scope: "global",
      },
    ],
  });
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("markdown batch import", () => {
  it("previews create actions and rejects path traversal", () => {
    const project = tempProject();
    const preview = previewMarkdownImportBatch(project, {
      collectionId: "posts",
      mode: "create",
      files: [
        {
          path: "hello.md",
          content: "---\ntitle: Hello\nslug: hello\n---\n\nBody",
        },
      ],
    });
    expect(preview.canApply).toBe(true);
    expect(preview.summary.creates).toBe(1);

    expect(() =>
      previewMarkdownImportBatch(project, {
        collectionId: "posts",
        mode: "create",
        files: [{ path: "../escape.md", content: "# bad" }],
      }),
    ).toThrow(/Invalid markdown import path/);
  });

  it("applies create then skips existing in create mode", () => {
    const project = tempProject();
    const files = [
      {
        path: "hello.md",
        content: "---\ntitle: Hello\nslug: hello\n---\n\n## Hi",
      },
    ];
    const applied = importMarkdownImportBatch(project, {
      collectionId: "posts",
      mode: "create",
      files,
    });
    expect(applied.applied).toBe(true);

    const second = previewMarkdownImportBatch(project, {
      collectionId: "posts",
      mode: "create",
      files,
    });
    expect(second.summary.skips).toBe(1);
    expect(second.canApply).toBe(false);
  });
});
