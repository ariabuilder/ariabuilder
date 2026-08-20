import { describe, expect, it } from "vitest";
import {
  extractClassRules,
  extractColorClassVariables,
  extractCustomProperties,
  groupColorVariables,
  resolveColorValue,
} from "./parseCss";

describe("extractClassRules", () => {
  it("keeps empty authored classes discoverable for Inspector activation", () => {
    const classes = extractClassRules(`
      .project-heading { color: red; }
      .test {
        /* ready for Inspector edits */
      }
    `, "site");

    expect(classes.map((entry) => entry.name)).toEqual(["project-heading", "test"]);
    expect(classes[1]?.css).toMatch(/^\.test\s*\{/);
  });

  it("does not catalog Aria BEM system classes as custom Design classes", () => {
    const classes = extractClassRules(`
      .aria-card { padding: 1rem; }
      .aria-card__body { margin: 0; }
      .aria-alert--info { border-left-color: blue; }
      .aria-card--products { padding: 2rem; }
    `, "aria");
    expect(classes.map((entry) => entry.name)).toEqual(["aria-card--products"]);
  });
});

describe("categorizeVar via extractCustomProperties", () => {
  it("catalogs --color-black / --color-white as color tokens", () => {
    const vars = extractCustomProperties(
      `
        :root {
          --color-black: hsla(0, 0%, 3%, 1);
          --color-white: hsla(0, 0%, 98%, 1);
          --color-border: hsla(0, 0%, 15%, 1);
        }
      `,
      "site",
    );
    const byName = Object.fromEntries(vars.map((v) => [v.name, v.category]));
    expect(byName["color-black"]).toBe("color");
    expect(byName["color-white"]).toBe("color");
    expect(byName["color-border"]).toBe("color");

    const { palettes } = groupColorVariables(vars);
    const names = palettes.map((p) => p.name).sort();
    expect(names).toEqual(["black", "border", "white"]);
    expect(palettes.find((p) => p.name === "black")?.shades.DEFAULT).toBe(
      "hsla(0, 0%, 3%, 1)",
    );
  });

  it("promotes bare paint custom properties to color", () => {
    const vars = extractCustomProperties(
      `:root { --brand: hsl(28, 86%, 47%); --gap: 1rem; }`,
      "site",
    );
    const byName = Object.fromEntries(vars.map((v) => [v.name, v.category]));
    expect(byName.brand).toBe("color");
    expect(byName.gap).toBe("spacing");
  });

  it("promotes color-mix() paint values to color", () => {
    const vars = extractCustomProperties(
      `:root { --brand-hover: color-mix(in oklab, #E2187D, #ffffff 10%); }`,
      "site",
    );
    expect(vars[0]).toMatchObject({
      name: "brand-hover",
      category: "color",
    });
  });
});

describe("resolveColorValue", () => {
  it("resolves whole-value var() aliases to hex", () => {
    const vars = new Map([["brand", "#E2187D"]]);
    expect(resolveColorValue("var(--brand)", vars)).toBe("#E2187D");
  });

  it("accepts literal color-mix() as paint-ready", () => {
    const authored = "color-mix(in oklab, #000000, #ffffff 10%)";
    expect(resolveColorValue(authored, new Map())).toBe(authored);
  });

  it("inlines nested var() inside color-mix()", () => {
    const vars = new Map([["accent", "#E2187D"]]);
    expect(
      resolveColorValue(
        "color-mix(in oklab, var(--accent), #ffffff 10%)",
        vars,
      ),
    ).toBe("color-mix(in oklab, #E2187D, #ffffff 10%)");
  });

  it("inlines nested var() mixed with transparent", () => {
    const vars = new Map([["color-bg", "oklch(0.2 0.02 250)"]]);
    expect(
      resolveColorValue(
        "color-mix(in oklab, var(--color-bg), transparent 28%)",
        vars,
      ),
    ).toBe("color-mix(in oklab, oklch(0.2 0.02 250), transparent 28%)");
  });

  it("returns null when an inner var() cannot be resolved", () => {
    expect(
      resolveColorValue(
        "color-mix(in oklab, var(--missing), #ffffff 10%)",
        new Map(),
      ),
    ).toBeNull();
  });

  it("resolves var() fallbacks that contain nested color functions", () => {
    expect(
      resolveColorValue(
        "var(--missing, color-mix(in oklab, #000000, #ffffff 10%))",
        new Map(),
      ),
    ).toBe("color-mix(in oklab, #000000, #ffffff 10%)");
  });
});

describe("extractColorClassVariables", () => {
  it("catalogs .color-* utilities inside @layer into color vars", () => {
    const css = `
      @layer utilities {
        .color-amber { color: hsl(28, 86%, 47%); /* #E62E0F #E17111 */ }
        .color-card { color: hsla(0, 0%, 8%, 1); /* #141414 */ }
        .color-muted { color: hsla(0, 0%, 42%, 1); /* #6c6c6c */ }
        .color-border { color: hsla(0, 0%, 15%, 1); /* #272727 */ }
      }
      :root {
        --color-black: hsla(0, 0%, 3%, 1);
        --color-white: hsla(0, 0%, 98%, 1);
      }
    `;

    const classVars = extractColorClassVariables(css, "site");
    const classNames = classVars.map((v) => v.name).sort();
    expect(classNames).toEqual([
      "color-amber",
      "color-border",
      "color-card",
      "color-muted",
    ]);
    expect(classVars.find((v) => v.name === "color-amber")?.value).toBe(
      "hsl(28, 86%, 47%)",
    );

    const cssVars = extractCustomProperties(css, "site");
    const merged = new Map<string, (typeof cssVars)[number]>();
    for (const variable of classVars) merged.set(variable.name, variable);
    for (const variable of cssVars) merged.set(variable.name, variable);

    const { palettes } = groupColorVariables([...merged.values()]);
    expect(palettes.map((p) => p.name).sort()).toEqual([
      "amber",
      "black",
      "border",
      "card",
      "muted",
      "white",
    ]);
  });

  it("prefers real CSS variables over class-derived synthetics", () => {
    const css = `
      .color-amber { color: hsl(0, 100%, 50%); }
      :root { --color-amber: hsl(28, 86%, 47%); }
    `;
    const classVars = extractColorClassVariables(css, "site");
    const cssVars = extractCustomProperties(css, "site");
    const map = new Map<string, (typeof cssVars)[number]>();
    for (const variable of classVars) map.set(variable.name, variable);
    for (const variable of cssVars) map.set(variable.name, variable);

    const { palettes } = groupColorVariables([...map.values()]);
    expect(palettes.find((p) => p.name === "amber")?.shades.DEFAULT).toBe(
      "hsl(28, 86%, 47%)",
    );
  });

  it("supports shaded .color-* utilities and background-color", () => {
    const css = `
      .color-primary-500 { background-color: #3366ff; }
      .color-primary { color: #112233; }
    `;
    const vars = extractColorClassVariables(css, "site");
    const { palettes } = groupColorVariables(vars);
    const primary = palettes.find((p) => p.name === "primary");
    expect(primary?.shades.DEFAULT).toBe("#112233");
    expect(primary?.shades["500"]).toBe("#3366ff");
  });
});
