import { ref, type Ref } from "vue"
import { toast } from "vue-sonner"
import {
  archiveCmsEntry,
  deleteCmsEntry,
  duplicateCmsEntry,
  publishCmsEntry,
  unpublishCmsEntry,
} from "@/lib/cms"
import type { CmsEntryRow } from "../lib/entryRow"

export function useCmsEntryActions(projectRoot: Ref<string>) {
  const isDeleting = ref(false)
  const isDuplicating = ref(false)
  const isTransitioning = ref(false)

  async function deleteEntries(
    rows: readonly CmsEntryRow[],
    onSuccess?: () => void | Promise<void>,
  ): Promise<boolean> {
    if (rows.length === 0) return false
    const root = projectRoot.value
    isDeleting.value = true
    let succeeded = 0
    try {
      for (const row of rows) {
        try {
          await deleteCmsEntry(root, row.collectionId, row.id, row.version)
          succeeded++
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : `Failed to delete ${row.title}`,
          )
        }
      }
      if (succeeded > 0) {
        toast.success(
          succeeded === 1 ? "Entry deleted" : `${succeeded} entries deleted`,
        )
        await onSuccess?.()
      }
      return succeeded === rows.length
    } finally {
      isDeleting.value = false
    }
  }

  async function duplicateEntries(
    rows: readonly CmsEntryRow[],
    onSuccess?: () => void | Promise<void>,
  ): Promise<boolean> {
    if (rows.length === 0) return false
    const root = projectRoot.value
    isDuplicating.value = true
    let succeeded = 0
    try {
      for (const row of rows) {
        try {
          await duplicateCmsEntry(root, row.collectionId, row.id, row.version)
          succeeded++
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : `Failed to duplicate ${row.title}`,
          )
        }
      }
      if (succeeded > 0) {
        toast.success(
          succeeded === 1
            ? "Entry duplicated"
            : `${succeeded} entries duplicated`,
        )
        await onSuccess?.()
      }
      return succeeded === rows.length
    } finally {
      isDuplicating.value = false
    }
  }

  async function publishEntries(
    rows: readonly CmsEntryRow[],
    onSuccess?: () => void | Promise<void>,
  ): Promise<boolean> {
    if (rows.length === 0) return false
    const root = projectRoot.value
    isTransitioning.value = true
    let succeeded = 0
    try {
      for (const row of rows) {
        try {
          await publishCmsEntry(root, row.collectionId, row.id, {
            version: row.version,
          })
          succeeded++
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : `Failed to publish ${row.title}`,
          )
        }
      }
      if (succeeded > 0) {
        toast.success(
          succeeded === 1
            ? "Entry published"
            : `${succeeded} entries published`,
        )
        await onSuccess?.()
      }
      return succeeded === rows.length
    } finally {
      isTransitioning.value = false
    }
  }

  async function unpublishEntries(
    rows: readonly CmsEntryRow[],
    onSuccess?: () => void | Promise<void>,
  ): Promise<boolean> {
    if (rows.length === 0) return false
    const root = projectRoot.value
    isTransitioning.value = true
    let succeeded = 0
    try {
      for (const row of rows) {
        try {
          await unpublishCmsEntry(root, row.collectionId, row.id, {
            version: row.version,
          })
          succeeded++
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : `Failed to unpublish ${row.title}`,
          )
        }
      }
      if (succeeded > 0) {
        toast.success(
          succeeded === 1
            ? "Entry unpublished"
            : `${succeeded} entries unpublished`,
        )
        await onSuccess?.()
      }
      return succeeded === rows.length
    } finally {
      isTransitioning.value = false
    }
  }

  async function archiveEntries(
    rows: readonly CmsEntryRow[],
    onSuccess?: () => void | Promise<void>,
  ): Promise<boolean> {
    if (rows.length === 0) return false
    const root = projectRoot.value
    isTransitioning.value = true
    let succeeded = 0
    try {
      for (const row of rows) {
        try {
          await archiveCmsEntry(root, row.collectionId, row.id, {
            version: row.version,
          })
          succeeded++
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : `Failed to archive ${row.title}`,
          )
        }
      }
      if (succeeded > 0) {
        toast.success(
          succeeded === 1
            ? "Entry archived"
            : `${succeeded} entries archived`,
        )
        await onSuccess?.()
      }
      return succeeded === rows.length
    } finally {
      isTransitioning.value = false
    }
  }

  return {
    isDeleting,
    isDuplicating,
    isTransitioning,
    deleteEntries,
    duplicateEntries,
    publishEntries,
    unpublishEntries,
    archiveEntries,
  }
}
