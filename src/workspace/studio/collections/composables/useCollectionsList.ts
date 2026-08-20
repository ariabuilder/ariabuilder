import { computed, ref, type ComputedRef, type Ref } from "vue"
import {
  COLLECTION_KINDS,
  type CollectionKind,
} from "../../../../../shared/cms"
import type { AriaCollectionDef } from "@/types/aria"
import { listCmsEntries } from "@/lib/cms"
import { getCollections } from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"
import {
  parseCmsCollectionKindFilter,
  parseCmsCollectionSort,
  type CmsCollectionKindFilter,
  type CmsCollectionSort,
} from "../lib/collectionViewPreferences"

export type CollectionSummary = {
  id: string
  name: string
  label: string
  kind: CollectionKind
  iconName: string | null
  itemCount: number
  countAvailable: boolean
  updatedAt: string
  createdAt: string
  sourceLabel: string
  sourceMode: string
  readOnly: boolean
  cacheState: "fresh" | "stale" | "unavailable"
  canMigrate: boolean
}

export function collectionToSummary(
  collection: AriaCollectionDef,
  itemCount = 0,
): CollectionSummary {
  return {
    id: collection.id,
    name: collection.name,
    label: collection.label,
    kind: collection.kind,
    iconName: collection.icon ?? collection.schema?.icon ?? null,
    itemCount,
    countAvailable: !collection.source?.readOnly || typeof collection.source.entryCount === "number",
    updatedAt: "",
    createdAt: "",
    sourceLabel: collection.source?.label ?? "Aria CMS",
    sourceMode: collection.source?.mode ?? "managed",
    readOnly: collection.source?.readOnly ?? false,
    cacheState: collection.source?.cacheState ?? "fresh",
    canMigrate: collection.capabilities?.migrate ?? false,
  }
}

export interface UseCollectionsListReturn {
  collections: Ref<CollectionSummary[]>
  collectionDefs: Ref<AriaCollectionDef[]>
  searchQuery: Ref<string>
  kindFilter: Ref<CmsCollectionKindFilter>
  sortBy: Ref<CmsCollectionSort>
  isLoading: Ref<boolean>
  loadError: Ref<string | null>
  stats: ComputedRef<{ total: number; items: number }>
  filteredCollections: ComputedRef<CollectionSummary[]>
  filters: ComputedRef<
    Array<{ key: CmsCollectionKindFilter; label: string; count: number }>
  >
  collectionNames: ComputedRef<readonly string[]>
  loadCollections: (options?: { force?: boolean; silent?: boolean }) => Promise<void>
  setKindFilter: (nextFilter: CmsCollectionKindFilter) => void
  setSortBy: (nextSort: CmsCollectionSort) => void
}

export function useCollectionsList(
  projectRoot: Ref<string> | (() => string),
): UseCollectionsListReturn {
  const resolveRoot = () =>
    typeof projectRoot === "function" ? projectRoot() : projectRoot.value

  const collections = ref<CollectionSummary[]>([])
  const collectionDefs = ref<AriaCollectionDef[]>([])
  const searchQuery = ref("")
  const kindFilter = ref<CmsCollectionKindFilter>("all")
  const sortBy = ref<CmsCollectionSort>({ key: "label", direction: "asc" })
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)

  const stats = computed(() => ({
    total: collections.value.length,
    items: collections.value.reduce(
      (sum, collection) => sum + collection.itemCount,
      0,
    ),
  }))

  const filteredCollections = computed(() => {
    const query = searchQuery.value.toLowerCase().trim()
    const activeKind = kindFilter.value

    const result = collections.value.filter((collection) => {
      if (activeKind !== "all" && collection.kind !== activeKind) return false
      if (!query) return true
      return (
        collection.name.toLowerCase().includes(query) ||
        collection.label.toLowerCase().includes(query)
        || collection.sourceLabel.toLowerCase().includes(query)
      )
    })

    const sort = parseCmsCollectionSort(sortBy.value)
    return [...result].sort((a, b) => {
      const direction = sort.direction === "asc" ? 1 : -1
      switch (sort.key) {
        case "itemCount":
          return (a.itemCount - b.itemCount) * direction
        case "kind":
          return a.kind.localeCompare(b.kind) * direction
        case "name":
          return a.name.localeCompare(b.name) * direction
        case "label":
        default:
          return a.label.localeCompare(b.label) * direction
      }
    })
  })

  const filters = computed(() => [
    {
      key: "all" as const,
      label: m.cms_collections_filter_all(),
      count: collections.value.length,
    },
    ...COLLECTION_KINDS.map((kind) => ({
      key: kind,
      label:
        kind === "content"
          ? m.cms_collections_filter_content()
          : kind === "data"
            ? m.cms_collections_filter_data()
            : kind === "config"
              ? m.cms_collections_filter_config()
              : m.cms_collections_filter_tags(),
      count: collections.value.filter((collection) => collection.kind === kind)
        .length,
    })),
  ])

  const collectionNames = computed(() =>
    collections.value.map((collection) => collection.name),
  )

  async function loadCollections(
    options: { force?: boolean; silent?: boolean } = {},
  ): Promise<void> {
    const root = resolveRoot().trim()
    if (!root) {
      collections.value = []
      collectionDefs.value = []
      return
    }

    isLoading.value = !options.silent
    loadError.value = null

    try {
      const state = await getCollections(root)
      collectionDefs.value = state.collections

      const summaries = await Promise.all(
        state.collections.map(async (collection) => {
          let itemCount = 0
          try {
            if (collection.source?.readOnly) return collectionToSummary(collection, collection.source.entryCount ?? 0)
            const listed = await listCmsEntries(root, {
              collectionId: collection.id,
              page: 1,
              limit: 1,
            })
            itemCount = listed.total
          } catch {
            itemCount = 0
          }
          return collectionToSummary(collection, itemCount)
        }),
      )
      collections.value = summaries
    } catch (err) {
      loadError.value =
        err instanceof Error ? err.message : "Failed to load collections"
      if (!options.silent) {
        collections.value = []
        collectionDefs.value = []
      }
    } finally {
      isLoading.value = false
    }
  }

  function setKindFilter(nextFilter: CmsCollectionKindFilter): void {
    kindFilter.value = parseCmsCollectionKindFilter(nextFilter)
  }

  function setSortBy(nextSort: CmsCollectionSort): void {
    sortBy.value = parseCmsCollectionSort(nextSort)
  }

  return {
    collections,
    collectionDefs,
    searchQuery,
    kindFilter,
    sortBy,
    isLoading,
    loadError,
    stats,
    filteredCollections,
    filters,
    collectionNames,
    loadCollections,
    setKindFilter,
    setSortBy,
  }
}
