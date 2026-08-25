import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSearchService, searchProject } from "./search";

describe("project global search", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-search-"));
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "pages", "blog"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
    fs.mkdirSync(path.join(root, "public", "uploads"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "search-site" }));
    fs.writeFileSync(path.join(root, "src", "pages", "home.astro"), "<h1>Home</h1>\n");
    fs.writeFileSync(
      path.join(root, "src", "pages", "blog", "[slug].astro"),
      "<h1>Dynamic entry</h1>\n",
    );
    fs.writeFileSync(path.join(root, "src", "components", "Hero.astro"), "<section />\n");
    fs.writeFileSync(path.join(root, "public", "uploads", "photo.jpg"), Buffer.from([1, 2, 3]));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("returns bounded typed local entities without source full-text search", async () => {
    const response = await searchProject(root, { query: "home", limit: 20 });
    expect(response.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "page", file: "src/pages/home.astro" }),
    ]));
    expect(response.results.some((result) => result.label.includes("<h1>"))).toBe(false);
  });

  it("returns the closest label for a small typing error", async () => {
    const response = await searchProject(root, { query: "hme", limit: 20 });
    expect(response.results[0]).toEqual(
      expect.objectContaining({ kind: "page", file: "src/pages/home.astro" }),
    );
  });

  it("omits non-navigable dynamic Astro routes", async () => {
    const response = await searchProject(root, { query: "slug", limit: 20 });
    expect(
      response.results.some(
        (result) => result.kind === "page" && result.file.includes("[slug]"),
      ),
    ).toBe(false);
  });

  it("routes History through the Settings workspace section", async () => {
    const response = await searchProject(root, { query: "history", limit: 20 });
    expect(response.results[0]).toEqual(
      expect.objectContaining({
        kind: "destination",
        rail: "settings",
        settingsTab: "history",
      }),
    );
  });

  it("rejects oversized queries and result bounds", async () => {
    await expect(searchProject(root, { query: "x".repeat(129), limit: 20 })).rejects.toThrow();
    await expect(searchProject(root, { query: "", limit: 101 })).rejects.toThrow();
  });

  it("single-flights rapid inventory requests and invalidates only relevant change categories", async () => {
    let releaseScan: (() => void) | undefined;
    const scanProject = vi.fn(() => new Promise((resolve) => {
      releaseScan = () => resolve({ pages: [], components: [], layouts: [] });
    }));
    const service = new ProjectSearchService({
      scanProject: scanProject as never,
      readCollections: vi.fn(() => ({ collections: [] })) as never,
      listEntryInventory: vi.fn() as never,
      listMedia: vi.fn(() => []) as never,
    });

    const first = service.searchProject(root, { query: "design", limit: 20 });
    const second = service.searchProject(root, { query: "settings", limit: 20 });
    expect(scanProject).toHaveBeenCalledTimes(1);
    releaseScan?.();
    await Promise.all([first, second]);

    service.invalidate(root, { category: "style" });
    await service.searchProject(root, { query: "history", limit: 20 });
    expect(scanProject).toHaveBeenCalledTimes(1);

    scanProject.mockResolvedValueOnce({ pages: [], components: [], layouts: [] });
    service.invalidate(root, { category: "structure" });
    await service.searchProject(root, { query: "history", limit: 20 });
    expect(scanProject).toHaveBeenCalledTimes(2);
  });

  it("reads and sorts each collection entry inventory once", async () => {
    const listEntryInventory = vi.fn(() => [
      {
        entry: { id: "older", updatedAt: "2026-08-24T00:00:00.000Z" },
        locales: [{ locale: "en", title: "Older", slug: "older", isSource: true }],
      },
      {
        entry: { id: "newer", updatedAt: "2026-08-25T00:00:00.000Z" },
        locales: [{ locale: "en", title: "Newer", slug: "newer", isSource: true }],
      },
    ]);
    const service = new ProjectSearchService({
      scanProject: vi.fn(async () => ({ pages: [], components: [], layouts: [] })) as never,
      readCollections: vi.fn(() => ({
        collections: [{ id: "posts", name: "posts", label: "Posts" }],
      })) as never,
      listEntryInventory: listEntryInventory as never,
      listMedia: vi.fn(() => []) as never,
    });

    const response = await service.searchProject(root, { query: "", limit: 100 });

    expect(listEntryInventory).toHaveBeenCalledOnce();
    expect(
      response.results
        .filter((result) => result.kind === "entry")
        .map((result) => result.label),
    ).toEqual(["Newer", "Older"]);
  });
});
