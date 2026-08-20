import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCollections } from "../collections";
import * as store from "./store";
import {
  importMarkdownToEntry,
  parseMarkdownEntry,
  previewImportMarkdown,
} from "./markdownImport";

const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aria-markdown-import-"));
  roots.push(root);
  writeCollections(root, {
    collections: [
      {
        id: "posts",
        name: "posts",
        label: "Posts",
        kind: "content",
        urlPattern: "/posts/{slug}",
        listPageFile: null,
        templatePageFile: null,
        supports: ["body", "drafts", "revisions"],
        scope: "global",
        schema: { fields: [], version: 1 },
      },
    ],
  });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Markdown CMS import", () => {
  it("preserves nested YAML values and rejects duplicate keys and aliases", () => {
    const parsed = parseMarkdownEntry(`---\ntitle: Nested\nmeta:\n  theme: dark\nitems:\n  - one\n  - two\n---\nBody`);
    expect(parsed.frontmatter.meta).toEqual({ theme: "dark" });
    expect(parsed.frontmatter.items).toEqual(["one", "two"]);

    expect(() => parseMarkdownEntry(`---\ntitle: One\ntitle: Two\n---`)).toThrow(
      /MARKDOWN_YAML_INVALID/,
    );
    expect(() => parseMarkdownEntry(`---\ndefaults: &defaults\n  x: 1\ncopy: *defaults\n---`)).toThrow(
      /MARKDOWN_YAML_INVALID/,
    );
  });

  it("returns a deterministic normalized plan and blocks unsafe links", () => {
    const root = fixture();
    const markdown = `---\ntitle: Safe title\nslug: safe-title\nfeatured: true\n---\n## Hello **world**\n\n[unsafe](javascript:alert(1))`;
    const first = previewImportMarkdown(root, "posts", markdown);
    const second = previewImportMarkdown(root, "posts", markdown);

    expect(first.previewHash).toBe(second.previewHash);
    expect(first.normalizedEntryPlan).toEqual(second.normalizedEntryPlan);
    expect(first.proposedSchemaChanges).toEqual([
      { key: "featured", label: "Featured", type: "boolean" },
    ]);
    expect(first.blockingDiagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unsafe-link" })]),
    );
  });

  it("requires the exact preview hash before any entry is written", () => {
    const root = fixture();
    const markdown = `---\ntitle: Imported\n---\nBody`;
    expect(() =>
      importMarkdownToEntry(root, "posts", markdown, {
        previewHash: "0".repeat(64),
      }),
    ).toThrow(/MARKDOWN_PREVIEW_MISMATCH/);
    expect(store.listEntryFiles(root, "posts")).toEqual([]);
  });

  it("imports lifecycle metadata as a draft", () => {
    const root = fixture();
    const markdown = `---\ntitle: Review first\nstatus: published\n---\nBody`;
    const preview = previewImportMarkdown(root, "posts", markdown);
    expect(preview.normalizedEntryPlan.status).toBe("draft");
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "lifecycle-imported-as-draft" }),
      ]),
    );
    const record = importMarkdownToEntry(root, "posts", markdown, {
      previewHash: preview.previewHash,
    });
    expect(record.entry.status).toBe("draft");
  });
});
