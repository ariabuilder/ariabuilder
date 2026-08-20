import { computed, ref, watch, type ComputedRef, type Ref } from "vue"
import { m } from "@/paraglide/messages.js"
import type { MediaAsset, MediaAssetType } from "@/lib/media"
import {
  getGroupIdFromFilter,
  type MediaRouteFilter,
  type MediaTypeFilter,
} from "../lib/mediaRouteFilter"

export type MediaSortKey = "name" | "uploaded" | "size" | "type"
export type MediaSort = { key: MediaSortKey; direction: "asc" | "desc" }

const GRID_PAGE_SIZE = 48
const TABLE_PAGE_SIZE = 48

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase()
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b)
}

function compareAssets(
  left: MediaAsset,
  right: MediaAsset,
  sort: MediaSort,
): number {
  const mult = sort.direction === "asc" ? 1 : -1
  let result = 0
  if (sort.key === "size") result = left.size - right.size
  else if (sort.key === "uploaded") result = left.mtimeMs - right.mtimeMs
  else if (sort.key === "type") result = compareText(left.type, right.type)
  else result = compareText(left.name, right.name)
  return result === 0 ? compareText(left.name, right.name) : result * mult
}

export function useMediaViewState(
  assets: Ref<readonly MediaAsset[]> | ComputedRef<readonly MediaAsset[]>,
  options: {
    activeFilter: Ref<MediaRouteFilter>
    typeFilter: Ref<MediaTypeFilter>
    buildEffectiveAssignments: (
      items: readonly MediaAsset[],
    ) => Record<string, string>
    getGroupMemberCount: (
      groupId: string,
      items: readonly MediaAsset[],
    ) => number
    customGroupOptions: ComputedRef<ReadonlyArray<{ id: string; name: string }>>
  },
) {
  const searchQuery = ref("")
  const sortBy = ref<MediaSort>({ key: "uploaded", direction: "desc" })
  const currentPage = ref(1)
  const pageSize = TABLE_PAGE_SIZE
  const gridVisibleCount = ref(GRID_PAGE_SIZE)

  const filteredAssets = computed(() => {
    const groupId = getGroupIdFromFilter(options.activeFilter.value)
    const type = options.typeFilter.value
    const query = normalizeSearch(searchQuery.value)
    const assignments = options.buildEffectiveAssignments(assets.value)

    return assets.value
      .filter((asset) => {
        if (groupId) return assignments[asset.id] === groupId
        return true
      })
      .filter((asset) => (type === "all" ? true : asset.type === type))
      .filter((asset) => {
        if (!query) return true
        return [asset.name, asset.id, asset.type, asset.file]
          .join(" ")
          .toLowerCase()
          .includes(query)
      })
      .slice()
      .sort((a, b) => compareAssets(a, b, sortBy.value))
  })

  const totalPages = computed(() =>
    Math.max(1, Math.ceil(filteredAssets.value.length / pageSize)),
  )

  const paginatedAssets = computed(() => {
    const start = (currentPage.value - 1) * pageSize
    return filteredAssets.value.slice(start, start + pageSize)
  })

  const gridAssets = computed(() =>
    filteredAssets.value.slice(0, gridVisibleCount.value),
  )

  const hasMoreGrid = computed(
    () => gridVisibleCount.value < filteredAssets.value.length,
  )

  function loadMoreGrid(): void {
    if (!hasMoreGrid.value) return
    gridVisibleCount.value = Math.min(
      gridVisibleCount.value + GRID_PAGE_SIZE,
      filteredAssets.value.length,
    )
  }

  function resetGridWindow(): void {
    gridVisibleCount.value = GRID_PAGE_SIZE
  }

  const typeCounts = computed(() => {
    const counts: Record<MediaAssetType | "all", number> = {
      all: assets.value.length,
      image: 0,
      video: 0,
      audio: 0,
      font: 0,
      document: 0,
      other: 0,
    }
    for (const asset of assets.value) {
      counts[asset.type] += 1
    }
    return counts
  })

  const builtinFilterOptions = computed(() => {
    const counts = typeCounts.value
    return [
      { key: "all", label: m.media_filter_all(), count: counts.all },
      { key: "image", label: m.media_filter_image(), count: counts.image },
      { key: "video", label: m.media_filter_video(), count: counts.video },
      { key: "audio", label: m.media_filter_audio(), count: counts.audio },
      { key: "font", label: m.media_filter_font(), count: counts.font },
      {
        key: "document",
        label: m.media_filter_document(),
        count: counts.document,
      },
      { key: "other", label: m.media_filter_other(), count: counts.other },
    ]
  })

  const viewTitle = computed(() => {
    const groupId = getGroupIdFromFilter(options.activeFilter.value)
    if (groupId) {
      return (
        options.customGroupOptions.value.find((g) => g.id === groupId)?.name ??
        m.media_all()
      )
    }
    if (options.typeFilter.value !== "all") {
      return (
        builtinFilterOptions.value.find(
          (f) => f.key === options.typeFilter.value,
        )?.label ?? m.media_all()
      )
    }
    return m.media_all()
  })

  watch(
    [
      () => options.activeFilter.value,
      () => options.typeFilter.value,
      searchQuery,
      sortBy,
    ],
    () => {
      currentPage.value = 1
      resetGridWindow()
    },
  )

  return {
    searchQuery,
    sortBy,
    currentPage,
    pageSize,
    filteredAssets,
    paginatedAssets,
    gridAssets,
    hasMoreGrid,
    loadMoreGrid,
    resetGridWindow,
    totalPages,
    builtinFilterOptions,
    viewTitle,
    showPagination: computed(() => filteredAssets.value.length > pageSize),
  }
}
