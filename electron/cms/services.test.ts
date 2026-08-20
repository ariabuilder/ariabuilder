import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCollections, writeCollections } from "../collections";
import { normalizeCmsMediaId } from "./mediaReferences";
import * as store from "./store";
import {
  createEntry,
  deleteCollections,
  findInboundEntryUsages,
  publishEntry,
} from "./services";

const roots: string[] = [];

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-cms-services-"));
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
        schema: {
          fields: [
            { key: "content", label: "Content", type: "structuredText" },
          ],
          version: 1,
        },
      },
    ],
  });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("CMS service edge cases", () => {
  it("deletes confirmed collections together with their entries", () => {
    const root = fixture();
    createEntry(root, {
      collectionId: "posts",
      title: "First post",
    });
    const state = readCollections(root);

    expect(() =>
      deleteCollections(root, ["posts"], state.revision!),
    ).toThrow(/CONTENT_IN_USE.*1 entry/);

    expect(
      deleteCollections(root, ["posts"], state.revision!, {
        deleteEntries: true,
      }),
    ).toEqual({ deleted: ["posts"] });
    expect(readCollections(root).collections).toEqual([]);
    expect(store.listEntryFiles(root, "posts")).toEqual([]);
  });

  it("accepts canonical structured text and reports its entry links as inbound usage", () => {
    const root = fixture();
    const target = createEntry(root, {
      collectionId: "posts",
      title: "Target",
    });
    const content = [
      {
        _type: "block" as const,
        _key: "block-1",
        style: "normal" as const,
        markDefs: [
          {
            _type: "entryLink" as const,
            _key: "link-1",
            collectionId: "posts",
            entryId: target.entry.id,
          },
        ],
        children: [
          {
            _type: "span" as const,
            _key: "span-1",
            text: "Target",
            marks: ["link-1"],
          },
        ],
      },
    ];
    const source = createEntry(root, {
      collectionId: "posts",
      title: "Source",
      frontmatter: { content },
    });

    expect(findInboundEntryUsages(root, target.entry.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceEntryId: source.entry.id,
          fieldKey: expect.stringContaining("content"),
        }),
      ]),
    );
  });

  it("blocks malformed structured bodies and temporary media at publication boundaries", () => {
    const root = fixture();
    const entry = createEntry(root, {
      collectionId: "posts",
      title: "Malformed",
      body: { unsupported: true },
    });
    expect(() =>
      publishEntry(root, "posts", entry.entry.id, {
        version: entry.entry.version,
      }),
    ).toThrow(/body: Invalid structured text/);
    expect(() => normalizeCmsMediaId(root, "blob:temporary")).toThrow(
      /Temporary blob media/,
    );
  });
});
