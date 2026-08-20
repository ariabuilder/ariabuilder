import {
  computed,
  onActivated,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from "vue"
import {
  ENTRY_STATUSES,
  type EntrySort,
  type EntryStatus,
} from "../../../../../shared/cms"
import { listCmsEntries } from "@/lib/cms"
import { m } from "@/paraglide/messages.js"
import {
  mapEntryRecordToRow,
  type CmsEntryRow,
} from "../lib/entryRow"
import {
  parseCmsEntryStatusFilter,
  type CmsEntryStatusFilter,
} from "../lib/entryViewPreferences"

const DEFAULT_LIMIT = 50

export function useCmsEntriesList(
  projectRoot: Ref<string>,
  collectionId: Ref<string>,
  enabled?: Readonly<Ref<boolean>>,
) {
  const rows = ref<CmsEntryRow[]>([])
  const total = ref(0)
  const page = ref(1)
  const limit = ref(DEFAULT_LIMIT)
  const searchQuery = ref("")
  const statusFilter = ref<CmsEntryStatusFilter>("all")
  const sort = ref<EntrySort[]>([{ field: "updatedAt", direction: "desc" }])
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)

  const totalPages = computed(() =>
    Math.max(1, Math.ceil(total.value / limit.value)),
  )

  const statusFilters = computed(() => {
    const counts = new Map<EntryStatus, number>(
      ENTRY_STATUSES.map((status) => [status, 0]),
    )
    for (const row of rows.value) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
    }

    return [
      {
        key: "all" as const,
        label: m.cms_entries_filter_all(),
        count: total.value,
      },
      ...ENTRY_STATUSES.map((status) => ({
        key: status,
        label:
          status === "draft"
            ? m.cms_status_draft()
            : status === "published"
              ? m.cms_status_published()
              : m.cms_status_archived(),
        count:
          statusFilter.value === status
            ? total.value
            : (counts.get(status) ?? 0),
      })),
    ]
  })

  async function loadEntries(
    options: { force?: boolean; silent?: boolean } = {},
  ): Promise<void> {
    if (enabled?.value === false) {
      rows.value = []
      total.value = 0
      isLoading.value = false
      loadError.value = null
      return
    }
    const id = collectionId.value.trim()
    const root = projectRoot.value.trim()
    if (!id || !root) {
      rows.value = []
      total.value = 0
      return
    }

    isLoading.value = !options.silent
    loadError.value = null

    try {
      const result = await listCmsEntries(root, {
        collectionId: id,
        page: page.value,
        limit: limit.value,
        query: searchQuery.value.trim() || undefined,
        status:
          statusFilter.value === "all"
            ? undefined
            : (statusFilter.value as EntryStatus),
        sort: sort.value,
      })
      rows.value = result.items.map(mapEntryRecordToRow)
      total.value = result.total
      page.value = result.page
      limit.value = result.limit
    } catch (err) {
      loadError.value =
        err instanceof Error ? err.message : "Failed to load entries"
      if (!options.silent) {
        rows.value = []
        total.value = 0
      }
    } finally {
      isLoading.value = false
    }
  }

  function setPage(nextPage: number): void {
    page.value = Math.max(1, nextPage)
    void loadEntries()
  }

  function setStatusFilter(nextFilter: CmsEntryStatusFilter): void {
    statusFilter.value = parseCmsEntryStatusFilter(nextFilter)
  }

  function setSort(nextSort: EntrySort[]): void {
    sort.value = nextSort
    page.value = 1
    void loadEntries()
  }

  watch(
    [projectRoot, collectionId, () => enabled?.value ?? true],
    () => {
      page.value = 1
      void loadEntries()
    },
    { immediate: true },
  )

  let searchDebounce: ReturnType<typeof setTimeout> | undefined
  watch(searchQuery, () => {
    if (searchDebounce) clearTimeout(searchDebounce)
    searchDebounce = setTimeout(() => {
      page.value = 1
      void loadEntries()
    }, 250)
  })

  watch(statusFilter, () => {
    page.value = 1
    void loadEntries()
  })

  let hasActivated = false
  onActivated(() => {
    if (hasActivated) {
      void loadEntries({ force: true, silent: true })
    }
    hasActivated = true
  })

  return {
    rows,
    total,
    page,
    limit,
    searchQuery,
    statusFilter,
    sort,
    isLoading,
    loadError,
    totalPages: totalPages as ComputedRef<number>,
    statusFilters,
    loadEntries,
    setPage,
    setStatusFilter,
    setSort,
  }
}
