import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEntry, readRevision } from "./store";

function legacyRecord() {
  return {
    entry: {
      id: "one",
      collectionId: "posts",
      status: "scheduled",
      version: "v1",
      authorId: "local-user",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      publishedAt: null,
      scheduledFor: "2026-02-01T00:00:00.000Z",
    },
    locales: [{
      entryId: "one",
      collectionId: "posts",
      locale: "en",
      slug: "one",
      title: "One",
      frontmatter: {
        settings: {
          entry: {
            status: "scheduled",
            scheduledFor: "keep-this-user-value",
          },
        },
      },
      body: null,
      isSource: true,
    }],
  };
}

describe("legacy CMS scheduling migration", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("normalizes only system entry metadata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-cms-store-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    const entryDir = path.join(root, ".aria", "cms", "entries", "posts");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "one.json"), JSON.stringify(legacyRecord()));

    const record = readEntry(root, "posts", "one");
    expect(record?.entry.status).toBe("draft");
    expect(record?.locales[0]?.frontmatter.settings).toEqual({
      entry: {
        status: "scheduled",
        scheduledFor: "keep-this-user-value",
      },
    });
  });

  it("normalizes revision snapshot metadata without rewriting snapshot content", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-cms-revision-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    const revisionDir = path.join(root, ".aria", "cms", "revisions", "one");
    fs.mkdirSync(revisionDir, { recursive: true });
    fs.writeFileSync(path.join(revisionDir, "r1.json"), JSON.stringify({
      id: "r1",
      entryId: "one",
      locale: null,
      version: "v1",
      snapshot: legacyRecord(),
      actorId: "local-user",
      createdAt: "2026-01-01T00:00:00.000Z",
    }));

    const revision = readRevision(root, "one", "r1");
    expect(revision?.snapshot.entry.status).toBe("draft");
    expect(revision?.snapshot.locales[0]?.frontmatter.settings).toEqual({
      entry: {
        status: "scheduled",
        scheduledFor: "keep-this-user-value",
      },
    });
  });
});
