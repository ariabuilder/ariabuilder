import { describe, expect, it } from "vitest"
import { fontsourceCssFamily, type DesignFonts } from "../../../../shared/design"
import { buildDesignFontOptions } from "./fontOptions"

describe("design font options", () => {
  it("resolves the CSS family declared by variable Fontsource packages", () => {
    expect(fontsourceCssFamily({ family: "Outfit", variable: true })).toBe(
      "Outfit Variable",
    )
    expect(
      fontsourceCssFamily({ family: "Outfit Variable", variable: true }),
    ).toBe("Outfit Variable")
    expect(fontsourceCssFamily({ family: "Open Sans", variable: false })).toBe(
      "Open Sans",
    )
  })

  it("combines Google, Fontsource, custom, legacy, and authored families", () => {
    const fonts: DesignFonts = {
      google: [{ family: "Roboto", weights: [400, 700] }],
      fontsource: [
        { id: "outfit", family: "Outfit", variable: true },
        { id: "open-sans", family: "Open Sans", variable: false },
      ],
      custom: [{ family: "Editorial", file: "public/fonts/editorial.woff2" }],
      bodyFamily: "System Body",
      headingFamily: "Outfit Variable",
    }

    expect(
      buildDesignFontOptions(fonts, ["Authored Stack", "var(--font-body)"]),
    ).toEqual([
      { family: "Authored Stack", source: "custom", weights: [] },
      { family: "Editorial", source: "custom", weights: [] },
      { family: "Open Sans", source: "fontsource", weights: [] },
      { family: "Outfit Variable", source: "fontsource", weights: [] },
      { family: "Roboto", source: "google", weights: [400, 700] },
      { family: "System Body", source: "custom", weights: [] },
    ])
  })
})
