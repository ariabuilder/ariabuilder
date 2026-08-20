import type { AriaEntryRecord } from "../../../../../shared/cms"
import { getCmsEntry } from "@/lib/cms"

export function cmsEntryLabel(entry: {
  id: string
  title?: string | null
  slug?: string | null
}): string {
  const title = entry.title?.trim()
  if (title) return title
  const slug = entry.slug?.trim()
  if (slug) return slug
  return entry.id
}

export function cmsEntryLabelFromRecord(record: AriaEntryRecord): string {
  const locale =
    record.locales.find((item) => item.isSource) ?? record.locales[0]
  return cmsEntryLabel({
    id: record.entry.id,
    title: locale?.title,
    slug: locale?.slug,
  })
}

export async function resolveCmsEntryLabels(
  projectRoot: string,
  collectionId: string,
  entryIds: readonly string[],
): Promise<Record<string, string>> {
  const uniqueIds = [
    ...new Set(entryIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  ]
  if (!projectRoot.trim() || !collectionId.trim() || uniqueIds.length === 0) {
    return {}
  }

  const labels: Record<string, string> = {}
  await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const record = await getCmsEntry(projectRoot, collectionId, id)
        if (!record) return
        labels[id] = cmsEntryLabelFromRecord(record)
      } catch {
        // Leave unresolved so the UI can keep showing the stored id.
      }
    }),
  )
  return labels
}
