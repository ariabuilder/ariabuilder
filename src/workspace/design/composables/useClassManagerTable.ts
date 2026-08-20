import {
  createColumnHelper,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type VisibilityState,
  useVueTable,
} from "@tanstack/vue-table"
import { computed, h, ref, watch, type ComputedRef } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { valueUpdater } from "@/components/ui/table/utils"
import { m } from "@/paraglide/messages.js"
import { createStudioTableSelectColumn } from "@/workspace/studio/core"
import {
  ClassManagerSegmentSchema,
  ClassManagerTableStateSchema,
  parseClassManagerTableState,
  type ClassManagerRow,
  type ClassManagerSegment,
} from "../lib/classManagerTable"

interface UseClassManagerTableOptions {
  rows: ComputedRef<ClassManagerRow[]>
  onEditCss: (row: ClassManagerRow) => void
  onRenameClass: (row: ClassManagerRow) => void
  onDuplicateClass: (row: ClassManagerRow) => void
  onDeleteClass: (row: ClassManagerRow) => void
}

const columnHelper = createColumnHelper<ClassManagerRow>()
const STORAGE_KEY = "aria-class-manager-table-state"
const COLUMN_VISIBILITY_KEY = "aria:class-manager:table-columns"

function loadColumnVisibility(): VisibilityState {
  try {
    const raw = localStorage.getItem(COLUMN_VISIBILITY_KEY)
    if (raw) return JSON.parse(raw) as VisibilityState
  } catch {
    /* ignore */
  }
  return {}
}

function saveColumnVisibility(state: VisibilityState) {
  try {
    localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

function getStoredClassManagerTableState() {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return parseClassManagerTableState({})
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return parseClassManagerTableState({})
    return parseClassManagerTableState(JSON.parse(stored))
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return parseClassManagerTableState({})
  }
}

function buildSegmentColumnFilters(
  segment: ClassManagerSegment,
): ColumnFiltersState {
  if (segment === "all") return []
  return [{ id: "status", value: segment }]
}

export function useClassManagerTable(options: UseClassManagerTableOptions) {
  const initialState = getStoredClassManagerTableState()
  const sorting = ref<SortingState>(initialState.sorting)
  const columnFilters = ref<ColumnFiltersState>(
    buildSegmentColumnFilters(initialState.segment),
  )
  const globalFilter = ref(initialState.query)
  const columnVisibility = ref<VisibilityState>({
    searchText: false,
    ...loadColumnVisibility(),
  })
  const activeSegment = ref<ClassManagerSegment>(initialState.segment)
  const rowSelection = ref<RowSelectionState>({})

  const counts = computed(() => {
    let used = 0
    let unused = 0
    for (const row of options.rows.value) {
      if (row.status === "used") used += 1
      else unused += 1
    }
    return {
      all: options.rows.value.length,
      used,
      unused,
    }
  })

  const filters = computed(() => [
    {
      key: "all" as ClassManagerSegment,
      label: m.design_classes_filter_all(),
      count: counts.value.all,
    },
    {
      key: "used" as ClassManagerSegment,
      label: m.design_classes_filter_used(),
      count: counts.value.used,
    },
    {
      key: "unused" as ClassManagerSegment,
      label: m.design_classes_filter_unused(),
      count: counts.value.unused,
    },
  ])

  function getStatusLabel(status: ClassManagerRow["status"]): string {
    return status === "used"
      ? m.design_classes_status_used()
      : m.design_classes_status_unused()
  }

  function formatCssSummary(row: ClassManagerRow): string {
    if (row.cssSummary === "No rules yet") {
      return m.design_classes_no_rules_yet()
    }
    return row.cssSummary
  }

  const columns = computed(() => [
    createStudioTableSelectColumn<ClassManagerRow>(),
    columnHelper.accessor((row) => row.searchText, {
      id: "searchText",
      header: () => null,
      cell: () => null,
      enableSorting: false,
      enableColumnFilter: false,
      enableGlobalFilter: true,
      enableHiding: false,
    }),
    columnHelper.accessor((row) => row.name, {
      id: "name",
      size: 240,
      header: m.design_classes_column_class(),
      meta: { label: m.design_classes_column_class() },
      cell: ({ row }) =>
        h(
          "p",
          {
            class: "min-w-0 truncate font-mono text-xs text-foreground/90",
          },
          row.original.name,
        ),
      enableGlobalFilter: false,
      enableHiding: false,
    }),
    columnHelper.accessor((row) => row.status, {
      id: "status",
      size: 120,
      header: m.design_classes_column_status(),
      meta: { label: m.design_classes_column_status() },
      cell: ({ row }) =>
        h(
          "span",
          {
            class:
              "inline-flex w-fit items-center rounded-md border border-transparent bg-transparent px-1 py-0 text-2xs font-medium uppercase tracking-widest text-muted-foreground transition-colors group-hover:bg-card/70 group-hover:text-foreground",
          },
          getStatusLabel(row.original.status),
        ),
      enableGlobalFilter: false,
      filterFn: (row, columnId, filterValue) => {
        if (filterValue !== "used" && filterValue !== "unused") return true
        return row.getValue<string>(columnId) === filterValue
      },
    }),
    columnHelper.accessor((row) => row.usageCount, {
      id: "usageCount",
      size: 100,
      header: m.design_classes_column_usage(),
      meta: { label: m.design_classes_column_usage() },
      cell: ({ row }) =>
        h(
          "p",
          { class: "font-mono text-xs tabular-nums text-foreground/90" },
          row.original.usageCount === 1
            ? m.design_classes_usage_ref({
                count: String(row.original.usageCount),
              })
            : m.design_classes_usage_refs({
                count: String(row.original.usageCount),
              }),
        ),
      enableGlobalFilter: false,
    }),
    columnHelper.accessor((row) => row.cssSummary, {
      id: "css",
      header: m.design_classes_column_css(),
      meta: {
        studioTableWidthMode: "flex",
        label: m.design_classes_column_css(),
      },
      cell: ({ row }) =>
        h(
          "p",
          {
            class: "truncate font-mono text-xs text-foreground/90",
            title: formatCssSummary(row.original),
          },
          formatCssSummary(row.original),
        ),
      enableSorting: false,
      enableGlobalFilter: false,
    }),
    columnHelper.display({
      id: "actions",
      size: 160,
      maxSize: 160,
      meta: { studioTableWidthMode: "fixed" },
      header: "",
      cell: ({ row }) =>
        h("div", { class: "flex items-center justify-end gap-1" }, [
          h(
            Button,
            {
              size: "icon-sm",
              variant: "ghost",
              class:
                "h-7 w-7 rounded-md opacity-0 transition-all duration-150 group-hover:opacity-100 focus-visible:opacity-100",
              title: m.design_classes_action_edit_css(),
              "aria-label": m.design_classes_action_edit_css(),
              onClick: (e: Event) => {
                e.stopPropagation()
                options.onEditCss(row.original)
              },
            },
            {
              default: () => h(AppIcon, { name: "code", size: 14 }),
            },
          ),
          h(
            Button,
            {
              size: "icon-sm",
              variant: "ghost",
              class:
                "h-7 w-7 rounded-md opacity-0 transition-all duration-150 group-hover:opacity-100 focus-visible:opacity-100",
              title: m.design_classes_action_rename(),
              "aria-label": m.design_classes_action_rename(),
              onClick: (e: Event) => {
                e.stopPropagation()
                options.onRenameClass(row.original)
              },
            },
            {
              default: () => h(AppIcon, { name: "edit", size: 14 }),
            },
          ),
          h(
            Button,
            {
              size: "icon-sm",
              variant: "ghost",
              class:
                "h-7 w-7 rounded-md opacity-0 transition-all duration-150 group-hover:opacity-100 focus-visible:opacity-100",
              title: m.design_classes_action_duplicate(),
              "aria-label": m.design_classes_action_duplicate(),
              onClick: (e: Event) => {
                e.stopPropagation()
                options.onDuplicateClass(row.original)
              },
            },
            {
              default: () => h(AppIcon, { name: "copy", size: 14 }),
            },
          ),
          h(
            Button,
            {
              size: "icon-sm",
              variant: "ghost",
              class:
                "h-7 w-7 rounded-md opacity-0 transition-all duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-destructive/8 hover:text-destructive",
              title: m.design_classes_action_delete(),
              "aria-label": m.design_classes_action_delete(),
              onClick: (e: Event) => {
                e.stopPropagation()
                options.onDeleteClass(row.original)
              },
            },
            {
              default: () => h(AppIcon, { name: "trash", size: 14 }),
            },
          ),
        ]),
      enableSorting: false,
      enableColumnFilter: false,
      enableGlobalFilter: false,
      enableHiding: false,
    }),
  ])

  const table = useVueTable<ClassManagerRow>({
    get data() {
      return options.rows.value
    },
    get columns() {
      return columns.value
    },
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: {
      get sorting() {
        return sorting.value
      },
      get columnFilters() {
        return columnFilters.value
      },
      get globalFilter() {
        return globalFilter.value
      },
      get columnVisibility() {
        return columnVisibility.value
      },
      get rowSelection() {
        return rowSelection.value
      },
    },
    enableRowSelection: true,
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      rowSelection.value =
        typeof updater === "function" ? updater(rowSelection.value) : updater
    },
    onSortingChange: (updater) => valueUpdater(updater, sorting),
    onColumnFiltersChange: (updater) => valueUpdater(updater, columnFilters),
    onGlobalFilterChange: (updater) => valueUpdater(updater, globalFilter),
    onColumnVisibilityChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater(columnVisibility.value)
          : updater
      columnVisibility.value = { ...next, name: true, searchText: false }
      saveColumnVisibility(columnVisibility.value)
    },
  })

  const searchQuery = computed({
    get: () => globalFilter.value,
    set: (value: string) => {
      globalFilter.value = value
    },
  })

  const hasActiveFilters = computed(
    () => globalFilter.value.trim().length > 0 || activeSegment.value !== "all",
  )

  function setActiveSegment(value: string): void {
    const parsedSegment = ClassManagerSegmentSchema.safeParse(value)
    if (!parsedSegment.success) return

    activeSegment.value = parsedSegment.data
    const nextFilters = columnFilters.value.filter(
      (filter) => filter.id !== "status",
    )
    if (parsedSegment.data !== "all") {
      nextFilters.push({ id: "status", value: parsedSegment.data })
    }
    columnFilters.value = nextFilters
  }

  watch(
    [globalFilter, activeSegment, sorting],
    ([query, segment, nextSorting]) => {
      if (
        typeof window === "undefined" ||
        typeof localStorage === "undefined"
      ) {
        return
      }
      const persistedState = ClassManagerTableStateSchema.parse({
        query,
        segment,
        sorting: nextSorting,
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState))
    },
    { deep: true },
  )

  return {
    table,
    searchQuery,
    activeSegment,
    counts,
    filters,
    hasActiveFilters,
    rowSelection,
    columnVisibility,
    setActiveSegment,
  }
}
