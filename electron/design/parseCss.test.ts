import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createEmptyGlobalStyles,
  mergeGlobalStyles,
} from "../../shared/design";
import {
  extractCustomProperties,
  extractRules,
  mapRulesToGlobalStyles,
  normalizeCssDeclarationValue,
} from "./parseCss";

describe("normalizeCssDeclarationValue", () => {
  it("collapses multiline clamp indent into tidy single-line form", () => {
    const raw = `clamp(
  3.13rem,
  calc(4.65vw + 1rem),
  5rem
)`;
    assert.equal(
      normalizeCssDeclarationValue(raw),
      "clamp(3.13rem, calc(4.65vw + 1rem), 5rem)",
    );
  });

  it("leaves compact clamp values unchanged", () => {
    assert.equal(
      normalizeCssDeclarationValue("clamp(3.13rem, calc(7.07vw + 0.86rem), 5rem)"),
      "clamp(3.13rem, calc(7.07vw + 0.86rem), 5rem)",
    );
  });

  it("preserves spaces inside quoted strings", () => {
    assert.equal(
      normalizeCssDeclarationValue('"hello   world"'),
      '"hello   world"',
    );
  });
});

describe("extractCustomProperties", () => {
  it("normalizes multiline custom property values", () => {
    const css = `
      :root {
        --font-size-h1: clamp(
          3.13rem,
          calc(4.65vw + 1rem),
          5rem
        );
        --font-size-h2: clamp(0.82rem, calc(0.37vw + 0.71rem), 1rem);
      }
    `;
    const vars = extractCustomProperties(css, "site");
    const byName = Object.fromEntries(vars.map((entry) => [entry.name, entry.value]));
    assert.equal(
      byName["font-size-h1"],
      "clamp(3.13rem, calc(4.65vw + 1rem), 5rem)",
    );
    assert.equal(
      byName["font-size-h2"],
      "clamp(0.82rem, calc(0.37vw + 0.71rem), 1rem)",
    );
  });
});

describe("mapRulesToGlobalStyles", () => {
  it("maps html, body combined selector to root and body", () => {
    const css = `
      html, body {
        font-family: var(--font-body);
        color: var(--text-body);
        background-color: var(--light);
        line-height: 1.4;
        letter-spacing: 0.03em;
        width: 100%;
      }
    `;
    const styles = mapRulesToGlobalStyles(extractRules(css));
    assert.equal(styles.body.fontFamily, "var(--font-body)");
    assert.equal(styles.body.color, "var(--text-body)");
    assert.equal(styles.body.backgroundColor, "var(--light)");
    assert.equal(styles.body.lineHeight, "1.4");
    assert.equal(styles.body.letterSpacing, "0.03em");
    // Root only accepts root-known fields from the shared rule
    assert.equal(styles.root.scrollBehavior, "");
    assert.equal(styles.body.backgroundColor, "var(--light)");
  });

  it("maps heading group and h1 without letting h2 overwrite", () => {
    const css = `
      h1, h2, h3, h4, h5, h6 {
        font-family: var(--font-heading);
      }
      h1 {
        font-weight: 400;
        line-height: 1.2;
      }
      h2 {
        font-weight: 700;
        line-height: 1.5;
      }
    `;
    const styles = mapRulesToGlobalStyles(extractRules(css));
    assert.equal(styles.heading.fontFamily, "var(--font-heading)");
    assert.equal(styles.heading.fontWeight, "400");
    assert.equal(styles.heading.lineHeight, "1.2");
  });

  it("maps p and a", () => {
    const css = `
      p { font-size: var(--text-2xs); }
      a { color: inherit; text-decoration: none; }
      a:hover { color: red; }
    `;
    const styles = mapRulesToGlobalStyles(extractRules(css));
    assert.equal(styles.paragraph.fontSize, "var(--text-2xs)");
    assert.equal(styles.link.color, "inherit");
    assert.equal(styles.link.textDecoration, "none");
    assert.equal(styles.link.hoverColor, "red");
  });

  it("maps button and input from combined form control rule", () => {
    const css = `
      button, input, select, textarea {
        font-family: inherit;
        font-size: 100%;
        line-height: 1.15;
      }
    `;
    const styles = mapRulesToGlobalStyles(extractRules(css));
    assert.equal(styles.button.base.fontFamily, "inherit");
    assert.equal(styles.button.base.fontSize, "100%");
    assert.equal(styles.input.fontFamily, "inherit");
    assert.equal(styles.input.fontSize, "100%");
  });

  it("does not map descendant selectors", () => {
    const css = `html body { color: red; }`;
    const styles = mapRulesToGlobalStyles(extractRules(css));
    assert.equal(styles.body.color, "");
    assert.equal(styles.root.caretColor, "");
  });

  it("maps body overflow axes and vendor font-smoothing to antialiased", () => {
    const css = `
      body {
        overflow-x: hidden;
        overflow-y: auto;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
    `;
    const styles = mapRulesToGlobalStyles(extractRules(css));
    assert.equal(styles.body.overflowX, "hidden");
    assert.equal(styles.body.overflowY, "auto");
    assert.equal(styles.body.fontSmoothing, "antialiased");
  });

  it("expands body margin/padding shorthand into sides", () => {
    const css = `
      body {
        margin: 8px 4px;
        padding-top: 12px;
        padding: 1rem;
      }
    `;
    const styles = mapRulesToGlobalStyles(extractRules(css));
    assert.equal(styles.body.marginTop, "8px");
    assert.equal(styles.body.marginRight, "4px");
    assert.equal(styles.body.marginBottom, "8px");
    assert.equal(styles.body.marginLeft, "4px");
    assert.equal(styles.body.paddingTop, "12px");
    assert.equal(styles.body.paddingRight, "1rem");
    assert.equal(styles.body.paddingBottom, "1rem");
    assert.equal(styles.body.paddingLeft, "1rem");
  });

  it("expands legacy body margin/padding shorthand when merging snapshots", () => {
    const styles = mergeGlobalStyles(createEmptyGlobalStyles(), {
      body: {
        ...createEmptyGlobalStyles().body,
        margin: "8px 4px",
        padding: "1rem",
      } as ReturnType<typeof createEmptyGlobalStyles>["body"],
    });
    assert.equal(styles.body.marginTop, "8px");
    assert.equal(styles.body.marginRight, "4px");
    assert.equal(styles.body.marginBottom, "8px");
    assert.equal(styles.body.marginLeft, "4px");
    assert.equal(styles.body.paddingTop, "1rem");
    assert.equal(styles.body.paddingRight, "1rem");
    assert.equal(styles.body.paddingBottom, "1rem");
    assert.equal(styles.body.paddingLeft, "1rem");
    assert.equal(
      "margin" in styles.body ? (styles.body as { margin?: string }).margin : undefined,
      undefined,
    );
  });
});
