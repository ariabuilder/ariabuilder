import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectUtilityManager } from "./inspection";

const roots: string[] = [];
const outsideFiles: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-utilities-inspect-"));
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
  for (const file of outsideFiles.splice(0)) fs.rmSync(file, { force: true });
});
describe("utility manager inspection", () => {
  it("detects a project-managed Tailwind 4 setup", () => {
    const root = fixture({
      "package.json": JSON.stringify({
        dependencies: { astro: "^6.0.0" },
        devDependencies: {
          tailwindcss: "^4.1.0",
          "@tailwindcss/vite": "^4.1.0",
        },
      }),
      "astro.config.mjs": [
        'import { defineConfig } from "astro/config";',
        'import tailwindcss from "@tailwindcss/vite";',
        "export default defineConfig({ vite: { plugins: [tailwindcss()] } });",
      ].join("\n"),
      "src/styles/global.css": '@import "tailwindcss";\n',
    });

    const library = inspectUtilityManager(root).libraries[0]!;
    expect(library.status).toBe("active");
    expect(library.ownership).toBe("project");
    expect(library.primaryAction).toBe("connect");
  });

  it("offers activation for a supported plain Astro project", () => {
    const root = fixture({
      "package.json": JSON.stringify({ dependencies: { astro: "^5.2.0" } }),
      "astro.config.mjs": 'import { defineConfig } from "astro/config";\nexport default defineConfig({});\n',
    });

    const library = inspectUtilityManager(root).libraries[0]!;
    expect(library.status).toBe("inactive");
    expect(library.primaryAction).toBe("activate");
  });

  it("accepts supported major-only dependency ranges", () => {
    const root = fixture({
      "package.json": JSON.stringify({ dependencies: { astro: "^6" } }),
      "astro.config.mjs": 'import { defineConfig } from "astro/config";\nexport default defineConfig({});\n',
    });

    const library = inspectUtilityManager(root).libraries[0]!;
    expect(library.status).toBe("inactive");
    expect(library.primaryAction).toBe("activate");
  });

  it("blocks Tailwind 3 instead of attempting an implicit migration", () => {
    const root = fixture({
      "package.json": JSON.stringify({
        dependencies: { astro: "^5.2.0" },
        devDependencies: { tailwindcss: "^3.4.0" },
      }),
    });

    const library = inspectUtilityManager(root).libraries[0]!;
    expect(library.status).toBe("blocked");
    expect(library.diagnostics.some((item) => item.code === "tailwind_version_unsupported"))
      .toBe(true);
  });

  it("rejects a receipt stylesheet path outside the project", () => {
    const root = fixture({
      "package.json": JSON.stringify({
        dependencies: { astro: "^6" },
        devDependencies: {
          tailwindcss: "^4",
          "@tailwindcss/vite": "^4",
        },
      }),
      "astro.config.mjs": 'import { defineConfig } from "astro/config";\nexport default defineConfig({});\n',
    });
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.css`);
    outsideFiles.push(outside);
    fs.writeFileSync(outside, '@import "tailwindcss";\n');
    const receipt = {
      version: 1,
      library: "tailwind",
      tailwindVersion: 4,
      activatedAt: new Date().toISOString(),
      packageManager: "npm",
      connection: "installed",
      packagesOwned: [],
      config: {
        relativePath: "astro.config.mjs",
        created: false,
        importOwned: false,
        pluginPatch: "none",
      },
      stylesheet: {
        relativePath: `../${path.basename(outside)}`,
        created: false,
        importOwned: false,
        beforeHash: null,
      },
      sourceImports: [],
    };
    const receiptFile = path.join(root, ".aria", "utilities.json");
    fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
    fs.writeFileSync(receiptFile, JSON.stringify(receipt));

    const library = inspectUtilityManager(root).libraries[0]!;
    expect(library.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "stylesheet_unreadable",
        message: "Path is outside the project",
      }),
    ]));
  });
});
