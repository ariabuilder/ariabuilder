import { z } from "zod"
import { summarizeClassCss } from "./classManagerCss"

export const ClassManagerSegmentSchema = z.enum(["all", "used", "unused"])

export type ClassManagerSegment = z.infer<typeof ClassManagerSegmentSchema>

export const ClassManagerSortableColumnSchema = z.enum([
  "status",
  "name",
  "usageCount",
])

export type ClassManagerSortableColumn = z.infer<
  typeof ClassManagerSortableColumnSchema
>

export const ClassManagerTableSortSchema = z.object({
  id: ClassManagerSortableColumnSchema,
  desc: z.boolean(),
})

export type ClassManagerTableSort = z.infer<typeof ClassManagerTableSortSchema>

export const ClassManagerTableStateSchema = z.object({
  query: z.string().catch(""),
  segment: ClassManagerSegmentSchema.catch("all"),
  sorting: z.array(ClassManagerTableSortSchema).catch([]),
})

export type ClassManagerTableState = z.infer<
  typeof ClassManagerTableStateSchema
>

export type ClassManagerRowStatus = "used" | "unused"

export interface ClassManagerRow {
  id: string
  name: string
  status: ClassManagerRowStatus
  statusLabel: string
  usageCount: number
  css: string
  cssSummary: string
  searchText: string
}

export function parseClassManagerTableState(
  value: unknown,
): ClassManagerTableState {
  return ClassManagerTableStateSchema.parse(value)
}

function buildSearchText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .trim()
    .toLowerCase()
}

export function buildClassManagerRows(
  classes: ReadonlyArray<{ name: string; css: string }>,
  usageCounts: Readonly<Record<string, number>>,
): ClassManagerRow[] {
  return classes.map((item) => {
    const usageCount = usageCounts[item.name] ?? 0
    const status: ClassManagerRowStatus = usageCount > 0 ? "used" : "unused"
    const cssSummary = summarizeClassCss(item.css)
    return {
      id: item.name,
      name: item.name,
      status,
      statusLabel: status === "used" ? "Used" : "Unused",
      usageCount,
      css: item.css,
      cssSummary,
      searchText: buildSearchText([item.name, status, cssSummary]),
    }
  })
}
