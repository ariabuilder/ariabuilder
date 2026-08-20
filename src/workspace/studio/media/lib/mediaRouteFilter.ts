export type MediaTypeFilter =
  | "all"
  | "image"
  | "video"
  | "audio"
  | "font"
  | "document"
  | "other"

export type MediaRouteFilter = MediaTypeFilter | `group:${string}`

export function toGroupRouteFilter(groupId: string): MediaRouteFilter {
  return `group:${groupId}`
}

export function getGroupIdFromFilter(filter: string): string | null {
  if (!filter.startsWith("group:")) return null
  const id = filter.slice("group:".length).trim()
  return id || null
}

export function parseMediaRouteFilter(value: string): MediaRouteFilter {
  if (value.startsWith("group:")) {
    const id = value.slice("group:".length).trim()
    return id ? `group:${id}` : "all"
  }
  if (
    value === "image" ||
    value === "video" ||
    value === "audio" ||
    value === "font" ||
    value === "document" ||
    value === "other"
  ) {
    return value
  }
  return "all"
}

export function parseMediaTypeFilter(value: string): MediaTypeFilter {
  if (
    value === "image" ||
    value === "video" ||
    value === "audio" ||
    value === "font" ||
    value === "document" ||
    value === "other"
  ) {
    return value
  }
  return "all"
}
