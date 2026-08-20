import bundledFonts from "./google-fonts.json"

export type GoogleFontCategory =
  | "all"
  | "sans-serif"
  | "serif"
  | "display"
  | "handwriting"
  | "monospace"

export type GoogleFontCatalogEntry = {
  family: string
  variants: string[]
  subsets: string[]
  category: Exclude<GoogleFontCategory, "all">
}

export type ListGoogleFontsInput = {
  search?: string
  category?: GoogleFontCategory
  limit?: number
  offset?: number
  /** Pull these catalog families to the front (e.g. site-enabled fonts). */
  preferFamilies?: string[]
}

export type ListGoogleFontsResult = {
  fonts: GoogleFontCatalogEntry[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

const POPULAR_FONTS = new Set([
  "Outfit",
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Playfair Display",
  "Merriweather",
  "Source Sans Pro",
  "Raleway",
  "Nunito",
  "Work Sans",
  "DM Sans",
  "Space Grotesk",
  "Manrope",
  "Plus Jakarta Sans",
  "Bricolage Grotesque",
  "Instrument Serif",
  "Geist",
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
])

const DEFAULT_PAGE_SIZE = 32

function inferFontCategory(family: string): Exclude<GoogleFontCategory, "all"> {
  const lower = family.toLowerCase()

  if (
    lower.includes("mono") ||
    lower.includes("code") ||
    lower.includes("console") ||
    lower.includes("courier") ||
    lower.includes("fira code") ||
    lower.includes("jetbrains")
  ) {
    return "monospace"
  }

  if (
    lower.includes("script") ||
    lower.includes("hand") ||
    lower.includes("cursive") ||
    lower.includes("brush") ||
    lower.includes("dancing") ||
    lower.includes("pacifico") ||
    lower.includes("caveat") ||
    lower.includes("satisfy") ||
    lower.includes("sacramento")
  ) {
    return "handwriting"
  }

  if (
    lower.includes("display") ||
    lower.includes("poster") ||
    lower.includes("black") ||
    lower.includes("ultra") ||
    lower.includes("impact") ||
    lower.includes("abril") ||
    lower.includes("bebas") ||
    lower.includes("lobster") ||
    lower.includes("righteous")
  ) {
    return "display"
  }

  if (
    (lower.includes("serif") && !lower.includes("sans")) ||
    lower.includes("times") ||
    lower.includes("georgia") ||
    lower.includes("garamond") ||
    lower.includes("bodoni") ||
    lower.includes("didot") ||
    lower.includes("playfair") ||
    lower.includes("merriweather") ||
    lower.includes("lora") ||
    lower.includes("crimson") ||
    lower.includes("libre baskerville") ||
    lower.includes("cormorant") ||
    lower.includes("eb garamond") ||
    lower.includes("noto serif") ||
    lower.includes("source serif") ||
    lower.includes("pt serif") ||
    lower.includes("roboto slab") ||
    lower.includes("bitter")
  ) {
    return "serif"
  }

  return "sans-serif"
}

let catalogCache: GoogleFontCatalogEntry[] | null = null

function getCatalog(): GoogleFontCatalogEntry[] {
  if (catalogCache) return catalogCache

  catalogCache = (
    bundledFonts as Array<{ family: string; variants: string[] }>
  ).map((font) => ({
    family: font.family,
    variants: font.variants,
    subsets: ["latin"],
    category: inferFontCategory(font.family),
  }))

  return catalogCache
}

/** Full catalog length (unfiltered). */
export function getGoogleFontCatalogSize(): number {
  return getCatalog().length
}

export function listGoogleFonts(
  input: ListGoogleFontsInput = {},
): ListGoogleFontsResult {
  let filtered = getCatalog().slice()

  const search = input.search?.trim().toLowerCase()
  if (search) {
    filtered = filtered.filter((f) => f.family.toLowerCase().includes(search))
  }

  if (input.category && input.category !== "all") {
    filtered = filtered.filter((f) => f.category === input.category)
  }

  const prefer = new Set(
    (input.preferFamilies ?? []).map((f) => f.trim().toLowerCase()).filter(Boolean),
  )

  filtered.sort((a, b) => {
    const aPrefer = prefer.has(a.family.toLowerCase())
    const bPrefer = prefer.has(b.family.toLowerCase())
    if (aPrefer && !bPrefer) return -1
    if (!aPrefer && bPrefer) return 1
    const aPopular = POPULAR_FONTS.has(a.family)
    const bPopular = POPULAR_FONTS.has(b.family)
    if (aPopular && !bPopular) return -1
    if (!aPopular && bPopular) return 1
    return a.family.localeCompare(b.family)
  })

  const total = filtered.length
  const offset = Math.max(0, input.offset ?? 0)
  const limit = Math.max(1, input.limit ?? DEFAULT_PAGE_SIZE)
  const page = filtered.slice(offset, offset + limit)

  return {
    fonts: page,
    total,
    offset,
    limit,
    hasMore: offset + page.length < total,
  }
}
