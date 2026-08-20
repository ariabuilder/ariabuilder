export const COMPONENTS_GROUP_FILTER_PREFIX = "group:" as const

export type ComponentsBuiltinFilter = "all"
export type ComponentsRouteFilter =
  | ComponentsBuiltinFilter
  | `${typeof COMPONENTS_GROUP_FILTER_PREFIX}${string}`

function isGroupFilterString(value: string): value is ComponentsRouteFilter {
  return /^group:[^\s]+$/.test(value)
}

export function parseComponentsRouteFilter(
  raw: unknown,
): ComponentsRouteFilter {
  if (raw === undefined || raw === null || raw === "") {
    return "all"
  }
  if (typeof raw !== "string") {
    return "all"
  }
  if (raw === "all") return "all"
  if (isGroupFilterString(raw)) return raw
  return "all"
}

export function getGroupIdFromFilter(
  filter: ComponentsRouteFilter,
): string | null {
  if (!filter.startsWith(COMPONENTS_GROUP_FILTER_PREFIX)) {
    return null
  }
  const groupId = filter.slice(COMPONENTS_GROUP_FILTER_PREFIX.length)
  return groupId.length > 0 ? groupId : null
}

export function isGroupRouteFilter(
  filter: ComponentsRouteFilter,
): filter is `${typeof COMPONENTS_GROUP_FILTER_PREFIX}${string}` {
  return filter.startsWith(COMPONENTS_GROUP_FILTER_PREFIX)
}

export function toGroupRouteFilter(groupId: string): ComponentsRouteFilter {
  return `${COMPONENTS_GROUP_FILTER_PREFIX}${groupId}`
}
