export type CmsEntrySortKey =
  | "title"
  | "slug"
  | "updatedAt"
  | "publishedAt"
  | "createdAt"

export type CmsEntrySortDirection = "asc" | "desc"

export type CmsEntrySort = {
  key: CmsEntrySortKey
  direction: CmsEntrySortDirection
}

const SORT_KEYS = new Set<CmsEntrySortKey>([
  "title",
  "slug",
  "updatedAt",
  "publishedAt",
  "createdAt",
])

export function parseCmsEntrySort(value: unknown): CmsEntrySort {
  if (
    value &&
    typeof value === "object" &&
    "key" in value &&
    "direction" in value
  ) {
    const key = (value as CmsEntrySort).key
    const direction = (value as CmsEntrySort).direction
    if (
      SORT_KEYS.has(key) &&
      (direction === "asc" || direction === "desc")
    ) {
      return { key, direction }
    }
  }
  return { key: "updatedAt", direction: "desc" }
}
