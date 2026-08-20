const ICONIFY_COLLECTIONS_URL = "https://api.iconify.design/collections"
const DEFAULT_PAGE_SIZE = 32

/** Prefer these sets near the top when not filtered by search. */
const FEATURED_PREFIXES = new Set([
  "lucide",
  "mdi",
  "simple-icons",
  "heroicons",
  "tabler",
  "ph",
  "radix-icons",
  "carbon",
  "solar",
  "fluent",
  "material-symbols",
  "fa6-solid",
  "fa6-brands",
  "remixicon",
  "bi",
])

export type IconifyCollectionCategory = string

export type IconifyCatalogEntry = {
  prefix: string
  name: string
  total: number
  category: string
  samples: string[]
}

export type ListIconifyCollectionsInput = {
  search?: string
  category?: IconifyCollectionCategory | "all"
  preferPrefixes?: string[]
  limit?: number
  offset?: number
}

export type ListIconifyCollectionsResult = {
  collections: IconifyCatalogEntry[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

type IconifyInfoRaw = {
  name?: string
  total?: number
  category?: string
  samples?: string[]
}

let catalogCache: IconifyCatalogEntry[] | null = null
let catalogPromise: Promise<IconifyCatalogEntry[]> | null = null
let categoryCache: string[] | null = null

function normalizeEntry(
  prefix: string,
  info: IconifyInfoRaw,
): IconifyCatalogEntry | null {
  const name = typeof info.name === "string" ? info.name.trim() : ""
  if (!name) return null
  const total = typeof info.total === "number" && info.total > 0 ? info.total : 0
  const category =
    typeof info.category === "string" && info.category.trim()
      ? info.category.trim()
      : "Other"
  const samples = Array.isArray(info.samples)
    ? info.samples.filter(
        (s): s is string => typeof s === "string" && s.trim().length > 0,
      )
    : []
  return {
    prefix,
    name,
    total,
    category,
    samples,
  }
}

async function fetchCatalog(): Promise<IconifyCatalogEntry[]> {
  const response = await fetch(ICONIFY_COLLECTIONS_URL)
  if (!response.ok) {
    throw new Error(`Iconify collections request failed (${response.status})`)
  }
  const data = (await response.json()) as Record<string, IconifyInfoRaw>
  const entries: IconifyCatalogEntry[] = []
  for (const [prefix, info] of Object.entries(data)) {
    if (!info || typeof info !== "object") continue
    const entry = normalizeEntry(prefix, info)
    if (entry) entries.push(entry)
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  return entries
}

export async function loadIconifyCatalog(
  force = false,
): Promise<IconifyCatalogEntry[]> {
  if (!force && catalogCache) return catalogCache
  if (!force && catalogPromise) return catalogPromise

  catalogPromise = fetchCatalog()
    .then((entries) => {
      catalogCache = entries
      categoryCache = null
      return entries
    })
    .finally(() => {
      catalogPromise = null
    })

  return catalogPromise
}

export async function listIconifyCategories(): Promise<string[]> {
  const catalog = await loadIconifyCatalog()
  if (categoryCache) return categoryCache
  const set = new Set<string>()
  for (const entry of catalog) {
    if (entry.category) set.add(entry.category)
  }
  categoryCache = [...set].sort((a, b) => a.localeCompare(b))
  return categoryCache
}

export async function listIconifyCollections(
  input: ListIconifyCollectionsInput = {},
): Promise<ListIconifyCollectionsResult> {
  let filtered = (await loadIconifyCatalog()).slice()

  const search = input.search?.trim().toLowerCase()
  if (search) {
    filtered = filtered.filter(
      (entry) =>
        entry.name.toLowerCase().includes(search) ||
        entry.prefix.toLowerCase().includes(search) ||
        entry.category.toLowerCase().includes(search),
    )
  }

  if (input.category && input.category !== "all") {
    filtered = filtered.filter((entry) => entry.category === input.category)
  }

  const prefer = new Set(
    (input.preferPrefixes ?? [])
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  )

  filtered.sort((a, b) => {
    const aPrefer = prefer.has(a.prefix.toLowerCase())
    const bPrefer = prefer.has(b.prefix.toLowerCase())
    if (aPrefer && !bPrefer) return -1
    if (!aPrefer && bPrefer) return 1
    const aFeatured = FEATURED_PREFIXES.has(a.prefix)
    const bFeatured = FEATURED_PREFIXES.has(b.prefix)
    if (aFeatured && !bFeatured) return -1
    if (!aFeatured && bFeatured) return 1
    return a.name.localeCompare(b.name)
  })

  const total = filtered.length
  const offset = Math.max(0, input.offset ?? 0)
  const limit = Math.max(1, input.limit ?? DEFAULT_PAGE_SIZE)
  const page = filtered.slice(offset, offset + limit)

  return {
    collections: page,
    total,
    offset,
    limit,
    hasMore: offset + page.length < total,
  }
}

/** Absolute Iconify SVG URL for a sample icon. */
export function iconifySvgUrl(prefix: string, name: string): string {
  return `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`
}
