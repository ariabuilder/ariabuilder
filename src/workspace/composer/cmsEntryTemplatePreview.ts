import { listCmsEntries } from "@/lib/cms"
import { getCollections, listExternalEntries } from "@/lib/workspace"
import type { ScanPage } from "@/workspace/types"
import {
  resolveCmsEntryPreviewRoute,
  type ComposerCmsEntryTemplatePreviewContext,
  type ComposerCmsPreviewEntry,
  type ComposerDocumentLaunchRequest,
} from "../../../shared/composer"

export async function createCmsEntryTemplateLaunch(
  projectPath: string,
  page: ScanPage,
): Promise<Extract<ComposerDocumentLaunchRequest, { mode: "cms-entry-template" }>> {
  const state = await getCollections(projectPath)
  const collection = state.collections.find((candidate) => candidate.templatePageFile === page.file)
  if (!collection) throw new Error("This entry template is not assigned to a collection.")

  let entries: ComposerCmsPreviewEntry[] = []
  if (collection.source && collection.source.kind !== "aria-managed") {
    const result = await listExternalEntries(projectPath, { collectionId: collection.id, limit: 100 })
    entries = result.items.map((entry) => {
      const slug = typeof entry.data.slug === "string" ? entry.data.slug : entry.id
      const locale = typeof entry.data.locale === "string" ? entry.data.locale : entry.locale
      const status = typeof entry.data.status === "string" ? entry.data.status : undefined
      return {
        id: entry.id,
        slug,
        title: typeof entry.data.title === "string" ? entry.data.title : slug,
        ...(status ? { status } : {}),
        ...(locale ? { locale } : {}),
        route: resolveCmsEntryPreviewRoute({
          urlPattern: collection.urlPattern,
          templateRoute: page.route,
          id: entry.id,
          slug,
          locale,
        }),
        version: JSON.stringify([
          entry.id,
          entry.filePath ?? null,
          entry.locale ?? null,
          entry.data,
          entry.body ?? null,
        ]),
      }
    })
  } else {
    const result = await listCmsEntries(projectPath, { collectionId: collection.id, limit: 100 })
    entries = result.items.map((record) => {
      const locale = record.locales.find((candidate) => candidate.isSource) ?? record.locales[0]
      const slug = locale?.slug || record.entry.id
      return {
        id: record.entry.id,
        slug,
        title: locale?.title || slug,
        status: record.entry.status,
        ...(locale?.locale ? { locale: locale.locale } : {}),
        route: resolveCmsEntryPreviewRoute({
          urlPattern: collection.urlPattern,
          templateRoute: page.route,
          id: record.entry.id,
          slug,
          locale: locale?.locale,
        }),
        version: record.entry.updatedAt,
      }
    })
  }
  const selected = entries.find((entry) => entry.status === "published")
    ?? entries.find((entry) => entry.status === "draft")
    ?? entries[0]
    ?? null
  const context: ComposerCmsEntryTemplatePreviewContext = {
    collectionId: collection.id,
    collectionName: collection.name,
    collectionLabel: collection.label,
    templateFile: page.file,
    entries,
    selectedEntryId: selected?.id ?? null,
    previewRoute: selected?.route ?? null,
    sourceKind: collection.source?.kind ?? "aria-managed",
    writable: !collection.source || (
      collection.source.kind === "aria-managed" && !collection.source.readOnly
    ),
    writableTextFields: [
      "title",
      ...(collection.schema?.fields ?? [])
        .filter((field) => field.type === "string" || field.type === "text")
        .map((field) => field.key),
    ],
  }
  return {
    mode: "cms-entry-template",
    name: page.title?.trim() || collection.label,
    file: page.file,
    context,
  }
}

/** Use Composer's representative entry when another view needs a concrete URL. */
export async function resolveCmsEntryTemplatePreviewRoute(
  projectPath: string,
  page: ScanPage,
): Promise<string | null> {
  const launch = await createCmsEntryTemplateLaunch(projectPath, page)
  return launch.context.previewRoute
}

export async function resolveCmsEntryTemplatePreviewTarget(
  projectPath: string,
  page: ScanPage,
): Promise<{ previewRoute: string; cacheKey: string } | null> {
  const launch = await createCmsEntryTemplateLaunch(projectPath, page)
  const selected = launch.context.entries.find(
    (entry) => entry.id === launch.context.selectedEntryId,
  )
  if (!selected || !launch.context.previewRoute) return null
  return {
    previewRoute: launch.context.previewRoute,
    cacheKey: JSON.stringify([
      launch.context.collectionId,
      selected.id,
      selected.route,
      selected.version ?? null,
    ]),
  }
}
