import { describe, expect, it } from "vitest"
import type {
  DesignColorPalette,
  DesignToken,
  DesignTokenSource,
} from "../../../../shared/design"
import { isSitePaletteManagedByAria } from "./sitePaletteManagement"

const siteSource: DesignTokenSource = {
  id: "tailwind-config:tailwind.config.mjs:theme.extend.colors.primary.500:default",
  provider: "tailwind-config",
  relativeFile: "tailwind.config.mjs",
  pointer: "theme.extend.colors.primary.500",
  sourceHash: "source-hash",
  ownership: "site",
  writable: true,
  mode: { id: "default", label: "Default" },
  authoredValue: "#E2187D",
  resolvedValue: "#E2187D",
}

const sitePalette: DesignColorPalette = {
  id: "site:primary",
  name: "primary",
  source: "site",
  shades: { 500: "#E2187D" },
}

const ariaPalette: DesignColorPalette = {
  id: "primary",
  name: "primary",
  source: "aria",
  shades: { 500: "#E2187D" },
}

const token: DesignToken = {
  id: "color.primary.500",
  category: "color",
  family: "primary",
  shade: "500",
  sources: [siteSource],
  activeSourceId: siteSource.id,
  ambiguous: false,
  usageCount: 3,
  usedIn: ["src/pages/index.astro"],
}

describe("site palette management status", () => {
  it("reports a copied palette as managed by Aria", () => {
    expect(
      isSitePaletteManagedByAria({
        palette: sitePalette,
        ariaPalettes: [ariaPalette],
        tokens: [token],
        adoptedFrom: {
          [token.id]: {
            provider: siteSource.provider,
            relativeFile: siteSource.relativeFile,
            pointer: siteSource.pointer,
            sourceHash: siteSource.sourceHash,
          },
        },
      }),
    ).toBe(true)
  })

  it("does not infer management from a same-named Aria palette without lineage", () => {
    expect(
      isSitePaletteManagedByAria({
        palette: sitePalette,
        ariaPalettes: [ariaPalette],
        tokens: [token],
        adoptedFrom: {},
      }),
    ).toBe(false)
  })
})
