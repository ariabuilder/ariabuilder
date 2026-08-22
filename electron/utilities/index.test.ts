import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchDesignSystem } from "../design";
import {
  activateUtilityLibrary,
  disableUtilityLibrary,
  inspectUtilityManager,
} from "./index";

const roots: string[] = [];

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

function executableAstro(root: string): void {
  const relative = process.platform === "win32"
    ? "node_modules/.bin/astro.cmd"
    : "node_modules/.bin/astro";
  const content = process.platform === "win32"
    ? "@exit /b 0\r\n"
    : "#!/bin/sh\nexit 0\n";
  write(root, relative, content);
  if (process.platform !== "win32") fs.chmodSync(path.join(root, relative), 0o755);
}

function fixture(): { root: string; config: string; page: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-utility-flow-"));
  roots.push(root);
  const config = [
    'import { defineConfig } from "astro/config";',
    "",
    "export default defineConfig({});",
    "",
  ].join("\n");
  const page = "<main>Home</main>\n";
  write(root, "package.json", JSON.stringify({
    dependencies: { astro: "^6.0.0" },
    devDependencies: {
      tailwindcss: "^4.1.0",
      "@tailwindcss/vite": "^4.1.0",
    },
  }, null, 2));
  write(root, "astro.config.mjs", config);
  write(root, "src/pages/index.astro", page);
  executableAstro(root);
  return { root, config, page };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("utility manager flow", () => {
  it("round-trips setup when the project has not adopted the stylesheet", async () => {
    const { root, config, page } = fixture();

    await activateUtilityLibrary(root, "tailwind");
    await disableUtilityLibrary(root, "tailwind");

    expect(fs.readFileSync(path.join(root, "src/pages/index.astro"), "utf8"))
      .toBe(page);
    expect(fs.existsSync(path.join(root, "src/styles/global.css"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "astro.config.mjs"), "utf8"))
      .toBe(config);
  });

  it("activates, follows Aria palette saves, and safely removes owned setup", async () => {
    const { root, config, page } = fixture();
    const progress: string[] = [];

    const activated = await activateUtilityLibrary(root, "tailwind", (event) => {
      progress.push(event.phase);
    });
    expect(activated.inspection.libraries[0]!.status).toBe("active");
    expect(activated.inspection.libraries[0]!.ownership).toBe("aria");
    expect(fs.readFileSync(path.join(root, "astro.config.mjs"), "utf8"))
      .toContain("@tailwindcss/vite");
    expect(fs.readFileSync(path.join(root, "src/pages/index.astro"), "utf8"))
      .toContain("aria:utility-manager:tailwind");
    expect(progress).toContain("complete");

    patchDesignSystem(root, {
      colors: {
        palettes: [{
          id: "primary",
          name: "primary",
          source: "aria",
          shades: { DEFAULT: "#2563eb", "500": "#3b82f6" },
        }],
        semantic: {},
      },
    });
    const stylesheet = fs.readFileSync(
      path.join(root, "src/styles/global.css"),
      "utf8",
    );
    expect(stylesheet).toContain("--primary: #2563eb");
    expect(stylesheet).toContain("--color-primary: var(--primary)");
    expect(stylesheet).toContain("--color-primary-500: var(--primary-500)");

    const disabled = await disableUtilityLibrary(root, "tailwind");
    expect(disabled.inspection.libraries[0]!.ownership).toBe("none");
    const nextPage = fs.readFileSync(path.join(root, "src/pages/index.astro"), "utf8");
    expect(nextPage).toContain('import "../styles/global.css";');
    expect(nextPage).not.toContain("aria:utility-manager:tailwind");
    expect(nextPage).toContain(page.trim());
    const nextConfig = fs.readFileSync(path.join(root, "astro.config.mjs"), "utf8");
    expect(nextConfig).not.toContain("@tailwindcss/vite");
    expect(nextConfig).toContain("defineConfig");
    expect(nextConfig.replace(/\s+/g, " ").trim())
      .toBe(config.replace(/\s+/g, " ").trim());
    expect(fs.existsSync(path.join(root, ".aria", "utilities.json"))).toBe(false);
    expect(inspectUtilityManager(root).libraries[0]!.status).toBe("partial");
  });
});
