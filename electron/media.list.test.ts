import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  duplicateMedia,
  listMedia,
  readMediaPreview,
  renameMedia,
  resolveMediaFilePath,
} from "./media";

describe("media listing across public folders", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-media-list-"));
    fs.mkdirSync(path.join(root, "public", "images", "andy"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(root, "public", "files"), { recursive: true });
    fs.mkdirSync(path.join(root, "public", "uploads"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "media-list-test" }),
    );
    fs.writeFileSync(path.join(root, "public", "robots.txt"), "User-agent: *\n");
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("lists media under every public/* folder and src/assets", () => {
    fs.writeFileSync(path.join(root, "public", "images", "logo.webp"), "img");
    fs.writeFileSync(
      path.join(root, "public", "images", "andy", "portrait.webp"),
      "img",
    );
    fs.writeFileSync(path.join(root, "public", "files", "deck.pdf"), "pdf");
    fs.writeFileSync(path.join(root, "public", "uploads", "hero.png"), "img");
    fs.writeFileSync(path.join(root, "src", "assets", "icon.svg"), "<svg/>");

    const assets = listMedia(root);
    const byId = Object.fromEntries(assets.map((asset) => [asset.id, asset]));

    expect(byId["public/images/logo.webp"]?.url).toBe("/images/logo.webp");
    expect(byId["public/images/andy/portrait.webp"]).toMatchObject({
      url: "/images/andy/portrait.webp",
      folder: "andy",
    });
    expect(byId["public/files/deck.pdf"]?.url).toBe("/files/deck.pdf");
    expect(byId["public/uploads/hero.png"]?.url).toBe("/uploads/hero.png");
    expect(byId["src/assets/icon.svg"]?.url).toBe("/src/assets/icon.svg");
    expect(assets.some((asset) => asset.file.endsWith("robots.txt"))).toBe(
      false,
    );
  });

  it("skips uploads variants directory", () => {
    fs.mkdirSync(path.join(root, "public", "uploads", "variants", "x"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "public", "uploads", "variants", "x", "crop.png"),
      "img",
    );
    fs.writeFileSync(path.join(root, "public", "uploads", "ok.png"), "img");

    const assets = listMedia(root);
    expect(assets.map((asset) => asset.id)).toEqual(["public/uploads/ok.png"]);
  });

  it("allows preview and resolve for public/images paths", () => {
    const file = path.join(root, "public", "images", "logo.webp");
    fs.writeFileSync(file, "img");

    expect(resolveMediaFilePath(root, "public/images/logo.webp")).toBe(
      fs.realpathSync.native(file),
    );
    expect(readMediaPreview(root, "public/images/logo.webp").dataUrl).toMatch(
      /^data:image\/webp;base64,/,
    );
  });

  it("renames public/images assets while preserving /images URLs", () => {
    fs.writeFileSync(path.join(root, "public", "images", "logo.webp"), "img");
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    const page = path.join(root, "src", "pages", "index.astro");
    fs.writeFileSync(page, '<img src="/images/logo.webp" alt="Logo" />\n');

    const renamed = renameMedia(root, "public/images/logo.webp", "brand.webp");

    expect(renamed).toMatchObject({
      id: "public/images/brand.webp",
      url: "/images/brand.webp",
    });
    expect(fs.existsSync(path.join(root, "public", "images", "brand.webp"))).toBe(
      true,
    );
    expect(fs.readFileSync(page, "utf8")).toContain("/images/brand.webp");
  });

  it("duplicates within the same public folder", () => {
    fs.writeFileSync(path.join(root, "public", "images", "logo.webp"), "img");

    const copy = duplicateMedia(root, "public/images/logo.webp");

    expect(copy.id).toBe("public/images/logo-copy.webp");
    expect(copy.url).toBe("/images/logo-copy.webp");
    expect(
      fs.existsSync(path.join(root, "public", "images", "logo-copy.webp")),
    ).toBe(true);
  });
});
