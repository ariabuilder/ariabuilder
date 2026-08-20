<script setup lang="ts">
import { FlexRender } from "@tanstack/vue-table"
import { computed, ref, toRef, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import {
  HeaderActionDropdownTooltip,
  HeaderActionTooltip,
  PageHeader,
  SearchOrBulkToolbar,
  StudioTableColGroup,
  StudioTableColumnMenu,
  STUDIO_TABLE_BODY_CELL_CLASS,
  STUDIO_TABLE_INTERACTIVE_ROW_CLASS,
  StudioTableHeader,
  getStudioTableColWidthStyle,
  toStudioTableHeaderTable,
  type StudioTableColumnMenuColumn,
} from "@/workspace/studio/core"
import type { AriaCollectionDef } from "../../../../../shared/types"
import ExternalEntryGridCard from "./ExternalEntryGridCard.vue"
import { useExternalEntriesList } from "../composables/useExternalEntriesList"
import { useExternalEntryTable } from "../composables/useExternalEntryTable"
import { collectionKindIcon } from "../lib/collectionKindOptions"

const VIEW_MODE_KEY = "aria:cms:entries:view-mode"

const props = defineProps<{
  projectRoot: string
  collection: AriaCollectionDef
}>()

const emit = defineEmits<{
  open: [entryId: string]
}>()

const projectRootRef = toRef(props, "projectRoot")
const collectionId = computed(() => props.collection.id)
const enabled = computed(() => Boolean(props.collection.source?.readOnly && props.collection.capabilities?.read))
const viewMode = ref<"table" | "grid">(
  localStorage.getItem(VIEW_MODE_KEY) === "grid" ? "grid" : "table",
)

const {
  rows,
  fields,
  issues,
  total,
  filteredTotal,
  scannedTotal,
  page,
  searchQuery,
  truncated,
  isLoading,
  loadError,
  totalPages,
  setPage,
  setSort,
} = useExternalEntriesList(projectRootRef, collectionId, enabled)

const {
  table,
  sorting,
  lockedColumnId,
  applySmartVisibility,
} = useExternalEntryTable({
  projectRoot: projectRootRef,
  data: rows,
  fields,
})

const headerTable = computed(() => toStudioTableHeaderTable(table))
const reorderableColumns = computed(() => table
  .getAllLeafColumns()
  .filter((column) => column.id !== "select")
  .map((column) => ({
    id: column.id,
    columnDef: column.columnDef,
    getIsVisible: () => column.getIsVisible(),
    toggleVisibility: () => column.toggleVisibility(),
  }) satisfies StudioTableColumnMenuColumn))
const sortableFields = computed(() => fields.value.filter((field) => field.sortable))
const sourceLabel = computed(() => props.collection.source?.label ?? "External CMS")
const isLocalAstro = computed(() => props.collection.source?.provider === "astro")
const sourceUnavailable = computed(() => props.collection.source?.availability === "unavailable")
const resultSummary = computed(() => {
  if (searchQuery.value.trim()) {
    return `${filteredTotal.value} matching ${filteredTotal.value === 1 ? "entry" : "entries"} · ${total.value} total`
  }
  return `${total.value} ${total.value === 1 ? "entry" : "entries"}`
})
const issueSummary = computed(() => {
  const skipped = `${issues.value.length} ${issues.value.length === 1 ? "entry" : "entries"} could not be loaded.`
  if (!total.value) return skipped
  return `${skipped} ${total.value} other ${total.value === 1 ? "entry is" : "entries are"} shown.`
})

let visibilityCollectionId = ""
watch([fields, collectionId], ([nextFields, nextCollectionId]) => {
  if (!nextFields.length || visibilityCollectionId === nextCollectionId) return
  visibilityCollectionId = nextCollectionId
  applySmartVisibility()
})

watch(sorting, (next) => {
  const first = next[0]
  if (!first) {
    setSort(undefined)
    return
  }
  setSort({
    field: first.id.startsWith("field:") ? first.id.slice(6) : "id",
    direction: first.desc ? "desc" : "asc",
  })
})

function toggleView(): void {
  viewMode.value = viewMode.value === "table" ? "grid" : "table"
  localStorage.setItem(VIEW_MODE_KEY, viewMode.value)
}

function onColumnReorder(columns: StudioTableColumnMenuColumn[]): void {
  table.setColumnOrder(columns.map((column) => column.id))
}

function sortGrid(field: string, direction: "asc" | "desc"): void {
  table.setSorting([{ id: `field:${field}`, desc: direction === "desc" }])
}
</script>

<template>
  <div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <PageHeader
      class="min-w-0 w-full max-w-full shrink-0 [contain:inline-size]"
      :title="collection.label"
      :search-query="searchQuery"
      entity-label-singular="entry"
      :hide-create="true"
      @update:search-query="searchQuery = $event"
    >
      <template #title>
        <div class="m-0 flex min-w-0 flex-wrap items-center gap-3">
          <AppIcon
            :name="collectionKindIcon(collection.kind)"
            :size="24"
            class="shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <h1 class="m-0 truncate font-sans text-3xl font-medium tracking-tight">
            {{ collection.label }}
          </h1>
          <Badge variant="secondary" class="shrink-0 capitalize">
            {{ collection.kind }}
          </Badge>
          <Badge variant="secondary" class="shrink-0">{{ sourceLabel }}</Badge>
          <Badge variant="outline" class="shrink-0">Read-only</Badge>
          <Badge
            v-if="!isLocalAstro && collection.source?.cacheState === 'stale'"
            variant="outline"
            class="shrink-0"
          >
            Stale cache
          </Badge>
        </div>
      </template>
      <template #description>
        <p class="text-sm text-muted-foreground/70">
          Browse data from {{ sourceLabel }}. Editing and publishing stay with the source.
        </p>
      </template>
      <template #search>
        <SearchOrBulkToolbar
          :count="0"
          entity-label="entry"
          :search-query="searchQuery"
          search-placeholder="Search entries…"
          @update:search-query="searchQuery = $event"
        />
      </template>
      <template #toolbar>
        <HeaderActionDropdownTooltip v-if="viewMode === 'grid'" label="Sort entries">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="headerAction" size="icon-header" aria-label="Sort entries">
                <AppIcon name="sort" :size="14" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="max-h-80 w-52 overflow-auto">
              <template v-for="field in sortableFields" :key="field.key">
                <DropdownMenuItem @select.prevent="sortGrid(field.key, 'asc')">
                  {{ field.label }} · Ascending
                </DropdownMenuItem>
                <DropdownMenuItem @select.prevent="sortGrid(field.key, 'desc')">
                  {{ field.label }} · Descending
                </DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
        </HeaderActionDropdownTooltip>
        <StudioTableColumnMenu
          v-if="viewMode === 'table'"
          :columns="reorderableColumns"
          :locked-column-ids="[lockedColumnId]"
          content-class="max-h-80 w-52 overflow-auto"
          @reorder="onColumnReorder"
        />
        <HeaderActionTooltip :label="viewMode === 'table' ? 'Grid view' : 'Table view'">
          <Button
            variant="headerAction"
            size="icon-header"
            :aria-label="viewMode === 'table' ? 'Grid view' : 'Table view'"
            @click="toggleView"
          >
            <AppIcon :name="viewMode === 'grid' ? 'list' : 'grid'" :size="14" aria-hidden="true" />
          </Button>
        </HeaderActionTooltip>
      </template>
    </PageHeader>

    <div class="min-h-0 min-w-0 flex-1 overflow-auto">
      <div
        v-if="sourceUnavailable"
        role="status"
        class="mx-7 my-4 rounded-md border border-border bg-muted/20 p-4 text-sm text-muted-foreground"
      >
        {{ collection.source?.availabilityReason ?? 'This collection is not available to browse in Aria.' }}
      </div>

      <div
        v-else-if="loadError"
        role="alert"
        class="mx-7 my-4 rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {{ loadError }}
        <span v-if="!isLocalAstro && collection.source?.cacheState === 'unavailable'">
          Refresh the source from Configure after project dependencies are installed.
        </span>
      </div>

      <div
        v-else-if="issues.length"
        role="status"
        class="mx-7 my-4 rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <p class="font-medium">{{ issueSummary }}</p>
        <ul class="mt-2 space-y-1 text-xs">
          <li v-for="issue in issues" :key="issue.filePath">
            Fix {{ issue.filePath }}: {{ issue.message }}.
          </li>
        </ul>
      </div>

      <div v-if="!sourceUnavailable && isLoading" role="status" class="flex justify-center py-16 text-sm text-muted-foreground">
        Loading entries…
      </div>

      <div
        v-else-if="!sourceUnavailable && !rows.length"
        class="flex flex-col items-center justify-center px-7 py-16 text-center"
      >
        <AppIcon name="collections" :size="32" class="mb-3 text-muted-foreground" aria-hidden="true" />
        <p class="text-sm font-medium text-foreground">
          {{ searchQuery ? 'No matching entries' : issues.length ? 'No valid entries found' : 'No entries found' }}
        </p>
        <p class="mt-1 max-w-md text-sm text-muted-foreground">
          {{ searchQuery
            ? 'Try a different search.'
            : issues.length
              ? 'Fix the source files listed above to load these entries.'
            : isLocalAstro
              ? 'Add files matching this collection’s source pattern to see them here.'
              : 'Refresh the project source to load its entries.' }}
        </p>
      </div>

      <div
        v-else-if="!sourceUnavailable && viewMode === 'table'"
        class="min-w-0 w-full max-w-full overflow-x-auto rounded-none [contain:inline-size]"
      >
        <StudioTableHeader :table="headerTable" :get-head-cell-class="() => 'px-5'" />
        <Table class="w-full min-w-[72rem] table-fixed border-collapse">
          <StudioTableColGroup :table="headerTable" />
          <TableBody>
            <TableRow
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              :class="STUDIO_TABLE_INTERACTIVE_ROW_CLASS"
              :data-state="row.getIsSelected() ? 'selected' : undefined"
              @click="emit('open', row.original.id)"
            >
              <TableCell
                v-for="cell in row.getVisibleCells()"
                :key="cell.id"
                :data-column-id="cell.column.id"
                :style="getStudioTableColWidthStyle(cell.column)"
                :class="STUDIO_TABLE_BODY_CELL_CLASS"
              >
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div
        v-else-if="!sourceUnavailable"
        class="grid min-w-0 grid-cols-1 gap-7 p-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
      >
          <ExternalEntryGridCard
            v-for="entry in rows"
            :key="entry.id"
            :project-root="projectRoot"
            :entry="entry"
          :fields="fields"
          :source-label="sourceLabel"
          @open="emit('open', $event)"
        />
      </div>
    </div>

    <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-border bg-background px-7 py-4 text-2xs text-muted-foreground">
      <p role="status">
        {{ resultSummary }}
        <template v-if="truncated"> · Browsing the first {{ scannedTotal }} safely inspected records</template>
      </p>
      <div v-if="totalPages > 1" class="flex gap-2">
        <Button variant="outline" size="sm" :disabled="page <= 1" @click="setPage(page - 1)">
          Previous
        </Button>
        <span class="self-center px-1 tabular-nums">{{ page }} / {{ totalPages }}</span>
        <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="setPage(page + 1)">
          Next
        </Button>
      </div>
    </footer>
  </div>
</template>
