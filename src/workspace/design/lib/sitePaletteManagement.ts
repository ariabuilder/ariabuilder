import type {
  DesignColorPalette,
  DesignToken,
  DesignTokenPreference,
} from "../../../../shared/design"

type AdoptedFrom = NonNullable<DesignTokenPreference["adoptedFrom"]>

export function isSitePaletteManagedByAria(input: {
  palette: DesignColorPalette
  ariaPalettes: readonly DesignColorPalette[]
  tokens: readonly DesignToken[]
  adoptedFrom: Readonly<Record<string, AdoptedFrom>>
}): boolean {
  if (!input.ariaPalettes.some((palette) => palette.name === input.palette.name)) {
    return false
  }
  const copiedTokenIds = input.tokens
    .filter(
      (token) =>
        token.family === input.palette.name &&
        token.sources.some(
          (source) =>
            source.ownership === "site" &&
            source.mode.id === "default" &&
            Boolean(source.resolvedValue),
        ),
    )
    .map((token) => token.id)
  return (
    copiedTokenIds.length > 0 &&
    copiedTokenIds.every((tokenId) => Boolean(input.adoptedFrom[tokenId]))
  )
}
