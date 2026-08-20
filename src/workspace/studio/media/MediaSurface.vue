<script setup lang="ts">
import { FlexRender } from "@tanstack/vue-table"
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
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
import { onProjectChange } from "@/lib/sessions"
import {
  deleteMedia,
  duplicateMedia,
  listMedia,
  renameMedia,
  revealMedia,
  resolveMedia,
  uploadMedia,
  type MediaAsset,
} from "@/lib/media"
import { m } from "@/paraglide/messages.js"
import {
  beginOrganizerGridCardDrag,
  beginOrganizerListRowDrag,
  EmptyState,
  FilterIconMenu,
  getOrganizerDropCommit,
  getStudioTableColWidthStyle,
  HeaderActionDropdownTooltip,
  HeaderActionTooltip,
  InventoryTableFooter,
  ORGANIZER_DRAG_IDS_MIME,
  PageHeader,
  SearchOrBulkToolbar,
  SkeletonTable,
  StudioLeftRailReveal,
  StudioPanelShell,
  StudioTableColGroup,
  StudioTableColumnMenu,
  StudioTableHeader,
  toStudioTableHeaderTable,
  useStudioOrganizerDragState,
  type StudioTableColumnMenuColumn,
  StudioOrganizerRail,
} from "@/workspace/studio/core"
import MediaDetailSurface from "./MediaDetailSurface.vue"
import MediaGridCard from "./components/MediaGridCard.vue"
import { useMediaGrouping } from "./composables/useMediaGrouping"
import { useMediaOrganizeState } from "./composables/useMediaOrganizeState"
import { createMediaPlayback } from "./composables/useMediaPlayback"
import { useMediaViewState } from "./composables/useMediaViewState"
import {
  parseMediaTypeFilter,
  toGroupRouteFilter,
  type MediaTypeFilter,
} from "./lib/mediaRouteFilter"
import { mediaMenuItems } from "./mediaMenuItems"
import { useMediaTable } from "./useMediaTable"
import "./styles/media-masonry.css"

const VIEW_MODE_KEY = "aria.media.viewMode"
const GRID_SORT_KEY = "aria.media.gridSort"

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
  projectRoot: string
}>()

const assets = ref<MediaAsset[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const selectedAssetId = ref<string | null>(null)
const typeFilter = ref<MediaTypeFilter>("all")
const viewMode = ref<ViewMode>(readViewMode())
const playback = createMediaPlayback()

const assetsRef = computed(() => assets.value)
const dragState = useStudioOrganizerDragState()

const grouping = useMediaGrouping(assetsRef, props.projectRoot)
const organizeState = useMediaOrganizeState({
  customGroups: grouping.customGroups,
  hasHydratedFromServer: grouping.hasHydratedFromServer,
})

const customGroupOptions = computed(() => grouping.customGroups.value)

const listState = useMediaViewState(assetsRef, {
  activeFilter: organizeState.activeFilter,
  typeFilter,
  buildEffectiveAssignments: grouping.buildEffectiveAssignments,
  getGroupMemberCount: grouping.getGroupMemberCount,
  customGroupOptions,
})

try {
  const stored = JSON.parse(localStorage.getItem(GRID_SORT_KEY) ?? "null")
  if (
    stored &&
    typeof stored === "object" &&
    typeof stored.key === "string" &&
    (stored.direction === "asc" || stored.direction === "desc")
  ) {
    listState.sortBy.value = stored
  }
} catch {
  /* ignore */
}

watch(listState.sortBy, (value) => {
  try {
    localStorage.setItem(GRID_SORT_KEY, JSON.stringify(value))
  } catch {
    /* ignore */
  }
})

watch(viewMode, (value) => {
  try {
    localStorage.setItem(VIEW_MODE_KEY, value)
  } catch {
    /* ignore */
  }
})

const tableRows = computed(() => [...listState.paginatedAssets.value])
const folderById = computed(() => {
  const assignments = grouping.buildEffectiveAssignments(assets.value)
  const names = new Map(
    grouping.customGroups.value.map((g) => [g.id, g.name] as const),
  )
  const map: Record<string, string> = {}
  for (const [id, groupId] of Object.entries(assignments)) {
    const name = names.get(groupId)
    if (name) map[id] = name
  }
  return map
})

const { table, rowSelection } = useMediaTable(
  tableRows,
  folderById,
  computed(() => props.projectRoot),
)

const selectedIds = computed(() =>
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
    counts[group.id] = grouping.getGroupMemberCount(group.id, assets.value)
  }
  return counts
})

const sortOptions = computed(() => [
  {
    label: m.media_sort_recent(),
    value: { key: "uploaded" as const, direction: "desc" as const },
  },
  {
    label: m.media_sort_oldest(),
    value: { key: "uploaded" as const, direction: "asc" as const },
  },
  {
    label: m.media_sort_name_asc(),
    value: { key: "name" as const, direction: "asc" as const },
  },
  {
    label: m.media_sort_name_desc(),
    value: { key: "name" as const, direction: "desc" as const },
  },
  {
    label: m.media_sort_largest(),
    value: { key: "size" as const, direction: "desc" as const },
  },
  {
    label: m.media_sort_smallest(),
    value: { key: "size" as const, direction: "asc" as const },
  },
  {
    label: m.media_sort_type_asc(),
    value: { key: "type" as const, direction: "asc" as const },
  },
  {
    label: m.media_sort_type_desc(),
    value: { key: "type" as const, direction: "desc" as const },
  },
])

const selectedAsset = computed(
  () => assets.value.find((a) => a.id === selectedAssetId.value) ?? null,
)
const detailFullWidth = ref(false)

watch(selectedAssetId, (id, prev) => {
  detailFullWidth.value = false
  if (id && id !== prev) {
    // Grid unmounts when detail opens; stop any in-flight preview audio/video.
    playback.stop()
  }
})

const usesMasonryGrid = computed(() => {
  return (
    typeFilter.value === "all" ||
    typeFilter.value === "image" ||
    typeFilter.value === "video"
  )
})

const footerLabel = computed(() => {
  const count = listState.filteredAssets.value.length
  if (count === 0) return m.media_footer_count_zero()
  if (count === 1) return m.media_footer_count_one()
  return m.media_footer_count({ count: String(count) })
})

const scrollRootRef = ref<HTMLElement | null>(null)
const gridSentinelRef = ref<HTMLElement | null>(null)
let gridObserver: IntersectionObserver | null = null

function disconnectGridObserver(): void {
  gridObserver?.disconnect()
  gridObserver = null
}

function isGridSentinelNear(): boolean {
  const root = scrollRootRef.value
  const sentinel = gridSentinelRef.value
  if (!root || !sentinel || !listState.hasMoreGrid.value) return false
  const rootRect = root.getBoundingClientRect()
  const sentinelRect = sentinel.getBoundingClientRect()
  return sentinelRect.top <= rootRect.bottom + 400
}

async function fillGridWhileNear(): Promise<void> {
  let guard = 0
  while (isGridSentinelNear() && guard < 40) {
    const before = listState.gridAssets.value.length
    listState.loadMoreGrid()
    if (listState.gridAssets.value.length === before) break
    guard += 1
    await nextTick()
  }
}

function connectGridObserver(): void {
  disconnectGridObserver()
  if (viewMode.value !== "grid") return
  const root = scrollRootRef.value
  const sentinel = gridSentinelRef.value
  if (!root || !sentinel) return

  gridObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void fillGridWhileNear()
      }
    },
    { root, rootMargin: "400px 0px", threshold: 0 },
  )
  gridObserver.observe(sentinel)
  void fillGridWhileNear()
}

function explicitGroupId(assetId: string): string | null {
  return grouping.buildEffectiveAssignments(assets.value)[assetId] ?? null
}

async function refresh() {
  loading.value = true
  error.value = null
  try {
    assets.value = await listMedia(props.projectRoot)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function handleUpload() {
  const result = await uploadMedia(props.projectRoot)
  if ("canceled" in result) return
  await refresh()
}

async function handleDelete(ids: string[]) {
  if (!ids.length) return
  for (const id of ids) {
    await deleteMedia(props.projectRoot, id)
  }
  rowSelection.value = {}
  await refresh()
}

async function handleRename(asset: MediaAsset) {
  const next = window.prompt(m.media_rename_title(), asset.name)
  if (!next || next.trim() === asset.name) return
  await renameMedia(props.projectRoot, asset.id, next.trim())
  await refresh()
}

async function onMediaMenuAction(id: string, asset: MediaAsset) {
  if (id === "open") {
    selectedAssetId.value = asset.id
    return
  }
  if (id === "rename") {
    await handleRename(asset)
    return
  }
  if (id === "duplicate") {
    await duplicateMedia(props.projectRoot, asset.id)
    await refresh()
    return
  }
  if (id === "reveal") {
    await revealMedia(props.projectRoot, asset.id)
    return
  }
  if (id === "copy-path") {
    const resolved = await resolveMedia(props.projectRoot, asset.id)
    await writeClipboardText(resolved.path)
    return
  }
  if (id.startsWith("move-group:")) {
    const groupId = id.slice("move-group:".length) || undefined
    await grouping.moveMediaToGroup(asset.id, groupId)
    return
  }
  if (id === "delete") {
    await handleDelete([asset.id])
  }
}

function resolveDragSourceElement(event: DragEvent): HTMLElement | null {
  const current = event.currentTarget
  if (!(current instanceof HTMLElement)) return null
  if (viewMode.value === "table") {
    const row = current.closest('tr[data-slot="table-row"]')
    if (row instanceof HTMLElement) return row
  }
  return current
}

function handleOrganizerDragEnd(event: DragEvent): void {
  if (!dragState.wasOrganizerDropCommitted()) {
    const commit = getOrganizerDropCommit(event.clientX, event.clientY)
    if (commit) {
      dragState.markOrganizerDropCommitted()
      void grouping.moveMediaItemsToGroup(commit.itemIds, commit.groupId)
    }
  }
  dragState.scheduleEndDrag()
}

function handleDragStart(assetId: string, event: DragEvent): void {
  const ids =
    viewMode.value === "table"
      ? resolveBulkTargets(assetId, selectedIds.value)
      : [assetId]

  dragState.startDrag(assetId, ids)
  event.dataTransfer?.setData("text/plain", assetId)
  if (ids.length > 1) {
    event.dataTransfer?.setData(ORGANIZER_DRAG_IDS_MIME, JSON.stringify(ids))
  }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move"
  }

  const dragOptions = {
    itemCount: ids.length,
    source: resolveDragSourceElement(event),
    compactLabel:
      ids.length > 1
        ? `${ids.length} files`
        : (assets.value.find((a) => a.id === assetId)?.name ?? assetId),
    onDragEnd: handleOrganizerDragEnd,
  }

  if (viewMode.value === "table") {
    beginOrganizerListRowDrag(event, dragOptions)
    return
  }
  beginOrganizerGridCardDrag(event, dragOptions)
}

function menuItemsFor(asset: MediaAsset) {
  return mediaMenuItems(asset, {
    groups: grouping.customGroups.value,
    currentGroupId: explicitGroupId(asset.id),
  })
}

onMounted(() => {
  void refresh()
  connectGridObserver()
})

const stopProjectChanges = onProjectChange((projectPath, change) => {
  if (projectPath !== props.projectRoot) return
  if (
    change.kind === "asset" ||
    change.path.startsWith("public/") ||
    change.path.startsWith("src/assets/")
  ) {
    void refresh()
  }
})

onUnmounted(() => {
  stopProjectChanges()
  disconnectGridObserver()
})

watch(
  () => props.projectRoot,
  () => {
    selectedAssetId.value = null
    listState.resetGridWindow()
    void refresh()
  },
)

watch(
  [
    viewMode,
    () => listState.gridAssets.value.length > 0,
    () => listState.hasMoreGrid.value,
  ],
  async () => {
    await nextTick()
    connectGridObserver()
  },
)
</script>

<template>
  <MediaDetailSurface
    v-if="selectedAsset?.type === 'image'"
    v-model:full-width="detailFullWidth"
    :asset="selectedAsset"
    :project-root="projectRoot"
    :playback="playback"
    @back="selectedAssetId = null"
    @changed="refresh"
  />

  <StudioPanelShell
    v-else
    :variant="selectedAsset && detailFullWidth ? 'default' : 'rail'"
  >
    <template v-if="!(selectedAsset && detailFullWidth)" #rail>
      <StudioLeftRailReveal>
        <StudioOrganizerRail
          :title="m.media_title()"
          :groups="grouping.customGroups.value"
          :group-counts="groupCounts"
          :all-count="assets.length"
          :active-filter="organizeState.activeFilter.value"
          :can-update-grouping="true"
          :all-label="m.media_sidebar_all()"
          :new-group-label="m.media_sidebar_new_group()"
          :delete-dialog-title="m.media_sidebar_delete_group()"
          :delete-stay-available-message="m.media_sidebar_delete_description()"
          :group-name-placeholder="m.media_sidebar_group_name()"
          :nav-aria-label="m.media_sidebar_groups()"
          :on-move-to-group="
            (id, groupId) => grouping.moveMediaToGroup(id, groupId)
          "
          :on-move-items-to-group="
            (ids, groupId) => grouping.moveMediaItemsToGroup(ids, groupId)
          "
          @select-all="
            () => {
              organizeState.setActiveFilter('all')
              selectedAssetId = null
            }
          "
          @select-group="
            (id) => {
              organizeState.setActiveFilter(toGroupRouteFilter(id))
              selectedAssetId = null
            }
          "
          @create-group="(name) => void grouping.createCustomGroup(name)"
          @rename-group="
            (id, name) => void grouping.renameCustomGroup(id, name)
          "
          @delete-group="(id) => void grouping.deleteCustomGroup(id)"
        />
      </StudioLeftRailReveal>
    </template>

    <MediaDetailSurface
      v-if="selectedAsset"
      embed
      v-model:full-width="detailFullWidth"
      :asset="selectedAsset"
      :project-root="projectRoot"
      :playback="playback"
      @back="selectedAssetId = null"
      @changed="refresh"
    />

    <template v-else>
    <PageHeader
      :title="listState.viewTitle.value"
      :description="m.media_description()"
      class="min-h-22 px-5 py-3"
      entity-label-singular="file"
      :create-label="m.media_upload()"
      hide-search
      @create="handleUpload"
    >
      <template #toolbar>
        <SearchOrBulkToolbar
          :count="selectedIds.length"
          entity-label="file"
          :search-query="listState.searchQuery.value"
          :search-placeholder="m.media_search()"
          :show-duplicate="false"
          :show-bulk="viewMode === 'table'"
          @update:search-query="listState.searchQuery.value = $event"
          @delete="handleDelete(selectedIds)"
        />
        <FilterIconMenu
          :model-value="typeFilter"
          :filters="listState.builtinFilterOptions.value"
          @update:model-value="typeFilter = parseMediaTypeFilter($event)"
        />
        <StudioTableColumnMenu
          v-if="viewMode === 'table'"
          :columns="reorderableColumns"
          :locked-column-ids="['name']"
        />
        <HeaderActionDropdownTooltip
          v-if="viewMode === 'grid'"
          :label="m.media_sort()"
        >
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="headerAction" size="icon-header">
                <AppIcon name="filter" class="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                v-for="option in sortOptions"
                :key="`${option.value.key}-${option.value.direction}`"
                @select="listState.sortBy.value = { ...option.value }"
              >
                {{ option.label }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HeaderActionDropdownTooltip>
        <HeaderActionTooltip
          :label="
            viewMode === 'grid' ? m.media_table_view() : m.media_grid_view()
          "
        >
          <Button
            variant="headerAction"
            size="icon-header"
            @click="viewMode = viewMode === 'grid' ? 'table' : 'grid'"
          >
            <AppIcon
              :name="viewMode === 'grid' ? 'list' : 'grid'"
              class="size-3.5"
            />
          </Button>
        </HeaderActionTooltip>
      </template>
    </PageHeader>

    <div
      ref="scrollRootRef"
      class="min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-y-none"
      style="touch-action: pan-y"
    >
      <SkeletonTable v-if="loading && assets.length === 0" />
      <EmptyState
        v-else-if="error"
        icon="media"
        entity-label="media"
        :title="m.media_title()"
        :description="error"
        hide-action
      />
      <EmptyState
        v-else-if="assets.length === 0"
        icon="media"
        entity-label="media"
        :title="m.media_empty_title()"
        :description="m.media_empty_description()"
        :create-label="m.media_upload()"
        @create="handleUpload"
      />
      <EmptyState
        v-else-if="listState.filteredAssets.value.length === 0"
        icon="media"
        entity-label="media"
        :title="m.media_empty_filtered()"
        :description="m.media_empty_filtered()"
        hide-action
      />

      <template v-else-if="viewMode === 'grid'">
        <div
          :class="[
            usesMasonryGrid ? 'media-masonry' : 'media-standard-grid',
            'px-7 pt-6 pb-6',
          ]"
        >
          <div
            v-for="asset in listState.gridAssets.value"
            :key="asset.id"
            :class="usesMasonryGrid ? 'media-masonry-item' : 'min-w-0'"
          >
            <MediaGridCard
              :asset="asset"
              :project-root="projectRoot"
              :items="menuItemsFor(asset)"
              :masonry="usesMasonryGrid"
              :playback="playback"
              @open="selectedAssetId = asset.id"
              @action="(id) => onMediaMenuAction(id, asset)"
              @drag-start="handleDragStart(asset.id, $event)"
            />
          </div>
        </div>
        <div
          v-if="listState.hasMoreGrid.value"
          ref="gridSentinelRef"
          class="h-10 w-full shrink-0"
          aria-hidden="true"
        />
      </template>

      <div v-else class="rounded-none">
        <StudioTableHeader
          :table="headerTable"
          :get-head-cell-class="() => 'px-5'"
        />
        <Table class="w-full table-fixed border-collapse">
          <StudioTableColGroup :table="headerTable" />
          <TableBody>
            <AppContextMenu
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              :items="menuItemsFor(row.original)"
              @action="(id) => onMediaMenuAction(id, row.original)"
            >
              <TableRow
                draggable="true"
                class="group cursor-pointer border-b border-dashed border-border! transition-all duration-100 hover:bg-sidebar/30 hover:[box-shadow:inset_2px_0_0_0_var(--primary),inset_-2px_0_0_0_var(--primary)] data-[state=selected]:bg-card/50"
                :data-state="row.getIsSelected() ? 'selected' : undefined"
                @click="selectedAssetId = row.original.id"
                @dragstart="handleDragStart(row.original.id, $event)"
              >
                <TableCell
                  v-for="cell in row.getVisibleCells()"
                  :key="cell.id"
                  :data-column-id="cell.column.id"
                  :style="getStudioTableColWidthStyle(cell.column)"
                  :class="
                    cell.column.id === 'cover'
                      ? 'overflow-hidden py-2 text-xs'
                      : 'min-w-0 overflow-hidden px-5 py-3 text-xs'
                  "
                >
                  <FlexRender
                    :render="cell.column.columnDef.cell"
                    :props="cell.getContext()"
                  />
                </TableCell>
              </TableRow>
            </AppContextMenu>
          </TableBody>
        </Table>
      </div>
    </div>

    <InventoryTableFooter
      :meta="footerLabel"
      :current-page="listState.currentPage.value"
      :total-pages="viewMode === 'grid' ? 1 : listState.totalPages.value"
      @update:current-page="listState.currentPage.value = $event"
    />
    </template>
  </StudioPanelShell>
</template>
