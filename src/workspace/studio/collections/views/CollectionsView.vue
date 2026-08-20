<script setup lang="ts">
import { FlexRender } from "@tanstack/vue-table"
import { computed, onMounted, ref, toRef, watch } from "vue"
import { toast } from "vue-sonner"
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
import {
  deleteCmsCollections,
  listCmsEntries,
  seedBlogCms,
} from "@/lib/cms"
import { getCollections } from "@/lib/workspace"
import { confirm } from "@/composables/useConfirm"
import { m } from "@/paraglide/messages.js"
import {
  EmptyState,
  FilterIconMenu,
  HeaderActionDropdownTooltip,
  HeaderActionTooltip,
  PageHeader,
  SearchOrBulkToolbar,
  SkeletonTable,
  StudioTableColGroup,
  StudioTableColumnMenu,
  STUDIO_TABLE_BODY_CELL_CLASS,
  STUDIO_TABLE_INTERACTIVE_ROW_CLASS,
  StudioTableHeader,
  getStudioTableColWidthStyle,
  toStudioTableHeaderTable,
  type StudioTableColumnMenuColumn,
} from "@/workspace/studio/core"
import CmsCollectionGridCard from "../components/CmsCollectionGridCard.vue"
import { useCmsCollectionsTable } from "../composables/useCmsCollectionsTable"
import { useCollectionsList } from "../composables/useCollectionsList"
import CreateCollectionDialog from "../dialogs/CreateCollectionDialog.vue"
import { collectionMenuItems } from "../lib/collectionMenuItems"
import {
  parseCmsCollectionKindFilter,
  parseCmsCollectionSort,
  parseCmsCollectionViewMode,
  type CmsCollectionSort,
  type CmsCollectionViewMode,
} from "../lib/collectionViewPreferences"
import type { CmsNav } from "../CollectionsSurface.vue"

defineOptions({ name: "CollectionsView" })

const VIEW_MODE_KEY = "aria:cms:collections:view-mode"
const GRID_SORT_KEY = "aria:cms:collections:grid-sort"

function blogSetupDoneKey(projectRoot: string): string {
  return `aria:cms:blog-setup-done:${projectRoot}`
}

function readBlogSetupDone(projectRoot: string): boolean {
  try {
    return localStorage.getItem(blogSetupDoneKey(projectRoot)) === "1"
  } catch {
    return false
  }
}

function writeBlogSetupDone(projectRoot: string): void {
  try {
    localStorage.setItem(blogSetupDoneKey(projectRoot), "1")
  } catch {
    // ignore quota / private-mode failures
  }
}

const props = defineProps<{
  projectRoot: string
  navigate: (nav: CmsNav) => void
}>()

const projectRootRef = toRef(props, "projectRoot")

const {
  searchQuery,
  stats,
  filteredCollections,
  kindFilter,
  sortBy,
  filters,
  isLoading,
  loadError,
  collectionNames,
  loadCollections,
  setKindFilter,
  setSortBy,
} = useCollectionsList(projectRootRef)

try {
  sortBy.value = parseCmsCollectionSort(
    JSON.parse(localStorage.getItem(GRID_SORT_KEY) ?? "null"),
  )
} catch {
  sortBy.value = parseCmsCollectionSort(null)
}

const viewMode = ref<CmsCollectionViewMode>(
  parseCmsCollectionViewMode(localStorage.getItem(VIEW_MODE_KEY)),
)
const createOpen = ref(false)
const isDeleting = ref(false)
const isSeedingBlog = ref(false)
const blogSetupDone = ref(readBlogSetupDone(props.projectRoot))
const collectionsReady = ref(false)

/** Hide once the project has collections/entries, or the user already ran blog setup. */
const showSetupBlogCms = computed(
  () =>
    collectionsReady.value &&
    !blogSetupDone.value &&
    !isLoading.value &&
    stats.value.total === 0 &&
    stats.value.items === 0,
)

const { table, rowSelection } = useCmsCollectionsTable(filteredCollections)

const selectedIds = computed(() =>
  Object.keys(rowSelection.value).filter((id) => rowSelection.value[id]),
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

const sortOptions = computed(() => [
  {
    label: m.cms_collections_sort_name_asc(),
    value: { key: "label", direction: "asc" } as const,
  },
  {
    label: m.cms_collections_sort_name_desc(),
    value: { key: "label", direction: "desc" } as const,
  },
  {
    label: m.cms_collections_sort_slug_asc(),
    value: { key: "name", direction: "asc" } as const,
  },
  {
    label: m.cms_collections_sort_kind_asc(),
    value: { key: "kind", direction: "asc" } as const,
  },
  {
    label: m.cms_collections_sort_most_entries(),
    value: { key: "itemCount", direction: "desc" } as const,
  },
  {
    label: m.cms_collections_sort_fewest_entries(),
    value: { key: "itemCount", direction: "asc" } as const,
  },
])

function openCollection(collectionName: string) {
  props.navigate({
    view: "detail",
    collectionName,
    tab: "entries",
  })
}

function handleSearch(value: string) {
  searchQuery.value = value
}

function handleFilter(value: string) {
  setKindFilter(parseCmsCollectionKindFilter(value))
}

function handleSort(nextSort: CmsCollectionSort) {
  setSortBy(nextSort)
  localStorage.setItem(GRID_SORT_KEY, JSON.stringify(nextSort))
}

function toggleView() {
  viewMode.value = viewMode.value === "table" ? "grid" : "table"
  localStorage.setItem(VIEW_MODE_KEY, viewMode.value)
}

function onColumnReorder(columns: StudioTableColumnMenuColumn[]) {
  const newOrder = columns
    .map((column) => column.id)
    .filter((id): id is string => Boolean(id))
  table.setColumnOrder(["select", ...newOrder])
}

async function copyCollectionId(id: string) {
  await writeClipboardText(id)
  toast.success("Collection ID copied")
}

function resolveBulkTargets(
  singleId: string | undefined,
  selected: readonly string[],
): string[] {
  if (singleId) {
    if (selected.length > 1 && selected.includes(singleId)) {
      return [...selected]
    }
    return [singleId]
  }
  return selected.length > 0 ? [...selected] : []
}

async function deleteCollections(ids: string[]) {
  if (ids.length === 0 || isDeleting.value) return
  let entryCount = 0
  try {
    const counts = await Promise.all(
      ids.map((collectionId) =>
        listCmsEntries(props.projectRoot, {
          collectionId,
          page: 1,
          limit: 1,
        }).then((result) => result.total),
      ),
    )
    entryCount = counts.reduce((total, count) => total + count, 0)
  } catch (err) {
    console.error(err)
    toast.error(m.cms_collections_delete_contents_failed())
    return
  }
  const ok = await confirm({
    title:
      ids.length > 1
        ? m.cms_collections_delete_selected_title()
        : m.cms_collections_delete_one(),
    description:
      entryCount === 0
        ? ids.length > 1
          ? m.cms_collections_delete_empty_many_description({
              collectionCount: String(ids.length),
            })
          : m.cms_collections_delete_empty_one_description()
        : ids.length > 1
          ? m.cms_collections_delete_with_entries_many_description({
              collectionCount: String(ids.length),
              entryCount: String(entryCount),
            })
          : entryCount === 1
            ? m.cms_collections_delete_with_one_entry_description()
            : m.cms_collections_delete_with_entries_one_description({
                entryCount: String(entryCount),
              }),
    confirmLabel:
      entryCount > 0
        ? ids.length > 1
          ? m.cms_collections_delete_many_with_entries()
          : m.cms_collections_delete_one_with_entries()
        : ids.length > 1
          ? m.cms_collections_delete_many()
          : m.cms_collections_delete_one(),
    destructive: true,
  })
  if (!ok) return

  isDeleting.value = true
  try {
    const state = await getCollections(props.projectRoot)
    if (!state.revision) throw new Error("Collection revision is unavailable")
    await deleteCmsCollections(props.projectRoot, ids, state.revision, {
      deleteEntries: entryCount > 0,
    })
    rowSelection.value = {}
    await loadCollections({ force: true })
    toast.success(
      ids.length === 1
        ? m.cms_collections_deleted_one()
        : m.cms_collections_deleted_many({ count: String(ids.length) }),
    )
  } catch (err) {
    console.error(err)
    toast.error(m.cms_collections_delete_failed())
  } finally {
    isDeleting.value = false
  }
}

async function onCollectionMenu(
  id: string,
  collectionName: string,
  actionId: string,
) {
  switch (actionId) {
    case "open":
      openCollection(collectionName)
      break
    case "copy-id":
      await copyCollectionId(id)
      break
    case "delete":
      await deleteCollections(resolveBulkTargets(id, selectedIds.value))
      break
  }
}

async function setupBlogCms() {
  if (isSeedingBlog.value) return
  isSeedingBlog.value = true
  try {
    const result = await seedBlogCms(props.projectRoot)
    blogSetupDone.value = true
    writeBlogSetupDone(props.projectRoot)
    await loadCollections({ force: true })
    toast.success(
      result.collections === 0 && result.entries === 0
        ? "Blog CMS already set up"
        : `Blog CMS ready — ${result.collections} collection${result.collections === 1 ? "" : "s"}, ${result.entries} entr${result.entries === 1 ? "y" : "ies"}`,
    )
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : "Failed to set up blog CMS",
    )
  } finally {
    isSeedingBlog.value = false
  }
}

onMounted(async () => {
  await loadCollections()
  collectionsReady.value = true
})

watch(
  () => props.projectRoot,
  async (root) => {
    collectionsReady.value = false
    blogSetupDone.value = readBlogSetupDone(root)
    await loadCollections({ force: true })
    collectionsReady.value = true
  },
)
</script>

<template>
  <div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <PageHeader
      :title="m.cms_collections_title()"
      :description="m.cms_collections_description()"
      class="min-h-[5.5rem] px-5 py-3"
      :search-query="searchQuery"
      entity-label-singular="collection"
      :hide-create="true"
      @update:search-query="handleSearch"
      @create="createOpen = true"
    >
      <template #search>
        <SearchOrBulkToolbar
          :count="selectedIds.length"
          entity-label="collection"
          :search-query="searchQuery"
          :search-placeholder="m.cms_collections_search()"
          :show-bulk="viewMode === 'table'"
          :show-duplicate="false"
          @update:search-query="handleSearch"
          @delete="deleteCollections(resolveBulkTargets(undefined, selectedIds))"
        />
      </template>
      <template #toolbar>
        <FilterIconMenu
          :model-value="kindFilter"
          :filters="filters"
          @update:model-value="handleFilter"
        />
        <HeaderActionDropdownTooltip
          v-if="viewMode === 'grid'"
          :label="m.cms_sort()"
        >
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="headerAction" size="icon-header">
                <AppIcon name="sort" :size="14" class="shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-40">
              <DropdownMenuItem
                v-for="option in sortOptions"
                :key="`${option.value.key}:${option.value.direction}`"
                class="cursor-pointer text-xs"
                @select.prevent="handleSort(option.value)"
              >
                <AppIcon
                  v-if="
                    option.value.key === sortBy.key &&
                    option.value.direction === sortBy.direction
                  "
                  name="check"
                  :size="14"
                  class="mr-1.5 text-primary"
                />
                <span v-else class="mr-1.5 w-3.5" />
                {{ option.label }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HeaderActionDropdownTooltip>
        <StudioTableColumnMenu
          v-if="viewMode === 'table'"
          :columns="reorderableColumns"
          @reorder="onColumnReorder"
        />
        <HeaderActionTooltip
          :label="
            viewMode === 'table' ? m.cms_grid_view() : m.cms_table_view()
          "
        >
          <Button variant="headerAction" size="icon-header" @click="toggleView">
            <AppIcon
              :name="viewMode === 'grid' ? 'list' : 'grid'"
              :size="14"
              class="shrink-0"
            />
          </Button>
        </HeaderActionTooltip>
      </template>
      <template #actions>
        <Button
          v-if="showSetupBlogCms"
          variant="outline"
          size="md"
          :disabled="isSeedingBlog"
          @click="setupBlogCms"
        >
          {{ isSeedingBlog ? "Setting up…" : "Set up blog CMS" }}
        </Button>
        <Button variant="default" size="md" @click="createOpen = true">
          {{ m.cms_collections_new() }}
        </Button>
      </template>
    </PageHeader>

    <div class="page-card-enter min-h-0 flex-1 overflow-auto">
      <div
        v-if="loadError"
        class="mx-7 my-4 rounded-sm border border-destructive/20 bg-destructive/10 p-4"
      >
        <p class="text-2xs text-destructive select-none">{{ loadError }}</p>
      </div>

      <SkeletonTable v-if="isLoading" />

      <EmptyState
        v-else-if="filteredCollections.length === 0"
        icon="collections"
        entity-label="collection"
        :title="
          searchQuery || kindFilter !== 'all'
            ? m.cms_collections_empty_filtered()
            : m.cms_collections_empty()
        "
        :description="
          searchQuery || kindFilter !== 'all'
            ? ' '
            : showSetupBlogCms
              ? 'Create a collection or set up a starter blog CMS.'
              : 'Create a collection to get started.'
        "
        :create-label="m.cms_collections_create_first()"
        :hide-action="true"
      >
        <template
          v-if="!searchQuery && kindFilter === 'all'"
          #actions
        >
          <Button
            v-if="showSetupBlogCms"
            variant="outline"
            size="sm"
            :disabled="isSeedingBlog"
            @click="setupBlogCms"
          >
            {{ isSeedingBlog ? "Setting up…" : "Set up blog CMS" }}
          </Button>
          <Button size="sm" @click="createOpen = true">
            {{ m.cms_collections_create_first() }}
            <AppIcon name="plusSign" :size="14" class="ml-1.5" />
          </Button>
        </template>
      </EmptyState>

      <div v-else-if="viewMode === 'table'" class="rounded-none">
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
              :items="collectionMenuItems(row.original)"
              @action="onCollectionMenu(row.original.id, row.original.name, $event)"
            >
              <TableRow
                :class="`${STUDIO_TABLE_INTERACTIVE_ROW_CLASS} last:border-b-0`"
                :data-state="row.getIsSelected() ? 'selected' : undefined"
                @click="openCollection(row.original.name)"
              >
                <TableCell
                  v-for="cell in row.getVisibleCells()"
                  :key="cell.id"
                  :data-column-id="cell.column.id"
                  :style="getStudioTableColWidthStyle(cell.column)"
                  :class="STUDIO_TABLE_BODY_CELL_CLASS"
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

      <div
        v-else
        class="grid grid-cols-1 gap-7 p-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
      >
        <AppContextMenu
          v-for="collection in filteredCollections"
          :key="collection.id"
          :items="collectionMenuItems(collection)"
          @action="onCollectionMenu(collection.id, collection.name, $event)"
        >
          <CmsCollectionGridCard
            :collection="collection"
            @open="openCollection"
          />
        </AppContextMenu>
      </div>
    </div>

    <div class="px-7 pb-6 text-xs text-muted-foreground">
      {{ m.cms_collections_footer({ count: stats.total }) }}
    </div>

    <CreateCollectionDialog
      :open="createOpen"
      :project-root="projectRoot"
      :existing-names="collectionNames"
      @update:open="createOpen = $event"
      @created="
        async (created) => {
          await loadCollections({ force: true })
          openCollection(created.name)
        }
      "
    />
  </div>
</template>
