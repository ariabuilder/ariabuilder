import type { AriaEntryRevision } from "../../../../../shared/cms"

const MAX_ACTIVITY_ITEMS = 5

export interface CmsEntryActivityItem {
  id: string
  userName: string
  action: string
  target: string
  timestamp: string
  createdAt: string
  isHighlighted?: boolean
}

export interface CmsEntryActivityInput {
  revisions?: readonly AriaEntryRevision[]
  targetLabel?: string
  createdAt?: string | null
  createdBy?: string | null
  updatedAt?: string | null
  updatedBy?: string | null
  publishedAt?: string | null
  publishedBy?: string | null
}

function formatActivityTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  const locale =
    typeof document === "undefined"
      ? undefined
      : document.documentElement.lang || undefined
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)
}

function revisionActorName(revision: AriaEntryRevision): string {
  return (
    revision.authorship?.actor?.username?.trim() ||
    revision.actorId.trim() ||
    "System"
  )
}

function revisionMessageToActivity(
  message: string | undefined,
  targetLabel: string,
): { action: string; target?: string } {
  const normalized = (message ?? "").trim().toLowerCase()

  if (normalized.includes("created entry")) {
    return { action: "created", target: targetLabel }
  }
  if (normalized.includes("before published")) {
    return { action: "published", target: targetLabel }
  }
  if (normalized.includes("before archived")) {
    return { action: "archived", target: targetLabel }
  }
  if (normalized.includes("before draft")) {
    return { action: "unpublished", target: targetLabel }
  }
  if (normalized.includes("restored")) {
    return { action: "restored", target: "content" }
  }
  if (normalized.includes("duplicated")) {
    return { action: "duplicated", target: targetLabel }
  }
  if (normalized.includes("before update")) {
    return { action: "updated", target: "content" }
  }

  return { action: "saved", target: "a revision" }
}

function buildRevisionActivityItem(
  revision: AriaEntryRevision,
  targetLabel: string,
): CmsEntryActivityItem {
  const copy = revisionMessageToActivity(revision.message, targetLabel)

  return {
    id: revision.id,
    userName: revisionActorName(revision),
    action: copy.action,
    target: copy.target ?? targetLabel,
    timestamp: formatActivityTimestamp(revision.createdAt),
    createdAt: revision.createdAt,
  }
}

function buildFallbackActivityItems(
  input: CmsEntryActivityInput,
  targetLabel: string,
): CmsEntryActivityItem[] {
  const items: CmsEntryActivityItem[] = []

  if (input.publishedAt) {
    items.push({
      id: `fallback-published:${input.publishedAt}`,
      userName: input.publishedBy?.trim() || "System",
      action: "published",
      target: targetLabel,
      timestamp: formatActivityTimestamp(input.publishedAt),
      createdAt: input.publishedAt,
    })
  }

  if (
    input.updatedAt &&
    input.updatedAt !== input.publishedAt &&
    input.updatedAt !== input.createdAt
  ) {
    items.push({
      id: `fallback-updated:${input.updatedAt}`,
      userName: input.updatedBy?.trim() || "System",
      action: "updated",
      target: "content",
      timestamp: formatActivityTimestamp(input.updatedAt),
      createdAt: input.updatedAt,
    })
  }

  if (input.createdAt) {
    items.push({
      id: `fallback-created:${input.createdAt}`,
      userName: input.createdBy?.trim() || "System",
      action: "created",
      target: targetLabel,
      timestamp: formatActivityTimestamp(input.createdAt),
      createdAt: input.createdAt,
    })
  }

  return items
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_ACTIVITY_ITEMS)
    .map((item, index) => ({
      ...item,
      isHighlighted: index === 0,
    }))
}

export function buildCmsEntryActivityItems(
  input: CmsEntryActivityInput,
): CmsEntryActivityItem[] {
  const targetLabel = input.targetLabel?.trim() || "this entry"
  const revisions = input.revisions ?? []

  if (revisions.length > 0) {
    return [...revisions]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_ACTIVITY_ITEMS)
      .map((revision) => buildRevisionActivityItem(revision, targetLabel))
      .map((item, index) => ({
        ...item,
        isHighlighted: index === 0,
      }))
  }

  return buildFallbackActivityItems(input, targetLabel)
}
