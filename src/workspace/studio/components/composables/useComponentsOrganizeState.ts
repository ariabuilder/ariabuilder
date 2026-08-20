import { computed, ref, watch, type Ref } from "vue"
import {
  getGroupIdFromFilter,
  parseComponentsRouteFilter,
  type ComponentsRouteFilter,
} from "../lib/componentsRouteFilter"

export interface UseComponentsOrganizeStateOptions {
  customGroups: Ref<ReadonlyArray<{ id: string; name: string }>>
  hasHydratedFromServer: Ref<boolean>
}

export interface UseComponentsOrganizeStateReturn {
  activeFilter: Ref<ComponentsRouteFilter>
  isGroupFilterActive: Ref<boolean>
  activeGroupId: Ref<string | null>
  setActiveFilter: (filter: ComponentsRouteFilter) => void
}

/**
 * Local (non-URL) organizer filter state for the Components inventory.
 * Invalid group filters fall back to `all` after grouping hydrates.
 */
export function useComponentsOrganizeState(
  options: UseComponentsOrganizeStateOptions,
): UseComponentsOrganizeStateReturn {
  const activeFilter = ref<ComponentsRouteFilter>("all")

  const activeGroupId = computed(() => {
    const groupId = getGroupIdFromFilter(activeFilter.value)
    if (!groupId) return null
    return options.customGroups.value.some((group) => group.id === groupId)
      ? groupId
      : null
  })

  const isGroupFilterActive = computed(() => activeGroupId.value !== null)

  function setActiveFilter(filter: ComponentsRouteFilter): void {
    activeFilter.value = parseComponentsRouteFilter(filter)
  }

  watch(
    [
      activeFilter,
      () => options.customGroups.value,
      () => options.hasHydratedFromServer.value,
    ],
    () => {
      const groupId = getGroupIdFromFilter(activeFilter.value)
      if (!groupId) return
      if (!options.hasHydratedFromServer.value) return
      const exists = options.customGroups.value.some(
        (group) => group.id === groupId,
      )
      if (!exists) {
        activeFilter.value = "all"
      }
    },
    { flush: "post" },
  )

  return {
    activeFilter,
    isGroupFilterActive,
    activeGroupId,
    setActiveFilter,
  }
}
