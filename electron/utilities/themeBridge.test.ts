import { describe, expect, it } from "vitest";
import type { DesignColorPalette } from "../../shared/design";
import {
  applyTailwindThemeBridge,
  removeManagedTailwindStylesheet,
} from "./themeBridge";

const palettes: DesignColorPalette[] = [
  {
    id: "primary",
    name: "primary",
    source: "aria",
    shades: { DEFAULT: "#2563eb", "500": "#3b82f6" },
  },
  {
    id: "site-brand",
    name: "brand",
    source: "site",
    shades: { DEFAULT: "#111111" },
  },
];

describe("Tailwind palette bridge", () => {
  it("creates inline color aliases without rewriting Aria values", () => {
    const result = applyTailwindThemeBridge(
      "/* Site styles */\n",
      palettes,
      { success: "#16a34a" },
      { ensureTailwindImport: true },
    );

    expect(result.content.startsWith('@import "tailwindcss";')).toBe(true);
    expect(result.content).toContain("@theme inline");
    expect(result.content).toContain("--color-primary: var(--primary)");
    expect(result.content).toContain("--color-primary-500: var(--primary-500)");
    expect(result.content).toContain("--color-success: var(--success)");
    expect(result.content).not.toContain("--color-brand");
    expect(result.aliasCount).toBe(3);
  });

  it("preserves project-owned aliases and reports collisions", () => {
    const result = applyTailwindThemeBridge(
      '@import "tailwindcss";\n@theme { --color-primary: #000; }\n',
      palettes,
      {},
    );

    expect(result.collisions).toEqual(["primary"]);
    expect(result.content.match(/--color-primary:/g)).toHaveLength(1);
    expect(result.content).toContain("--color-primary-500");
  });

  it("removes only Aria-owned Tailwind CSS", () => {
    const original = ".site-rule { color: red; }\n";
    const active = applyTailwindThemeBridge(
      original,
      palettes,
      {},
      { ensureTailwindImport: true },
    );
    const removed = removeManagedTailwindStylesheet(
      active.content,
      active.importOwned,
    );

    expect(removed).toBe(original);
  });

  it("can apply collisions discovered in another stylesheet", () => {
    const result = applyTailwindThemeBridge(
      '@import "tailwindcss";\n',
      palettes,
      {},
      { collisionContent: "@theme { --color-primary: #111; }" },
    );
    expect(result.collisions).toEqual(["primary"]);
    expect(result.content).not.toContain("--color-primary: var(--primary)");
  });
});
