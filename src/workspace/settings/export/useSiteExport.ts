import { computed, onMounted, ref, watch, type Ref } from "vue"
import {
  createDefaultSiteExportSelection,
  createSiteExport as createSiteExportApi,
  deleteSiteExport as deleteSiteExportApi,
  inventorySiteExport,
  listSiteExports,
  revealSiteExport,
  saveAsSiteExport,
  type SiteExportInventory,
  type SiteExportRecord,
  type SiteExportSection,
  type SiteExportSelection,
} from "@/lib/siteExport"

/** ~100 years — matches the UI "Keep forever" retention preset. */
export const EXPORT_KEEP_TTL_MINUTES = 52_560_000

export type { SiteExportRecord, SiteExportSelection, SiteExportSection }

export interface UseSiteExportReturn {
  isLoadingExportInventory: Ref<boolean>
  isLoadingExports: Ref<boolean>
  isCreatingExport: Ref<boolean>
  deletingExportId: Ref<string | null>
  revealingExportId: Ref<string | null>
  exportError: Ref<string | null>
  exportTtlMinutes: Ref<number>
  exportSelection: Ref<SiteExportSelection>
  exportInventory: Ref<SiteExportInventory>
  exports: Ref<SiteExportRecord[]>
  latestExport: Readonly<Ref<SiteExportRecord | null>>
  loadExportInventory: () => Promise<void>
  loadExports: () => Promise<void>
  createSiteExport: () => Promise<void>
  setExportPreset: (
    preset: Exclude<SiteExportSelection["preset"], "custom">,
  ) => void
  toggleExportSection: (section: SiteExportSection, enabled: boolean) => void
  deleteExport: (id: string) => Promise<void>
  downloadExport: (record: SiteExportRecord) => Promise<void>
  revealExport: (record: SiteExportRecord) => Promise<void>
  refresh: () => Promise<void>
  formatDateTime: (value: string) => string
  formatRelativeExpiry: (value: string, createdAt?: string) => string
  formatExportExpiry: (record: SiteExportRecord) => string
  formatBytes: (value: number) => string
  formatExportTitle: (record: SiteExportRecord) => string
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export function isKeepForeverExport(record: {
  createdAt: string
  expiresAt: string
}): boolean {
  const created = new Date(record.createdAt).getTime()
  const expires = new Date(record.expiresAt).getTime()
  if (Number.isNaN(created) || Number.isNaN(expires)) return false
  const ttlMinutes = (expires - created) / 60_000
  return ttlMinutes >= EXPORT_KEEP_TTL_MINUTES * 0.99
}

export function formatExportExpiry(record: SiteExportRecord): string {
  if (isKeepForeverExport(record)) return "Never expires"
  return `Expires ${formatDateTime(record.expiresAt)}`
}

function formatRelativeExpiry(value: string, createdAt?: string): string {
  if (createdAt && isKeepForeverExport({ createdAt, expiresAt: value })) {
    return "Never expires"
  }
  const expiresAt = new Date(value)
  if (Number.isNaN(expiresAt.getTime())) return value
  const diffMs = expiresAt.getTime() - Date.now()
  if (diffMs <= 0) return "Expired"
  const minutes = Math.floor(diffMs / (60 * 1000))
  if (minutes < 60) return `${minutes}m left`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h left`
  const days = Math.floor(hours / 24)
  if (days < 60) return `${days}d left`
  return formatDateTime(value)
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  const units = ["KB", "MB", "GB"] as const
  let size = value / 1024
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`
}

function formatExportTitle(record: SiteExportRecord): string {
  const match = record.filename.match(
    /aria-site-export-(\d{4}-\d{2}-\d{2})T(\d{2}-\d{2}-\d{2})/,
  )
  if (match) {
    const [, datePart, timePart] = match
    const isoCandidate = `${datePart}T${timePart.replace(/-/g, ":")}Z`
    const parsed = new Date(isoCandidate)
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(parsed)
    }
  }
  return formatDateTime(record.createdAt)
}

export function useSiteExport(projectRoot: Ref<string> | string): UseSiteExportReturn {
  const root = computed(() =>
    typeof projectRoot === "string" ? projectRoot : projectRoot.value,
  )

  const isLoadingExportInventory = ref(false)
  const isLoadingExports = ref(false)
  const isCreatingExport = ref(false)
  const deletingExportId = ref<string | null>(null)
  const revealingExportId = ref<string | null>(null)
  const exportError = ref<string | null>(null)
  const exportTtlMinutes = ref(10_080)
  const exportSelection = ref<SiteExportSelection>(
    createDefaultSiteExportSelection(),
  )
  const exportInventory = ref<SiteExportInventory>({
    pages: 0,
    layouts: 0,
    components: 0,
    media: 0,
    cmsCollections: 0,
    cmsEntries: 0,
    redirects: 0,
    estimatedMediaBytes: 0,
  })
  const exportsList = ref<SiteExportRecord[]>([])

  const latestExport = computed(() => exportsList.value[0] ?? null)

  async function loadExportInventory(): Promise<void> {
    if (!root.value) return
    isLoadingExportInventory.value = true
    try {
      exportInventory.value = await inventorySiteExport(root.value)
    } catch {
      exportInventory.value = {
        pages: 0,
        layouts: 0,
        components: 0,
        media: 0,
        cmsCollections: 0,
        cmsEntries: 0,
        redirects: 0,
        estimatedMediaBytes: 0,
      }
    } finally {
      isLoadingExportInventory.value = false
    }
  }

  async function loadExports(): Promise<void> {
    if (!root.value) return
    isLoadingExports.value = true
    exportError.value = null
    try {
      const result = await listSiteExports(root.value)
      exportsList.value = result.exports
    } catch (error) {
      exportsList.value = []
      exportError.value =
        error instanceof Error ? error.message : "Failed to load exports"
    } finally {
      isLoadingExports.value = false
    }
  }

  function setExportPreset(
    preset: Exclude<SiteExportSelection["preset"], "custom">,
  ): void {
    exportSelection.value = {
      ...createDefaultSiteExportSelection(),
      preset,
      sections: undefined,
    }
  }

  function toggleExportSection(
    section: SiteExportSection,
    enabled: boolean,
  ): void {
    exportSelection.value = {
      ...exportSelection.value,
      preset: "custom",
      sections: {
        ...exportSelection.value.sections,
        [section]: enabled,
      },
    }
  }

  async function createSiteExport(): Promise<void> {
    if (!root.value) return
    isCreatingExport.value = true
    exportError.value = null
    try {
      const ttlMinutes = Math.max(1, Number(exportTtlMinutes.value) || 15)
      const result = await createSiteExportApi(root.value, {
        ttlMinutes,
        selection: exportSelection.value,
      })
      if (result.export) {
        exportsList.value = [
          result.export,
          ...exportsList.value.filter(
            (record) => record.id !== result.export?.id,
          ),
        ]
      } else {
        await loadExports()
      }
    } catch (error) {
      exportError.value =
        error instanceof Error ? error.message : "Failed to generate export"
    } finally {
      isCreatingExport.value = false
    }
  }

  async function deleteExport(id: string): Promise<void> {
    if (!root.value) return
    deletingExportId.value = id
    exportError.value = null
    try {
      await deleteSiteExportApi(root.value, { id })
      exportsList.value = exportsList.value.filter((record) => record.id !== id)
    } catch (error) {
      exportError.value =
        error instanceof Error ? error.message : "Failed to delete export"
    } finally {
      deletingExportId.value = null
    }
  }

  async function downloadExport(record: SiteExportRecord): Promise<void> {
    if (!root.value) return
    exportError.value = null
    try {
      await saveAsSiteExport(root.value, { id: record.id })
    } catch (error) {
      exportError.value =
        error instanceof Error ? error.message : "Failed to save export"
    }
  }

  async function revealExport(record: SiteExportRecord): Promise<void> {
    if (!root.value) return
    revealingExportId.value = record.id
    exportError.value = null
    try {
      await revealSiteExport(root.value, { id: record.id })
    } catch (error) {
      exportError.value =
        error instanceof Error ? error.message : "Failed to reveal export"
    } finally {
      revealingExportId.value = null
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([loadExportInventory(), loadExports()])
  }

  onMounted(() => {
    void refresh()
  })

  watch(root, () => {
    void refresh()
  })

  return {
    isLoadingExportInventory,
    isLoadingExports,
    isCreatingExport,
    deletingExportId,
    revealingExportId,
    exportError,
    exportTtlMinutes,
    exportSelection,
    exportInventory,
    exports: exportsList,
    latestExport,
    loadExportInventory,
    loadExports,
    createSiteExport,
    setExportPreset,
    toggleExportSection,
    deleteExport,
    downloadExport,
    revealExport,
    refresh,
    formatDateTime,
    formatRelativeExpiry,
    formatExportExpiry,
    formatBytes,
    formatExportTitle,
  }
}
