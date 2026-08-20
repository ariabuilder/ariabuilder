import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectFontsourceRuntime,
  discoverFontsourceFonts,
  mergeFontsourceFonts,
  stripFontsourceFontsFromContent,
} from "./fontsourceDiscovery";

describe("fontsourceDiscovery", () => {
  it("parses CSS and JS Fontsource imports", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-fontsource-"));
    try {
      fs.mkdirSync(path.join(root, "src", "styles"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "src", "styles", "global.css"),
        [
          '@import "@fontsource-variable/inter";',
          '@import "@fontsource/open-sans/400.css";',
          "",
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(root, "src", "layout.ts"),
        'import "@fontsource-variable/outfit";\n',
      );

      const discovered = discoverFontsourceFonts(root);
      expect(discovered).toEqual([
        { id: "inter", family: "Inter", variable: true },
        { id: "open-sans", family: "Open Sans", variable: false },
        { id: "outfit", family: "Outfit", variable: true },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets meta win on family and variable when merging", () => {
    const merged = mergeFontsourceFonts(
      [{ id: "inter", family: "Inter Display", variable: false }],
      [{ id: "inter", family: "Inter", variable: true }],
    );
    expect(merged).toEqual([
      { id: "inter", family: "Inter Display", variable: false },
    ]);
  });

  it("strips matching package imports and leaves others", () => {
    const source = [
      '@import "@fontsource-variable/inter";',
      '@import "@fontsource/open-sans/400.css";',
      'import "@fontsource-variable/outfit";',
      "",
    ].join("\n");

    const { content, changed } = stripFontsourceFontsFromContent(source, [
      { id: "inter", variable: true },
      { id: "open-sans", variable: false },
    ]);

    expect(changed).toBe(true);
    expect(content).not.toContain("@fontsource-variable/inter");
    expect(content).not.toContain("@fontsource/open-sans");
    expect(content).toContain("@fontsource-variable/outfit");
  });

  it("detects installed fontsource packages from package.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-fontsource-pkg-"));
    try {
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
          dependencies: {
            "@fontsource-variable/inter": "^5.0.0",
            lodash: "4.0.0",
          },
          devDependencies: {
            "@fontsource/open-sans": "^5.0.0",
          },
        }),
      );
      expect(detectFontsourceRuntime(root).installedPackages).toEqual([
        "@fontsource-variable/inter",
        "@fontsource/open-sans",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
