<script setup lang="ts">
import { FlexRender, type Column } from "@tanstack/vue-table"
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import {
  Table,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
  getStudioTableColWidthStyle,
  isStudioTableSortableColumn,
  type StudioTableHeaderTable,
} from "../lib/studioTableHeader"
import StudioTableColGroup from "./StudioTableColGroup.vue"

const props = withDefaults(
  defineProps<{
    table: StudioTableHeaderTable
    getHeadCellClass?: (columnId: string) => string | undefined
    sticky?: boolean
    tableClass?: string
  }>(),
  {
    sticky: true,
    tableClass: "",
  },
)

const headerGroups = computed(() => props.table.getHeaderGroups())

function getHeadClass(columnId: string, canSort: boolean): string {
  const isSelect = columnId === "select"
  const isCover = columnId === "cover"

  return cn(
    "sticky h-9 select-none bg-card/20! py-2.5 font-mono text-[10px] font-normal tracking-wider",
    isSelect
      ? "pl-5 pr-2 text-muted-foreground/50"
      : isCover
        ? "px-1 text-muted-foreground/50"
        : "cursor-pointer px-4 text-muted-foreground/50 transition-colors hover:bg-card/50! hover:text-muted-foreground",
    !canSort && !isSelect && !isCover && "cursor-default hover:bg-input!",
    // Select/cover gutters are owned by the shared rules below — don't let callers override.
    isSelect || isCover ? undefined : props.getHeadCellClass?.(columnId),
  )
}

function handleHeadClick(
  column: Column<unknown, unknown>,
  event: MouseEvent,
): void {
  if (!isStudioTableSortableColumn(column.id) || !column.getCanSort()) {
    return
  }

  column.toggleSorting(undefined, event.shiftKey)
}

function getAriaSort(column: Column<unknown, unknown>): "ascending" | "descending" | "none" | undefined {
  if (!isStudioTableSortableColumn(column.id) || !column.getCanSort()) return undefined
  const sorted = column.getIsSorted()
  return sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
}
</script>

<template>
  <div
    :class="
      cn(
        'border-y border-dashed border-border bg-background',
        props.sticky ? 'sticky top-0 z-20' : undefined,
      )
    "
  >
    <Table :class="cn('w-full table-fixed border-collapse', props.tableClass)">
      <StudioTableColGroup :table="props.table" />
      <TableHeader class="[&_tr]:border-b-0!">
        <TableRow
          v-for="headerGroup in headerGroups"
          :key="headerGroup.id"
          class="border-b-0! hover:bg-transparent"
        >
          <TableHead
            v-for="header in headerGroup.headers"
            :key="header.id"
            :data-column-id="header.column.id"
            :aria-sort="getAriaSort(header.column)"
            :style="getStudioTableColWidthStyle(header.column)"
            :class="getHeadClass(header.column.id, header.column.getCanSort())"
          >
            <template v-if="!header.isPlaceholder">
              <button
                v-if="isStudioTableSortableColumn(header.column.id) && header.column.getCanSort()"
                type="button"
                class="flex w-full items-center gap-2 text-start focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                :aria-label="`Sort by ${typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : header.column.id}`"
                @click="handleHeadClick(header.column, $event)"
              >
                <FlexRender
                  :render="header.column.columnDef.header"
                  :props="header.getContext()"
                />
                <AppIcon
                  v-if="header.column.getIsSorted() === 'asc'"
                  name="chevronUp"
                  :size="12"
                  class="text-primary"
                />
                <AppIcon
                  v-else-if="header.column.getIsSorted() === 'desc'"
                  name="chevronDown"
                  :size="12"
                  class="text-primary"
                />
              </button>
              <div
                v-else
                :class="
                  header.column.id === 'select'
                    ? 'flex items-center'
                    : 'flex items-center gap-2'
                "
              >
                <FlexRender
                  :render="header.column.columnDef.header"
                  :props="header.getContext()"
                />
              </div>
            </template>
          </TableHead>
        </TableRow>
      </TableHeader>
    </Table>
  </div>
</template>

<style>
/*
 * Select gutter: content inset matches PageHeader px-5; row borders stay full-bleed.
 * Unscoped so body cells in sibling tables pick up the same rule.
 */
th[data-column-id="select"],
td[data-column-id="select"] {
  width: 3rem !important;
  max-width: 3rem !important;
  min-width: 3rem !important;
  padding-left: 1.25rem !important;
  padding-right: 0.5rem !important;
}

/*
 * Cover/thumb gutter: sits between select and name with a compact 3:2 thumb.
 */
th[data-column-id="cover"],
td[data-column-id="cover"] {
  width: 4.5rem !important;
  max-width: 4.5rem !important;
  min-width: 4.5rem !important;
  padding-left: 0.25rem !important;
  padding-right: 0.75rem !important;
}

/*
 * Trailing gutter: last column keeps content off the panel edge while row
 * borders stay full-bleed (mirrors the select gutter on the left).
 */
th:last-child:not([data-column-id="select"]),
td:last-child:not([data-column-id="select"]) {
  padding-right: 1.75rem !important;
}
</style>
