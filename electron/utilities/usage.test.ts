import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanUtilityUsage } from "./usage";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Tailwind disable usage scan", () => {
  it("finds class and apply utilities but ignores Aria setup markers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-utilities-usage-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "Page.astro"),
      '<div class="grid gap-4 project-card" class:list={[active && "md:flex"]}></div>\n',
    );
    fs.writeFileSync(
      path.join(root, "src", "global.css"),
      ".button { @apply px-4 font-semibold; }\n",
    );

    expect(scanUtilityUsage(root)).toEqual(expect.arrayContaining([
      { relativePath: "src/Page.astro", token: "grid" },
      { relativePath: "src/Page.astro", token: "gap-4" },
      { relativePath: "src/Page.astro", token: "md:flex" },
      { relativePath: "src/global.css", token: "px-4" },
      { relativePath: "src/global.css", token: "font-semibold" },
    ]));
    expect(scanUtilityUsage(root).some((item) => item.token === "project-card")).toBe(false);
  });

  it("treats Tailwind CSS directives as project adoption", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-utilities-usage-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "global.css"),
      "@utility tab-4 { tab-size: 4; }\n",
    );

    expect(scanUtilityUsage(root)).toContainEqual({
      relativePath: "src/global.css",
      token: "@utility",
    });
  });

  it("finds Tailwind usage in a top-level styles directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-utilities-usage-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "styles"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "styles", "theme.css"),
      ".card { @apply rounded-lg shadow-md; }\n",
    );

    expect(scanUtilityUsage(root)).toEqual(expect.arrayContaining([
      { relativePath: "styles/theme.css", token: "rounded-lg" },
      { relativePath: "styles/theme.css", token: "shadow-md" },
    ]));
  });
});
