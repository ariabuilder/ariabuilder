import {
  getCoreRowModel,
  getSortedRowModel,
  useVueTable,
  type ColumnDef,
  type ColumnOrderState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/vue-table"
import { toValue, ref, type MaybeRefOrGetter, type Ref } from "vue"

export type UseStudioInventoryTableOptions<TRow> = {
  rows: Ref<TRow[]>
  columns: MaybeRefOrGetter<ColumnDef<TRow, unknown>[]>
  getRowId: (row: TRow) => string
  initialSorting?: SortingState
  initialColumnVisibility?: VisibilityState
  initialColumnOrder?: ColumnOrderState
  enableRowSelection?: boolean | ((row: Row<TRow>) => boolean)
  /** When false, skips column-order state (media table). Default true. */
  enableColumnOrdering?: boolean
}

/**
 * Shared TanStack wiring for studio inventory tables (pages, components, media).
 * Column defs stay domain-specific; sorting/selection/visibility/order live here.
 */
export function useStudioInventoryTable<TRow>(
  options: UseStudioInventoryTableOptions<TRow>,
) {
  const sorting = ref<SortingState>(options.initialSorting ?? [])
  const rowSelection = ref<RowSelectionState>({})
  const columnVisibility = ref<VisibilityState>(
    options.initialColumnVisibility ?? {},
  )
  const columnOrder = ref<ColumnOrderState>(options.initialColumnOrder ?? [])
  const enableColumnOrdering = options.enableColumnOrdering !== false

  const table = useVueTable({
    get data() {
      return options.rows.value
    },
    get columns() {
      return toValue(options.columns)
    },
    state: {
      get sorting() {
        return sorting.value
      },
      get rowSelection() {
        return rowSelection.value
      },
      get columnVisibility() {
        return columnVisibility.value
      },
      get columnOrder() {
        return enableColumnOrdering ? columnOrder.value : []
      },
    },
    enableRowSelection: options.enableRowSelection ?? true,
    getRowId: options.getRowId,
    onSortingChange: (updater) => {
      sorting.value =
        typeof updater === "function" ? updater(sorting.value) : updater
    },
    onRowSelectionChange: (updater) => {
      rowSelection.value =
        typeof updater === "function" ? updater(rowSelection.value) : updater
    },
    onColumnVisibilityChange: (updater) => {
      columnVisibility.value =
        typeof updater === "function"
          ? updater(columnVisibility.value)
          : updater
    },
    onColumnOrderChange: enableColumnOrdering
      ? (updater) => {
          columnOrder.value =
            typeof updater === "function" ? updater(columnOrder.value) : updater
        }
      : undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return {
    table,
    rowSelection,
    sorting,
    columnVisibility,
    columnOrder,
  }
}
