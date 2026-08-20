import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY_DESIGN_FONTS,
  EMPTY_DESIGN_VARIABLES,
  createEmptyGlobalStyles,
  type DesignCssVar,
} from "../../shared/design";
import { buildDesignVariables, getDesignSnapshot, patchDesignSystem } from "./index";
import { ARIA_BEM_PRIMITIVES_CSS } from "../../shared/composer/ariaBemCss";
import {
  applyManagedBlockToFile,
  serializeManagedBlock,
  stylesheetHasStaleAriaBemPrimitives,
  stylesheetNeedsAriaBemPrimitives,
  type ManagedBlockModel,
} from "./managedBlock";

function createModel(): ManagedBlockModel {
  return {
    fonts: structuredClone(EMPTY_DESIGN_FONTS),
    variables: structuredClone(EMPTY_DESIGN_VARIABLES),
    colors: { palettes: [], semantic: {} },
    globalStyles: createEmptyGlobalStyles(),
    classes: [],
    icons: { enabledPacks: ["lucide"] },
  };
}

describe("serializeManagedBlock", () => {
  it("keeps managed Google imports before ordinary CSS rules", () => {
    const model = createModel();
    model.fonts.google = [
      { family: "Bricolage Grotesque", weights: [700, 400, 700] },
      { family: "Alex Brush", weights: [] },
    ];

    const css = applyManagedBlockToFile(":root { color: black; }\n", model);

    expect(css.indexOf("aria:font-imports-begin")).toBeLessThan(
      css.indexOf(":root"),
    );
    expect(css).toContain(
      "family=Bricolage%20Grotesque:wght@400;700&family=Alex%20Brush:wght@400;500;600;700",
    );
    expect(
      css.slice(css.indexOf("aria:design-begin"), css.indexOf("aria:design-end")),
    ).not.toContain("@import");
  });

  it("places managed Google imports after charset and migrates legacy block imports", () => {
    const model = createModel();
    model.fonts.google = [{ family: "Outfit", weights: [400, 600] }];
    const legacy = [
      '@charset "UTF-8";',
      ":root { color: black; }",
      "",
      "/* aria:design-begin */",
      "/* aria:fonts */",
      "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap');",
      "/* aria:design-end */",
      "",
    ].join("\n");

    const css = applyManagedBlockToFile(legacy, model);

    expect(css.startsWith('@charset "UTF-8";\n\n/* aria:font-imports-begin */'))
      .toBe(true);
    expect(css.match(/fonts\.googleapis\.com/g)).toHaveLength(1);
    expect(css).not.toContain("family=Inter");
    expect(applyManagedBlockToFile(css, model)).toBe(css);
  });

  it("removes managed Google imports when no families remain enabled", () => {
    const model = createModel();
    const css = applyManagedBlockToFile([
      "/* aria:font-imports-begin */",
      "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap');",
      "/* aria:font-imports-end */",
      "",
      ":root { color: black; }",
    ].join("\n"), model);

    expect(css).not.toContain("aria:font-imports");
    expect(css).not.toContain("fonts.googleapis.com");
  });

  it("writes Fontsource package imports even when Google is empty", () => {
    const model = createModel();
    model.fonts.fontsource = [
      { id: "outfit", family: "Outfit", variable: true },
      { id: "open-sans", family: "Open Sans", variable: false },
    ];

    const css = applyManagedBlockToFile(":root { color: black; }\n", model);

    expect(css).toContain('@import "@fontsource-variable/outfit";');
    expect(css).toContain('@import "@fontsource/open-sans";');
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css.indexOf("aria:font-imports-begin")).toBeLessThan(css.indexOf(":root"));
  });

  it("removes Fontsource imports when no Fontsource families remain enabled", () => {
    const model = createModel();
    const css = applyManagedBlockToFile(
      [
        "/* aria:font-imports-begin */",
        '@import "@fontsource-variable/outfit";',
        "/* aria:font-imports-end */",
        "",
        ":root { color: black; }",
      ].join("\n"),
      model,
    );

    expect(css).not.toContain("aria:font-imports");
    expect(css).not.toContain("@fontsource");
  });

  it("does not write icon-pack state into managed CSS", () => {
    const css = serializeManagedBlock(createModel());

    expect(css).not.toMatch(/aria-icon-packs/);
    expect(css).not.toMatch(/aria:icons/);
    expect(css).not.toMatch(/Iconify packs enabled/);
  });

  it("drops the legacy icon-pack marker while preserving user variables", () => {
    const remaining: DesignCssVar[] = [
      {
        name: "aria-icon-packs",
        value: '"lucide"',
        source: "aria",
        category: "other",
      },
      {
        name: "content-width",
        value: "72rem",
        source: "aria",
        category: "layout",
      },
    ];
    const variables = buildDesignVariables(remaining, {
      custom: {
        "aria-icon-packs": {
          label: "Aria Icon Packs",
          category: "other",
        },
      },
      aliases: {},
    });
    const model = createModel();
    model.variables = variables;

    expect(variables.custom["aria-icon-packs"]).toBeUndefined();
    expect(variables.custom["content-width"]?.value).toBe("72rem");
    const css = serializeManagedBlock(model);
    expect(css).not.toMatch(/aria-icon-packs/);
    expect(css).toMatch(/--content-width: 72rem;/);
  });

  it("cleans a legacy project on design save without disabling its icon pack", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-icon-css-migration-"));
    const stylesheet = path.join(root, "src", "styles", "global.css");
    const metaFile = path.join(root, ".aria", "design-meta.json");
    fs.mkdirSync(path.dirname(stylesheet), { recursive: true });
    fs.mkdirSync(path.dirname(metaFile), { recursive: true });
    fs.writeFileSync(
      stylesheet,
      [
        "/* aria:design-begin */",
        "/* aria:icons */",
        ":root { --aria-icon-packs: \"lucide\"; }",
        "/* aria:design-end */",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      metaFile,
      JSON.stringify({
        enabledIconPacks: ["lucide"],
        variables: {
          custom: {
            "aria-icon-packs": {
              label: "Aria Icon Packs",
              category: "other",
            },
          },
          aliases: {},
        },
      }),
    );

    try {
      const snapshot = patchDesignSystem(root, {});
      const savedCss = fs.readFileSync(stylesheet, "utf8");
      const savedMeta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as {
        enabledIconPacks?: string[];
        variables?: { custom?: Record<string, unknown> };
      };

      expect(snapshot.icons.enabledPacks).toEqual(["lucide"]);
      expect(snapshot.variables.custom["aria-icon-packs"]).toBeUndefined();
      expect(savedCss).not.toMatch(/aria-icon-packs|aria:icons/);
      expect(savedMeta.enabledIconPacks).toEqual(["lucide"]);
      expect(savedMeta.variables?.custom?.["aria-icon-packs"]).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rewrites first-wave primitive CSS when the design snapshot is read", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-primitives-refresh-"));
    const stylesheet = path.join(root, "src", "styles", "global.css");
    fs.mkdirSync(path.dirname(stylesheet), { recursive: true });
    fs.writeFileSync(
      stylesheet,
      [
        "/* aria:design-begin */",
        "/* aria:primitives */",
        ".aria-alert { border-left-width: 3px; }",
        ".aria-alert--info { border-left-color: dodgerblue; }",
        "/* aria:design-end */",
        "",
      ].join("\n"),
    );

    try {
      getDesignSnapshot(root);
      const savedCss = fs.readFileSync(stylesheet, "utf8");
      expect(savedCss).toContain("border: none;");
      expect(savedCss).toContain("border-left: none;");
      expect(savedCss).not.toContain("border-left-width: 3px");
      expect(savedCss).toContain(".aria-alert__icon");
      expect(stylesheetNeedsAriaBemPrimitives(savedCss)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("global styles CSS", () => {
  it("emits overflow axes and cross-browser font-smoothing on body", () => {
    const model = createModel();
    model.globalStyles.body.overflowX = "hidden";
    model.globalStyles.body.overflowY = "auto";
    model.globalStyles.body.fontSmoothing = "antialiased";

    const css = serializeManagedBlock(model);

    expect(css).toContain("overflow-x: hidden;");
    expect(css).toContain("overflow-y: auto;");
    expect(css).toContain("-webkit-font-smoothing: antialiased;");
    expect(css).toContain("-moz-osx-font-smoothing: grayscale;");
    expect(css).not.toContain("\n  font-smoothing:");
  });

  it("emits body margin and padding longhands", () => {
    const model = createModel();
    model.globalStyles.body.marginTop = "8px";
    model.globalStyles.body.marginBottom = "8px";
    model.globalStyles.body.marginLeft = "4px";
    model.globalStyles.body.marginRight = "4px";
    model.globalStyles.body.paddingTop = "12px";

    const css = serializeManagedBlock(model);
    const globals = css.slice(
      css.indexOf("/* aria:globals */"),
      css.indexOf("/* aria:primitives */"),
    );

    expect(globals).toContain("margin-top: 8px;");
    expect(globals).toContain("margin-bottom: 8px;");
    expect(globals).toContain("margin-left: 4px;");
    expect(globals).toContain("margin-right: 4px;");
    expect(globals).toContain("padding-top: 12px;");
    expect(globals).not.toContain("\n  margin:");
    expect(globals).not.toContain("\n  padding:");
  });

  it("emits BEM primitive defaults without inline-style markup", () => {
    const css = serializeManagedBlock(createModel());
    expect(css).toContain("/* aria:primitives */");
    expect(css).toContain(".aria-card {");
    expect(css).toContain(".aria-alert--info .aria-alert__title");
    expect(css).toContain(".aria-alert {\n  display: grid;");
    expect(css).toMatch(/\.aria-alert \{[^}]*border: none;/);
    expect(css).toContain("border-left: none;");
    expect(css).not.toContain("border-left-width");
    expect(css).not.toContain("border-left-color");
    expect(css).toContain(".aria-alert__icon {\n  grid-column: 1;");
    expect(css).toContain("max-width: 1.15rem;");
    expect(css).toContain("svg.aria-alert__icon");
    expect(css).toContain(".aria-field--check {");
    expect(css).toContain(".aria-avatar {");
    expect(applyManagedBlockToFile(css, createModel())).toBe(css);
    expect(stylesheetNeedsAriaBemPrimitives(css)).toBe(false);
    expect(stylesheetHasStaleAriaBemPrimitives(css)).toBe(false);
  });

  it("treats missing or first-wave primitive CSS as needing a rewrite", () => {
    expect(stylesheetNeedsAriaBemPrimitives(".card { color: red; }")).toBe(true);
    expect(stylesheetHasStaleAriaBemPrimitives(".card { color: red; }")).toBe(false);

    const stale = [
      "/* aria:design-begin */",
      "/* aria:primitives */",
      ".aria-alert { border-left-width: 3px; }",
      ".aria-alert--info { border-left-color: dodgerblue; }",
      "/* aria:design-end */",
    ].join("\n");
    expect(stylesheetNeedsAriaBemPrimitives(stale)).toBe(true);
    expect(stylesheetHasStaleAriaBemPrimitives(stale)).toBe(true);

    const current = applyManagedBlockToFile(stale, createModel());
    expect(current).toContain(ARIA_BEM_PRIMITIVES_CSS.trim());
    expect(current).not.toContain("border-left-width: 3px");
    expect(stylesheetNeedsAriaBemPrimitives(current)).toBe(false);
  });
});
