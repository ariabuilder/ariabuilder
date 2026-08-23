import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  planGlobalStylesheetImports,
  removeManagedSourceImport,
} from "./sourceImports";

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-utilities-source-"));
  roots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("global stylesheet source imports", () => {
  it("patches Astro frontmatter and can remove the exact managed line", () => {
    const root = fixture({
      "src/pages/index.astro": "<main>Hello</main>\n",
    });
    const plan = planGlobalStylesheetImports(root, "src/styles/global.css");

    expect(plan.blockedFiles).toEqual([]);
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0]!.after).toContain('import "../styles/global.css";');
    expect(removeManagedSourceImport(
      plan.edits[0]!.after,
      plan.edits[0]!.createdFrontmatter,
    )).toBe("<main>Hello</main>\n");
  });

  it("fails closed for Markdown pages without a static layout", () => {
    const root = fixture({
      "src/pages/about.md": "---\ntitle: About\n---\n\nAbout\n",
    });
    const plan = planGlobalStylesheetImports(root, "src/styles/global.css");

    expect(plan.blockedFiles).toEqual(["src/pages/about.md"]);
  });

  it("accepts Markdown routed through a static Astro layout", () => {
    const root = fixture({
      "src/pages/about.md": "---\ntitle: About\nlayout: ../layouts/Docs.astro\n---\n",
      "src/layouts/Docs.astro": "<slot />\n",
    });
    const plan = planGlobalStylesheetImports(root, "src/styles/global.css");

    expect(plan.blockedFiles).toEqual([]);
    expect(plan.edits.some((edit) => edit.relativePath === "src/layouts/Docs.astro")).toBe(true);
  });
});
