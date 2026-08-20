import type { ColumnDef } from "@tanstack/vue-table"
import { h } from "vue"
import { Checkbox } from "@/components/ui/checkbox"

type CheckedState = boolean | "indeterminate"

/** Matches PageHeader `px-5` so the toggle sits on the title gutter. */
export const STUDIO_TABLE_SELECT_COLUMN_SIZE = 48

function resolveChecked(
  allSelected: boolean,
  someSelected: boolean,
): CheckedState {
  if (allSelected) return true
  if (someSelected) return "indeterminate"
  return false
}

/**
 * Shared TanStack select column using the shadcn-vue Checkbox.
 * Used by pages, components, media, class manager, and variable manager tables.
 *
 * Pair with the select/trailing gutter CSS on StudioTableHeader so edge
 * padding matches the page header while row borders stay full-bleed.
 */
export function createStudioTableSelectColumn<TData>(): ColumnDef<
  TData,
  unknown
> {
  return {
    id: "select",
    size: STUDIO_TABLE_SELECT_COLUMN_SIZE,
    maxSize: STUDIO_TABLE_SELECT_COLUMN_SIZE,
    meta: { studioTableWidthMode: "fixed" },
    header: ({ table }) =>
      h(Checkbox, {
        modelValue: resolveChecked(
          table.getIsAllPageRowsSelected(),
          table.getIsSomePageRowsSelected(),
        ),
        "aria-label": "Select all",
        class: "align-middle",
        "onUpdate:modelValue": (value: CheckedState) => {
          table.toggleAllPageRowsSelected(value === true)
        },
        onClick: (event: Event) => event.stopPropagation(),
      }),
    cell: ({ row }) =>
      h(Checkbox, {
        modelValue: row.getIsSelected(),
        disabled: !row.getCanSelect(),
        "aria-label": "Select row",
        class: "align-middle",
        "onUpdate:modelValue": (value: CheckedState) => {
          row.toggleSelected(value === true)
        },
        onClick: (event: Event) => event.stopPropagation(),
      }),
    enableSorting: false,
    enableHiding: false,
  }
}
