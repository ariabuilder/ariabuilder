import { computed, ref, watch, type Ref } from "vue"
import {
  getGroupIdFromFilter,
  parseMediaRouteFilter,
  type MediaRouteFilter,
} from "../lib/mediaRouteFilter"

export function useMediaOrganizeState(options: {
  customGroups: Ref<ReadonlyArray<{ id: string; name: string }>>
  hasHydratedFromServer: Ref<boolean>
}) {
  const activeFilter = ref<MediaRouteFilter>("all")

  const activeGroupId = computed(() => {
    const groupId = getGroupIdFromFilter(activeFilter.value)
    if (!groupId) return null
    return options.customGroups.value.some((group) => group.id === groupId)
      ? groupId
      : null
  })

  function setActiveFilter(filter: MediaRouteFilter): void {
    activeFilter.value = parseMediaRouteFilter(filter)
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
      if (!exists) activeFilter.value = "all"
    },
    { flush: "post" },
  )

  return {
    activeFilter,
    activeGroupId,
    setActiveFilter,
  }
}
