import { COLLECTION_KINDS } from "../../../../../shared/cms"

export type CmsCollectionViewMode = "table" | "grid"
export type CmsCollectionKindFilter = "all" | (typeof COLLECTION_KINDS)[number]
export type CmsCollectionSortKey = "label" | "name" | "kind" | "itemCount"
export type CmsCollectionSortDirection = "asc" | "desc"
export type CmsCollectionSort = {
  key: CmsCollectionSortKey
  direction: CmsCollectionSortDirection
}

const SORT_KEYS = new Set<CmsCollectionSortKey>([
  "label",
  "name",
  "kind",
  "itemCount",
])

export function parseCmsCollectionViewMode(
  value: unknown,
): CmsCollectionViewMode {
  return value === "grid" || value === "table" ? value : "table"
}

export function parseCmsCollectionKindFilter(
  value: unknown,
): CmsCollectionKindFilter {
  if (value === "all") return "all"
  if (
    typeof value === "string" &&
    (COLLECTION_KINDS as readonly string[]).includes(value)
  ) {
    return value as CmsCollectionKindFilter
  }
  return "all"
}

export function parseCmsCollectionSort(value: unknown): CmsCollectionSort {
  if (
    value &&
    typeof value === "object" &&
    "key" in value &&
    "direction" in value
  ) {
    const key = (value as CmsCollectionSort).key
    const direction = (value as CmsCollectionSort).direction
    if (
      SORT_KEYS.has(key) &&
      (direction === "asc" || direction === "desc")
    ) {
      return { key, direction }
    }
  }
  return { key: "label", direction: "asc" }
}
