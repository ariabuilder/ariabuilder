import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectComposerFrameworks } from "./frameworks";

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-framework-"));
  roots.push(root);
  for (const [relativeFile, content] of Object.entries(files)) {
    const file = path.join(root, relativeFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Composer framework detection", () => {
  it("reports a plain CSS project without inventing a framework", () => {
    const result = detectComposerFrameworks(
      fixture({
        "package.json": JSON.stringify({ dependencies: {} }),
        "src/styles.css": ".card { color: red; }",
      }),
    );
    expect(result.primary).toBe("none");
    expect(result.confidence).toBe("none");
    expect(result.breakpoints.md).toBe(768);
  });

  it("detects Tailwind 3 config, project tokens, and custom screens", () => {
    const result = detectComposerFrameworks(
      fixture({
        "package.json": JSON.stringify({ devDependencies: { tailwindcss: "^3.4.0" } }),
        "tailwind.config.ts": `export default { theme: { screens: { md: '52rem' } } }`,
        "src/pages/index.astro": `<div class="grid md:gap-8 custom-token"></div>`,
      }),
    );
    expect(result.primary).toBe("tailwind");
    expect(result.confidence).toBe("configured");
    expect(result.breakpoints.md).toBe(832);
    expect(result.candidates).toContain("custom-token");
  });

  it("detects Tailwind 4 CSS directives and theme breakpoints", () => {
    const result = detectComposerFrameworks(
      fixture({
        "package.json": JSON.stringify({ dependencies: { "@tailwindcss/vite": "^4.0.0" } }),
        "src/global.css": `@import "tailwindcss";\n@theme { --breakpoint-tablet: 50rem; }`,
      }),
    );
    expect(result.primary).toBe("tailwind");
    expect(result.breakpoints.tablet).toBe(800);
    expect(result.sources).toContain("src/global.css");
  });

  it("detects UnoCSS configuration and existing shortcuts", () => {
    const result = detectComposerFrameworks(
      fixture({
        "package.json": JSON.stringify({ devDependencies: { unocss: "^66.0.0" } }),
        "uno.config.ts": `import { defineConfig } from 'unocss'; export default defineConfig({ shortcuts: {} })`,
        "src/App.vue": `<main class="page-shell hover:bg-brand"></main>`,
      }),
    );
    expect(result.primary).toBe("unocss");
    expect(result.confidence).toBe("configured");
    expect(result.candidates).toContain("page-shell");
  });
});
