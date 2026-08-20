import { formatRelativeTime } from "@/lib/relativeTime"

/** Relative time from an ISO timestamp string. */
export function formatCmsRelativeTime(
  iso: string | null | undefined,
  empty = "—",
): string {
  if (!iso) return empty
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return empty
  return formatRelativeTime(ms) || empty
}
