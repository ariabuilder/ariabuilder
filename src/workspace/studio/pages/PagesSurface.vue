<script setup lang="ts">
import { FlexRender } from "@tanstack/vue-table"
import { computed, nextTick, ref, watch } from "vue"
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
  createLayoutPropDrafts,
  loadRequiredLayoutProps,
  pageNameLayoutFallback,
  serializeLayoutPropDrafts,
  type LayoutPropDraftValue,
} from "@/lib/layoutProps"
import {
  createWorkspacePage,
  deleteWorkspacePage,
  getCollections,
  resolveWorkspacePage,
  revealWorkspacePage,
} from "@/lib/workspace"
import { confirm } from "@/composables/useConfirm"
import { guardDirtyNavigation } from "@/workspace/dirtyState"
import { m } from "@/paraglide/messages.js"
import {
  clearPendingPageDetailNavigation,
  usePendingPageDetailNavigation,
} from "@/workspace/globalSearchNavigation"
import {
  EmptyState,
  HeaderActionDropdownTooltip,
  HeaderActionTooltip,
  InventoryTableFooter,
  PageHeader,
  SearchOrBulkToolbar,
  SkeletonTable,
  StudioPanelShell,
  StudioTableColGroup,
  StudioTableColumnMenu,
  StudioTableHeader,
  getStudioTableColWidthStyle,
  toStudioTableHeaderTable,
  type StudioTableColumnMenuColumn,
  StudioNameCreateDialog,
} from "@/workspace/studio/core"
import type { ScanComponent, ScanPage } from "@/workspace/types"
import type { PropField } from "../../../../shared/composer/types"
import { requestComposerDocumentLaunch } from "@/workspace/composer/composerDocumentLaunchRequest"
import { createCmsEntryTemplateLaunch } from "@/workspace/composer/cmsEntryTemplatePreview"
import PageGridCard from "./PageGridCard.vue"
import PageDetailSurface from "./detail/PageDetailSurface.vue"
import { pageMenuItems } from "./pageMenuItems"
import {
  toPagesInventoryRows,
  usePagesTable,
  type PagesTableRow,
} from "./usePagesTable"

const PAGE_SIZE = 25
const VIEW_MODE_KEY = "aria.pages.viewMode"
const GRID_SORT_KEY = "aria.pages.gridSort"

type ViewMode = "table" | "grid"
type PagesSortKey = "updated" | "name" | "route"
type PagesSort = { key: PagesSortKey; direction: "asc" | "desc" }

function readViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY)
    if (stored === "grid" || stored === "table") return stored
  } catch {
    /* ignore */
  }
  return "grid"
}

function parsePagesSort(value: unknown): PagesSort {
  if (
    value &&
    typeof value === "object" &&
    "key" in value &&
    "direction" in value
  ) {
    const key = (value as PagesSort).key
    const direction = (value as PagesSort).direction
    if (
      (key === "updated" || key === "name" || key === "route") &&
      (direction === "asc" || direction === "desc")
    ) {
      return { key, direction }
    }
  }
  return { key: "updated", direction: "desc" }
}

function readGridSort(): PagesSort {
  try {
    return parsePagesSort(JSON.parse(localStorage.getItem(GRID_SORT_KEY) ?? "null"))
  } catch {
    return parsePagesSort(null)
  }
}

function comparePages(a: PagesTableRow, b: PagesTableRow, sort: PagesSort): number {
  let result = 0
  switch (sort.key) {
    case "name":
      result = a.displayName.localeCompare(b.displayName)
      break
    case "route":
      result = a.route.localeCompare(b.route)
      break
    case "updated":
    default:
      result = a.mtimeMs - b.mtimeMs
      break
  }
  return sort.direction === "desc" ? -result : result
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
  pages: ScanPage[]
  layouts?: ScanComponent[]
  loading: boolean
  error: string | null
  selectedRoute: string | null
  projectRoot: string
  /** Local Astro preview base URL when the preview server is live. */
  previewUrl?: string | null
  onSelectRoute: (route: string) => void
  onRefresh: () => Promise<void> | void
}>()

const searchQuery = ref("")
const currentPage = ref(1)
const viewMode = ref<ViewMode>(readViewMode())
const sortBy = ref<PagesSort>(readGridSort())
const createOpen = ref(false)
const createBusy = ref(false)
const createError = ref<string | null>(null)
const createLayoutFile = ref("")
const createLayoutFields = ref<PropField[]>([])
const createLayoutFieldValues = ref<Record<string, LayoutPropDraftValue>>({})
const createLayoutFieldsBusy = ref(false)
const createLayoutFieldsError = ref<string | null>(null)
let layoutFieldsGeneration = 0
const selectedPageFile = ref<string | null>(null)
const pendingPageDetail = usePendingPageDetailNavigation()

const selectedDetailPage = computed(
  () => props.pages.find((page) => page.file === selectedPageFile.value) ?? null,
)

async function openPageDetails(file: string) {
  if (
    selectedPageFile.value &&
    selectedPageFile.value !== file &&
    !(await guardDirtyNavigation(props.projectRoot))
  ) return
  selectedPageFile.value = file
}

async function closePageDetails() {
  const file = selectedPageFile.value
  selectedPageFile.value = null
  await nextTick()
  if (!file) return
  const trigger = [...document.querySelectorAll<HTMLElement>("[data-page-file]")]
    .find((element) => element.dataset.pageFile === file)
  ;(trigger?.matches("button") ? trigger : trigger?.querySelector<HTMLElement>("button"))
    ?.focus({ preventScroll: true })
}

watch(
  [pendingPageDetail, () => props.pages],
  ([file]) => {
    if (!file || !props.pages.some((page) => page.file === file)) return
    openPageDetails(file)
    clearPendingPageDetailNavigation(file)
  },
  { immediate: true },
)

async function openInComposer(route: string) {
  const page = props.pages.find((candidate) => candidate.route === route)
  if (page?.role === "cms-entry") {
    try {
      requestComposerDocumentLaunch(
        await createCmsEntryTemplateLaunch(props.projectRoot, page),
        props.projectRoot,
      )
    } catch (error) {
      toast.error("Could not open entry template", {
        description: error instanceof Error ? error.message : String(error),
      })
      return
    }
  }
  props.onSelectRoute(route)
}

const sortOptions = computed(() => [
  {
    label: m.pages_sort_recently_updated(),
    value: { key: "updated", direction: "desc" } as const,
  },
  {
    label: m.pages_sort_oldest_updated(),
    value: { key: "updated", direction: "asc" } as const,
  },
  {
    label: m.pages_sort_name_asc(),
    value: { key: "name", direction: "asc" } as const,
  },
  {
    label: m.pages_sort_name_desc(),
    value: { key: "name", direction: "desc" } as const,
  },
  {
    label: m.pages_sort_route_asc(),
    value: { key: "route", direction: "asc" } as const,
  },
  {
    label: m.pages_sort_route_desc(),
    value: { key: "route", direction: "desc" } as const,
  },
])

const allRows = computed(() => toPagesInventoryRows(props.pages))

const filteredRows = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const rows = !q
    ? [...allRows.value]
    : allRows.value.filter((row) => {
        return (
          row.displayName.toLowerCase().includes(q) ||
          row.route.toLowerCase().includes(q) ||
          row.file.toLowerCase().includes(q)
        )
      })

  // Grid uses header sort; table sorts via column headers on the page slice.
  if (viewMode.value === "grid") {
    rows.sort((a, b) => comparePages(a, b, sortBy.value))
  }
  return rows
})

const totalPages = computed(() =>
  Math.max(1, Math.ceil(filteredRows.value.length / PAGE_SIZE)),
)

const paginatedRows = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return filteredRows.value.slice(start, start + PAGE_SIZE)
})

watch(searchQuery, () => {
  currentPage.value = 1
})

watch(
  () => props.pages.length,
  () => {
    currentPage.value = 1
  },
)

watch(totalPages, (pages) => {
  if (currentPage.value > pages) {
    currentPage.value = pages
  }
})

const { table, rowSelection } = usePagesTable(paginatedRows)

watch(currentPage, () => {
  rowSelection.value = {}
})

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

const footerMeta = computed(() => {
  const count = filteredRows.value.length
  if (count === 0) return m.pages_footer_count_zero()
  if (count === 1) return m.pages_footer_count_one()
  return m.pages_footer_count({ count })
})

const showEmpty = computed(
  () => !props.loading && filteredRows.value.length === 0,
)

const emptyIsFiltered = computed(
  () => props.pages.length > 0 && filteredRows.value.length === 0,
)

function onColumnReorder(columns: StudioTableColumnMenuColumn[]) {
  const newOrder = columns
    .map((column) => column.id)
    .filter((id): id is string => Boolean(id))
  table.setColumnOrder(["select", ...newOrder])
}

function handleSearch(value: string) {
  searchQuery.value = value
}

function toggleView() {
  viewMode.value = viewMode.value === "table" ? "grid" : "table"
  rowSelection.value = {}
  try {
    localStorage.setItem(VIEW_MODE_KEY, viewMode.value)
  } catch {
    /* ignore */
  }
}

function handleSort(next: PagesSort) {
  sortBy.value = next
  currentPage.value = 1
  try {
    localStorage.setItem(GRID_SORT_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

function isActiveSort(option: PagesSort): boolean {
  return (
    option.key === sortBy.value.key &&
    option.direction === sortBy.value.direction
  )
}

function openCreate() {
  createError.value = null
  createLayoutFile.value = props.layouts?.length === 1 ? props.layouts[0]!.file : ""
  createOpen.value = true
}

const createLayoutOptions = computed(() => [
  { value: "", label: m.pages_create_layout_none() },
  ...(props.layouts ?? []).map((layout) => ({
    value: layout.file,
    label: layout.name,
  })),
])

watch(createLayoutFile, async (file) => {
  const generation = ++layoutFieldsGeneration
  createLayoutFields.value = []
  createLayoutFieldValues.value = {}
  createLayoutFieldsError.value = null
  if (!file) return
  createLayoutFieldsBusy.value = true
  try {
    const fields = await loadRequiredLayoutProps(props.projectRoot, file)
    if (generation !== layoutFieldsGeneration) return
    createLayoutFields.value = fields
    createLayoutFieldValues.value = createLayoutPropDrafts(fields)
    createLayoutFieldsError.value = serializeLayoutPropDrafts(
      fields,
      createLayoutFieldValues.value,
      { allowEmptyStrings: true },
    ).error
  } catch (error) {
    if (generation === layoutFieldsGeneration) {
      createLayoutFieldsError.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (generation === layoutFieldsGeneration) createLayoutFieldsBusy.value = false
  }
})

function updateCreateLayoutField(name: string, value: string | boolean) {
  createLayoutFieldValues.value = {
    ...createLayoutFieldValues.value,
    [name]: value,
  }
  createLayoutFieldsError.value = serializeLayoutPropDrafts(
    createLayoutFields.value,
    createLayoutFieldValues.value,
    { allowEmptyStrings: true },
  ).error
}

async function submitCreate(name: string) {
  createBusy.value = true
  createError.value = null
  try {
    const selectedLayout = (props.layouts ?? []).find(
      (layout) => layout.file === createLayoutFile.value,
    )
    const layoutProps = serializeLayoutPropDrafts(
      createLayoutFields.value,
      createLayoutFieldValues.value,
      { emptyStringFallback: pageNameLayoutFallback(name) },
    )
    if (selectedLayout && layoutProps.error) {
      createError.value = layoutProps.error
      return
    }
    const created = await createWorkspacePage(props.projectRoot, name, {
      layout: selectedLayout
        ? {
            name: selectedLayout.name,
            file: selectedLayout.file,
            props: layoutProps.props,
          }
        : null,
    })
    createOpen.value = false
    await props.onRefresh()
    selectedPageFile.value = created.file
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

function resolveSelectedRows(ids: readonly string[]): PagesTableRow[] {
  const byFile = new Map(allRows.value.map((row) => [row.file, row]))
  return ids
    .map((id) => byFile.get(id))
    .filter((row): row is PagesTableRow => row !== undefined && row.route !== "/")
}

async function confirmDeletePages(rowFile?: string): Promise<void> {
  const ids = resolveBulkTargets(rowFile, selectedIds.value)
  const targets = resolveSelectedRows(ids)
  if (targets.length === 0) return

  let assignmentsByFile: Map<string, string[]>
  try {
    const state = await getCollections(props.projectRoot)
    assignmentsByFile = new Map(targets.map((target) => [target.file, []]))
    for (const collection of state.collections) {
      if (assignmentsByFile.has(collection.listPageFile ?? "")) {
        assignmentsByFile
          .get(collection.listPageFile!)!
          .push(
            m.pages_delete_assignment_list_page({
              collection: collection.label,
            }),
          )
      }
      if (assignmentsByFile.has(collection.templatePageFile ?? "")) {
        assignmentsByFile
          .get(collection.templatePageFile!)!
          .push(
            m.pages_delete_assignment_entry_template({
              collection: collection.label,
            }),
          )
      }
    }
  } catch (err: unknown) {
    console.error(err)
    toast.error(m.pages_delete_assignments_failed())
    return
  }

  const assignments = [...assignmentsByFile.values()].flat()
  const hasAssignments = assignments.length > 0
  let description: string
  if (targets.length > 1) {
    description = hasAssignments
      ? m.pages_delete_assigned_description_many({
          assignmentCount: String(assignments.length),
          pageCount: String(targets.length),
        })
      : m.pages_delete_description_many({ count: String(targets.length) })
  } else if (assignments.length === 1) {
    description = m.pages_delete_assigned_description({
      assignment: assignments[0]!,
    })
  } else if (assignments.length > 1) {
    description = m.pages_delete_assigned_description_multiple({
      assignments: assignments.join(", "),
    })
  } else {
    description = m.pages_delete_confirm_description()
  }

  const ok = await confirm({
    title:
      targets.length > 1
        ? m.pages_delete_title_many()
        : m.pages_delete_confirm_title({ name: targets[0]!.displayName }),
    description,
    confirmLabel: hasAssignments
      ? m.pages_delete_unassign_and_delete()
      : m.confirm_delete(),
    cancelLabel: m.confirm_cancel(),
    destructive: true,
  })
  if (!ok) return

  let succeeded = 0
  let lastError: string | null = null

  for (const target of targets) {
    try {
      await deleteWorkspacePage(props.projectRoot, target.file, {
        unassignCms: (assignmentsByFile.get(target.file)?.length ?? 0) > 0,
      })
      if (selectedPageFile.value === target.file) {
        selectedPageFile.value = null
      }
      succeeded += 1
    } catch (err: unknown) {
      console.error(err)
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  rowSelection.value = {}
  await props.onRefresh()

  if (succeeded === 0) {
    toast.error(m.pages_delete_failed(), {
      description: lastError ?? undefined,
    })
    return
  }

  if (succeeded === 1 && targets.length === 1) {
    toast.success(m.pages_delete_success({ name: targets[0]!.displayName }))
  } else {
    toast.success(m.pages_delete_success_many({ count: String(succeeded) }))
  }

  if (lastError) {
    toast.error(m.pages_delete_failed(), { description: lastError })
  }
}

async function onPageMenuAction(id: string, page: PagesTableRow) {
  switch (id) {
    case "details":
      openPageDetails(page.file)
      break
    case "composer":
    case "select":
      await openInComposer(page.route)
      break
    case "copy-route":
      await copyText(page.route)
      break
    case "copy-path":
      try {
        const resolved = await resolveWorkspacePage(
          props.projectRoot,
          page.file,
        )
        await copyText(resolved.path)
      } catch (err: unknown) {
        console.error(err)
        await copyText(page.file)
      }
      break
    case "reveal":
      try {
        await revealWorkspacePage(props.projectRoot, page.file)
      } catch (err: unknown) {
        console.error(err)
      }
      break
    case "delete": {
      await confirmDeletePages(page.file)
      break
    }
  }
}
</script>

<template>
  <StudioPanelShell class="flex-row">
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <PageHeader
      :title="m.pages_title()"
      :description="m.pages_description()"
      class="min-h-22 px-5 py-3"
      entity-label-singular="page"
      :create-label="m.pages_new()"
      :hide-create="false"
      hide-search
      @create="openCreate"
    >
      <template #toolbar>
        <SearchOrBulkToolbar
          :count="selectedIds.length"
          :entity-label="m.pages_entity()"
          :search-query="searchQuery"
          :search-placeholder="m.pages_search()"
          :show-duplicate="false"
          :show-bulk="viewMode === 'table'"
          @update:search-query="handleSearch"
          @delete="confirmDeletePages()"
        />
        <StudioTableColumnMenu
          v-if="viewMode === 'table'"
          :columns="reorderableColumns"
          :locked-column-ids="['page']"
          @reorder="onColumnReorder"
        />
        <HeaderActionDropdownTooltip
          v-if="viewMode === 'grid'"
          :label="m.pages_sort()"
        >
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="headerAction"
                size="icon-header"
                :aria-label="m.pages_sort()"
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
          :label="
            viewMode === 'table' ? m.pages_grid_view() : m.pages_table_view()
          "
        >
          <Button
            variant="headerAction"
            size="icon-header"
            :aria-label="
              viewMode === 'table' ? m.pages_grid_view() : m.pages_table_view()
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

    <div
      class="min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-y-none"
      style="touch-action: pan-y"
    >
      <SkeletonTable
        v-if="loading && pages.length === 0"
        :rows="5"
        :columns="4"
      />

      <div
        v-else-if="error"
        class="m-5 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm"
      >
        <p class="font-medium text-destructive">Could not read this project</p>
        <p class="mt-1 wrap-break-word text-muted-foreground">{{ error }}</p>
        <Button class="mt-3" variant="outline" size="sm" @click="onRefresh">
          Retry
        </Button>
      </div>

      <EmptyState
        v-else-if="showEmpty"
        icon="pages"
        entity-label="pages"
        entity-label-singular="page"
        :title="
          emptyIsFiltered ? m.studio_no_results() : m.pages_empty_title()
        "
        :description="
          emptyIsFiltered
            ? m.pages_empty_filtered()
            : m.pages_empty_description()
        "
        :hide-action="emptyIsFiltered"
        :create-label="m.pages_new()"
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
            <AppContextMenu
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              :items="pageMenuItems(row.original)"
              @action="(id) => onPageMenuAction(id, row.original)"
            >
              <TableRow
                class="group cursor-pointer border-b border-dashed border-border! transition-all duration-100 hover:bg-sidebar/30 hover:[box-shadow:inset_2px_0_0_0_var(--primary),inset_-2px_0_0_0_var(--primary)] data-[state=selected]:bg-card/50"
                :data-state="
                  row.getIsSelected() || row.original.route === selectedRoute
                    ? 'selected'
                    : undefined
                "
                :data-page-file="row.original.file"
                @click="openPageDetails(row.original.file)"
              >
                <TableCell
                  v-for="cell in row.getVisibleCells()"
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
          </TableBody>
        </Table>
      </div>

      <div
        v-else
        class="grid grid-cols-1 gap-7 p-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
      >
        <PageGridCard
          v-for="row in paginatedRows"
          :key="row.file"
          :page="row"
          :project-path="projectRoot"
          :items="pageMenuItems(row)"
          :preview-base-url="previewUrl"
          :selected="row.route === selectedRoute"
          @open="openPageDetails"
          @edit-in-composer="openInComposer"
          @action="(id) => onPageMenuAction(id, row)"
        />
      </div>
    </div>

    <InventoryTableFooter
      v-if="!loading"
      :meta="footerMeta"
      :current-page="currentPage"
      :total-pages="totalPages"
      @update:current-page="currentPage = $event"
    />

    <StudioNameCreateDialog
      v-model:open="createOpen"
      v-model:choice-model-value="createLayoutFile"
      :busy="createBusy"
      :error="createError"
      :title="m.pages_create_title()"
      :description="m.pages_create_description()"
      :placeholder="m.pages_create_placeholder()"
      :cancel-label="m.pages_create_cancel()"
      :submit-label="m.pages_create_submit()"
      :creating-label="m.pages_create_creating()"
      :choice-label="m.pages_create_layout_label()"
      :choice-options="createLayoutOptions"
      :choice-fields="createLayoutFields"
      :choice-field-values="createLayoutFieldValues"
      :choice-fields-busy="createLayoutFieldsBusy"
      :choice-fields-error="createLayoutFieldsError"
      @update:choice-field-value="updateCreateLayoutField"
      @submit="submitCreate"
    />
    </div>

    <PageDetailSurface
      v-if="selectedDetailPage"
      :key="selectedDetailPage.file"
      :page="selectedDetailPage"
      :project-root="projectRoot"
      @back="closePageDetails"
      @open-composer="openInComposer"
      @saved="onRefresh"
    />
  </StudioPanelShell>
</template>
