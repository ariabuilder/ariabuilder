import { computed, ref, type Ref } from "vue"
import { toast } from "vue-sonner"
import type {
  AriaEntryRecord,
  EntryStatus,
  FieldSchema,
  StructuredTextDocument,
} from "../../../../../shared/cms"
import {
  plainTextToStructuredText,
  StructuredTextDocumentSchema,
} from "../../../../../shared/cms"
import {
  checkCmsSlug,
  getCmsEntry,
  updateCmsEntry,
} from "@/lib/cms"
import {
  buildFrontmatterFromDraft,
  createFrontmatterDraft,
  type CmsFrontmatterDraft,
} from "../lib/frontmatterForm"
import {
  buildEntryRelationsFromDraft,
  createRelationDraft,
  type CmsRelationDraft,
} from "../lib/relationForm"
import { findEntryLocale, matchEntryLocale } from "../lib/entryLocales"
import { slugify } from "../lib/slugify"

function normalizeBodyDocument(body: unknown): StructuredTextDocument {
  const parsed = StructuredTextDocumentSchema.safeParse(body)
  if (parsed.success) {
    return parsed.data
  }
  return typeof body === "string" ? plainTextToStructuredText(body) : []
}

function pickLocale(
  record: AriaEntryRecord,
  localeCode?: string | null,
): AriaEntryRecord["locales"][number] | undefined {
  return findEntryLocale(record.locales, localeCode)
}

export function useEditEntryForm() {
  let loadGeneration = 0
  const currentEntryRecord = ref<AriaEntryRecord | null>(null)
  const resolvedEntryId = ref("")
  const activeLocale = ref("")
  const title = ref("")
  const slug = ref("")
  const status = ref<EntryStatus>("draft")
  const bodyDocument = ref<StructuredTextDocument>([])
  const frontmatterDraft = ref<CmsFrontmatterDraft>({})
  const relationDraft = ref<CmsRelationDraft>({})
  const version = ref("")
  const createdAt = ref("")
  const updatedAt = ref("")
  const publishedAt = ref<string | null>(null)
  const isSlugEdited = ref(false)
  const isLoading = ref(false)
  const isSaving = ref(false)
  const loadError = ref<string | null>(null)
  const errors = ref<Record<string, string>>({})
  const savedSnapshot = ref<string | null>(null)

  function focusInvalidField(id: string): void {
    if (typeof document === "undefined") return
    requestAnimationFrame(() => document.getElementById(id)?.focus())
  }

  function serializeSnapshot(): string {
    return JSON.stringify({
      locale: activeLocale.value,
      title: title.value.trim(),
      slug: slugify(slug.value.trim()),
      bodyDocument: bodyDocument.value,
      frontmatterDraft: frontmatterDraft.value,
      relationDraft: relationDraft.value,
    })
  }

  const hasUnsavedChanges = computed(() => {
    if (savedSnapshot.value === null) return false
    return serializeSnapshot() !== savedSnapshot.value
  })

  const entryLocales = computed(
    () => currentEntryRecord.value?.locales ?? [],
  )

  function applyLocaleFromRecord(
    record: AriaEntryRecord,
    fields: readonly FieldSchema[],
    localeCode?: string | null,
  ): void {
    const locale = pickLocale(record, localeCode)
    if (!locale) return
    activeLocale.value = locale.locale
    title.value = locale.title
    slug.value = locale.slug
    bodyDocument.value = normalizeBodyDocument(locale.body)
    frontmatterDraft.value = createFrontmatterDraft(
      fields,
      locale.frontmatter ?? {},
    )
    relationDraft.value = createRelationDraft(fields, record.relations)
  }

  function applyEntryRecord(
    record: AriaEntryRecord,
    fields: readonly FieldSchema[] = [],
    preferredLocale?: string | null,
  ): void {
    currentEntryRecord.value = record
    resolvedEntryId.value = record.entry.id
    status.value = record.entry.status
    version.value = record.entry.version
    createdAt.value = record.entry.createdAt
    updatedAt.value = record.entry.updatedAt
    publishedAt.value = record.entry.publishedAt
    isSlugEdited.value = true
    applyLocaleFromRecord(
      record,
      fields,
      preferredLocale ?? activeLocale.value,
    )
    savedSnapshot.value = serializeSnapshot()
    errors.value = {}
  }

  function switchLocale(
    localeCode: string,
    fields: readonly FieldSchema[],
  ): boolean {
    if (!currentEntryRecord.value) return false
    if (hasUnsavedChanges.value) {
      toast.error("Save changes before switching locale")
      return false
    }
    const match = matchEntryLocale(currentEntryRecord.value.locales, localeCode)
    if (!match) return false
    applyLocaleFromRecord(currentEntryRecord.value, fields, match.locale)
    savedSnapshot.value = serializeSnapshot()
    return true
  }

  function resetForm(options?: { clearLoadError?: boolean }): void {
    currentEntryRecord.value = null
    resolvedEntryId.value = ""
    activeLocale.value = ""
    title.value = ""
    slug.value = ""
    status.value = "draft"
    bodyDocument.value = []
    frontmatterDraft.value = {}
    relationDraft.value = {}
    version.value = ""
    createdAt.value = ""
    updatedAt.value = ""
    publishedAt.value = null
    isSlugEdited.value = false
    if (options?.clearLoadError !== false) loadError.value = null
    errors.value = {}
    savedSnapshot.value = null
  }

  function updateSlugFromTitle(): void {
    if (!isSlugEdited.value) {
      slug.value = slugify(title.value)
    }
  }

  function markSlugEdited(): void {
    isSlugEdited.value = true
  }

  function setRelationValue(fieldKey: string, value: string[]): void {
    relationDraft.value = {
      ...relationDraft.value,
      [fieldKey]: value,
    }
  }

  async function loadEntry(
    projectRoot: string,
    collectionId: string,
    entrySlugOrId: string,
    fields: readonly FieldSchema[],
    preferredLocale?: string | null,
  ): Promise<boolean> {
    if (!projectRoot || !collectionId || !entrySlugOrId) {
      resetForm()
      return false
    }
    isLoading.value = true
    loadError.value = null
    const generation = ++loadGeneration
    try {
      const record = await getCmsEntry(
        projectRoot,
        collectionId,
        entrySlugOrId,
      )
      if (generation !== loadGeneration) return false
      if (!record) {
        loadError.value = "Entry not found"
        resetForm({ clearLoadError: false })
        return false
      }
      applyEntryRecord(record, fields, preferredLocale)
      return true
    } catch (err) {
      if (generation !== loadGeneration) return false
      loadError.value =
        err instanceof Error ? err.message : "Failed to load entry"
      resetForm({ clearLoadError: false })
      return false
    } finally {
      if (generation === loadGeneration) isLoading.value = false
    }
  }

  async function checkSlugAvailability(
    projectRoot: string,
    collectionId: string,
    entryId: string,
  ): Promise<boolean> {
    const nextSlug = slugify(slug.value.trim())
    if (!nextSlug) {
      errors.value = { ...errors.value, slug: "Slug is required" }
      return false
    }
    try {
      const available = await checkCmsSlug(
        projectRoot,
        collectionId,
        nextSlug,
        activeLocale.value || undefined,
        entryId,
      )
      if (!available) {
        errors.value = { ...errors.value, slug: "Slug is already in use" }
        return false
      }
      const { slug: _slug, ...rest } = errors.value
      errors.value = rest
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Slug check failed")
      return false
    }
  }

  function buildFrontmatter(
    fields: readonly FieldSchema[],
  ): Record<string, unknown> | null {
    try {
      return buildFrontmatterFromDraft(fields, frontmatterDraft.value)
    } catch (err) {
      errors.value = {
        ...errors.value,
        frontmatter:
          err instanceof Error ? err.message : "Invalid frontmatter",
      }
      return null
    }
  }

  function buildBodyDocument(): StructuredTextDocument | null {
    const parsed = StructuredTextDocumentSchema.safeParse(bodyDocument.value)
    if (!parsed.success) {
      errors.value = { ...errors.value, body: "Body content is invalid" }
      return null
    }
    return parsed.data
  }

  async function submitUpdate(
    projectRoot: string,
    collectionId: string,
    entryId: string,
    fields: readonly FieldSchema[],
    bodyEnabled: boolean,
    options?: { showSuccessToast?: boolean },
  ): Promise<AriaEntryRecord | null> {
    if (isSaving.value || !version.value) return null
    if (!title.value.trim()) {
      errors.value = { ...errors.value, title: "Title is required" }
      focusInvalidField("entry-title")
      return null
    }
    const okSlug = await checkSlugAvailability(
      projectRoot,
      collectionId,
      entryId,
    )
    if (!okSlug) {
      focusInvalidField("entry-slug")
      return null
    }

    const frontmatter = buildFrontmatter(fields)
    const body = bodyEnabled ? buildBodyDocument() : null
    if (!frontmatter || (bodyEnabled && !body)) {
      toast.error("Entry is invalid")
      return null
    }

    isSaving.value = true
    try {
      const relations = buildEntryRelationsFromDraft(
        entryId,
        fields,
        relationDraft.value,
      )

      const updated = await updateCmsEntry(projectRoot, {
        collectionId,
        id: entryId,
        version: version.value,
        patch: {
          locale: activeLocale.value || undefined,
          title: title.value.trim(),
          slug: slugify(slug.value.trim()),
          frontmatter,
          relations,
          body: bodyEnabled
            ? body && body.length > 0
              ? body
              : null
            : undefined,
        },
      })
      applyEntryRecord(updated, fields, activeLocale.value)
      if (options?.showSuccessToast !== false) {
        toast.success("Entry saved")
      }
      return updated
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save entry")
      return null
    } finally {
      isSaving.value = false
    }
  }

  async function addLocale(
    projectRoot: string,
    collectionId: string,
    entryId: string,
    localeCode: string,
    fields: readonly FieldSchema[],
  ): Promise<boolean> {
    if (!version.value || !currentEntryRecord.value) return false
    const code = localeCode.trim()
    if (!code) {
      toast.error("Locale code is required")
      return false
    }
    if (matchEntryLocale(currentEntryRecord.value.locales, code)) {
      toast.error("Locale already exists on this entry")
      return false
    }

    const source =
      currentEntryRecord.value.locales.find((item) => item.isSource) ??
      currentEntryRecord.value.locales[0]
    if (!source) return false

    isSaving.value = true
    try {
      const updated = await updateCmsEntry(projectRoot, {
        collectionId,
        id: entryId,
        version: version.value,
        patch: {
          upsertLocale: {
            locale: code,
            title: source.title,
            slug: source.slug,
            frontmatter: { ...source.frontmatter },
            body: source.body,
            isSource: false,
          },
        },
      })
      applyEntryRecord(updated, fields, code)
      toast.success(`Locale “${code}” added`)
      return true
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add locale",
      )
      return false
    } finally {
      isSaving.value = false
    }
  }

  return {
    currentEntryRecord: currentEntryRecord as Ref<AriaEntryRecord | null>,
    resolvedEntryId,
    activeLocale,
    entryLocales,
    title,
    slug,
    status,
    bodyDocument,
    frontmatterDraft,
    relationDraft,
    version,
    createdAt,
    updatedAt,
    publishedAt,
    isSlugEdited,
    isLoading,
    isSaving,
    hasUnsavedChanges,
    loadError,
    errors,
    loadEntry,
    checkSlugAvailability,
    updateSlugFromTitle,
    markSlugEdited,
    setRelationValue,
    applyEntryRecord,
    switchLocale,
    addLocale,
    resetForm,
    submitUpdate,
  }
}
