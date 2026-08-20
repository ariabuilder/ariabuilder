import { computed, ref, watch, type Ref } from "vue"
import { listExternalEntries } from "@/lib/workspace"
import type {
  ExternalCollectionEntry,
  ExternalEntryIssue,
  ExternalEntrySort,
  ExternalFieldDescriptor,
} from "../../../../../shared/types"

const DEFAULT_LIMIT = 50

export function useExternalEntriesList(
  projectRoot: Ref<string>,
  collectionId: Ref<string>,
  enabled: Readonly<Ref<boolean>>,
) {
  const rows = ref<ExternalCollectionEntry[]>([])
  const fields = ref<ExternalFieldDescriptor[]>([])
  const issues = ref<ExternalEntryIssue[]>([])
  const total = ref(0)
  const filteredTotal = ref(0)
  const scannedTotal = ref(0)
  const page = ref(1)
  const limit = ref(DEFAULT_LIMIT)
  const searchQuery = ref("")
  const sort = ref<ExternalEntrySort | undefined>()
  const truncated = ref(false)
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)

  const totalPages = computed(() =>
    Math.max(1, Math.ceil(filteredTotal.value / limit.value)),
  )

  async function loadEntries(options: { silent?: boolean } = {}): Promise<void> {
    if (!enabled.value) return
    const root = projectRoot.value.trim()
    const id = collectionId.value.trim()
    if (!root || !id) return
    isLoading.value = !options.silent
    loadError.value = null
    try {
      const result = await listExternalEntries(root, {
        collectionId: id,
        query: searchQuery.value.trim() || undefined,
        page: page.value,
        limit: limit.value,
        sort: sort.value,
      })
      rows.value = result.items
      fields.value = result.fields
      issues.value = result.issues ?? []
      total.value = result.total
      filteredTotal.value = result.filteredTotal
      scannedTotal.value = result.scannedTotal
      page.value = result.page
      limit.value = result.limit
      truncated.value = result.truncated
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : "Unable to load entries"
      loadError.value = raw
        .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "")
        .replace(/^Error:\s*/i, "")
      if (!options.silent) {
        rows.value = []
        issues.value = []
      }
    } finally {
      isLoading.value = false
    }
  }

  function setPage(nextPage: number): void {
    page.value = Math.max(1, Math.min(totalPages.value, nextPage))
    void loadEntries()
  }

  function setSort(nextSort?: ExternalEntrySort): void {
    sort.value = nextSort
    page.value = 1
    void loadEntries()
  }

  watch(
    [projectRoot, collectionId, enabled],
    () => {
      page.value = 1
      if (enabled.value) void loadEntries()
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

  return {
    rows,
    fields,
    issues,
    total,
    filteredTotal,
    scannedTotal,
    page,
    limit,
    searchQuery,
    sort,
    truncated,
    isLoading,
    loadError,
    totalPages,
    loadEntries,
    setPage,
    setSort,
  }
}
