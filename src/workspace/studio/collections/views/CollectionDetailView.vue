<script setup lang="ts">
import { FlexRender } from "@tanstack/vue-table"
import { computed, ref, toRef, watch } from "vue"
import { toast } from "vue-sonner"
import AppContextMenu from "@/components/menu/AppContextMenu.vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Badge } from "@/components/ui/badge"
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
import { createCmsEntry } from "@/lib/cms"
import { cancelCollectionRefresh, refreshCollectionSource } from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"
import {
  FilterIconMenu,
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
import type { FieldSchema } from "../../../../../shared/cms"
import type { CollectionMigrationResult } from "../../../../../shared/types"
import CmsEntryGridCard from "../components/CmsEntryGridCard.vue"
import ExternalCollectionEntriesView from "../components/ExternalCollectionEntriesView.vue"
import CollectionSchemaPanel from "../components/CollectionSchemaPanel.vue"
import CollectionSettingsPanel from "../components/CollectionSettingsPanel.vue"
import { useCollectionDetail } from "../composables/useCollectionDetail"
import { useCmsEntriesList } from "../composables/useCmsEntriesList"
import { useCmsEntryActions } from "../composables/useCmsEntryActions"
import { useCmsEntryTable } from "../composables/useCmsEntryTable"
import DeleteCollectionDialog from "../dialogs/DeleteCollectionDialog.vue"
import DeleteEntryDialog from "../dialogs/DeleteEntryDialog.vue"
import ImportMarkdownDialog from "../dialogs/ImportMarkdownDialog.vue"
import MigrateCollectionDialog from "../dialogs/MigrateCollectionDialog.vue"
import { collectionKindIcon } from "../lib/collectionKindOptions"
import { createReadableDraftEntrySlug } from "../lib/draftEntrySlug"
import { entryMenuItems } from "../lib/entryMenuItems"
import type { CmsEntryRow } from "../lib/entryRow"
import {
  parseCmsEntrySort,
  type CmsEntrySort,
} from "../lib/entrySortPreferences"
import {
  parseCmsEntryStatusFilter,
  parseCmsEntryViewMode,
  type CmsEntryViewMode,
} from "../lib/entryViewPreferences"
import type { CmsNav } from "../CollectionsSurface.vue"

defineOptions({ name: "CollectionDetailView" })

const VIEW_MODE_KEY = "aria:cms:entries:view-mode"

const props = defineProps<{
  projectRoot: string
  collectionName: string
  tab: "entries" | "configure"
  navigate: (nav: CmsNav) => void
}>()

const projectRootRef = toRef(props, "projectRoot")
const collectionParam = toRef(props, "collectionName")

const {
  collection,
  isLoading: isCollectionLoading,
  loadError: collectionLoadError,
  loadCollection,
} = useCollectionDetail(projectRootRef, collectionParam)

const collectionId = computed(() => collection.value?.id ?? "")
const isReadOnlySource = computed(() => collection.value?.source?.readOnly ?? false)
const canLoadManagedEntries = computed(
  () => Boolean(collection.value) && !isReadOnlySource.value,
)
const fields = computed(
  () => (collection.value?.schema?.fields ?? []) as FieldSchema[],
)
const supportsCover = computed(() =>
  (collection.value?.supports ?? []).includes("cover"),
)

const {
  rows,
  total,
  page,
  totalPages,
  searchQuery,
  statusFilter,
  statusFilters,
  isLoading: isEntriesLoading,
  loadError: entriesLoadError,
  setPage,
  setStatusFilter,
  setSort,
  loadEntries,
} = useCmsEntriesList(projectRootRef, collectionId, canLoadManagedEntries)

const { table, rowSelection, sorting } = useCmsEntryTable({
  data: rows,
  fields,
  projectRoot: projectRootRef,
  supportsCover,
})
const entryActions = useCmsEntryActions(projectRootRef)

const viewMode = ref<CmsEntryViewMode>(
  parseCmsEntryViewMode(localStorage.getItem(VIEW_MODE_KEY)),
)
const isCreatingEntry = ref(false)
const isDeleteEntryDialogOpen = ref(false)
const entriesPendingDelete = ref<CmsEntryRow[]>([])
const isDeleteCollectionDialogOpen = ref(false)
const importMarkdownOpen = ref(false)
const isRefreshingSource = ref(false)
const refreshError = ref<string | null>(null)
const migrationDialogOpen = ref(false)

const selectedEntryIds = computed(() =>
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

const isLoading = computed(
  () => isCollectionLoading.value || isEntriesLoading.value,
)
const loadError = computed(
  () => collectionLoadError.value ?? entriesLoadError.value,
)

const collectionDisplayLabel = computed(
  () => collection.value?.label ?? props.collectionName,
)
const collectionDisplayName = computed(
  () => collection.value?.name ?? props.collectionName,
)
const collectionDisplayKind = computed(() => collection.value?.kind ?? null)
const sourceLabel = computed(() => collection.value?.source?.label ?? "Aria CMS")

const deleteEntryDialogTitle = computed(() => {
  if (entriesPendingDelete.value.length === 1) {
    return entriesPendingDelete.value[0]?.title || m.cms_entries_untitled()
  }
  return `${entriesPendingDelete.value.length} entries`
})

const sortOptions = computed(() => [
  {
    label: m.cms_entries_sort_recent(),
    value: { key: "updatedAt", direction: "desc" } as const,
  },
  {
    label: m.cms_entries_sort_oldest(),
    value: { key: "updatedAt", direction: "asc" } as const,
  },
  {
    label: m.cms_entries_sort_title_asc(),
    value: { key: "title", direction: "asc" } as const,
  },
  {
    label: m.cms_entries_sort_title_desc(),
    value: { key: "title", direction: "desc" } as const,
  },
  {
    label: m.cms_entries_sort_slug_asc(),
    value: { key: "slug", direction: "asc" } as const,
  },
  {
    label: m.cms_entries_sort_published_newest(),
    value: { key: "publishedAt", direction: "desc" } as const,
  },
])

watch(sorting, (nextSorting) => {
  const first = nextSorting[0]
  if (!first) {
    setSort([{ field: "updatedAt", direction: "desc" }])
    return
  }
  switch (first.id) {
    case "title":
    case "slug":
    case "updatedAt":
    case "publishedAt":
    case "createdAt":
      setSort([
        {
          field: first.id,
          direction: first.desc ? "desc" : "asc",
        },
      ])
      break
  }
})

function navigateToCollections() {
  props.navigate({ view: "list" })
}

function navigateToTab(tab: "entries" | "configure") {
  props.navigate({
    view: "detail",
    collectionName: collectionDisplayName.value,
    tab,
  })
}

function handleBack() {
  if (props.tab === "configure") {
    navigateToTab("entries")
    return
  }
  navigateToCollections()
}

function openEntryEditor(rowId: string) {
  const row = rows.value.find((entry) => entry.id === rowId)
  props.navigate({
    view: "entry",
    collectionName: collectionDisplayName.value,
    entryIdOrSlug: row?.slug ?? rowId,
  })
}

function openExternalEntry(entryId: string) {
  props.navigate({
    view: "external-entry",
    collectionName: collectionDisplayName.value,
    entryId,
  })
}

async function openCreateEntry() {
  const id = collectionId.value
  const name = collection.value?.name
  if (!id || !name || isCreatingEntry.value) return

  isCreatingEntry.value = true
  try {
    const draftSlug = createReadableDraftEntrySlug()
    const record = await createCmsEntry(props.projectRoot, {
      collectionId: id,
      title: "Untitled",
      slug: draftSlug,
      status: "draft",
      frontmatter: {},
      body: [],
    })
    props.navigate({
      view: "entry",
      collectionName: name,
      entryIdOrSlug: record.locales[0]?.slug ?? draftSlug,
    })
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to create entry")
  } finally {
    isCreatingEntry.value = false
  }
}

function toggleView() {
  viewMode.value = viewMode.value === "table" ? "grid" : "table"
  localStorage.setItem(VIEW_MODE_KEY, viewMode.value)
}

function handleSearch(value: string) {
  searchQuery.value = value
}

function handleFilter(value: string) {
  setStatusFilter(parseCmsEntryStatusFilter(value))
}

function handleSort(nextSort: CmsEntrySort) {
  const parsed = parseCmsEntrySort(nextSort)
  table.setSorting([{ id: parsed.key, desc: parsed.direction === "desc" }])
}

function onColumnReorder(columns: StudioTableColumnMenuColumn[]) {
  const newOrder = columns
    .map((column) => column.id)
    .filter((id): id is string => Boolean(id))
  table.setColumnOrder(["select", ...newOrder])
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

function resolveEntryActionTargets(row?: CmsEntryRow): CmsEntryRow[] {
  const ids = resolveBulkTargets(row?.id, selectedEntryIds.value)
  if (ids.length === 0) return []
  const byId = new Map(rows.value.map((entry) => [entry.id, entry]))
  return ids
    .map((id) => byId.get(id))
    .filter((entry): entry is CmsEntryRow => Boolean(entry))
}

async function refreshEntries() {
  await loadEntries({ force: true })
  await loadCollection({ force: true, silent: true })
}

async function handleCollectionMigrated(result: CollectionMigrationResult) {
  try {
    await loadCollection({ force: true })
    props.navigate({
      view: "detail",
      collectionName: result.collectionName,
      tab: "entries",
    })
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The collection migrated, but Aria could not open it.")
  }
}

async function copyEntryId(id: string) {
  await writeClipboardText(id)
  toast.success("Entry ID copied")
}

async function publishEntries(row?: CmsEntryRow) {
  const targets = resolveEntryActionTargets(row)
  if (targets.length === 0) return
  await entryActions.publishEntries(targets, async () => {
    rowSelection.value = {}
    await refreshEntries()
  })
}

async function unpublishEntries(row?: CmsEntryRow) {
  const targets = resolveEntryActionTargets(row)
  if (targets.length === 0) return
  await entryActions.unpublishEntries(targets, async () => {
    rowSelection.value = {}
    await refreshEntries()
  })
}

async function archiveEntries(row?: CmsEntryRow) {
  const targets = resolveEntryActionTargets(row)
  if (targets.length === 0) return
  await entryActions.archiveEntries(targets, async () => {
    rowSelection.value = {}
    await refreshEntries()
  })
}

async function duplicateEntries(row?: CmsEntryRow) {
  const targets = resolveEntryActionTargets(row)
  if (targets.length === 0) return
  await entryActions.duplicateEntries(targets, async () => {
    rowSelection.value = {}
    await refreshEntries()
  })
}

function requestDeleteEntries(row?: CmsEntryRow) {
  const targets = resolveEntryActionTargets(row)
  if (targets.length === 0) return
  entriesPendingDelete.value = targets
  isDeleteEntryDialogOpen.value = true
}

function handleDeleteEntryDialogOpen(value: boolean) {
  isDeleteEntryDialogOpen.value = value
  if (!value) entriesPendingDelete.value = []
}

async function confirmDeleteEntries() {
  const targets = entriesPendingDelete.value
  if (targets.length === 0) return
  await entryActions.deleteEntries(targets, async () => {
    rowSelection.value = {}
    await refreshEntries()
  })
  handleDeleteEntryDialogOpen(false)
}

async function onEntryMenu(entry: CmsEntryRow, actionId: string) {
  switch (actionId) {
    case "open":
      openEntryEditor(entry.id)
      break
    case "duplicate":
      await duplicateEntries(entry)
      break
    case "publish":
      await publishEntries(entry)
      break
    case "unpublish":
      await unpublishEntries(entry)
      break
    case "archive":
      await archiveEntries(entry)
      break
    case "copy-id":
      await copyEntryId(entry.id)
      break
    case "delete":
      requestDeleteEntries(entry)
      break
  }
}

function handleCollectionConfigured() {
  void loadCollection({ force: true })
}

async function refreshReadOnlySource() {
  if (!collection.value || isRefreshingSource.value) return
  isRefreshingSource.value = true
  refreshError.value = null
  try {
    await refreshCollectionSource(props.projectRoot, collection.value.id)
    await loadCollection({ force: true })
    toast.success("Collection refreshed from source")
  } catch (error) {
    refreshError.value = error instanceof Error ? error.message : "Collection refresh failed"
  } finally {
    isRefreshingSource.value = false
  }
}

async function cancelReadOnlyRefresh() {
  if (!collection.value) return
  await cancelCollectionRefresh(props.projectRoot, collection.value.id)
}

function handleCollectionDeleted() {
  props.navigate({ view: "list" })
}
</script>

<template>
  <div
    class="flex h-full min-w-0 w-full max-w-full flex-col overflow-hidden bg-background [contain:inline-size]"
  >
    <header
      class="flex min-w-0 w-full max-w-full items-center justify-between px-3 pt-3 pb-3 shrink-0 max-[40rem]:flex-col max-[40rem]:items-stretch max-[40rem]:gap-3"
    >
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          data-testid="collection-detail-back"
          @click="handleBack"
        >
          <AppIcon name="chevronLeft" :size="16" />
        </Button>
        <nav class="flex min-w-0 items-center gap-2 text-sm">
          <button
            type="button"
            class="shrink-0 cursor-pointer text-muted-foreground transition-colors hover:text-primary/80"
            @click="navigateToCollections"
          >
            {{ m.cms_collections_title() }}
          </button>
          <span class="shrink-0 text-muted-foreground/50">/</span>
          <AppIcon
            v-if="collectionDisplayKind"
            :name="collectionKindIcon(collectionDisplayKind)"
            :size="16"
            class="shrink-0 text-muted-foreground"
          />
          <button
            v-if="tab === 'configure'"
            type="button"
            class="min-w-0 cursor-pointer truncate text-muted-foreground transition-colors hover:text-primary/80"
            @click="navigateToTab('entries')"
          >
            {{ collectionDisplayLabel }}
          </button>
          <span v-else class="truncate font-medium text-muted-foreground">
            {{ collectionDisplayLabel }}
          </span>
          <template v-if="tab === 'configure'">
            <span class="shrink-0 text-muted-foreground/50">/</span>
            <span class="truncate font-medium text-muted-foreground">
              {{ m.cms_collections_tab_settings() }}
            </span>
          </template>
        </nav>
      </div>

      <div class="sticky right-7 z-20 ml-auto flex shrink-0 items-center gap-2 max-[40rem]:static max-[40rem]:ml-0 max-[40rem]:grid max-[40rem]:w-full max-[40rem]:grid-cols-2">
        <Button
          variant="outline"
          size="md"
          :class="[
            'max-[40rem]:min-w-0',
            tab === 'entries'
              ? 'bg-transparent! border-primary! text-foreground!'
              : '',
          ]"
          @click="navigateToTab('entries')"
        >
          {{ m.cms_collections_tab_entries() }}
        </Button>
        <Button
          variant="outline"
          size="md"
          :class="[
            'max-[40rem]:min-w-0',
            tab === 'configure'
              ? 'bg-transparent! border-primary! text-foreground!'
              : '',
          ]"
          @click="navigateToTab('configure')"
        >
          {{ m.cms_collections_tab_configure() }}
        </Button>
      </div>
    </header>

    <div
      v-if="isReadOnlySource && collection && tab === 'configure'"
      class="min-h-0 flex-1 overflow-auto"
    >
      <div class="mx-auto w-full max-w-4xl space-y-6 px-7 py-8">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-3xl font-medium tracking-tight">{{ collectionDisplayLabel }}</h1>
              <Badge variant="secondary">{{ sourceLabel }}</Badge>
              <Badge variant="outline">Read-only</Badge>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button v-if="isRefreshingSource" variant="outline" type="button" @click="cancelReadOnlyRefresh">Cancel project refresh</Button>
            <Button v-else-if="collection.capabilities?.refresh" variant="outline" type="button" @click="refreshReadOnlySource">Refresh project sources</Button>
            <Button v-if="collection.capabilities?.migrate" variant="default" type="button" @click="migrationDialogOpen = true">
              Migrate to Aria Collections
            </Button>
          </div>
        </div>

        <p v-if="refreshError" role="alert" class="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {{ refreshError }} The last successful cache is still available.
        </p>

        <section class="space-y-2 rounded-lg border border-border p-5">
          <h2 class="text-sm font-medium">Connected to {{ sourceLabel }}</h2>
          <p class="text-sm text-muted-foreground">
            {{ collection.source?.availabilityReason
              ?? `You can browse this collection in Aria. Editing and publishing remain in ${sourceLabel} until you migrate it.` }}
          </p>
        </section>
      </div>
    </div>

    <div
      v-else-if="isReadOnlySource && collection && tab === 'entries'"
      class="min-h-0 min-w-0 w-full max-w-full flex-1 overflow-hidden [contain:inline-size]"
    >
      <ExternalCollectionEntriesView
        :project-root="projectRoot"
        :collection="collection"
        @open="openExternalEntry"
      />
    </div>

    <div
      v-else-if="tab === 'entries'"
      class="min-h-0 min-w-0 w-full max-w-full flex-1 overflow-hidden [contain:inline-size]"
    >
      <div class="flex h-full min-w-0 w-full max-w-full flex-col overflow-hidden">
        <PageHeader
          class="min-w-0 w-full max-w-full shrink-0 [contain:inline-size]"
          :title="collectionDisplayLabel"
          :search-query="searchQuery"
          entity-label-singular="entry"
          :hide-create="true"
          @update:search-query="handleSearch"
          @create="openCreateEntry"
        >
          <template #title>
            <div class="m-0 flex min-w-0 items-center gap-3">
              <AppIcon
                v-if="collectionDisplayKind"
                :name="collectionKindIcon(collectionDisplayKind)"
                :size="24"
                class="shrink-0 text-muted-foreground"
              />
              <h1
                class="m-0 truncate font-sans text-3xl font-medium tracking-tight"
              >
                {{ collectionDisplayLabel }}
              </h1>
              <Badge
                v-if="collectionDisplayKind"
                variant="secondary"
                class="shrink-0 capitalize"
              >
                {{ collectionDisplayKind }}
              </Badge>
            </div>
          </template>
          <template #description>
            <p class="text-sm text-muted-foreground/60">
              <span>{{ collectionDisplayName }}</span>
            </p>
          </template>
          <template #search>
            <SearchOrBulkToolbar
              :count="selectedEntryIds.length"
              entity-label="entry"
              :search-query="searchQuery"
              :search-placeholder="m.cms_entries_search()"
              @update:search-query="handleSearch"
              @duplicate="duplicateEntries()"
              @delete="requestDeleteEntries()"
            >
              <template #bulk-actions>
                <Button
                  variant="outline"
                  size="sm"
                  class="h-9 text-muted-foreground hover:text-foreground!"
                  :disabled="entryActions.isTransitioning.value"
                  @click="publishEntries()"
                >
                  <AppIcon name="published" :size="12" class="mr-1.5" />
                  {{ m.cms_entries_action_publish() }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="h-9 text-muted-foreground hover:text-foreground!"
                  :disabled="entryActions.isTransitioning.value"
                  @click="unpublishEntries()"
                >
                  <AppIcon name="unpublish" :size="12" class="mr-1.5" />
                  {{ m.cms_entries_action_unpublish() }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="h-9 text-muted-foreground hover:text-foreground!"
                  :disabled="entryActions.isTransitioning.value"
                  @click="archiveEntries()"
                >
                  <AppIcon name="archive" :size="12" class="mr-1.5" />
                  {{ m.cms_entries_action_archive() }}
                </Button>
              </template>
            </SearchOrBulkToolbar>
          </template>
          <template #toolbar>
            <FilterIconMenu
              :model-value="statusFilter"
              :filters="statusFilters"
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
                <DropdownMenuContent align="end" class="w-44">
                  <DropdownMenuItem
                    v-for="option in sortOptions"
                    :key="`${option.value.key}:${option.value.direction}`"
                    class="cursor-pointer text-xs"
                    @select.prevent="handleSort(option.value)"
                  >
                    <AppIcon
                      v-if="
                        table.getState().sorting[0]?.id === option.value.key &&
                        table.getState().sorting[0]?.desc ===
                          (option.value.direction === 'desc')
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
              :locked-column-ids="['title']"
              @reorder="onColumnReorder"
            />
            <HeaderActionTooltip
              :label="
                viewMode === 'table' ? m.cms_grid_view() : m.cms_table_view()
              "
            >
              <Button
                variant="headerAction"
                size="icon-header"
                @click="toggleView"
              >
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
              variant="outline"
              size="md"
              :disabled="!collection"
              @click="importMarkdownOpen = true"
            >
              Import markdown
            </Button>
            <Button
              variant="default"
              size="md"
              :disabled="!collection || isCreatingEntry"
              @click="openCreateEntry"
            >
              {{
                isCreatingEntry
                  ? m.cms_entries_creating()
                  : m.cms_entries_new()
              }}
            </Button>
          </template>
        </PageHeader>

        <div class="min-w-0 w-full max-w-full flex-1 overflow-auto">
          <div
            v-if="loadError"
            class="mx-7 my-4 rounded-sm border border-destructive/20 bg-destructive/10 p-4"
          >
            <p class="text-2xs text-destructive">{{ loadError }}</p>
          </div>

          <div
            v-if="isLoading"
            class="flex flex-col items-center justify-center py-16"
          >
            <p class="text-sm text-muted-foreground">
              {{ m.cms_entries_loading() }}
            </p>
          </div>

          <div
            v-else-if="rows.length === 0"
            class="flex flex-col items-center justify-center py-16"
          >
            <template v-if="searchQuery || statusFilter !== 'all'">
              <AppIcon
                name="pages"
                :size="32"
                class="mb-2 text-muted-foreground"
              />
              <p class="mb-3 text-sm text-muted-foreground">
                {{ m.cms_entries_empty() }}
              </p>
            </template>
            <template v-else>
              <AppIcon
                name="collections"
                :size="32"
                class="mb-2 text-muted-foreground"
              />
              <p class="mb-1 text-sm font-medium text-foreground">
                {{ m.cms_entries_get_started() }}
              </p>
              <p
                class="mb-4 max-w-sm text-center text-sm text-muted-foreground"
              >
                {{ m.cms_entries_get_started_description() }}
              </p>
              <div
                class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center"
              >
                <Button
                  v-if="collection"
                  variant="outline"
                  size="sm"
                  @click="navigateToTab('configure')"
                >
                  {{ m.cms_entries_setup_schema() }}
                </Button>
                <Button
                  v-if="collection"
                  variant="outline"
                  size="sm"
                  @click="importMarkdownOpen = true"
                >
                  Import markdown
                </Button>
                <Button
                  v-if="collection"
                  variant="outline"
                  size="sm"
                  :disabled="isCreatingEntry"
                  @click="openCreateEntry"
                >
                  {{
                    isCreatingEntry
                      ? m.cms_entries_creating()
                      : m.cms_entries_create_entries()
                  }}
                </Button>
              </div>
            </template>
          </div>

          <div
            v-else-if="viewMode === 'table'"
            class="min-w-0 w-full max-w-full overflow-x-auto rounded-none [contain:inline-size]"
          >
            <StudioTableHeader
              :table="headerTable"
              :get-head-cell-class="() => 'px-5'"
            />
            <Table class="w-full min-w-[72rem] table-fixed border-collapse">
              <StudioTableColGroup :table="headerTable" />
              <TableBody>
                <AppContextMenu
                  v-for="row in table.getRowModel().rows"
                  :key="row.id"
                  :items="entryMenuItems(row.original)"
                  @action="onEntryMenu(row.original, $event)"
                >
                  <TableRow
                    :class="STUDIO_TABLE_INTERACTIVE_ROW_CLASS"
                    :data-state="row.getIsSelected() ? 'selected' : undefined"
                    @click="openEntryEditor(row.original.id)"
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
            class="grid min-w-0 grid-cols-1 gap-7 p-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
          >
            <AppContextMenu
              v-for="entry in rows"
              :key="entry.id"
              :items="entryMenuItems(entry)"
              @action="onEntryMenu(entry, $event)"
            >
              <CmsEntryGridCard
                :entry="entry"
                :project-root="projectRoot"
                :cover-supported="supportsCover"
                @open="openEntryEditor"
                @duplicate="duplicateEntries(entry)"
                @publish="publishEntries(entry)"
                @unpublish="unpublishEntries(entry)"
                @archive="archiveEntries(entry)"
                @delete="requestDeleteEntries(entry)"
              />
            </AppContextMenu>
          </div>
        </div>

        <div
          v-if="totalPages > 1"
          class="flex items-center justify-between border-t border-dashed border-border bg-background px-8 py-4 text-2xs text-muted-foreground"
        >
          <span>{{
            m.cms_entries_page_of({ page, total: totalPages })
          }}</span>
          <div class="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="page <= 1"
              @click="setPage(page - 1)"
            >
              {{ m.cms_previous() }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="page >= totalPages"
              @click="setPage(page + 1)"
            >
              {{ m.cms_next() }}
            </Button>
          </div>
        </div>
        <div
          v-else
          class="border-t border-dashed border-border bg-background px-8 py-4 text-2xs text-muted-foreground"
        >
          {{ m.cms_entries_count_in_collection({ count: total }) }}
        </div>
      </div>
    </div>

    <div v-else-if="collection" class="min-h-0 flex-1 overflow-auto">
      <div
        class="mx-auto grid w-full max-w-[85rem] gap-8 px-5 py-6 md:px-7 xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-10"
      >
        <div class="min-w-0 space-y-8">
          <CollectionSettingsPanel
            :collection="collection"
            :project-root="projectRoot"
            embedded
            @updated="handleCollectionConfigured"
            @request-delete="isDeleteCollectionDialogOpen = true"
          />
        </div>
        <aside class="min-w-0 xl:sticky xl:top-6 xl:self-start">
          <CollectionSchemaPanel
            :collection="collection"
            :project-root="projectRoot"
            embedded
            @updated="handleCollectionConfigured"
          />
        </aside>
      </div>
    </div>

    <DeleteEntryDialog
      v-if="!isReadOnlySource"
      :open="isDeleteEntryDialogOpen"
      :title="deleteEntryDialogTitle"
      :count="entriesPendingDelete.length"
      :is-deleting="entryActions.isDeleting.value"
      @update:open="handleDeleteEntryDialogOpen"
      @confirm="confirmDeleteEntries"
    />
    <DeleteCollectionDialog
      v-if="collection && !isReadOnlySource"
      :open="isDeleteCollectionDialogOpen"
      :collection="collection"
      :project-root="projectRoot"
      @update:open="isDeleteCollectionDialogOpen = $event"
      @deleted="handleCollectionDeleted"
    />
    <ImportMarkdownDialog
      v-if="collection && !isReadOnlySource"
      :open="importMarkdownOpen"
      :project-root="projectRoot"
      :collection-id="collection.id"
      :collection-label="collection.label"
      @update:open="importMarkdownOpen = $event"
      @imported="loadEntries({ force: true })"
    />
    <MigrateCollectionDialog
      v-if="collection && isReadOnlySource"
      :open="migrationDialogOpen"
      :project-root="projectRoot"
      :collection-id="collection.id"
      :collection-label="collectionDisplayLabel"
      :source-label="sourceLabel"
      @update:open="migrationDialogOpen = $event"
      @migrated="handleCollectionMigrated"
    />
  </div>
</template>

<style scoped>
:deep(th[data-column-id="select"]),
:deep(td[data-column-id="select"]) {
  width: 40px !important;
  max-width: 40px !important;
  min-width: 40px !important;
  padding-left: 8px !important;
  padding-right: 8px !important;
}
</style>
