import { ENTRY_STATUSES } from "../../../../../shared/cms"

export type CmsEntryViewMode = "table" | "grid"
export type CmsEntryStatusFilter = "all" | (typeof ENTRY_STATUSES)[number]

export function parseCmsEntryViewMode(value: unknown): CmsEntryViewMode {
  return value === "grid" || value === "table" ? value : "table"
}

export function parseCmsEntryStatusFilter(
  value: unknown,
): CmsEntryStatusFilter {
  if (value === "all") return "all"
  if (
    typeof value === "string" &&
    (ENTRY_STATUSES as readonly string[]).includes(value)
  ) {
    return value as CmsEntryStatusFilter
  }
  return "all"
}
