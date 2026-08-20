/** Title-case a route/file slug for display (e.g. `about-us` → `About Us`). */
export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
}

/** Format a filesystem mtime for studio inventory tables and cards. */
export function formatStudioUpdated(
  mtimeMs: number,
  empty = "—",
): string {
  if (!mtimeMs) return empty
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(mtimeMs))
  } catch {
    return empty
  }
}
