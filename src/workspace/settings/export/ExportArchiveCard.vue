<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { m } from "@/paraglide/messages.js"
import type { SiteExportRecord } from "./useSiteExport"

const props = defineProps<{
  record: SiteExportRecord
  isDeleting?: boolean
  isRevealing?: boolean
  formatDateTime: (value: string) => string
  formatExportExpiry: (record: SiteExportRecord) => string
  formatBytes: (value: number) => string
}>()

const archiveStats = computed(() => {
  const cmsCollectionCount = props.record.cmsCollectionCount ?? 0
  const cmsEntryCount = props.record.cmsEntryCount ?? 0
  const redirectCount = props.record.redirectCount ?? 0
  const cmsTotal = cmsCollectionCount + cmsEntryCount

  const stats = [
    { label: "Pages", value: props.record.pageCount },
    { label: "Media", value: props.record.mediaCount },
  ]

  if (cmsTotal > 0) {
    stats.push({ label: "CMS", value: cmsTotal })
  }

  if (redirectCount > 0) {
    stats.push({ label: "Rules", value: redirectCount })
  }

  if (stats.length < 4) {
    stats.push({
      label: "Files",
      value: props.record.pageCount + props.record.mediaCount,
    })
  }

  return stats.slice(0, 4)
})

const emit = defineEmits<{
  download: [record: SiteExportRecord]
  reveal: [record: SiteExportRecord]
  delete: [id: string]
}>()
</script>

<template>
  <article
    class="overflow-hidden rounded-md border border-solid border-border bg-input hover:border-dashed hover:border-border"
  >
    <div
      class="flex items-center justify-between border-b border-dashed border-border px-3"
    >
      <div class="flex min-w-0 items-center gap-4">
        <AppIcon
          name="archived"
          :size="22"
          class="size-5.5 shrink-0 text-muted-foreground"
        />
        <div class="min-w-0 pb-2">
          <p class="truncate text-sm leading-4 font-medium text-foreground">
            Site Export
          </p>
          <p class="text-2xs leading-0 text-muted-foreground">
            {{ formatDateTime(record.createdAt) }}
          </p>
        </div>
      </div>

      <div class="ml-2 flex shrink-0 items-center gap-0.5">
        <Button
          size="icon-header"
          variant="headerAction"
          class="h-3.5 shrink-0 hover:text-primary"
          :aria-label="m.export_download()"
          @click="emit('download', record)"
        >
          <AppIcon name="download" :size="14" class="size-3.5" />
          <span class="sr-only">{{ m.export_download() }}</span>
        </Button>
        <Button
          size="icon-header"
          variant="headerAction"
          class="h-3.5 shrink-0 hover:text-primary"
          :disabled="isRevealing"
          :aria-label="m.export_reveal()"
          @click="emit('reveal', record)"
        >
          <AppIcon
            name="folderOpen"
            :size="14"
            class="size-3.5"
            :class="isRevealing ? 'animate-pulse' : ''"
          />
          <span class="sr-only">{{ m.export_reveal() }}</span>
        </Button>
        <Button
          variant="headerAction"
          class="h-3.5 shrink-0 hover:text-destructive"
          size="icon-header"
          :disabled="isDeleting"
          :aria-label="m.export_delete()"
          @click="emit('delete', record.id)"
        >
          <AppIcon
            name="trash"
            :size="14"
            class="size-3.5"
            :class="isDeleting ? 'animate-pulse' : ''"
          />
          <span class="sr-only">{{ m.export_delete() }}</span>
        </Button>
      </div>
    </div>

    <div class="bg-muted/70 px-3 py-3 pb-3">
      <div
        class="grid gap-2"
        :class="archiveStats.length >= 4 ? 'grid-cols-4' : 'grid-cols-3'"
      >
        <div v-for="stat in archiveStats" :key="stat.label" class="text-center">
          <p
            class="pb-2 text-base leading-0 font-medium tabular-nums text-foreground"
          >
            {{ stat.value }}
          </p>
          <p class="text-2xs leading-0 text-muted-foreground">
            {{ stat.label }}
          </p>
        </div>
      </div>
    </div>

    <div class="flex items-center bg-muted/70 px-3 py-2">
      <div
        class="flex w-full min-w-0 items-center justify-between gap-2 text-2xs text-muted-foreground/50"
      >
        <span class="truncate">{{ formatExportExpiry(record) }}</span>
        <span class="truncate">{{ formatBytes(record.sizeBytes) }}</span>
      </div>
    </div>
  </article>
</template>
