<script setup lang="ts">
import { FlexRender } from "@tanstack/vue-table"
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import AppIcon from "@/components/ui/app-icon/AppIcon.vue"
import { confirm } from "@/composables/useConfirm"
import { m } from "@/paraglide/messages.js"
import { toast } from "vue-sonner"
import {
  FilterIconMenu,
  HeaderActionDropdownTooltip,
  SearchOrBulkToolbar,
  StudioTableColGroup,
  StudioTableHeader,
  getStudioTableColWidthStyle,
  toStudioTableHeaderTable,
} from "@/workspace/studio/core"
import type {
  DesignSnapshot,
  DesignVariables,
} from "../../../../shared/design"
import DesignHeaderTeleport from "../components/DesignHeaderTeleport.vue"
import { useVariableManagerTable } from "../composables/useVariableManagerTable"
import VariableEditorDialog, {
  type VariableEditorSavePayload,
} from "../dialogs/VariableEditorDialog.vue"
import VariableManagerImportDialog from "../dialogs/VariableManagerImportDialog.vue"
import { createSequentialDuplicateKey } from "../lib/variableManagerKeys"
import {
  allVariableKeys,
  cloneDesignVariables,
  createEmptyVariableSet,
  mergeImportedVariableSet,
  renameVariableKey,
  type VariableManagerRow,
  type VariableManagerSegment,
} from "../lib/variableManagerTable"
import { buildVariableManagerTokenOptions } from "../lib/variableManagerTokens"
import type { VariableImportMode } from "../lib/variableManagerImport"
import type { VariableReferenceOption } from "../lib/variableReferences"

const props = defineProps<{
  snapshot: DesignSnapshot | null
  saving?: boolean
  variableReferences?: readonly VariableReferenceOption[]
}>()

const emit = defineEmits<{
  save: [variables: DesignVariables, options?: { silent?: boolean }]
}>()

const variables = ref<DesignVariables>(createEmptyVariableSet())
const isImportDialogOpen = ref(false)
const editorRow = ref<VariableManagerRow | null>(null)
const isEditorOpen = computed(() => editorRow.value !== null)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let syncingFromSnapshot = false
let lastEmittedJson = ""

watch(
  () => props.snapshot,
  (snap) => {
    const incoming = cloneDesignVariables(
      snap?.variables ?? createEmptyVariableSet(),
    )
    const incomingJson = JSON.stringify(incoming)
    // Ignore echo from our own silent patch so in-progress edits aren't wiped.
    if (incomingJson === lastEmittedJson) {
      return
    }
    syncingFromSnapshot = true
    variables.value = incoming
    lastEmittedJson = incomingJson
    nextTick(() => {
      syncingFromSnapshot = false
    })
  },
  { immediate: true },
)

function emitSave(options?: { silent?: boolean }): void {
  const payload = cloneDesignVariables(variables.value)
  lastEmittedJson = JSON.stringify(payload)
  emit("save", payload, options)
}

function scheduleSave(): void {
  if (syncingFromSnapshot) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    // Debounced cell edits stay quiet; discrete actions use saveNow().
    emitSave({ silent: true })
  }, 350)
}

function saveNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  emitSave()
}

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
})

const designTokenOptions = computed(() =>
  buildVariableManagerTokenOptions(
    (props.snapshot?.colors.palettes ?? []).map((palette) => ({
      name: palette.name,
      label: palette.name,
      shades: palette.shades,
    })),
    props.snapshot?.colors.semantic ?? {},
  ),
)

const customVariableOptions = computed(() =>
  Object.entries(variables.value.custom).map(([key, variable]) => ({
    value: key,
    label: variable.label.trim() || `--${key}`,
  })),
)

function resolveBulkTargets(
  singleId: string | undefined,
  selectedIds: readonly string[],
): string[] {
  if (singleId) {
    if (selectedIds.length > 1 && selectedIds.includes(singleId)) {
      return [...selectedIds]
    }
    return [singleId]
  }
  return selectedIds.length > 0 ? [...selectedIds] : []
}

const {
  searchQuery,
  activeSegment,
  filters,
  table,
  rows,
  rowSelection,
  hasActiveFilters,
  setActiveSegment,
} = useVariableManagerTable({
  variables,
  designTokenOptions,
  customVariableOptions,
  onVariablesMutated: scheduleSave,
  renameCustomVariableKey: (currentKey, nextKey) => {
    const ok = renameVariableKey(variables.value, "custom", currentKey, nextKey)
    if (ok && currentKey !== nextKey) saveNow()
    return ok
  },
  renameAliasKey: (currentKey, nextKey) => {
    const ok = renameVariableKey(variables.value, "alias", currentKey, nextKey)
    if (ok && currentKey !== nextKey) saveNow()
    return ok
  },
  duplicateCustomVariable: (key) => {
    const row = rows.value.find(
      (entry) => entry.kind === "custom" && entry.key === key,
    )
    if (row) {
      void confirmDuplicateVariables(row.id)
    }
    return Promise.resolve(null)
  },
  duplicateAlias: (key) => {
    const row = rows.value.find(
      (entry) => entry.kind === "alias" && entry.key === key,
    )
    if (row) {
      void confirmDuplicateVariables(row.id)
    }
    return Promise.resolve(null)
  },
  removeCustomVariable: (key) => {
    const row = rows.value.find(
      (entry) => entry.kind === "custom" && entry.key === key,
    )
    if (row) {
      void confirmDeleteVariables(row.id)
    }
  },
  removeAlias: (key) => {
    const row = rows.value.find(
      (entry) => entry.kind === "alias" && entry.key === key,
    )
    if (row) {
      void confirmDeleteVariables(row.id)
    }
  },
  editVariable: (row) => {
    openVariableEditor(row)
  },
})

const selectedIds = computed(() =>
  table.getSelectedRowModel().rows.map((row) => row.original.id),
)
const tableRows = computed(() => table.getRowModel().rows)
const visibleColumnCount = computed(() => table.getVisibleLeafColumns().length)
const headerTable = computed(() => toStudioTableHeaderTable(table))

const ROW_PAGE_SIZE = 30
const visibleRowCount = ref(ROW_PAGE_SIZE)
const visibleTableRows = computed(() =>
  tableRows.value.slice(0, visibleRowCount.value),
)
const hasMoreRows = computed(
  () => visibleRowCount.value < tableRows.value.length,
)
const loadMoreSentinel = ref<HTMLElement | null>(null)
let loadMoreObserver: IntersectionObserver | null = null

function growVisibleRowCount(): void {
  if (visibleRowCount.value >= tableRows.value.length) {
    return
  }
  visibleRowCount.value = Math.min(
    visibleRowCount.value + ROW_PAGE_SIZE,
    tableRows.value.length,
  )
}

function revealRowByKey(kind: "custom" | "alias", key: string): void {
  const index = tableRows.value.findIndex(
    (row) => row.original.kind === kind && row.original.key === key,
  )
  if (index === -1) {
    return
  }

  const needed = index + 1
  if (needed > visibleRowCount.value) {
    visibleRowCount.value = needed
  }
}

watch([searchQuery, activeSegment], () => {
  visibleRowCount.value = Math.min(ROW_PAGE_SIZE, tableRows.value.length)
})

watch(loadMoreSentinel, (element, previousElement) => {
  if (previousElement && loadMoreObserver) {
    loadMoreObserver.unobserve(previousElement)
  }
  if (element && loadMoreObserver) {
    loadMoreObserver.observe(element)
  }
})

onMounted(() => {
  if (typeof IntersectionObserver === "undefined") {
    return
  }

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        growVisibleRowCount()
      }
    },
    { rootMargin: "600px 0px" },
  )

  if (loadMoreSentinel.value) {
    loadMoreObserver.observe(loadMoreSentinel.value)
  }
})

onBeforeUnmount(() => {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
})

const emptyStateLabel = computed(() => {
  if (rows.value.length === 0) {
    return m.design_variables_empty_none()
  }

  if (hasActiveFilters.value) {
    return m.design_variables_empty_no_matches()
  }

  return m.design_variables_empty_none()
})

function getRowElementId(row: VariableManagerRow): string {
  return `variable-row-${row.kind}-${row.key}`
}

function getHeadCellClass(columnId: string): string | undefined {
  switch (columnId) {
    case "kind":
      return "px-5"
    case "actions":
      return "sticky right-0 text-right"
    default:
      return "px-3"
  }
}

function getBodyCellClass(columnId: string): string {
  switch (columnId) {
    case "select":
      return "py-1.5 align-middle text-xs"
    case "kind":
      return "min-w-0 overflow-hidden px-5 py-1.5 align-middle text-xs"
    case "value":
      return "min-w-0 w-full overflow-hidden px-3 py-1.5 align-middle text-xs"
    case "actions":
      return "sticky right-0 bg-background py-1.5 pr-3 align-middle text-xs text-right transition-colors group-hover:bg-card/18"
    default:
      return "min-w-0 overflow-hidden px-3 py-1.5 align-middle text-xs"
  }
}

async function jumpToRow(rowId: string | null): Promise<void> {
  if (!rowId || typeof document === "undefined") {
    return
  }

  await nextTick()

  const row = document.getElementById(rowId)
  row?.scrollIntoView({ behavior: "smooth", block: "center" })

  const input = row?.querySelector("input, button")
  if (input instanceof HTMLElement) {
    input.focus()
  }
}

function openVariableEditor(row: VariableManagerRow): void {
  editorRow.value = row
}

function handleEditorOpenChange(open: boolean): void {
  if (!open) editorRow.value = null
}

function handleEditorSave(payload: VariableEditorSavePayload): void {
  const key = payload.key
  const previousKind = payload.previousKind

  if (payload.kind === "custom") {
    const existingCustom = variables.value.custom[key]
    const existingAlias =
      previousKind === "alias" ? variables.value.aliases[key] : undefined

    if (previousKind === "alias") {
      delete variables.value.aliases[key]
    }

    variables.value.custom[key] = {
      label: payload.label || existingCustom?.label || existingAlias?.label || "",
      value: payload.value,
      category: existingCustom?.category ?? "other",
      source: existingCustom?.source ?? "aria",
      description: existingCustom?.description,
    }

    editorRow.value = null
    saveNow()
    toast.success(m.design_variables_toast_updated_variable())
    return
  }

  const existingAlias = variables.value.aliases[key]
  const existingCustom =
    previousKind === "custom" ? variables.value.custom[key] : undefined

  if (previousKind === "custom") {
    delete variables.value.custom[key]
  }

  variables.value.aliases[key] = {
    label: payload.label || existingAlias?.label || existingCustom?.label || "",
    sourceType: payload.sourceType,
    sourceKey: payload.sourceKey,
    fallback: payload.fallback,
  }

  editorRow.value = null
  saveNow()
  toast.success(m.design_variables_toast_updated_alias())
}

/**
 * New rows are edited inline on the table. Clear search / segment filters
 * that would hide the draft so Add always lands on a visible row.
 */
function prepareTableForNewRow(kind: "custom" | "alias"): void {
  searchQuery.value = ""
  if (kind === "alias" && activeSegment.value === "custom") {
    setActiveSegment("aliases")
  } else if (kind === "custom" && activeSegment.value === "aliases") {
    setActiveSegment("custom")
  }
}

function handleAddCustomVariable(): void {
  prepareTableForNewRow("custom")
  const key = createSequentialDuplicateKey(
    "custom-var",
    allVariableKeys(variables.value),
  )
  variables.value.custom[key] = {
    label: "",
    value: "",
    category: "other",
    source: "aria",
  }
  saveNow()
  revealRowByKey("custom", key)
  void jumpToRow(`variable-row-custom-${key}`)
}

function handleAddAlias(): void {
  prepareTableForNewRow("alias")
  const key = createSequentialDuplicateKey(
    "alias-var",
    allVariableKeys(variables.value),
  )
  variables.value.aliases[key] = {
    label: "",
    sourceType: "custom",
    sourceKey: "",
    fallback: "",
  }
  saveNow()
  revealRowByKey("alias", key)
  void jumpToRow(`variable-row-alias-${key}`)
}

function resolveSelectedRows(ids: readonly string[]): VariableManagerRow[] {
  return ids
    .map((id) => rows.value.find((row) => row.id === id))
    .filter((row): row is VariableManagerRow => row !== undefined)
}

async function confirmDeleteVariables(rowId?: string): Promise<void> {
  const ids = resolveBulkTargets(rowId, selectedIds.value)
  const targets = resolveSelectedRows(ids)
  if (targets.length === 0) {
    return
  }

  const ok = await confirm({
    title:
      targets.length > 1
        ? m.design_variables_delete_title_many()
        : m.design_variables_delete_title_one(),
    description:
      targets.length > 1
        ? m.design_variables_delete_description_many({
            count: String(targets.length),
          })
        : m.design_variables_delete_description_one({
            name: targets[0]!.key,
          }),
    confirmLabel: m.design_colors_remove(),
    cancelLabel: m.confirm_cancel(),
    destructive: true,
  })
  if (!ok) return

  for (const target of targets) {
    if (target.kind === "custom") {
      delete variables.value.custom[target.key]
    } else {
      delete variables.value.aliases[target.key]
    }
  }

  rowSelection.value = {}
  saveNow()
}

async function confirmDuplicateVariables(rowId?: string): Promise<void> {
  const ids = resolveBulkTargets(rowId, selectedIds.value)
  const targets = resolveSelectedRows(ids)
  if (targets.length === 0) {
    return
  }

  let succeeded = 0
  let lastJump: { id: string; kind: "custom" | "alias"; key: string } | null =
    null

  for (const row of targets) {
    const nextKey = createSequentialDuplicateKey(
      row.key,
      allVariableKeys(variables.value),
    )
    if (row.kind === "custom") {
      const source = variables.value.custom[row.key]
      if (!source) continue
      variables.value.custom[nextKey] = {
        ...source,
        label: source.label ? `${source.label} Copy` : "",
        source: "aria",
      }
    } else {
      const source = variables.value.aliases[row.key]
      if (!source) continue
      variables.value.aliases[nextKey] = {
        ...source,
        label: source.label ? `${source.label} Copy` : "",
      }
    }
    succeeded += 1
    lastJump = {
      id: `variable-row-${row.kind}-${nextKey}`,
      kind: row.kind,
      key: nextKey,
    }
  }

  rowSelection.value = {}

  if (succeeded > 0) {
    saveNow()
    if (lastJump) {
      revealRowByKey(lastJump.kind, lastJump.key)
      void jumpToRow(lastJump.id)
    }
  }
}

async function handleClearVariables(): Promise<void> {
  const customCount = Object.keys(variables.value.custom).length
  const aliasCount = Object.keys(variables.value.aliases).length

  if (customCount === 0 && aliasCount === 0) {
    return
  }

  const ok = await confirm({
    title: m.design_variables_clear_title(),
    description: m.design_variables_clear_description(),
    confirmLabel: m.design_variables_clear_confirm(),
    cancelLabel: m.confirm_cancel(),
    destructive: true,
  })
  if (!ok) return

  variables.value = createEmptyVariableSet()
  saveNow()
}

function handleImportSubmit(payload: {
  mode: VariableImportMode
  variables: DesignVariables
}): void {
  if (payload.mode === "replace") {
    variables.value = cloneDesignVariables(payload.variables)
  } else {
    variables.value = mergeImportedVariableSet(
      variables.value,
      payload.variables,
    )
  }
  isImportDialogOpen.value = false
  saveNow()
}
</script>

<template>
  <DesignHeaderTeleport target="toolbar">
    <FilterIconMenu
      :model-value="activeSegment"
      :filters="filters"
      @update:model-value="setActiveSegment($event as VariableManagerSegment)"
    />
  </DesignHeaderTeleport>

  <DesignHeaderTeleport target="search">
    <SearchOrBulkToolbar
      :count="selectedIds.length"
      :entity-label="m.design_variables_entity()"
      :search-query="searchQuery"
      :search-placeholder="m.design_variables_search_placeholder()"
      @update:search-query="(value) => (searchQuery = value)"
      @duplicate="confirmDuplicateVariables()"
      @delete="confirmDeleteVariables()"
    />
  </DesignHeaderTeleport>

  <DesignHeaderTeleport target="importExport">
    <HeaderActionDropdownTooltip :label="m.design_variables_more_actions()">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="headerAction"
            size="icon-header"
            :aria-label="m.design_variables_more_actions()"
          >
            <AppIcon name="moreHorizontal" class="size-3.5 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem @select="isImportDialogOpen = true">
              {{ m.design_variables_menu_import() }}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              @select="handleClearVariables"
            >
              {{ m.design_variables_menu_clear_all() }}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </HeaderActionDropdownTooltip>
  </DesignHeaderTeleport>

  <DesignHeaderTeleport target="actions">
    <Button size="md" variant="outline" @click="handleAddCustomVariable">
      <AppIcon name="plus" class="mr-1.5 size-3.5" />
      {{ m.design_variables_add_variable() }}
    </Button>
    <Button size="md" variant="default" @click="handleAddAlias">
      <AppIcon name="plus" class="mr-1.5 size-3.5" />
      {{ m.design_variables_add_alias() }}
    </Button>
  </DesignHeaderTeleport>

  <div
    v-if="!snapshot"
    class="design-page-card flex h-96 items-center justify-center"
  >
    <AppIcon
      name="loading"
      class="size-6 animate-spin text-muted-foreground"
    />
  </div>

  <div v-else class="design-page-card p-0 pb-10">
    <section>
      <StudioTableHeader
        :table="headerTable"
        :get-head-cell-class="getHeadCellClass"
      />
      <Table class="w-full border-collapse table-fixed bg-transparent">
        <StudioTableColGroup :table="headerTable" />
        <TableBody>
          <TableEmpty
            v-if="tableRows.length === 0"
            :colspan="visibleColumnCount"
          >
            {{ emptyStateLabel }}
          </TableEmpty>

          <template v-else>
            <TableRow
              v-for="row in visibleTableRows"
              :id="getRowElementId(row.original)"
              :key="row.id"
              class="group cursor-pointer border-b border-border border-dashed transition-all duration-50 hover:bg-card/18 hover:[box-shadow:inset_2px_0_0_0_var(--primary),inset_-2px_0_0_0_var(--primary)]"
              @dblclick="openVariableEditor(row.original)"
            >
              <TableCell
                v-for="cell in row.getVisibleCells()"
                :key="cell.id"
                :data-column-id="cell.column.id"
                :style="getStudioTableColWidthStyle(cell.column)"
                :class="getBodyCellClass(cell.column.id)"
              >
                <FlexRender
                  :render="cell.column.columnDef.cell"
                  :props="cell.getContext()"
                />
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>

      <div
        v-if="hasMoreRows"
        ref="loadMoreSentinel"
        class="flex items-center justify-center py-4 text-2xs text-muted-foreground/60"
      >
        <AppIcon name="loading" class="mr-2 size-3.5 animate-spin" />
        {{ m.design_variables_loading_more() }}
      </div>
    </section>

    <VariableManagerImportDialog
      :open="isImportDialogOpen"
      @update:open="isImportDialogOpen = $event"
      @submit="handleImportSubmit"
    />

    <VariableEditorDialog
      :open="isEditorOpen"
      :row="editorRow"
      :custom-variable-options="customVariableOptions"
      :design-token-options="designTokenOptions"
      :variable-references="variableReferences ?? []"
      @update:open="handleEditorOpenChange"
      @save="handleEditorSave"
    />
  </div>
</template>
