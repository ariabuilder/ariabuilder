import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeCollectionsWithContentConfig } from "@electron/cms/contentSync";
import { readCollections } from "@electron/collections";

describe("coordinated collection content config writes", () => {
  it("does not persist a collection when an unmarked external config cannot be integrated", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aria-content-config-"));
    mkdirSync(path.join(root, "src"), { recursive: true });
    const config = path.join(root, "src/content.config.ts");
    writeFileSync(config, 'export const collections = { external: remoteLoader() };\n');

    expect(() => writeCollectionsWithContentConfig(root, { collections: [{
      id: "posts", name: "posts", label: "Posts", kind: "content",
      urlPattern: "/posts/{slug}", listPageFile: null, templatePageFile: null,
      schema: { version: 1, fields: [] }, supports: [], scope: "global",
    }] })).toThrow(/will not replace an existing unmarked content\.config/);

    expect(readCollections(root).collections).toEqual([]);
    expect(readFileSync(config, "utf8")).toContain("remoteLoader");
    expect(existsSync(path.join(root, ".aria/collections.json"))).toBe(false);
  });
});
