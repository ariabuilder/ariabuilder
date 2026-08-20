import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearProjectIconCache,
  resolveProjectIcons,
  searchProjectIcons,
} from "./iconProvider";

describe("project icon provider", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-icon-provider-"));
    fs.mkdirSync(path.join(root, ".aria"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "@iconify-json", "test-pack"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "icon-test",
        dependencies: { "@iconify-json/test-pack": "1.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(root, ".aria", "design-meta.json"),
      JSON.stringify({ enabledIconPacks: ["test-pack"] }),
    );
    fs.writeFileSync(
      path.join(root, "node_modules", "@iconify-json", "test-pack", "package.json"),
      JSON.stringify({
        name: "@iconify-json/test-pack",
        version: "1.0.0",
        exports: { "./icons.json": "./icons.json" },
      }),
    );
    fs.writeFileSync(
      path.join(root, "node_modules", "@iconify-json", "test-pack", "icons.json"),
      JSON.stringify({
        prefix: "test-pack",
        width: 24,
        height: 24,
        icons: {
          star: { body: '<path d="M1 1h22v22H1z"/>' },
          sun: { body: '<circle cx="12" cy="12" r="5"/>' },
        },
        aliases: { favorite: { parent: "star", hFlip: true } },
      }),
    );
    clearProjectIconCache();
  });

  afterEach(() => {
    clearProjectIconCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("searches enabled installed packs with pagination and aliases", () => {
    const first = searchProjectIcons(root, { pack: "test-pack", limit: 2 });
    expect(first.items.map((item) => item.name)).toEqual(["favorite", "star"]);
    expect(first.nextCursor).toBeTruthy();

    const second = searchProjectIcons(root, {
      pack: "test-pack",
      cursor: first.nextCursor,
      limit: 2,
    });
    expect(second.items.map((item) => item.name)).toEqual(["sun"]);
    expect(second.nextCursor).toBeNull();

    expect(
      searchProjectIcons(root, { pack: "test-pack", query: "fav" }).items,
    ).toMatchObject([{ id: "test-pack:favorite", label: "Favorite" }]);
  });

  it("resolves icons and aliases as isolated SVG data URLs", () => {
    const result = resolveProjectIcons(root, [
      "test-pack:star",
      "test-pack:favorite",
      "test-pack:missing",
    ]);
    expect(result.icons["test-pack:star"]?.dataUrl).toMatch(
      /^data:image\/svg\+xml;charset=utf-8,/,
    );
    expect(result.icons["test-pack:favorite"]?.viewBox).toBe("0 0 24 24");
    expect(result.missing).toEqual(["test-pack:missing"]);
  });

  it("rejects disabled, missing, malformed, and invalid packs", () => {
    expect(() => searchProjectIcons(root, { pack: "../test-pack" })).toThrow(
      "Invalid icon pack",
    );
    fs.writeFileSync(
      path.join(root, ".aria", "design-meta.json"),
      JSON.stringify({ enabledIconPacks: [] }),
    );
    expect(() => searchProjectIcons(root, { pack: "test-pack" })).toThrow(
      "not enabled",
    );
  });

  it("invalidates cached package data when the file changes", () => {
    const file = path.join(
      root,
      "node_modules",
      "@iconify-json",
      "test-pack",
      "icons.json",
    );
    const before = searchProjectIcons(root, { pack: "test-pack" });
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    payload.icons.moon = { body: '<circle cx="12" cy="12" r="8"/>' };
    fs.writeFileSync(file, `${JSON.stringify(payload)} `);
    const after = searchProjectIcons(root, { pack: "test-pack" });
    expect(after.items.some((item) => item.name === "moon")).toBe(true);
    expect(after.snapshotVersion).not.toBe(before.snapshotVersion);
  });
});
