import { createColumnHelper, type ColumnDef } from "@tanstack/vue-table"
import { computed, h, type Ref } from "vue"
import { m } from "@/paraglide/messages.js"
import {
  createStudioTableSelectColumn,
  useStudioInventoryTable,
} from "@/workspace/studio/core"
import type { ScanComponent } from "@/workspace/types"
import {
  componentDisplayName,
  formatComponentUpdated,
} from "./componentsDisplay"

export type ComponentsTableRow = ScanComponent & {
  displayName: string
}

const columnHelper = createColumnHelper<ComponentsTableRow>()

export function toComponentsTableRows(
  components: ScanComponent[],
): ComponentsTableRow[] {
  return components.map((component) => ({
    ...component,
    displayName: componentDisplayName(component.name, component.file),
  }))
}

export function useComponentsTable(rows: Ref<ComponentsTableRow[]>) {
  const columns = computed<ColumnDef<ComponentsTableRow, unknown>[]>(() => [
    createStudioTableSelectColumn<ComponentsTableRow>(),
    columnHelper.accessor("displayName", {
      id: "name",
      header: m.components_col_component(),
      size: 220,
      meta: { studioTableWidthMode: "flex" },
      cell: (info) =>
        h(
          "span",
          { class: "truncate font-medium text-foreground" },
          info.getValue(),
        ),
    }),
    columnHelper.accessor("id", {
      id: "id",
      header: m.components_col_id(),
      size: 220,
      cell: (info) =>
        h(
          "span",
          {
            class:
              "truncate font-mono text-[11px] text-muted-foreground",
          },
          info.getValue(),
        ),
    }),
    columnHelper.accessor((row) => row.category, {
      id: "category",
      header: m.components_col_category(),
      size: 160,
      cell: (info) =>
        h(
          "span",
          { class: "truncate text-muted-foreground" },
          info.getValue() || m.components_uncategorized(),
        ),
    }),
    columnHelper.accessor("file", {
      id: "file",
      header: m.components_col_file(),
      size: 280,
      cell: (info) =>
        h(
          "span",
          {
            class:
              "truncate font-mono text-[11px] text-muted-foreground",
          },
          info.getValue(),
        ),
    }),
    columnHelper.accessor("mtimeMs", {
      id: "updated",
      header: m.components_col_updated(),
      size: 220,
      cell: (info) =>
        h(
          "span",
          { class: "truncate tabular-nums text-muted-foreground" },
          formatComponentUpdated(info.getValue()),
        ),
    }),
  ])

  return useStudioInventoryTable({
    rows,
    columns,
    getRowId: (row) => row.id,
    initialSorting: [{ id: "name", desc: false }],
  })
}
