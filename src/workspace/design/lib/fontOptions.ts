import {
  fontsourceCssFamily,
  type DesignFonts,
} from "../../../../shared/design"

export type DesignFontOption = {
  family: string
  source: "google" | "custom" | "fontsource"
  weights: number[]
}

export function buildDesignFontOptions(
  fonts: DesignFonts | null | undefined,
  authoredFamilies: readonly string[] = [],
): DesignFontOption[] {
  if (!fonts) return []

  const options = new Map<string, DesignFontOption>()
  const add = (option: DesignFontOption, overwrite = true) => {
    const family = option.family.trim()
    if (!family) return
    const key = family.toLocaleLowerCase()
    if (!overwrite && options.has(key)) return
    options.set(key, { ...option, family })
  }

  for (const font of fonts.google) {
    add({
      family: font.family,
      source: "google",
      weights: [...font.weights],
    })
  }
  for (const font of fonts.fontsource ?? []) {
    add({
      family: fontsourceCssFamily(font),
      source: "fontsource",
      weights: [],
    }, false)
  }
  for (const font of fonts.custom) {
    add({ family: font.family, source: "custom", weights: [] })
  }
  for (const family of [
    fonts.bodyFamily,
    fonts.headingFamily,
    ...authoredFamilies,
  ]) {
    const normalized = family?.trim() ?? ""
    if (!normalized || /^var\(/i.test(normalized)) continue
    add({ family: normalized, source: "custom", weights: [] }, false)
  }

  return [...options.values()].sort((left, right) =>
    left.family.localeCompare(right.family),
  )
}
