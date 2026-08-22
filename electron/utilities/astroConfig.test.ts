import { describe, expect, it } from "vitest";
import {
  analyzeAstroConfig,
  createAstroConfigWithTailwind,
  patchAstroConfig,
  removeManagedAstroConfig,
} from "./astroConfig";

describe("Tailwind Astro config patching", () => {
  it("adds and removes a managed vite block without changing existing integrations", () => {
    const before = [
      'import { defineConfig } from "astro/config";',
      'import sitemap from "@astrojs/sitemap";',
      "",
      "export default defineConfig({",
      "  integrations: [sitemap()],",
      "});",
      "",
    ].join("\n");
    const patch = patchAstroConfig(before);

    expect(analyzeAstroConfig(patch.content).configured).toBe(true);
    expect(patch.pluginPatch).toBe("vite-block");
    expect(patch.content).toContain("integrations: [sitemap()]");

    const removed = removeManagedAstroConfig(
      patch.content,
      patch.pluginPatch,
      patch.importOwned,
    );
    expect(removed).toContain("integrations: [sitemap()]");
    expect(removed).not.toContain("@tailwindcss/vite");
    expect(analyzeAstroConfig(removed).configured).toBe(false);
  });

  it("adds one marked item to an existing Vite plugin array", () => {
    const before = [
      'import { defineConfig } from "astro/config";',
      'import legacy from "./legacy.js";',
      "export default defineConfig({ vite: { plugins: [legacy()] } });",
    ].join("\n");
    const patch = patchAstroConfig(before);

    expect(patch.pluginPatch).toBe("array-item");
    expect(patch.content).toContain("legacy()");
    expect(analyzeAstroConfig(patch.content).configured).toBe(true);
  });

  it("fails closed for dynamic Vite plugins", () => {
    const source = 'export default defineConfig({ vite: getViteConfig() });\n';
    expect(analyzeAstroConfig(source).safeToPatch).toBe(false);
    expect(() => patchAstroConfig(source)).toThrow("dynamic");
  });

  it("fails closed for method-style Vite config", () => {
    const source = "export default defineConfig({ vite() { return {}; } });\n";
    expect(analyzeAstroConfig(source).safeToPatch).toBe(false);
  });

  it("avoids an existing ariaTailwindcss identifier", () => {
    const source = "const ariaTailwindcss = 1;\nexport default defineConfig({});\n";
    const patch = patchAstroConfig(source);
    expect(patch.content).toContain("import ariaTailwindcss2");
    expect(patch.content).toContain("plugins: [ariaTailwindcss2()]");
  });

  it("creates a complete static Astro config", () => {
    const source = createAstroConfigWithTailwind();
    expect(analyzeAstroConfig(source).configured).toBe(true);
  });
});
