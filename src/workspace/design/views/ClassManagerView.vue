<script setup lang="ts">
import { FlexRender } from "@tanstack/vue-table"
import { computed, onMounted, ref, toRef, watch } from "vue"
import { toast } from "vue-sonner"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableRow,
} from "@/components/ui/table"
import { confirm } from "@/composables/useConfirm"
import { detectComposerFrameworks } from "@/lib/composer"
import { m } from "@/paraglide/messages.js"
import {
  FilterIconMenu,
  HeaderActionDropdownTooltip,
  SearchOrBulkToolbar,
  StudioTableColGroup,
  StudioTableColumnMenu,
  StudioTableHeader,
  getStudioTableColWidthStyle,
  toStudioTableHeaderTable,
  type StudioTableColumnMenuColumn,
} from "@/workspace/studio/core"
import DesignHeaderTeleport from "../components/DesignHeaderTeleport.vue"
import { useClassManagerInventory } from "../composables/useClassManagerInventory"
import { useClassManagerTable } from "../composables/useClassManagerTable"
import ClassManagerCssDialog from "../dialogs/ClassManagerCssDialog.vue"
import ClassManagerImportDialog from "../dialogs/ClassManagerImportDialog.vue"
import ClassManagerNameDialog from "../dialogs/ClassManagerNameDialog.vue"
import type { ClassImportItem } from "../lib/classManagerCss"
import type { ClassManagerRow } from "../lib/classManagerTable"
import type { VariableReferenceOption } from "../lib/variableReferences"

const props = defineProps<{
  projectRoot: string
  variableReferences?: readonly VariableReferenceOption[]
  classReferences?: readonly string[]
}>()

const emit = defineEmits<{
  saved: []
  "open-stylesheet": [path: string]
}>()

const projectRootRef = toRef(props, "projectRoot")

const inventory = useClassManagerInventory(projectRootRef)
const {
  sheets,
  selectedPath,
  rows,
  hasStylesheetContent,
  dirty,
  loading,
  saving,
  error,
  bootstrap,
  loadFile,
  refreshInventory,
  save,
  createClass,
  renameClass,
  duplicateClass,
  deleteClasses,
  updateClassCss,
  clearAllClasses,
  importClasses,
  exportClassesJson,
  exportClassesCss,
} = inventory

type NameDialogState =
  | { mode: "create"; row: null }
  | { mode: "rename"; row: ClassManagerRow }
  | { mode: "duplicate"; row: ClassManagerRow }
  | null

const nameDialogState = ref<NameDialogState>(null)
const cssDialogRow = ref<ClassManagerRow | null>(null)
const isImportDialogOpen = ref(false)
const utilityReferences = ref<string[]>([])
let completionScanGeneration = 0

const classReferences = computed(() =>
  [...new Set([
    ...(props.classReferences ?? []),
    ...rows.value.map((row) => row.name),
  ])].sort((left, right) => left.localeCompare(right)),
)

const keyframeReferences = computed(() => {
  const names = new Set<string>()
  const pattern = /@(?:-webkit-)?keyframes\s+([_a-zA-Z][\w-]*)/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(inventory.content.value))) names.add(match[1]!)
  return [...names].sort((left, right) => left.localeCompare(right))
})

async function refreshCompletionInventory() {
  const projectRoot = props.projectRoot
  const generation = ++completionScanGeneration
  utilityReferences.value = []
  if (!projectRoot) return
  try {
    const framework = await detectComposerFrameworks(projectRoot)
    if (generation === completionScanGeneration) {
      utilityReferences.value = framework.candidates
    }
  } catch {
    if (generation === completionScanGeneration) utilityReferences.value = []
  }
}

const {
  searchQuery,
  activeSegment,
  filters,
  table,
  rowSelection,
  hasActiveFilters,
  setActiveSegment,
} = useClassManagerTable({
  rows,
  onEditCss: (row) => {
    cssDialogRow.value = row
  },
  onRenameClass: (row) => {
    nameDialogState.value = { mode: "rename", row }
  },
  onDuplicateClass: (row) => {
    nameDialogState.value = { mode: "duplicate", row }
  },
  onDeleteClass: (row) => {
    void confirmDeleteClasses(row.id)
  },
})

const CLASS_MANAGER_LOCKED_COLUMN_IDS = new Set([
  "select",
  "searchText",
  "name",
  "actions",
])

const reorderableColumns = computed(() =>
  table
    .getAllLeafColumns()
    .filter((column) => !CLASS_MANAGER_LOCKED_COLUMN_IDS.has(column.id ?? ""))
    .map(
      (column) =>
        ({
          id: column.id,
          columnDef: column.columnDef,
          getIsVisible: () => column.getIsVisible(),
          toggleVisibility: () => column.toggleVisibility(),
        }) satisfies StudioTableColumnMenuColumn,
    ),
)

function onColumnReorder(columns: StudioTableColumnMenuColumn[]) {
  const newOrder = columns
    .map((column) => column.id)
    .filter((id): id is string => Boolean(id))
  table.setColumnOrder(["select", "searchText", "name", ...newOrder, "actions"])
}

const selectedIds = computed(() =>
  Object.keys(rowSelection.value).filter((id) => rowSelection.value[id]),
)

const headerTable = computed(() => toStudioTableHeaderTable(table))
const tableRows = computed(() => table.getRowModel().rows)
const visibleColumnCount = computed(() => table.getVisibleLeafColumns().length)

const emptyStateLabel = computed(() => {
  if (hasActiveFilters.value && rows.value.length > 0) {
    return m.design_classes_empty_no_matches()
  }
  if (hasStylesheetContent.value && rows.value.length === 0) {
    return m.design_classes_empty_no_class_rules()
  }
  return m.design_classes_empty_none()
})

const showOpenStylesheetCta = computed(
  () =>
    Boolean(selectedPath.value) &&
    hasStylesheetContent.value &&
    rows.value.length === 0 &&
    !hasActiveFilters.value,
)

function openInStylesheets() {
  if (!selectedPath.value) return
  emit("open-stylesheet", selectedPath.value)
}

const isNameDialogOpen = computed(() => nameDialogState.value !== null)
const isCssDialogOpen = computed(() => cssDialogRow.value !== null)

const nameDialogInitialCss = computed(() => {
  const row = nameDialogState.value?.row
  return row?.css ?? ""
})

onMounted(() => {
  void bootstrap()
  void refreshCompletionInventory()
})

watch(
  () => props.projectRoot,
  () => {
    void bootstrap()
    void refreshCompletionInventory()
  },
)

async function onSelectPath(path: unknown) {
  if (typeof path !== "string" || !path || path === selectedPath.value) return
  if (dirty.value) {
    const ok = await confirm({
      title: m.design_stylesheets_unsaved_title(),
      description: m.design_stylesheets_unsaved_description(),
      confirmLabel: m.design_stylesheets_discard(),
      cancelLabel: m.design_stylesheets_stay(),
      destructive: true,
    })
    if (!ok) return
  }
  await loadFile(path)
}

async function persistAndNotify(): Promise<boolean> {
  const ok = await save()
  if (!ok) {
    toast.error(m.design_stylesheets_save_failed(), {
      description: error.value ?? undefined,
    })
    return false
  }
  emit("saved")
  toast.success(m.design_stylesheets_save_success())
  return true
}

function openCreateDialog() {
  nameDialogState.value = { mode: "create", row: null }
}

function handleNameDialogOpenChange(value: boolean) {
  if (!value) nameDialogState.value = null
}

function handleCssDialogOpenChange(value: boolean) {
  if (!value) cssDialogRow.value = null
}

function handleRowDblClick(row: ClassManagerRow) {
  cssDialogRow.value = row
}

function getHeadCellClass(columnId: string): string | undefined {
  switch (columnId) {
    case "name":
      return "px-5"
    case "actions":
      return "text-right"
    default:
      return "px-3"
  }
}

function getBodyCellClass(columnId: string): string {
  switch (columnId) {
    case "select":
      return "py-1.5 align-middle text-xs"
    case "name":
      return "min-w-0 overflow-hidden px-5 py-1.5 align-middle text-xs"
    case "css":
      return "min-w-0 overflow-hidden px-3 py-1.5 align-middle text-xs whitespace-nowrap"
    case "actions":
      return "min-w-0 overflow-hidden py-1.5 pr-3 align-middle text-xs text-right transition-colors group-hover:bg-card/18"
    default:
      return "min-w-0 overflow-hidden px-3 py-1.5 align-middle text-xs"
  }
}

function resolveSelectedRows(ids: readonly string[]): ClassManagerRow[] {
  return ids
    .map((id) => rows.value.find((row) => row.id === id))
    .filter((row): row is ClassManagerRow => row !== undefined)
}

async function confirmDeleteClasses(rowId?: string) {
  const ids = rowId ? [rowId] : selectedIds.value
  const targets = resolveSelectedRows(ids)
  if (targets.length === 0) return

  const ok = await confirm({
    title:
      targets.length === 1
        ? m.design_classes_delete_title_one()
        : m.design_classes_delete_title_many(),
    description:
      targets.length === 1
        ? m.design_classes_delete_description_one({ name: targets[0]!.name })
        : m.design_classes_delete_description_many({
            count: String(targets.length),
          }),
    confirmLabel: m.design_classes_action_delete(),
    cancelLabel: m.confirm_cancel(),
    destructive: true,
  })
  if (!ok) return

  deleteClasses(targets.map((row) => row.name))
  rowSelection.value = {}
  await persistAndNotify()
}

async function confirmDuplicateClasses() {
  const targets = resolveSelectedRows(selectedIds.value)
  if (targets.length === 0) return
  let succeeded = 0
  for (const row of targets) {
    if (duplicateClass(row.name)) succeeded += 1
  }
  rowSelection.value = {}
  if (succeeded > 0) {
    await persistAndNotify()
  }
}

async function handleNameDialogSubmit(payload: {
  name: string
  cssText?: string
}) {
  const state = nameDialogState.value
  if (!state) return

  if (state.mode === "create") {
    const created = createClass(payload.name, payload.cssText)
    if (!created) {
      toast.error(m.design_classes_toast_create_failed())
      return
    }
    nameDialogState.value = null
    await persistAndNotify()
    return
  }

  if (state.mode === "rename") {
    const ok = renameClass(state.row.name, payload.name)
    if (!ok) {
      toast.error(m.design_classes_toast_rename_failed())
      return
    }
    nameDialogState.value = null
    await persistAndNotify()
    return
  }

  const created = duplicateClass(state.row.name, payload.name)
  if (!created) {
    toast.error(m.design_classes_toast_duplicate_failed())
    return
  }
  nameDialogState.value = null
  await persistAndNotify()
}

async function handleCssDialogSave(css: string) {
  const row = cssDialogRow.value
  if (!row) return
  const ok = updateClassCss(row.name, css)
  if (!ok) {
    toast.error(m.design_classes_toast_css_failed())
    return
  }
  cssDialogRow.value = null
  await persistAndNotify()
}

async function handleClearAll() {
  if (rows.value.length === 0) {
    return
  }
  const ok = await confirm({
    title: m.design_classes_clear_title(),
    description: m.design_classes_clear_description(),
    confirmLabel: m.design_classes_clear_confirm(),
    cancelLabel: m.confirm_cancel(),
    destructive: true,
  })
  if (!ok) return
  clearAllClasses()
  rowSelection.value = {}
  await persistAndNotify()
}

async function handleImportSubmit(payload: {
  mode: "merge" | "replace"
  items: ClassImportItem[]
}) {
  const count = importClasses(payload.items, payload.mode)
  isImportDialogOpen.value = false
  if (count === 0) {
    toast.error(m.design_classes_import_empty())
    return
  }
  await persistAndNotify()
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportJson() {
  downloadText(
    "aria-classes.json",
    exportClassesJson(),
    "application/json",
  )
  toast.success(m.design_classes_toast_exported_json())
}

function exportCss() {
  downloadText("aria-classes.css", exportClassesCss(), "text/css")
  toast.success(m.design_classes_toast_exported_css())
}
</script>

<template>
  <DesignHeaderTeleport target="toolbar">
    <FilterIconMenu
      :model-value="activeSegment"
      :filters="filters"
      @update:model-value="setActiveSegment"
    />
    <StudioTableColumnMenu
      :columns="reorderableColumns"
      @reorder="onColumnReorder"
    />
  </DesignHeaderTeleport>

  <DesignHeaderTeleport target="search">
    <SearchOrBulkToolbar
      :count="selectedIds.length"
      :entity-label="m.design_classes_entity()"
      :search-query="searchQuery"
      :search-placeholder="m.design_classes_search_placeholder()"
      @update:search-query="(value) => (searchQuery = value)"
      @duplicate="confirmDuplicateClasses()"
      @delete="confirmDeleteClasses()"
    />
  </DesignHeaderTeleport>

  <DesignHeaderTeleport target="importExport">
    <HeaderActionDropdownTooltip :label="m.design_classes_more_actions()">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="headerAction"
            size="icon-header"
            :aria-label="m.design_classes_more_actions()"
          >
            <AppIcon name="moreHorizontal" class="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem @select="isImportDialogOpen = true">
              {{ m.design_classes_menu_import() }}
            </DropdownMenuItem>
            <DropdownMenuItem @select="exportJson">
              {{ m.design_classes_menu_export_json() }}
            </DropdownMenuItem>
            <DropdownMenuItem @select="exportCss">
              {{ m.design_classes_menu_export_css() }}
            </DropdownMenuItem>
            <DropdownMenuItem @select="refreshInventory">
              {{ m.design_classes_menu_refresh() }}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" @select="handleClearAll">
              {{ m.design_classes_menu_clear_all() }}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </HeaderActionDropdownTooltip>
  </DesignHeaderTeleport>

  <DesignHeaderTeleport target="stylesheet">
    <Select
      :model-value="selectedPath || undefined"
      :disabled="loading || sheets.length === 0"
      @update:model-value="onSelectPath"
    >
      <SelectTrigger class="h-8 w-full max-w-sm">
        <SelectValue :placeholder="m.design_stylesheets_select_placeholder()" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          v-for="sheet in sheets"
          :key="sheet.relativePath"
          :value="sheet.relativePath"
        >
          {{ sheet.relativePath
          }}{{
            sheet.isEntry ? ` · ${m.design_stylesheets_entry_badge()}` : ""
          }}
        </SelectItem>
      </SelectContent>
    </Select>
  </DesignHeaderTeleport>

  <DesignHeaderTeleport target="actions">
    <Button
      variant="default"
      size="md"
      :disabled="!selectedPath || saving"
      @click="openCreateDialog"
    >
      <AppIcon name="add" class="mr-1.5 size-3.5" />
      {{ m.design_classes_create_button() }}
    </Button>
  </DesignHeaderTeleport>

  <div
    v-if="loading && rows.length === 0"
    class="flex h-96 items-center justify-center"
  >
    <div
      class="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground"
    />
  </div>

  <div v-else class="pb-10">
    <p v-if="error" class="px-7 py-3 text-sm text-destructive">{{ error }}</p>
    <p
      v-else-if="sheets.length === 0"
      class="px-7 py-8 text-sm text-muted-foreground"
    >
      {{ m.design_stylesheets_empty() }}
    </p>

    <section v-else class="overflow-x-auto overscroll-x-contain">
      <StudioTableHeader
        :table="headerTable"
        :get-head-cell-class="getHeadCellClass"
      />
      <Table class="w-full table-fixed border-collapse bg-transparent">
        <StudioTableColGroup :table="headerTable" />
        <TableBody>
          <TableEmpty
            v-if="tableRows.length === 0"
            :colspan="visibleColumnCount"
          >
            <div class="flex flex-col items-center gap-4 text-center">
              <p class="max-w-md text-sm text-muted-foreground whitespace-normal">
                {{ emptyStateLabel }}
              </p>
              <Button
                v-if="showOpenStylesheetCta"
                variant="outline"
                size="sm"
                @click="openInStylesheets"
              >
                {{ m.design_classes_open_in_stylesheets() }}
              </Button>
            </div>
          </TableEmpty>

          <TableRow
            v-for="row in tableRows"
            :id="`class-row-${row.original.name}`"
            :key="row.id"
            class="group border-b border-dashed border-border transition-all duration-50 hover:bg-card/18 hover:[box-shadow:inset_2px_0_0_0_var(--primary),inset_-2px_0_0_0_var(--primary)]"
            @dblclick="handleRowDblClick(row.original)"
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
        </TableBody>
      </Table>
    </section>
  </div>

  <ClassManagerNameDialog
    :open="isNameDialogOpen"
    :mode="nameDialogState?.mode ?? 'create'"
    :initial-name="nameDialogState?.row?.name"
    :initial-css="nameDialogInitialCss"
    :variable-references="variableReferences"
    :class-references="classReferences"
    :utility-references="utilityReferences"
    :keyframe-references="keyframeReferences"
    @update:open="handleNameDialogOpenChange"
    @submit="handleNameDialogSubmit"
  />

  <ClassManagerCssDialog
    :open="isCssDialogOpen"
    :class-name="cssDialogRow?.name ?? ''"
    :initial-css="cssDialogRow?.css ?? ''"
    :variable-references="variableReferences"
    :class-references="classReferences"
    :utility-references="utilityReferences"
    :keyframe-references="keyframeReferences"
    @update:open="handleCssDialogOpenChange"
    @save="handleCssDialogSave"
  />

  <ClassManagerImportDialog
    :open="isImportDialogOpen"
    @update:open="(v) => (isImportDialogOpen = v)"
    @submit="handleImportSubmit"
  />
</template>
