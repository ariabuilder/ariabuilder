import { computed, ref, watch, type ComputedRef, type Ref } from "vue"
import { m } from "@/paraglide/messages.js"
import type { ScanComponent } from "@/workspace/types"
import {
  getGroupIdFromFilter,
  type ComponentsRouteFilter,
} from "../lib/componentsRouteFilter"
import type { GroupedComponentsSection } from "./useComponentGrouping"

export interface ComponentDisplaySection<T> {
  key: string
  label: string
  items: readonly T[]
}

export interface ComponentsFilterOption {
  key: ComponentsRouteFilter
  label: string
  count: number
}

export interface ComponentsFilterMenuSection {
  label: string
  options: ComponentsFilterOption[]
}

export type ComponentsSortKey = "name" | "id" | "category" | "updated"
export type ComponentsSortDirection = "asc" | "desc"
export interface ComponentsSort {
  key: ComponentsSortKey
  direction: ComponentsSortDirection
}

export interface UseComponentsListStateOptions {
  activeFilter: Ref<ComponentsRouteFilter>
  groupedSections: ComputedRef<GroupedComponentsSection<ScanComponent>[]>
  buildEffectiveAssignments: (
    items: readonly ScanComponent[],
  ) => Record<string, string>
  getGroupMemberCount: (
    groupId: string,
    items: readonly ScanComponent[],
  ) => number
  customGroupOptions: ComputedRef<ReadonlyArray<{ id: string; name: string }>>
}

export interface ComponentsListStateReturn {
  searchQuery: Ref<string>
  sortBy: Ref<ComponentsSort>
  currentPage: Ref<number>
  pageSize: number
  filteredComponents: ComputedRef<ScanComponent[]>
  displaySections: ComputedRef<ComponentDisplaySection<ScanComponent>[]>
  tableData: ComputedRef<ScanComponent[]>
  isSectionedView: ComputedRef<boolean>
  showPagination: ComputedRef<boolean>
  paginatedComponents: ComputedRef<ScanComponent[]>
  totalPages: ComputedRef<number>
  builtinFilterOptions: ComputedRef<ComponentsFilterOption[]>
  groupFilterSections: ComputedRef<ComponentsFilterMenuSection[]>
  activeFilterLabel: ComputedRef<string>
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase()
}

function includesSearch(component: ScanComponent, query: string): boolean {
  const haystack = [
    component.id,
    component.name,
    component.file,
    component.category,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()
  return haystack.includes(query)
}

function compareText(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return (left || "").localeCompare(right || "")
}

function compareComponents(
  left: ScanComponent,
  right: ScanComponent,
  sort: ComponentsSort,
): number {
  const multiplier = sort.direction === "asc" ? 1 : -1
  let result = 0

  if (sort.key === "id") {
    result = compareText(left.id, right.id)
  } else if (sort.key === "category") {
    result = compareText(
      left.category || "Uncategorized",
      right.category || "Uncategorized",
    )
  } else if (sort.key === "updated") {
    result = left.mtimeMs - right.mtimeMs
  } else {
    result = compareText(left.name || left.id, right.name || right.id)
  }

  return result === 0
    ? compareText(left.name || left.id, right.name || right.id)
    : result * multiplier
}

export function useComponentsListState(
  components: Ref<readonly ScanComponent[]> | ComputedRef<readonly ScanComponent[]>,
  options: UseComponentsListStateOptions,
  initialPageSize = 24,
): ComponentsListStateReturn {
  const searchQuery = ref("")
  const sortBy = ref<ComponentsSort>({ key: "name", direction: "asc" })
  const currentPage = ref(1)
  const pageSize = initialPageSize

  const isGroupFilter = computed(
    () => getGroupIdFromFilter(options.activeFilter.value) !== null,
  )

  const isSectionedView = computed(
    () => options.activeFilter.value === "all",
  )

  const filteredComponents = computed<ScanComponent[]>(() => {
    const filter = options.activeFilter.value
    const groupId = getGroupIdFromFilter(filter)
    const query = normalizeSearchQuery(searchQuery.value)
    const source = components.value
    const effectiveAssignments = options.buildEffectiveAssignments(source)

    return source
      .filter((component) => {
        if (!groupId) return true
        return effectiveAssignments[component.id] === groupId
      })
      .filter((component) => {
        if (!query) return true
        return includesSearch(component, query)
      })
      .slice()
      .sort((left, right) => compareComponents(left, right, sortBy.value))
  })

  const displaySections = computed<
    ComponentDisplaySection<ScanComponent>[]
  >(() => {
    if (!isSectionedView.value) {
      if (filteredComponents.value.length === 0) {
        return []
      }
      return [
        {
          key: "flat",
          label: "",
          items: filteredComponents.value,
        },
      ]
    }

    const allowedIds = new Set(
      filteredComponents.value.map((component) => component.id),
    )

    const sections = options.groupedSections.value
      .map((section) => ({
        key: section.key,
        label: section.name,
        items: section.items
          .filter((item) => allowedIds.has(item.id))
          .slice()
          .sort((left, right) =>
            compareComponents(left, right, sortBy.value),
          ),
      }))
      .filter((section) => section.items.length > 0)

    if (sections.length === 0 && filteredComponents.value.length > 0) {
      return [
        {
          key: "flat",
          label: "",
          items: filteredComponents.value,
        },
      ]
    }

    return sections
  })

  const showPagination = computed(() => isGroupFilter.value)

  const totalPages = computed<number>(() => {
    if (!showPagination.value) {
      return 1
    }
    return Math.max(1, Math.ceil(filteredComponents.value.length / pageSize))
  })

  const paginatedComponents = computed<ScanComponent[]>(() => {
    if (!showPagination.value) {
      return filteredComponents.value
    }
    const start = (currentPage.value - 1) * pageSize
    return filteredComponents.value.slice(start, start + pageSize)
  })

  const tableData = computed<ScanComponent[]>(() => {
    if (isSectionedView.value) {
      return filteredComponents.value
    }
    return paginatedComponents.value
  })

  const builtinFilterOptions = computed<ComponentsFilterOption[]>(() => [
    {
      key: "all",
      label: m.components_sidebar_all(),
      count: components.value.length,
    },
  ])

  const groupFilterSections = computed<ComponentsFilterMenuSection[]>(() => {
    const groups = options.customGroupOptions.value
    if (groups.length === 0) {
      return []
    }

    const optionsList = groups.map((group) => ({
      key: `group:${group.id}` as ComponentsRouteFilter,
      label: group.name,
      count: options.getGroupMemberCount(group.id, components.value),
    }))

    return [{ label: m.components_sidebar_groups(), options: optionsList }]
  })

  const activeFilterLabel = computed(() => {
    const filter = options.activeFilter.value
    const groupId = getGroupIdFromFilter(filter)
    if (groupId) {
      const group = options.customGroupOptions.value.find(
        (item) => item.id === groupId,
      )
      return group?.name ?? m.components_title()
    }
    return (
      builtinFilterOptions.value.find((item) => item.key === filter)?.label ??
      m.components_title()
    )
  })

  watch([searchQuery, () => options.activeFilter.value], () => {
    currentPage.value = 1
  })

  watch(totalPages, (nextTotalPages) => {
    if (currentPage.value > nextTotalPages) {
      currentPage.value = nextTotalPages
    }
  })

  return {
    searchQuery,
    sortBy,
    currentPage,
    pageSize,
    filteredComponents,
    displaySections,
    tableData,
    isSectionedView,
    showPagination,
    paginatedComponents,
    totalPages,
    builtinFilterOptions,
    groupFilterSections,
    activeFilterLabel,
  }
}
