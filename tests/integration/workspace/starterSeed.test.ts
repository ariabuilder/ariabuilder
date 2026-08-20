import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCollections } from "@electron/collections";
import { seedAriaStarter } from "@electron/starterSeed";

describe.sequential("Aria starter seed", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-starter-"));
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "starter" }));
    fs.writeFileSync(path.join(root, "src", "pages", "index.astro"), "<h1>Keep me</h1>\n");
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("is idempotent and never overwrites an existing page", async () => {
    await seedAriaStarter(root);
    const firstCollections = readCollections(root).collections.map((item) => item.name).sort();
    const firstHome = fs.readFileSync(path.join(root, "src", "pages", "index.astro"), "utf8");

    await seedAriaStarter(root);
    const secondCollections = readCollections(root).collections.map((item) => item.name).sort();

    expect(firstCollections).toEqual(["authors", "blog", "tags"]);
    expect(secondCollections).toEqual(firstCollections);
    expect(firstHome).toBe("<h1>Keep me</h1>\n");
    expect(fs.readFileSync(path.join(root, "src", "pages", "index.astro"), "utf8")).toBe(firstHome);
    expect(fs.existsSync(path.join(root, "src", "layouts", "BaseLayout.astro"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src", "pages", "404.astro"))).toBe(true);
  });
});
