import { normalizeFontsourceId } from "../../../../shared/design"

const FONTSOURCE_FONTS_URL = "https://api.fontsource.org/v1/fonts"
const DEFAULT_PAGE_SIZE = 32

const POPULAR_IDS = new Set([
  "outfit",
  "inter",
  "roboto",
  "open-sans",
  "lato",
  "montserrat",
  "poppins",
  "playfair-display",
  "merriweather",
  "source-sans-3",
  "raleway",
  "nunito",
  "work-sans",
  "dm-sans",
  "space-grotesk",
  "manrope",
  "plus-jakarta-sans",
  "bricolage-grotesque",
  "instrument-serif",
  "geist",
  "jetbrains-mono",
  "fira-code",
  "source-code-pro",
])

export type FontsourceCategory =
  | "all"
  | "sans-serif"
  | "serif"
  | "display"
  | "handwriting"
  | "monospace"

export type FontsourceCatalogEntry = {
  id: string
  family: string
  category: Exclude<FontsourceCategory, "all">
  variable: boolean
  weights: number[]
}

export type ListFontsourceFontsInput = {
  search?: string
  category?: FontsourceCategory
  variableOnly?: boolean
  preferIds?: string[]
  limit?: number
  offset?: number
}

export type ListFontsourceFontsResult = {
  fonts: FontsourceCatalogEntry[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
  catalogFailed?: boolean
}

type FontsourceApiRow = {
  id?: unknown
  family?: unknown
  category?: unknown
  variable?: unknown
  weights?: unknown
  type?: unknown
}

const CATEGORIES = new Set<Exclude<FontsourceCategory, "all">>([
  "sans-serif",
  "serif",
  "display",
  "handwriting",
  "monospace",
])

let catalogCache: FontsourceCatalogEntry[] | null = null
let catalogPromise: Promise<FontsourceCatalogEntry[]> | null = null

function normalizeCategory(
  raw: unknown,
): Exclude<FontsourceCategory, "all"> {
  return typeof raw === "string" &&
    CATEGORIES.has(raw as Exclude<FontsourceCategory, "all">)
    ? (raw as Exclude<FontsourceCategory, "all">)
    : "sans-serif"
}

function normalizeEntry(row: FontsourceApiRow): FontsourceCatalogEntry | null {
  if (row.type === "icons") return null
  const id = normalizeFontsourceId(typeof row.id === "string" ? row.id : "")
  const family = typeof row.family === "string" ? row.family.trim() : ""
  if (!id || !family) return null
  const weights = Array.isArray(row.weights)
    ? row.weights.filter(
        (weight): weight is number =>
          typeof weight === "number" && Number.isFinite(weight),
      )
    : []
  return {
    id,
    family,
    category: normalizeCategory(row.category),
    variable: Boolean(row.variable),
    weights,
  }
}

async function fetchCatalog(): Promise<FontsourceCatalogEntry[]> {
  const response = await fetch(FONTSOURCE_FONTS_URL)
  if (!response.ok) {
    throw new Error(`Fontsource catalog request failed (${response.status})`)
  }
  const data = (await response.json()) as unknown
  if (!Array.isArray(data)) {
    throw new Error("Fontsource catalog response was not an array")
  }
  const entries: FontsourceCatalogEntry[] = []
  const seen = new Set<string>()
  for (const row of data) {
    if (!row || typeof row !== "object") continue
    const entry = normalizeEntry(row as FontsourceApiRow)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  return entries
}

export async function loadFontsourceCatalog(
  force = false,
): Promise<FontsourceCatalogEntry[]> {
  if (!force && catalogCache) return catalogCache
  if (!force && catalogPromise) return catalogPromise

  catalogPromise = fetchCatalog()
    .then((entries) => {
      catalogCache = entries
      return entries
    })
    .finally(() => {
      catalogPromise = null
    })

  return catalogPromise
}

export function fontsourceCdnPreviewUrl(font: {
  id: string
  variable: boolean
}): string {
  const id = encodeURIComponent(normalizeFontsourceId(font.id) || font.id)
  return font.variable
    ? `https://cdn.jsdelivr.net/fontsource/css/${id}:vf@latest/index.css`
    : `https://cdn.jsdelivr.net/fontsource/css/${id}@latest/index.css`
}

export function syntheticFontsourceEntries(
  fonts: readonly { id: string; family: string; variable: boolean }[],
): FontsourceCatalogEntry[] {
  const entries: FontsourceCatalogEntry[] = []
  for (const font of fonts) {
    const id = normalizeFontsourceId(font.id)
    if (!id) continue
    entries.push({
      id,
      family: font.family.trim() || id,
      category: "sans-serif",
      variable: Boolean(font.variable),
      weights: [],
    })
  }
  return entries
}

export async function listFontsourceFonts(
  input: ListFontsourceFontsInput = {},
  fallback: FontsourceCatalogEntry[] = [],
): Promise<ListFontsourceFontsResult> {
  let catalog: FontsourceCatalogEntry[]
  let catalogFailed = false
  try {
    catalog = (await loadFontsourceCatalog()).slice()
  } catch {
    catalog = []
    catalogFailed = true
  }

  if (catalog.length === 0 && fallback.length > 0) {
    catalog = fallback.slice()
  }

  let filtered = catalog

  const search = input.search?.trim().toLowerCase()
  if (search) {
    filtered = filtered.filter(
      (font) =>
        font.family.toLowerCase().includes(search) ||
        font.id.toLowerCase().includes(search),
    )
  }

  if (input.category && input.category !== "all") {
    filtered = filtered.filter((font) => font.category === input.category)
  }

  if (input.variableOnly) {
    filtered = filtered.filter((font) => font.variable)
  }

  const prefer = new Set(
    (input.preferIds ?? [])
      .map((id) => normalizeFontsourceId(id))
      .filter(Boolean),
  )

  filtered.sort((a, b) => {
    const aPrefer = prefer.has(a.id)
    const bPrefer = prefer.has(b.id)
    if (aPrefer && !bPrefer) return -1
    if (!aPrefer && bPrefer) return 1
    const aPopular = POPULAR_IDS.has(a.id)
    const bPopular = POPULAR_IDS.has(b.id)
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
    catalogFailed: catalogFailed || undefined,
  }
}
