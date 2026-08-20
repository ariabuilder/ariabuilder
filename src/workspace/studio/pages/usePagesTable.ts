import { createColumnHelper, type ColumnDef } from "@tanstack/vue-table"
import { computed, h, type Ref } from "vue"
import { m } from "@/paraglide/messages.js"
import {
  createStudioTableSelectColumn,
  useStudioInventoryTable,
} from "@/workspace/studio/core"
import type { ScanPage } from "@/workspace/types"
import { formatPageUpdated, pageDisplayName } from "./pagesDisplay"

export type PagesTableRow = ScanPage & {
  displayName: string
}

const columnHelper = createColumnHelper<PagesTableRow>()

export function toPagesTableRows(pages: ScanPage[]): PagesTableRow[] {
  return [...pages]
    .map((page) => ({
      ...page,
      displayName: page.title?.trim() || pageDisplayName(page.file),
    }))
    .sort((a, b) => a.route.localeCompare(b.route))
}

/**
 * Pages is a filesystem inventory, so it includes entry templates even though
 * they cannot be opened as bare preview routes without an entry slug.
 */
export function toPagesInventoryRows(pages: ScanPage[]): PagesTableRow[] {
  return toPagesTableRows(pages)
}

export function usePagesTable(rows: Ref<PagesTableRow[]>) {
  const columns = computed<ColumnDef<PagesTableRow, unknown>[]>(() => [
    createStudioTableSelectColumn<PagesTableRow>(),
    columnHelper.accessor("displayName", {
      id: "page",
      header: m.pages_col_page(),
      size: 220,
      meta: { studioTableWidthMode: "flex" },
      cell: (info) =>
        h("span", { class: "truncate font-medium text-foreground" }, info.getValue()),
    }),
    columnHelper.accessor("route", {
      id: "route",
      header: m.pages_col_route(),
      size: 200,
      cell: (info) =>
        h(
          "span",
          { class: "truncate font-mono text-muted-foreground" },
          info.getValue(),
        ),
    }),
    columnHelper.accessor("file", {
      id: "file",
      header: m.pages_col_file(),
      size: 280,
      cell: (info) =>
        h(
          "span",
          { class: "truncate font-mono text-[11px] text-muted-foreground" },
          info.getValue(),
        ),
    }),
    columnHelper.accessor("mtimeMs", {
      id: "updated",
      header: m.pages_col_updated(),
      // Fits medium date+time + last-column trailing gutter (pr-7).
      size: 220,
      cell: (info) =>
        h(
          "span",
          { class: "truncate tabular-nums text-muted-foreground" },
          formatPageUpdated(info.getValue()),
        ),
    }),
  ])

  return useStudioInventoryTable({
    rows,
    columns,
    getRowId: (row) => row.file,
    initialSorting: [{ id: "route", desc: false }],
    enableRowSelection: (row) => row.original.route !== "/",
  })
}
