import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { normalizeVariablesMeta, normalizeFonts } from "./meta";

describe("normalizeVariablesMeta", () => {
  it("preserves draft aliases with an empty sourceKey", () => {
    const meta = normalizeVariablesMeta({
      custom: {},
      aliases: {
        "alias-var-1": {
          label: "",
          sourceType: "custom",
          sourceKey: "",
          fallback: "",
        },
      },
    });

    assert.deepEqual(meta.aliases["alias-var-1"], {
      label: "",
      sourceType: "custom",
      sourceKey: "",
      fallback: "",
    });
  });

  it("preserves token aliases with a sourceKey", () => {
    const meta = normalizeVariablesMeta({
      custom: {},
      aliases: {
        brand: {
          label: "Brand",
          sourceType: "token",
          sourceKey: "color.primary.500",
          fallback: "#000",
        },
      },
    });

    assert.deepEqual(meta.aliases.brand, {
      label: "Brand",
      sourceType: "token",
      sourceKey: "color.primary.500",
      fallback: "#000",
    });
  });

  it("drops aliases whose value is not an object", () => {
    const meta = normalizeVariablesMeta({
      custom: {},
      aliases: {
        bad: "not-an-object",
        ok: {
          label: "Ok",
          sourceType: "custom",
          sourceKey: "spacing-md",
        },
      },
    });

    assert.equal(meta.aliases.bad, undefined);
    assert.equal(meta.aliases.ok?.sourceKey, "spacing-md");
  });
});

describe("normalizeFonts", () => {
  it("round-trips Fontsource families and fills an empty list", () => {
    const fonts = normalizeFonts({
      google: [{ family: "Inter", weights: [400] }],
      custom: [{ family: "Editorial", file: "fonts/Editorial.woff2" }],
      fontsource: [
        { id: "outfit", family: "Outfit", variable: true },
        { id: "@fontsource/open-sans/400.css", family: "Open Sans", variable: false },
        { id: "outfit", family: "Duplicate", variable: false },
      ],
    });

    assert.deepEqual(fonts.fontsource, [
      { id: "outfit", family: "Outfit", variable: true },
      { id: "open-sans", family: "Open Sans", variable: false },
    ]);
    assert.equal(normalizeFonts(undefined).fontsource.length, 0);
    assert.equal(normalizeFonts({ google: [] }).fontsource.length, 0);
  });
});
