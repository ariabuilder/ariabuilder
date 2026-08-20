import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_DESIGN_META, type DesignTokenSource } from "../../shared/design";
import { configureMutationCoordinator } from "../mutations";
import { executeDesignEdit } from "../agent/designEdit";
import { listProjectStylesheets } from "./discovery";
import {
  applyDesignTokenMutation,
  getDesignSnapshot,
  patchDesignSystem,
  selectDesignTokenSource,
} from "./index";
import { readDesignMeta } from "./meta";
import {
  DESIGN_SOURCE_ADAPTERS,
  discoverDesignTokenIndex,
  planDesignTokenMutation,
} from "./sourceAdapters";

const roots: string[] = [];

function fixture(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aria-design-${name}-`));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: `fixture-${name}`, devDependencies: { tailwindcss: "^4.0.0" } }),
  );
  return root;
}

function write(root: string, relativeFile: string, content: string): void {
  const file = path.join(root, ...relativeFile.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function discover(root: string) {
  return discoverDesignTokenIndex(
    root,
    listProjectStylesheets(root),
    structuredClone(EMPTY_DESIGN_META),
  );
}

function source(
  root: string,
  tokenId: string,
  provider: DesignTokenSource["provider"],
): DesignTokenSource {
  const token = discover(root).tokens.find((candidate) => candidate.id === tokenId);
  const found = token?.sources.find((candidate) => candidate.provider === provider);
  if (!found) throw new Error(`Missing ${provider} source for ${tokenId}`);
  return found;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("source-aware design discovery", () => {
  it("indexes a Foxi-shaped Tailwind palette and complete utility usage", () => {
    const root = fixture("foxi");
    const shades = {
      50: "#FFF1F7",
      100: "#FFE4F0",
      200: "#FFC8E0",
      300: "#FF9AC7",
      400: "#F75AA4",
      500: "#E2187D",
      600: "#C51067",
      700: "#A50F56",
      800: "#891148",
      900: "#72133F",
      950: "#460520",
    };
    write(
      root,
      "tailwind.config.mjs",
      `/** Foxi theme — preserve this comment. */\nexport default {\n  theme: {\n    extend: {\n      colors: {\n        primary: ${JSON.stringify(shades, null, 10)}\n      }\n    }\n  },\n  plugins: [],\n};\n`,
    );
    write(
      root,
      "src/pages/index.astro",
      `<main class="text-primary-500 hover:bg-primary-600 md:border-primary-300 [&>strong]:text-primary-700 text-primary-500/80">\n  <strong class="ring-primary-500">Foxi</strong>\n</main>\n<style>.cta { @apply shadow-primary-500; }</style>\n`,
    );

    const index = discover(root);
    const primary = index.sitePalettes.find((palette) => palette.name === "primary");
    const token = index.tokens.find((candidate) => candidate.id === "color.primary.500");

    expect(DESIGN_SOURCE_ADAPTERS.map((adapter) => adapter.id)).toEqual([
      "css",
      "tailwind-config",
    ]);
    expect(primary?.shades).toHaveProperty("500", "#E2187D");
    expect(Object.keys(primary?.shades ?? {})).toHaveLength(11);
    expect(token).toMatchObject({ usageCount: 7, ambiguous: false });
    expect(token?.usedIn).toEqual(["src/pages/index.astro"]);
    expect(token?.sources[0]).toMatchObject({
      provider: "tailwind-config",
      relativeFile: "tailwind.config.mjs",
      pointer: "theme.extend.colors.primary.500",
      authoredValue: "#E2187D",
      resolvedValue: "#E2187D",
      writable: true,
    });
    expect(index.sourceFiles).toEqual(
      expect.arrayContaining([
        "package.json",
        "tailwind.config.mjs",
        "src/pages/index.astro",
      ]),
    );
    expect(index.siteTokenRefs.find((item) => item.family === "primary")).toBeUndefined();
  });

  it("preserves CSS aliases, Tailwind @theme provenance, and dark modes", () => {
    const root = fixture("css-modes");
    write(
      root,
      "src/styles/global.css",
      `:root {\n  --brand: #E2187D;\n  --color-primary-500: var(--brand);\n}\n@theme { --color-secondary-500: oklch(62% 0.2 10); }\n.dark {\n  --brand: #FF75B5;\n  --color-primary-500: var(--brand);\n}\n`,
    );

    const index = discover(root);
    const primary = index.tokens.find((token) => token.id === "color.primary.500");
    const secondary = index.tokens.find((token) => token.id === "color.secondary.500");
    const defaultSource = primary?.sources.find((item) => item.mode.id === "default");
    const darkSource = primary?.sources.find((item) => item.mode.id === "dark");

    expect(defaultSource).toMatchObject({
      provider: "css",
      authoredValue: "var(--brand)",
      resolvedValue: "#E2187D",
      writable: true,
    });
    expect(darkSource).toMatchObject({
      mode: { id: "dark", label: "Dark", selector: ".dark" },
      authoredValue: "var(--brand)",
      resolvedValue: "#FF75B5",
    });
    expect(secondary?.sources[0]).toMatchObject({
      provider: "tailwind-theme",
      resolvedValue: "oklch(62% 0.2 10)",
    });
  });

  it("resolves color-mix() tokens that reference other CSS variables", () => {
    const root = fixture("css-color-mix");
    write(
      root,
      "src/styles/global.css",
      `:root {\n  --accent: #E2187D;\n  --color-bg: oklch(0.2 0.02 250);\n  --header-bg: color-mix(in oklab, var(--color-bg), transparent 28%);\n}\n@theme {\n  --color-brand-hover: color-mix(in oklab, var(--accent), #ffffff 10%);\n}\n:root[data-theme="light"] {\n  --header-bg: color-mix(in oklab, var(--color-bg), transparent 8%);\n}\n`,
    );

    const index = discover(root);
    const brandHover = index.tokens.find((token) => token.id === "color.brand-hover.DEFAULT");
    const headerBg = index.tokens.find((token) => token.id === "color.header-bg.DEFAULT");
    const defaultHeader = headerBg?.sources.find((item) => item.mode.id === "default");
    const lightHeader = headerBg?.sources.find((item) =>
      item.pointer.includes('[data-theme="light"]'),
    );

    expect(brandHover?.sources[0]).toMatchObject({
      provider: "tailwind-theme",
      authoredValue: "color-mix(in oklab, var(--accent), #ffffff 10%)",
      resolvedValue: "color-mix(in oklab, #E2187D, #ffffff 10%)",
    });
    expect(defaultHeader).toMatchObject({
      authoredValue: "color-mix(in oklab, var(--color-bg), transparent 28%)",
      resolvedValue: "color-mix(in oklab, oklch(0.2 0.02 250), transparent 28%)",
    });
    expect(lightHeader).toMatchObject({
      authoredValue: "color-mix(in oklab, var(--color-bg), transparent 8%)",
      resolvedValue: "color-mix(in oklab, oklch(0.2 0.02 250), transparent 8%)",
    });
    expect(index.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DESIGN_CSS_COLOR_UNRESOLVED" }),
      ]),
    );
  });

  it("counts unshaded utilities and CSS variable references for discovered families", () => {
    const root = fixture("css-usage");
    write(
      root,
      "src/styles/global.css",
      `@theme {\n  --color-soft: #eeeeee;\n  --color-muted: #888888;\n  --header-bg: color-mix(in oklab, var(--color-muted), transparent 28%);\n}\n.hero {\n  color: var(--color-soft);\n  background: var(--muted);\n}\n`,
    );
    write(
      root,
      "src/pages/index.astro",
      `<section class="bg-soft text-muted bg-cover">Hero</section>\n`,
    );

    const index = discover(root);
    const soft = index.tokens.find((token) => token.id === "color.soft.DEFAULT");
    const muted = index.tokens.find((token) => token.id === "color.muted.DEFAULT");

    expect(soft).toMatchObject({
      usageCount: 2,
      usedIn: ["src/pages/index.astro", "src/styles/global.css"],
    });
    expect(muted).toMatchObject({
      usageCount: 3,
      usedIn: ["src/pages/index.astro", "src/styles/global.css"],
    });
    expect(index.siteTokenRefs.find((item) => item.family === "cover")).toBeUndefined();
  });

  it.each([
    ["tailwind.config.mjs", `export default defineConfig({ theme: { colors: { brand: { 500: "#E2187D" } } } });`],
    ["tailwind.config.cjs", `module.exports = { theme: { extend: { colors: { brand: { 500: '#E2187D' } } } } };`],
    ["tailwind.config.ts", `const config = { theme: { extend: { colors: { brand: { 500: \`#E2187D\` } } } } } satisfies Config;\nexport default config;`],
  ])("reads static %s without executing it", (relativeFile, content) => {
    const root = fixture(relativeFile.replaceAll(".", "-"));
    write(root, relativeFile, content);
    expect(source(root, "color.brand.500", "tailwind-config")).toMatchObject({
      resolvedValue: "#E2187D",
      writable: true,
    });
  });

  it("applies provable Tailwind theme then extend precedence without ambiguity", () => {
    const root = fixture("tailwind-precedence");
    write(
      root,
      "tailwind.config.mjs",
      `export default { theme: {\n  colors: { primary: { 500: '#111111' } },\n  extend: { colors: { primary: { 500: '#E2187D' } } },\n} };\n`,
    );
    const index = discover(root);
    const token = index.tokens.find((item) => item.id === "color.primary.500")!;
    expect(token.sources).toHaveLength(2);
    expect(token.ambiguous).toBe(false);
    expect(token.sources.find((item) => item.id === token.activeSourceId)?.resolvedValue)
      .toBe("#E2187D");
  });

  it("fails closed for imports, functions, spreads, and shared literal aliases", () => {
    const root = fixture("dynamic");
    write(
      root,
      "tailwind.config.ts",
      `import colors from "./colors";\nconst shared = "#E2187D";\nexport default {\n  theme: { extend: { colors: { ...colors, safe: { 500: shared }, dynamic: makeColors() } } }\n};\n`,
    );

    const index = discover(root);
    const shared = index.tokens.find((token) => token.id === "color.safe.500")?.sources[0];
    expect(shared).toMatchObject({
      authoredValue: "#E2187D",
      resolvedValue: "#E2187D",
      writable: false,
    });
    expect(shared?.writeReason).toMatch(/shared/i);
    expect(index.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DESIGN_TAILWIND_TOKEN_UNRESOLVED" }),
      ]),
    );
  });
});

describe("source-aware design mutations", () => {
  it("requires an explicit source choice, preserves config formatting, and rejects stale hashes", async () => {
    const root = fixture("mutate");
    const history = fs.mkdtempSync(path.join(os.tmpdir(), "aria-design-history-"));
    roots.push(history);
    configureMutationCoordinator(history);
    write(root, "src/styles/global.css", `:root { --color-primary-500: #D00070; }\n`);
    const original = `/** keep */\nexport default {\n  theme: { extend: { colors: {\n    primary: {\n      500: '#E2187D', // brand pink\n      600: '#C51067',\n    },\n  } } },\n  plugins: [],\n};\n`;
    write(root, "tailwind.config.mjs", original);

    const ambiguous = getDesignSnapshot(root);
    const token = ambiguous.tokens.find((item) => item.id === "color.primary.500")!;
    const tailwind = token.sources.find((item) => item.provider === "tailwind-config")!;
    expect(token.ambiguous).toBe(true);
    expect(() =>
      planDesignTokenMutation(root, ambiguous, {
        tokenId: token.id,
        sourceId: tailwind.id,
        value: "#F00080",
        expectedRevision: ambiguous.revision,
        expectedSourceHash: tailwind.sourceHash,
      }),
    ).toThrow(/DESIGN_SOURCE_AMBIGUOUS/);

    const selected = await selectDesignTokenSource(root, {
      tokenId: token.id,
      sourceId: tailwind.id,
      expectedRevision: ambiguous.revision,
    });
    const selectedToken = selected.snapshot.tokens.find((item) => item.id === token.id)!;
    const selectedSource = selectedToken.sources.find((item) => item.id === tailwind.id)!;
    expect(selectedToken.ambiguous).toBe(false);

    const changed = await applyDesignTokenMutation(root, {
      tokenId: token.id,
      sourceId: selectedSource.id,
      value: "#F00080",
      expectedRevision: selected.snapshot.revision,
      expectedSourceHash: selectedSource.sourceHash,
    });
    const written = fs.readFileSync(path.join(root, "tailwind.config.mjs"), "utf8");
    expect(written).toBe(original.replace("'#E2187D'", "'#F00080'"));
    expect(changed.changedFiles).toEqual(["tailwind.config.mjs"]);
    expect(changed.snapshot.colors.palettes.find((item) => item.name === "primary")?.shades["500"])
      .toBe("#F00080");

    await expect(
      applyDesignTokenMutation(root, {
        tokenId: token.id,
        sourceId: selectedSource.id,
        value: "#FF0088",
        expectedRevision: selected.snapshot.revision,
        expectedSourceHash: selectedSource.sourceHash,
      }),
    ).rejects.toThrow(/DESIGN_SOURCE_CONFLICT/);
  });

  it("patches CSS declaration ranges and keeps authored aliases intact", () => {
    const root = fixture("css-write");
    const css = `:root {\n  --brand: #E2187D; /* keep */\n  --color-primary-500: var(--brand);\n}\n`;
    write(root, "src/styles/global.css", css);
    const snapshot = getDesignSnapshot(root);
    const token = snapshot.tokens.find((item) => item.id === "color.brand.DEFAULT")!;
    const cssSource = token.sources.find((item) => item.provider === "css")!;
    const plan = planDesignTokenMutation(root, snapshot, {
      tokenId: token.id,
      sourceId: cssSource.id,
      value: "#F00080",
      expectedRevision: snapshot.revision,
      expectedSourceHash: cssSource.sourceHash,
    });
    expect(plan.nextContent).toBe(css.replace("#E2187D", "#F00080"));
    expect(snapshot.tokens.find((item) => item.id === "color.primary.500")?.sources[0])
      .toMatchObject({ authoredValue: "var(--brand)", resolvedValue: "#E2187D" });
  });

  it("copies concrete values into Aria without changing the original source", () => {
    const root = fixture("copy");
    write(
      root,
      "tailwind.config.mjs",
      `export default { theme: { extend: { colors: { primary: { 500: '#E2187D' } } } } };\n`,
    );
    const original = fs.readFileSync(path.join(root, "tailwind.config.mjs"), "utf8");
    const snapshot = getDesignSnapshot(root);
    const siteSource = snapshot.tokens.find((item) => item.id === "color.primary.500")!.sources[0]!;
    const copied = patchDesignSystem(root, {
      colors: {
        palettes: [{
          id: "primary",
          name: "primary",
          source: "aria",
          shades: { 500: siteSource.resolvedValue! },
        }],
        adoptedFrom: {
          "color.primary.500": {
            provider: siteSource.provider,
            relativeFile: siteSource.relativeFile,
            pointer: siteSource.pointer,
            sourceHash: siteSource.sourceHash,
          },
        },
      },
    });
    expect(fs.readFileSync(path.join(root, "tailwind.config.mjs"), "utf8")).toBe(original);
    expect(copied.meta.tokenPreferences["color.primary.500"]?.adoptedFrom)
      .toMatchObject({ relativeFile: "tailwind.config.mjs" });
  });

  it("routes Agent site-token edits through the same fenced mutation API", async () => {
    const root = fixture("agent-token");
    const history = fs.mkdtempSync(path.join(os.tmpdir(), "aria-design-agent-history-"));
    roots.push(history);
    configureMutationCoordinator(history);
    write(
      root,
      "tailwind.config.mjs",
      `export default { theme: { extend: { colors: { primary: { 500: '#E2187D' } } } } };\n`,
    );
    const snapshot = getDesignSnapshot(root);
    const token = snapshot.tokens.find((item) => item.id === "color.primary.500")!;
    const tokenSource = token.sources[0]!;
    const result = await executeDesignEdit(
      { projectPath: root, userData: history, webContentsId: 1 },
      {
        action: "token_set",
        tokenId: token.id,
        sourceId: tokenSource.id,
        sourceHash: tokenSource.sourceHash,
        value: "#F00080",
        expectedRevision: snapshot.revision,
      },
    );
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, "tailwind.config.mjs"), "utf8"))
      .toContain("500: '#F00080'");
  });

  it("migrates legacy metadata without changing existing token preferences", () => {
    const root = fixture("meta");
    write(
      root,
      ".aria/design-meta.json",
      JSON.stringify({
        paletteOrder: ["primary"],
        enabledIconPacks: ["lucide"],
        tokenPreferences: {
          "color.primary.500": { preferredSourceId: "tailwind-config:fixture" },
        },
      }),
    );
    expect(readDesignMeta(root)).toMatchObject({
      version: 2,
      paletteOrder: ["primary"],
      enabledIconPacks: ["lucide"],
      tokenPreferences: {
        "color.primary.500": { preferredSourceId: "tailwind-config:fixture" },
      },
    });
  });
});
