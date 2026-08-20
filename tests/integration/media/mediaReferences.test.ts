import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renameMedia } from "@electron/media";

describe("media reference migration", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-media-references-"));
    fs.mkdirSync(path.join(root, "public", "uploads"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "media-test" }));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("rewrites exact structured references", () => {
    fs.writeFileSync(path.join(root, "public", "uploads", "logo.png"), "image");
    const page = path.join(root, "src", "pages", "index.astro");
    fs.writeFileSync(page, '<img src="/uploads/logo.png" alt="Logo" />\n');

    renameMedia(root, "public/uploads/logo.png", "brand.png");

    expect(fs.readFileSync(page, "utf8")).toContain('/uploads/brand.png');
    expect(fs.existsSync(path.join(root, "public", "uploads", "brand.png"))).toBe(true);
  });

  it("blocks ambiguous expressions instead of rewriting substrings", () => {
    const oldFile = path.join(root, "public", "uploads", "banner.png");
    fs.writeFileSync(oldFile, "image");
    const page = path.join(root, "src", "pages", "index.astro");
    fs.writeFileSync(page, 'const responsive = "/uploads/banner.png?width=800";\n');

    expect(() =>
      renameMedia(root, "public/uploads/banner.png", "hero.png"),
    ).toThrow(/MEDIA_REFERENCE_UNSAFE/);
    expect(fs.existsSync(oldFile)).toBe(true);
    expect(fs.existsSync(path.join(root, "public", "uploads", "hero.png"))).toBe(false);
    expect(fs.readFileSync(page, "utf8")).toContain("banner.png?width=800");
  });
});
