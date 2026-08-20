<script setup lang="ts">
import { FlexRender } from "@tanstack/vue-table"
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import AppContextMenu from "@/components/menu/AppContextMenu.vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table"
import { writeClipboardText } from "@/lib/clipboard"
import { prioritizeComponentThumbs } from "@/lib/thumbs"
import { confirm } from "@/composables/useConfirm"
import {
  createWorkspaceComponent,
  deleteWorkspaceComponentFolder,
  deleteWorkspaceStudioDocument,
  renameWorkspaceComponentFolder,
  resolveWorkspaceComponent,
  revealWorkspaceComponent,
} from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"
import {
  beginOrganizerGridCardDrag,
  beginOrganizerListRowDrag,
  endOrganizerDragGhost,
  getOrganizerDropCommit,
  getStudioTableColWidthStyle,
  HeaderActionDropdownTooltip,
  HeaderActionTooltip,
  InventoryTableFooter,
  ORGANIZER_DRAG_IDS_MIME,
  PageHeader,
  SearchOrBulkToolbar,
  SkeletonTable,
  StudioPanelShell,
  StudioTableColGroup,
  StudioTableColumnMenu,
  StudioTableHeader,
  toStudioTableHeaderTable,
  useStudioOrganizerDragState,
  type StudioTableColumnMenuColumn,
  EmptyState,
  StudioOrganizerRail,
  StudioNameCreateDialog,
} from "@/workspace/studio/core"
import type { ScanComponent } from "@/workspace/types"
import type { StudioDocumentUsage } from "../../../../shared/types"
import ComponentGridCard from "./ComponentGridCard.vue"
import ComponentInspectorPanel from "./detail/ComponentInspectorPanel.vue"
import { componentMenuItems } from "./componentMenuItems"
import {
  folderGroupIdForPath,
  folderPathFromGroupId,
  useComponentGrouping,
} from "./composables/useComponentGrouping"
import {
  useComponentsListState,
  type ComponentsSort,
  type ComponentsSortKey,
} from "./composables/useComponentsListState"
import { useComponentsOrganizeState } from "./composables/useComponentsOrganizeState"
import { useVisibleComponentThumbPriority } from "./composables/useVisibleComponentThumbPriority"
import { toGroupRouteFilter } from "./lib/componentsRouteFilter"
import {
  toComponentsTableRows,
  useComponentsTable,
  type ComponentsTableRow,
} from "./useComponentsTable"

const VIEW_MODE_KEY = "aria.components.viewMode"
const GRID_SORT_KEY = "aria.components.gridSort"

type ViewMode = "table" | "grid"

function readViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY)
    if (stored === "grid" || stored === "table") return stored
  } catch {
    /* ignore */
  }
  return "grid"
}

function parseComponentsSort(value: unknown): ComponentsSort {
  const fallback: ComponentsSort = { key: "name", direction: "asc" }
  if (!value || typeof value !== "object") return fallback

  const record = value as { key?: unknown; direction?: unknown }
  const key = record.key
  const direction = record.direction
  const validKey: ComponentsSortKey | null =
    key === "name" ||
    key === "id" ||
    key === "category" ||
    key === "updated"
      ? key
      : null
  const validDirection =
    direction === "asc" || direction === "desc" ? direction : null

  return validKey && validDirection
    ? { key: validKey, direction: validDirection }
    : fallback
}

function readGridSort(): ComponentsSort {
  try {
    return parseComponentsSort(
      JSON.parse(localStorage.getItem(GRID_SORT_KEY) ?? "null"),
    )
  } catch {
    return parseComponentsSort(null)
  }
}

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

const props = defineProps<{
  components: ScanComponent[]
  loading: boolean
  error: string | null
  projectRoot: string
  onRefresh: () => Promise<void> | void
  onOpenComposer: (component: { name: string; file: string }) => void
  onOpenUsage: (usage: StudioDocumentUsage) => void
}>()

const componentsRef = computed(() => props.components)
const dragState = useStudioOrganizerDragState()

const grouping = useComponentGrouping(componentsRef, props.projectRoot)
const organizeState = useComponentsOrganizeState({
  customGroups: grouping.customGroups,
  hasHydratedFromServer: grouping.hasHydratedFromServer,
})

const customGroupOptions = computed(() => grouping.customGroups.value)

const listState = useComponentsListState(componentsRef, {
  activeFilter: organizeState.activeFilter,
  groupedSections: grouping.groupedComponents,
  buildEffectiveAssignments: grouping.buildEffectiveAssignments,
  getGroupMemberCount: grouping.getGroupMemberCount,
  customGroupOptions,
})

listState.sortBy.value = readGridSort()

const viewMode = ref<ViewMode>(readViewMode())
const collapsedGroups = ref<Record<string, boolean>>({})
const createOpen = ref(false)
const createBusy = ref(false)
const createError = ref<string | null>(null)
const selectionAnchorId = ref<string | null>(null)
const lifecycleError = ref<string | null>(null)
const selectedComponentFile = ref<string | null>(null)
const inventoryScrollRoot = ref<HTMLElement | null>(null)

useVisibleComponentThumbPriority({
  enabled: () => viewMode.value === "grid" && !props.loading,
  projectPath: () => props.projectRoot,
  scrollRoot: inventoryScrollRoot,
})

const selectedDetailComponent = computed(() =>
  selectedComponentFile.value
    ? props.components.find((component) => component.file === selectedComponentFile.value) ?? null
    : null,
)

watch(
  () => selectedDetailComponent.value?.id,
  (id) => {
    if (!id) return
    void prioritizeComponentThumbs({
      projectPath: props.projectRoot,
      ids: [id],
    }).catch(() => undefined)
  },
)

const sortOptions = computed(() => [
  {
    label: m.components_sort_name_asc(),
    value: { key: "name", direction: "asc" } as const,
  },
  {
    label: m.components_sort_name_desc(),
    value: { key: "name", direction: "desc" } as const,
  },
  {
    label: m.components_sort_recently_updated(),
    value: { key: "updated", direction: "desc" } as const,
  },
  {
    label: m.components_sort_oldest_updated(),
    value: { key: "updated", direction: "asc" } as const,
  },
  {
    label: m.components_sort_id_asc(),
    value: { key: "id", direction: "asc" } as const,
  },
  {
    label: m.components_sort_id_desc(),
    value: { key: "id", direction: "desc" } as const,
  },
  {
    label: m.components_sort_category_asc(),
    value: { key: "category", direction: "asc" } as const,
  },
  {
    label: m.components_sort_category_desc(),
    value: { key: "category", direction: "desc" } as const,
  },
])

const tableRows = computed(() =>
  toComponentsTableRows(listState.tableData.value),
)

const { table, rowSelection } = useComponentsTable(tableRows)

const selectedComponentIds = computed(() =>
  table.getSelectedRowModel().rows.map((row) => row.original.id),
)

const headerTable = computed(() => toStudioTableHeaderTable(table))

const reorderableColumns = computed(() =>
  table
    .getAllLeafColumns()
    .filter((column) => column.id !== "select")
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

const groupCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const group of grouping.customGroups.value) {
    counts[group.id] = grouping.getGroupMemberCount(
      group.id,
      props.components,
    )
  }
  return counts
})

const tableDisplaySections = computed(() => {
  const sortedRows = table.getRowModel().rows

  return listState.displaySections.value
    .map((section) => {
      const sectionIds = new Set(section.items.map((item) => item.id))
      const items = sortedRows
        .filter((row) => sectionIds.has(row.original.id))
        .map((row) => ({
          component: row.original,
          row,
        }))

      return {
        ...section,
        items,
      }
    })
    .filter((section) => section.items.length > 0)
})

const gridDisplaySections = computed(() => {
  if (!listState.showPagination.value) {
    return listState.displaySections.value.map((section) => ({
      ...section,
      items: toComponentsTableRows([...section.items]),
    }))
  }

  return [
    {
      key: "flat",
      label: "",
      items: toComponentsTableRows(listState.paginatedComponents.value),
    },
  ]
})

const headerTitle = computed(() =>
  listState.activeFilterLabel.value || m.components_title(),
)

const footerMeta = computed(() => {
  const count = listState.filteredComponents.value.length
  if (count === 0) return m.components_footer_count_zero()
  if (count === 1) return m.components_footer_count_one()
  return m.components_footer_count({ count })
})

const showEmpty = computed(
  () => !props.loading && listState.filteredComponents.value.length === 0,
)

const emptyIsFiltered = computed(
  () =>
    props.components.length > 0 &&
    listState.filteredComponents.value.length === 0,
)

const footerTotalPages = computed(() =>
  listState.showPagination.value ? listState.totalPages.value : 1,
)

watch(
  () => props.projectRoot,
  () => {
    rowSelection.value = {}
    selectedComponentFile.value = null
  },
)

watch(
  () => props.components.map((component) => component.file).join("|"),
  () => {
    if (selectedComponentFile.value && !selectedDetailComponent.value) {
      selectedComponentFile.value = null
    }
  },
)

onBeforeUnmount(() => {
  endOrganizerDragGhost()
  dragState.endDrag()
})

function onColumnReorder(columns: StudioTableColumnMenuColumn[]) {
  const newOrder = columns.map((column) => column.id)
  const allIds = table.getAllLeafColumns().map((column) => column.id)
  const fixedIds = allIds.filter((id) => !newOrder.includes(id))
  table.setColumnOrder([...fixedIds, ...newOrder])
}

function handleSearch(value: string) {
  listState.searchQuery.value = value
}

function toggleView() {
  viewMode.value = viewMode.value === "table" ? "grid" : "table"
  try {
    localStorage.setItem(VIEW_MODE_KEY, viewMode.value)
  } catch {
    /* ignore */
  }
}

function handleSort(next: ComponentsSort) {
  const parsed = parseComponentsSort(next)
  listState.sortBy.value = parsed
  listState.currentPage.value = 1
  try {
    localStorage.setItem(GRID_SORT_KEY, JSON.stringify(parsed))
  } catch {
    /* ignore */
  }
}

function isActiveSort(option: ComponentsSort): boolean {
  return (
    option.key === listState.sortBy.value.key &&
    option.direction === listState.sortBy.value.direction
  )
}

function isGroupCollapsed(groupKey: string): boolean {
  return collapsedGroups.value[groupKey] === true
}

function toggleGroupCollapse(groupKey: string): void {
  collapsedGroups.value = {
    ...collapsedGroups.value,
    [groupKey]: !isGroupCollapsed(groupKey),
  }
}

function explicitGroupId(componentId: string): string | undefined {
  return grouping.componentGroupAssignments.value[componentId]
}

function openCreate() {
  createError.value = null
  createOpen.value = true
}

async function submitCreate(name: string) {
  createBusy.value = true
  createError.value = null
  try {
    const created = await createWorkspaceComponent(props.projectRoot, name)
    createOpen.value = false
    await props.onRefresh()
    props.onOpenComposer({ name: created.name, file: created.file })
  } catch (err: unknown) {
    createError.value = err instanceof Error ? err.message : String(err)
  } finally {
    createBusy.value = false
  }
}

async function copyText(value: string) {
  try {
    await writeClipboardText(value)
  } catch (err: unknown) {
    console.error(err)
  }
}

async function revealComponent(component: ComponentsTableRow) {
  try {
    await revealWorkspaceComponent(props.projectRoot, component.file)
  } catch (err: unknown) {
    console.error(err)
  }
}

function selectComponent(component: ComponentsTableRow, event: MouseEvent | KeyboardEvent) {
  const additive = event.metaKey || event.ctrlKey
  const visibleIds = listState.filteredComponents.value.map((item) => item.id)
  if (event.shiftKey && selectionAnchorId.value) {
    const anchor = visibleIds.indexOf(selectionAnchorId.value)
    const current = visibleIds.indexOf(component.id)
    if (anchor >= 0 && current >= 0) {
      const [start, end] = anchor <= current ? [anchor, current] : [current, anchor]
      const next = additive ? { ...rowSelection.value } : {}
      for (const id of visibleIds.slice(start, end + 1)) next[id] = true
      rowSelection.value = next
      return
    }
  }
  rowSelection.value = additive
    ? { ...rowSelection.value, [component.id]: !rowSelection.value[component.id] }
    : { [component.id]: true }
  selectionAnchorId.value = component.id
}

function openComponent(component: ComponentsTableRow) {
  selectedComponentFile.value = component.file
  rowSelection.value = {}
}

function onComponentRowClick(component: ComponentsTableRow, event: MouseEvent) {
  if ((event.target as HTMLElement | null)?.closest("button,input,a,[role='menuitem']")) return
  if (event.metaKey || event.ctrlKey || event.shiftKey) {
    selectComponent(component, event)
    return
  }
  openComponent(component)
}

function openDuplicatedComponent(component: ScanComponent) {
  selectedComponentFile.value = component.file
}

async function closeComponentInspector() {
  const componentId = selectedDetailComponent.value?.id
  selectedComponentFile.value = null
  await nextTick()
  if (!componentId) return
  const trigger = [...document.querySelectorAll<HTMLElement>("[data-component-id]")]
    .find((element) => element.dataset.componentId === componentId)
  trigger?.focus({ preventScroll: true })
}

async function deleteComponents(ids: readonly string[]) {
  if (ids.length === 0) return

  const byId = new Map(props.components.map((item) => [item.id, item]))
  const blockedUsageFiles = new Set<string>()
  lifecycleError.value = null
  for (const id of ids) {
    const component = byId.get(id)
    if (!component) continue
    try {
      const result = await deleteWorkspaceStudioDocument(props.projectRoot, {
        kind: "component",
        file: component.file,
      })
      if (!result.ok) {
        for (const usage of result.usages) blockedUsageFiles.add(usage.file)
      }
    } catch (err: unknown) {
      console.error(err)
      lifecycleError.value = err instanceof Error ? err.message : String(err)
    }
  }

  if (blockedUsageFiles.size) {
    lifecycleError.value = m.studio_document_delete_blocked({
      count: blockedUsageFiles.size,
    })
  }

  rowSelection.value = {}
  await props.onRefresh()
}

async function onComponentMenuAction(
  id: string,
  component: ComponentsTableRow,
) {
  if (id.startsWith("move-group:")) {
    const groupId = id.slice("move-group:".length) || undefined
    await grouping.moveComponentToGroup(component.id, groupId)
    return
  }

  switch (id) {
    case "reveal":
      await revealComponent(component)
      break
    case "copy-path":
      try {
        const resolved = await resolveWorkspaceComponent(
          props.projectRoot,
          component.file,
        )
        await copyText(resolved.path)
      } catch (err: unknown) {
        console.error(err)
        await copyText(component.file)
      }
      break
    case "delete":
      await deleteComponents([component.id])
      break
  }
}

async function handleBulkDelete() {
  const ids = selectedComponentIds.value
  if (ids.length === 0) return

  const ok = await confirm({
    title:
      ids.length === 1
        ? m.components_delete_confirm_title({ name: ids[0]! })
        : m.components_delete_confirm_title({
            name: `${ids.length} components`,
          }),
    description: m.components_delete_confirm_description(),
    destructive: true,
  })
  if (!ok) return

  await deleteComponents(ids)
}

function handleSelectAll(): void {
  selectedComponentFile.value = null
  organizeState.setActiveFilter("all")
}

function handleSelectGroup(groupId: string): void {
  selectedComponentFile.value = null
  organizeState.setActiveFilter(toGroupRouteFilter(groupId))
}

async function handleCreateGroup(name: string): Promise<void> {
  await grouping.createCustomGroup(name)
}

async function handleRenameGroup(
  groupId: string,
  name: string,
): Promise<void> {
  const folderPath = folderPathFromGroupId(groupId)
  if (folderPath) {
    try {
      const result = await renameWorkspaceComponentFolder(
        props.projectRoot,
        folderPath,
        name,
      )
      grouping.applyFolderPathMutation(result)
      if (
        organizeState.activeFilter.value === toGroupRouteFilter(groupId) &&
        result.to
      ) {
        organizeState.setActiveFilter(
          toGroupRouteFilter(folderGroupIdForPath(result.to)),
        )
      }
      await props.onRefresh()
    } catch (err: unknown) {
      console.error(err)
    }
    return
  }
  await grouping.renameCustomGroup(groupId, name)
}

async function handleDeleteGroup(groupId: string): Promise<void> {
  const wasActive =
    organizeState.activeFilter.value === toGroupRouteFilter(groupId)
  const folderPath = folderPathFromGroupId(groupId)

  if (folderPath) {
    try {
      const result = await deleteWorkspaceComponentFolder(
        props.projectRoot,
        folderPath,
      )
      grouping.applyFolderPathMutation(result)
      if (wasActive) {
        organizeState.setActiveFilter(
          result.to
            ? toGroupRouteFilter(folderGroupIdForPath(result.to))
            : "all",
        )
      }
      await props.onRefresh()
    } catch (err: unknown) {
      console.error(err)
    }
    return
  }

  await grouping.deleteCustomGroup(groupId)
  if (wasActive) {
    organizeState.setActiveFilter("all")
  }
}

async function handleMoveToGroup(
  componentId: string,
  groupId?: string,
): Promise<void> {
  await grouping.moveComponentToGroup(componentId, groupId)
}

async function handleMoveItemsToGroup(
  componentIds: readonly string[],
  groupId?: string,
): Promise<void> {
  for (const componentId of componentIds) {
    await grouping.moveComponentToGroup(componentId, groupId)
  }
}

function getComponentDragLabel(componentId: string, itemCount: number): string {
  if (itemCount > 1) {
    return `${itemCount} components`
  }
  const component = props.components.find((item) => item.id === componentId)
  return component?.name || componentId
}

function resolveDragSourceElement(event: DragEvent): HTMLElement | null {
  const current = event.currentTarget
  if (!(current instanceof HTMLElement)) {
    return null
  }

  if (viewMode.value === "table") {
    const row = current.closest('tr[data-slot="table-row"]')
    if (row instanceof HTMLElement) {
      return row
    }
  }

  return current
}

function handleDragStart(componentId: string, event: DragEvent): void {
  const ids =
    resolveBulkTargets(componentId, selectedComponentIds.value)

  dragState.startDrag(componentId, ids)
  event.dataTransfer?.setData("text/plain", componentId)
  if (ids.length > 1) {
    event.dataTransfer?.setData(ORGANIZER_DRAG_IDS_MIME, JSON.stringify(ids))
  }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move"
    if (viewMode.value === "table") {
      event.dataTransfer.setData("text/html", " ")
    }
  }

  const dragOptions = {
    itemCount: ids.length,
    source: resolveDragSourceElement(event),
    compactLabel: getComponentDragLabel(componentId, ids.length),
    onDragEnd: handleOrganizerDragEnd,
  }

  if (viewMode.value === "table") {
    beginOrganizerListRowDrag(event, dragOptions)
    return
  }

  beginOrganizerGridCardDrag(event, dragOptions)
}

function handleOrganizerDragEnd(event: DragEvent): void {
  if (!dragState.wasOrganizerDropCommitted()) {
    const commit = getOrganizerDropCommit(event.clientX, event.clientY)
    if (commit) {
      dragState.markOrganizerDropCommitted()
      void handleMoveItemsToGroup(commit.itemIds, commit.groupId)
    }
  }

  dragState.scheduleEndDrag()
}

function menuItemsFor(component: ComponentsTableRow) {
  return componentMenuItems(component, {
    groups: grouping.customGroups.value,
    currentGroupId: explicitGroupId(component.id) ?? null,
    canUpdateGrouping: true,
  })
}
</script>

<template>
  <StudioPanelShell variant="rail" content-class="flex-row">
    <template #rail>
      <StudioOrganizerRail
        :title="m.components_title()"
        :groups="grouping.customGroups.value"
        :group-counts="groupCounts"
        :all-count="components.length"
        :active-filter="organizeState.activeFilter.value"
        :can-update-grouping="true"
        :all-label="m.components_sidebar_all()"
        :new-group-label="m.components_sidebar_new_group()"
        :delete-dialog-title="m.components_sidebar_delete_group()"
        :delete-stay-available-message="m.components_sidebar_delete_description()"
        :delete-folder-stay-available-message="
          m.components_sidebar_delete_folder_description()
        "
        :group-name-placeholder="m.components_sidebar_group_name()"
        :nav-aria-label="m.components_sidebar_groups()"
        :on-move-to-group="handleMoveToGroup"
        :on-move-items-to-group="handleMoveItemsToGroup"
        @select-all="handleSelectAll"
        @select-group="handleSelectGroup"
        @create-group="handleCreateGroup"
        @rename-group="handleRenameGroup"
        @delete-group="handleDeleteGroup"
      />
    </template>

    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">

    <PageHeader
      :title="headerTitle"
      :description="m.components_description()"
      class="min-h-22 px-5 py-3"
      :search-query="listState.searchQuery.value"
      entity-label-singular="component"
      :create-label="m.components_new()"
      :hide-create="false"
      hide-search
      @create="openCreate"
    >
      <template #toolbar>
        <SearchOrBulkToolbar
          :count="selectedComponentIds.length"
          entity-label="component"
          :search-query="listState.searchQuery.value"
          :search-placeholder="m.components_search()"
          :show-duplicate="false"
          @update:search-query="handleSearch"
          @delete="handleBulkDelete"
        />
        <StudioTableColumnMenu
          v-if="viewMode === 'table' && selectedComponentIds.length === 0"
          :columns="reorderableColumns"
          :locked-column-ids="['name']"
          @reorder="onColumnReorder"
        />
        <HeaderActionDropdownTooltip
          v-if="viewMode === 'grid' && selectedComponentIds.length === 0"
          :label="m.components_sort()"
        >
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="headerAction"
                size="icon-header"
                :aria-label="m.components_sort()"
              >
                <AppIcon name="sort" :size="14" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-44">
              <DropdownMenuItem
                v-for="option in sortOptions"
                :key="`${option.value.key}:${option.value.direction}`"
                class="cursor-pointer text-xs"
                @select.prevent="handleSort(option.value)"
              >
                <AppIcon
                  v-if="isActiveSort(option.value)"
                  name="checkLinear"
                  :size="14"
                  class="mr-1.5 text-primary"
                />
                <span v-else class="mr-1.5 w-3.5" />
                {{ option.label }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HeaderActionDropdownTooltip>
        <HeaderActionTooltip
          v-if="selectedComponentIds.length === 0"
          :label="
            viewMode === 'table'
              ? m.components_grid_view()
              : m.components_table_view()
          "
        >
          <Button
            variant="headerAction"
            size="icon-header"
            :aria-label="
              viewMode === 'table'
                ? m.components_grid_view()
                : m.components_table_view()
            "
            @click="toggleView"
          >
            <AppIcon
              :name="viewMode === 'grid' ? 'list' : 'grid'"
              :size="14"
            />
          </Button>
        </HeaderActionTooltip>
      </template>
    </PageHeader>

    <p
      v-if="lifecycleError"
      class="border-b border-dashed border-border bg-destructive/5 px-7 py-2.5 text-sm text-destructive"
      role="alert"
    >
      {{ lifecycleError }}
    </p>

    <div
      ref="inventoryScrollRoot"
      class="min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-y-none"
      style="touch-action: pan-y"
    >
      <SkeletonTable
        v-if="loading && components.length === 0"
        :rows="5"
        :columns="5"
      />

      <div
        v-else-if="error"
        class="m-5 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm"
      >
        <p class="font-medium text-destructive">Could not read this project</p>
        <p class="mt-1 break-words text-muted-foreground">{{ error }}</p>
        <Button class="mt-3" variant="outline" size="sm" @click="onRefresh">
          Retry
        </Button>
      </div>

      <EmptyState
        v-else-if="showEmpty"
        icon="components"
        entity-label="components"
        entity-label-singular="component"
        :title="
          emptyIsFiltered
            ? m.studio_no_results()
            : m.components_empty_title()
        "
        :description="
          emptyIsFiltered
            ? m.components_empty_filtered()
            : m.components_empty_description()
        "
        :hide-action="emptyIsFiltered"
        :create-label="m.components_new()"
        @create="openCreate"
      />

      <div v-else-if="viewMode === 'table'" class="rounded-none">
        <StudioTableHeader
          :table="headerTable"
          :get-head-cell-class="() => 'px-5'"
        />
        <Table class="w-full table-fixed border-collapse">
          <StudioTableColGroup :table="headerTable" />
          <TableBody>
            <template
              v-for="group in tableDisplaySections"
              :key="group.key"
            >
              <TableRow
                v-if="group.label"
                class="bg-muted/30 hover:bg-muted/30"
              >
                <TableCell
                  class="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  :colspan="table.getVisibleLeafColumns().length"
                >
                  <button
                    type="button"
                    class="inline-flex items-center gap-2"
                    @click="toggleGroupCollapse(group.key)"
                  >
                    <AppIcon
                      :name="
                        isGroupCollapsed(group.key)
                          ? 'chevronRight'
                          : 'chevronDown'
                      "
                      :size="14"
                    />
                    {{ group.label }}
                    <span class="text-[10px] text-muted-foreground/70">
                      ({{ group.items.length }})
                    </span>
                  </button>
                </TableCell>
              </TableRow>

              <template v-if="!group.label || !isGroupCollapsed(group.key)">
                <AppContextMenu
                  v-for="item in group.items"
                  :key="item.component.id"
                  :items="menuItemsFor(item.component)"
                  @action="(id) => onComponentMenuAction(id, item.component)"
                >
                  <TableRow
                    class="group cursor-grab border-b border-dashed border-border! transition-all duration-100 hover:bg-sidebar/30 hover:[box-shadow:inset_2px_0_0_0_var(--primary),inset_-2px_0_0_0_var(--primary)] active:cursor-grabbing data-[state=selected]:bg-card/50"
                    draggable="true"
                    :data-component-id="item.component.id"
                    :data-state="
                      item.row.getIsSelected() ? 'selected' : undefined
                    "
                    @click="onComponentRowClick(item.component, $event)"
                    @dragstart="handleDragStart(item.component.id, $event)"
                  >
                    <TableCell
                      v-for="cell in item.row.getVisibleCells()"
                      :key="cell.id"
                      :data-column-id="cell.column.id"
                      :style="getStudioTableColWidthStyle(cell.column)"
                      class="min-w-0 overflow-hidden px-5 py-3 text-xs"
                    >
                      <FlexRender
                        :render="cell.column.columnDef.cell"
                        :props="cell.getContext()"
                      />
                    </TableCell>
                  </TableRow>
                </AppContextMenu>
              </template>
            </template>
          </TableBody>
        </Table>
      </div>

      <div v-else class="space-y-8">
        <section
          v-for="group in gridDisplaySections"
          :key="group.key"
        >
          <div
            v-if="group.label"
            class="sticky top-0 z-20 bg-background pt-5 pb-4"
          >
            <div
              class="flex items-center gap-3 border-b border-dashed border-border pb-2.5"
            >
              <h3
                class="pl-7 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {{ group.label }}
              </h3>
              <span
                class="pr-7 text-[10px] text-muted-foreground/70 tabular-nums select-none"
              >
                {{ group.items.length }}
              </span>
            </div>
          </div>
          <div
            class="grid grid-cols-1 gap-7 px-7 pb-7 pt-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
          >
            <AppContextMenu
              v-for="component in group.items"
              :key="component.id"
              :items="menuItemsFor(component)"
              @action="(id) => onComponentMenuAction(id, component)"
            >
              <ComponentGridCard
                :component="component"
                :project-path="projectRoot"
                draggable
                :selected="Boolean(rowSelection[component.id])"
                @select="selectComponent(component, $event)"
                @open="openComponent(component)"
                @dragstart="handleDragStart(component.id, $event)"
              />
            </AppContextMenu>
          </div>
        </section>
      </div>
    </div>

    <InventoryTableFooter
      v-if="!loading"
      :meta="footerMeta"
      :current-page="listState.currentPage.value"
      :total-pages="footerTotalPages"
      @update:current-page="listState.currentPage.value = $event"
    />

    <StudioNameCreateDialog
      v-model:open="createOpen"
      :busy="createBusy"
      :error="createError"
      :title="m.components_create_title()"
      :description="m.components_create_description()"
      :placeholder="m.components_create_placeholder()"
      :cancel-label="m.components_create_cancel()"
      :submit-label="m.components_create_submit()"
      :creating-label="m.components_create_creating()"
      @submit="submitCreate"
    />
    </div>

    <ComponentInspectorPanel
      v-if="selectedDetailComponent"
      :component="selectedDetailComponent"
      :project-root="projectRoot"
      :on-refresh="onRefresh"
      :on-open-composer="onOpenComposer"
      :on-open-usage="onOpenUsage"
      @close="closeComponentInspector"
      @duplicated="openDuplicatedComponent"
    />
  </StudioPanelShell>
</template>
