import type { AriaEntryRecord, EntryStatus } from "../../../../../shared/cms"

export type CmsEntryRow = {
  id: string
  collectionId: string
  title: string
  slug: string
  status: EntryStatus
  version: string
  locale: string
  frontmatter: Record<string, unknown>
  updatedAt: string
  publishedAt: string | null
  createdAt: string
}

function resolveSourceLocale(record: AriaEntryRecord) {
  return (
    record.locales.find((locale) => locale.isSource) ??
    record.locales[0] ??
    null
  )
}

export function mapEntryRecordToRow(record: AriaEntryRecord): CmsEntryRow {
  const locale = resolveSourceLocale(record)
  if (!locale) {
    throw new Error(`Entry ${record.entry.id} is missing locale data`)
  }

  return {
    id: record.entry.id,
    collectionId: record.entry.collectionId,
    title: locale.title,
    slug: locale.slug,
    status: record.entry.status,
    version: record.entry.version,
    locale: locale.locale,
    frontmatter: locale.frontmatter ?? {},
    updatedAt: record.entry.updatedAt,
    publishedAt: record.entry.publishedAt,
    createdAt: record.entry.createdAt,
  }
}
