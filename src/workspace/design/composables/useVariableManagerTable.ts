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
import { computed, h, ref, watch, type ComputedRef, type Ref } from "vue"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { valueUpdater } from "@/components/ui/table/utils"
import AppIcon from "@/components/ui/app-icon/AppIcon.vue"
import { m } from "@/paraglide/messages.js"
import { createStudioTableSelectColumn } from "@/workspace/studio/core"
import type { DesignVariableAlias, DesignVariables } from "../../../../shared/design"
import VariableManagerSourceCell from "../components/VariableManagerSourceCell.vue"
import {
  buildVariableManagerRows,
  parseVariableManagerTableState,
  VariableManagerSegmentSchema,
  VariableManagerTableStateSchema,
  type VariableManagerRow,
  type VariableManagerSegment,
} from "../lib/variableManagerTable"
import {
  isValidCssCustomPropertyKey,
  normalizeCssVariableKey,
  type VariableManagerTokenOption,
} from "../lib/variableManagerTokens"

interface VariableManagerOption {
  value: string
  label: string
}

type MaybePromise<T> = T | Promise<T>

interface UseVariableManagerTableOptions {
  variables: Ref<DesignVariables>
  designTokenOptions: ComputedRef<readonly VariableManagerTokenOption[]>
  customVariableOptions: ComputedRef<readonly VariableManagerOption[]>
  tokenOptionsLoading?: Ref<boolean>
  renameCustomVariableKey: (
    currentKey: string,
    nextKey: string,
  ) => MaybePromise<boolean | void>
  renameAliasKey: (
    currentKey: string,
    nextKey: string,
  ) => MaybePromise<boolean | void>
  duplicateCustomVariable: (key: string) => MaybePromise<string | null>
  duplicateAlias: (key: string) => MaybePromise<string | null>
  removeCustomVariable: (key: string) => MaybePromise<boolean | void>
  removeAlias: (key: string) => MaybePromise<boolean | void>
  editVariable: (row: VariableManagerRow) => void
  /** Called after inline edits that mutate variables in place. */
  onVariablesMutated?: () => void
}

const columnHelper = createColumnHelper<VariableManagerRow>()
const STORAGE_KEY = "aria-variable-manager-table-state"
const MINIMAL_CELL_INPUT_CLASS =
  "h-7! rounded-md border border-transparent bg-transparent px-2 text-xs! shadow-none transition-colors placeholder:text-muted-foreground/70 hover:border-border/50 hover:bg-card/30 focus-visible:border-border focus-visible:bg-background focus-visible:ring-0"
const MINIMAL_MONO_CELL_INPUT_CLASS = `${MINIMAL_CELL_INPUT_CLASS} font-mono text-foreground/90`
const MINIMAL_KEY_CELL_INPUT_CLASS = `${MINIMAL_MONO_CELL_INPUT_CLASS} pl-7`
const COMPACT_ROW_ACTION_CLASS =
  "h-7 w-7 rounded-md opacity-0 transition-all duration-150 group-hover:opacity-100 focus-visible:opacity-100"

function getStoredVariableManagerTableState() {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return parseVariableManagerTableState({})
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return parseVariableManagerTableState({})
    }

    return parseVariableManagerTableState(JSON.parse(stored))
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return parseVariableManagerTableState({})
  }
}

function buildSegmentColumnFilters(
  segment: VariableManagerSegment,
): ColumnFiltersState {
  if (segment === "all") {
    return []
  }

  return [
    {
      id: "kind",
      value: segment,
    },
  ]
}

export function useVariableManagerTable(
  options: UseVariableManagerTableOptions,
) {
  const initialState = getStoredVariableManagerTableState()
  const customKeyDrafts = ref<Record<string, string>>({})
  const aliasKeyDrafts = ref<Record<string, string>>({})
  const sorting = ref<SortingState>(initialState.sorting)
  const columnFilters = ref<ColumnFiltersState>(
    buildSegmentColumnFilters(initialState.segment),
  )
  const globalFilter = ref(initialState.query)
  const columnVisibility = ref<VisibilityState>({
    searchText: false,
  })
  const activeSegment = ref<VariableManagerSegment>(initialState.segment)
  const rowSelection = ref<RowSelectionState>({})

  const rows = computed<VariableManagerRow[]>(() =>
    buildVariableManagerRows(
      options.variables.value,
      options.designTokenOptions.value,
    ),
  )

  const counts = computed(() => {
    let custom = 0
    let aliases = 0

    for (const row of rows.value) {
      if (row.kind === "custom") {
        custom += 1
        continue
      }

      aliases += 1
    }

    return {
      all: rows.value.length,
      custom,
      aliases,
    }
  })

  const filters = computed(() => [
    {
      key: "all" as VariableManagerSegment,
      label: m.design_variables_filter_all(),
      count: counts.value.all,
    },
    {
      key: "custom" as VariableManagerSegment,
      label: m.design_variables_filter_variable(),
      count: counts.value.custom,
    },
    {
      key: "aliases" as VariableManagerSegment,
      label: m.design_variables_filter_alias(),
      count: counts.value.aliases,
    },
  ])

  function notifyMutated(): void {
    options.onVariablesMutated?.()
  }

  function syncCustomDraft(key: string, value: string): void {
    customKeyDrafts.value[key] = value
  }

  function syncAliasDraft(key: string, value: string): void {
    aliasKeyDrafts.value[key] = value
  }

  function normalizeKeyDraft(value: string, fallbackKey: string): string {
    const normalizedKey = normalizeCssVariableKey(value)
    return isValidCssCustomPropertyKey(normalizedKey)
      ? normalizedKey
      : fallbackKey
  }

  function commitCustomKey(currentKey: string): void {
    const nextKey = normalizeKeyDraft(
      customKeyDrafts.value[currentKey] ?? currentKey,
      currentKey,
    )
    void options.renameCustomVariableKey(currentKey, nextKey)
    delete customKeyDrafts.value[currentKey]
  }

  function commitAliasKey(currentKey: string): void {
    const nextKey = normalizeKeyDraft(
      aliasKeyDrafts.value[currentKey] ?? currentKey,
      currentKey,
    )
    void options.renameAliasKey(currentKey, nextKey)
    delete aliasKeyDrafts.value[currentKey]
  }

  function updateAliasSourceType(
    alias: DesignVariableAlias,
    value: string,
  ): void {
    if (value !== "token" && value !== "custom") {
      return
    }
    if (alias.sourceType === value) {
      return
    }

    alias.sourceType = value
    alias.sourceKey = ""
    notifyMutated()
  }

  function updateAliasTokenSource(
    alias: DesignVariableAlias,
    optionValue: string | null,
  ): void {
    if (!optionValue) {
      return
    }

    alias.sourceType = "token"
    alias.sourceKey = optionValue

    if (!alias.label.trim()) {
      alias.label =
        options.designTokenOptions.value.find(
          (option) => option.value === optionValue,
        )?.suggestedLabel || alias.label
    }
    notifyMutated()
  }

  function updateAliasCustomSource(
    alias: DesignVariableAlias,
    sourceKey: string,
  ): void {
    alias.sourceType = "custom"
    alias.sourceKey = sourceKey
    notifyMutated()
  }

  const columns = computed(() => {
    const nextColumns = [
      createStudioTableSelectColumn<VariableManagerRow>(),
      columnHelper.accessor((row) => row.searchText, {
        id: "searchText",
        header: () => null,
        cell: () => null,
        enableSorting: false,
        enableColumnFilter: false,
        enableGlobalFilter: true,
      }),
      columnHelper.accessor(
        (row) => (row.kind === "custom" ? "custom" : "aliases"),
        {
          id: "kind",
          size: 88,
          header: m.design_variables_column_type(),
          cell: ({ row }) =>
            h(
              "span",
              {
                class:
                  "inline-flex w-fit items-center rounded-md border border-transparent bg-transparent px-0 py-0 text-2xs font-medium uppercase tracking-widest text-muted-foreground transition-colors group-hover:bg-card/70 group-hover:text-foreground",
              },
              row.original.kind === "custom"
                ? m.design_variables_type_variable()
                : m.design_variables_type_alias(),
            ),
          enableGlobalFilter: false,
          filterFn: (row, columnId, filterValue) => {
            if (filterValue !== "custom" && filterValue !== "aliases") {
              return true
            }

            return row.getValue<string>(columnId) === filterValue
          },
        },
      ),
      columnHelper.accessor((row) => row.key, {
        id: "key",
        size: 200,
        header: m.design_variables_column_key(),
        cell: ({ row }) => {
          const prefix = h(
            "span",
            {
              class:
                "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted-foreground/60",
            },
            "--",
          )

          if (row.original.kind === "custom") {
            return h("div", { class: "relative" }, [
              prefix,
              h(Input, {
                modelValue:
                  customKeyDrafts.value[row.original.key] ?? row.original.key,
                placeholder: "custom-var",
                class: MINIMAL_KEY_CELL_INPUT_CLASS,
                "onUpdate:modelValue": (value: string | number) => {
                  syncCustomDraft(row.original.key, String(value))
                },
                onBlur: () => {
                  commitCustomKey(row.original.key)
                },
              }),
            ])
          }

          return h("div", { class: "relative" }, [
            prefix,
            h(Input, {
              modelValue:
                aliasKeyDrafts.value[row.original.key] ?? row.original.key,
              placeholder: "alias-var",
              class: MINIMAL_KEY_CELL_INPUT_CLASS,
              "onUpdate:modelValue": (value: string | number) => {
                syncAliasDraft(row.original.key, String(value))
              },
              onBlur: () => {
                commitAliasKey(row.original.key)
              },
            }),
          ])
        },
        enableGlobalFilter: false,
      }),
      columnHelper.accessor((row) => row.label, {
        id: "label",
        size: 140,
        header: m.design_variables_column_label(),
        cell: ({ row }) => {
          if (row.original.kind === "custom") {
            const variable = row.original.variable

            return h(Input, {
              modelValue: variable.label,
              placeholder: m.design_variables_placeholder_label(),
              class: MINIMAL_CELL_INPUT_CLASS,
              "onUpdate:modelValue": (value: string | number) => {
                variable.label = String(value)
                notifyMutated()
              },
            })
          }

          const alias = row.original.alias

          return h(Input, {
            modelValue: alias.label,
            placeholder: m.design_variables_placeholder_label(),
            class: MINIMAL_CELL_INPUT_CLASS,
            "onUpdate:modelValue": (value: string | number) => {
              alias.label = String(value)
              notifyMutated()
            },
          })
        },
        enableGlobalFilter: false,
      }),
      columnHelper.accessor((row) => row.sourceLabel, {
        id: "source",
        size: 156,
        meta: { studioTableWidthMode: "fixed" as const },
        header: m.design_variables_column_source(),
        cell: ({ row }) =>
          h(VariableManagerSourceCell, {
            row: row.original,
            customVariableOptions: options.customVariableOptions.value,
            designTokenOptions: options.designTokenOptions.value,
            tokenOptionsLoading: options.tokenOptionsLoading?.value ?? false,
            onUpdateAliasSourceType: updateAliasSourceType,
            onUpdateAliasTokenSource: updateAliasTokenSource,
            onUpdateAliasCustomSource: updateAliasCustomSource,
          }),
        enableGlobalFilter: false,
      }),
      columnHelper.accessor((row) => row.valueText, {
        id: "value",
        minSize: 200,
        meta: { studioTableWidthMode: "flex" as const },
        header: m.design_variables_column_value(),
        cell: ({ row }) => {
          if (row.original.kind === "custom") {
            const variable = row.original.variable

            return h(Input, {
              modelValue: variable.value,
              placeholder: m.design_variables_placeholder_value(),
              class: MINIMAL_MONO_CELL_INPUT_CLASS,
              "onUpdate:modelValue": (value: string | number) => {
                variable.value = String(value)
                notifyMutated()
              },
            })
          }

          const alias = row.original.alias

          return h(Input, {
            modelValue: alias.fallback,
            placeholder: m.design_variables_placeholder_fallback(),
            class: MINIMAL_MONO_CELL_INPUT_CLASS,
            "onUpdate:modelValue": (value: string | number) => {
              alias.fallback = String(value)
              notifyMutated()
            },
          })
        },
        enableGlobalFilter: false,
      }),
      columnHelper.display({
        id: "actions",
        size: 144,
        maxSize: 144,
        meta: { studioTableWidthMode: "fixed" as const },
        header: () => null,
        cell: ({ row }) =>
          h("div", { class: "flex items-center justify-end gap-1" }, [
            h(
              Button,
              {
                size: "icon-sm",
                variant: "ghost",
                class: COMPACT_ROW_ACTION_CLASS,
                title:
                  row.original.kind === "custom"
                    ? m.design_variables_action_edit_variable()
                    : m.design_variables_action_edit_alias(),
                "aria-label":
                  row.original.kind === "custom"
                    ? m.design_variables_action_edit_variable()
                    : m.design_variables_action_edit_alias(),
                onClick: (e: Event) => {
                  e.stopPropagation()
                  options.editVariable(row.original)
                },
              },
              {
                default: () =>
                  h(AppIcon, {
                    name: "code",
                    class: "size-3.5",
                  }),
              },
            ),
            h(
              Button,
              {
                size: "icon-sm",
                variant: "ghost",
                class: COMPACT_ROW_ACTION_CLASS,
                title:
                  row.original.kind === "custom"
                    ? m.design_variables_action_duplicate_variable()
                    : m.design_variables_action_duplicate_alias(),
                "aria-label":
                  row.original.kind === "custom"
                    ? m.design_variables_action_duplicate_variable()
                    : m.design_variables_action_duplicate_alias(),
                onClick: (e: Event) => {
                  e.stopPropagation()
                  if (row.original.kind === "custom") {
                    void options.duplicateCustomVariable(row.original.key)
                    return
                  }

                  void options.duplicateAlias(row.original.key)
                },
              },
              {
                default: () =>
                  h(AppIcon, {
                    name: "copy",
                    class: "size-3.5",
                  }),
              },
            ),
            h(
              Button,
              {
                size: "icon-sm",
                variant: "ghost",
                class: `${COMPACT_ROW_ACTION_CLASS} hover:bg-destructive/8 hover:text-destructive`,
                title:
                  row.original.kind === "custom"
                    ? m.design_variables_action_delete_variable()
                    : m.design_variables_action_delete_alias(),
                "aria-label":
                  row.original.kind === "custom"
                    ? m.design_variables_action_delete_variable()
                    : m.design_variables_action_delete_alias(),
                onClick: (e: Event) => {
                  e.stopPropagation()
                  if (row.original.kind === "custom") {
                    void options.removeCustomVariable(row.original.key)
                    return
                  }

                  void options.removeAlias(row.original.key)
                },
              },
              {
                default: () =>
                  h(AppIcon, {
                    name: "trash",
                    class: "size-3.5",
                  }),
              },
            ),
          ]),
        enableSorting: false,
        enableColumnFilter: false,
        enableGlobalFilter: false,
      }),
    ]

    return nextColumns
  })

  const table = useVueTable<VariableManagerRow>({
    get data() {
      return rows.value
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
        typeof updater === "function"
          ? updater(rowSelection.value)
          : updater
    },
    onSortingChange: (updater) => valueUpdater(updater, sorting),
    onColumnFiltersChange: (updater) => valueUpdater(updater, columnFilters),
    onGlobalFilterChange: (updater) => valueUpdater(updater, globalFilter),
    onColumnVisibilityChange: (updater) =>
      valueUpdater(updater, columnVisibility),
  })

  const searchQuery = computed({
    get: () => globalFilter.value,
    set: (value: string) => {
      globalFilter.value = value
    },
  })

  const filteredRowCount = computed(() => table.getRowModel().rows.length)

  const hasActiveFilters = computed(
    () => globalFilter.value.trim().length > 0 || activeSegment.value !== "all",
  )

  function setActiveSegment(value: string): void {
    const parsedSegment = VariableManagerSegmentSchema.safeParse(value)
    if (!parsedSegment.success) {
      return
    }

    activeSegment.value = parsedSegment.data

    const nextFilters = columnFilters.value.filter(
      (filter) => filter.id !== "kind",
    )

    if (parsedSegment.data !== "all") {
      nextFilters.push({
        id: "kind",
        value: parsedSegment.data,
      })
    }

    columnFilters.value = nextFilters
  }

  function resetFilters(): void {
    globalFilter.value = ""
    activeSegment.value = "all"
    columnFilters.value = buildSegmentColumnFilters("all")
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

      const persistedState = VariableManagerTableStateSchema.parse({
        query,
        segment,
        sourceFilter: "all",
        sorting: nextSorting,
      })

      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState))
    },
    { deep: true },
  )

  return {
    table,
    rows,
    rowSelection,
    filteredRowCount,
    searchQuery,
    activeSegment,
    counts,
    filters,
    hasActiveFilters,
    setActiveSegment,
    resetFilters,
  }
}
