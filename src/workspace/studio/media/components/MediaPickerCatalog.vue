<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import type { MediaAsset, MediaAssetType } from "@/lib/media"
import { listMedia, uploadMedia } from "@/lib/media"
import {
  findUploadedPickerAsset,
  mediaAssetMatchesPicker,
} from "@/lib/pickers/mediaPicker"
import {
  FilterIconMenu,
  HeaderActionTooltip,
  PageHeader,
} from "@/workspace/studio/core"
import { m } from "@/paraglide/messages.js"
import { useMediaGrouping } from "../composables/useMediaGrouping"
import MediaPickerPreview from "./MediaPickerPreview.vue"

const props = withDefaults(
  defineProps<{
    projectRoot: string
    title: string
    description: string
    mediaTypes?: readonly MediaAssetType[]
    requireSvg?: boolean
  }>(),
  {
    mediaTypes: () => [],
    requireSvg: false,
  },
)

const emit = defineEmits<{
  select: [asset: MediaAsset]
}>()

type ViewMode = "grid" | "list"

const assets = ref<MediaAsset[]>([])
const loading = ref(true)
const uploading = ref(false)
const error = ref("")
const status = ref("")
const searchQuery = ref("")
const viewMode = ref<ViewMode>("grid")
const activeFolder = ref("all")
const activeIndex = ref(0)
const itemRefs = ref<Array<HTMLButtonElement | null>>([])
const assetsRef = computed(() => assets.value)
const grouping = useMediaGrouping(assetsRef, props.projectRoot)

const eligibleAssets = computed(() =>
  assets.value.filter((asset) =>
    mediaAssetMatchesPicker(asset, props.mediaTypes, props.requireSvg),
  ),
)

const filteredAssets = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const groupId = activeFolder.value.startsWith("group:")
    ? activeFolder.value.slice("group:".length)
    : ""
  const assignments = grouping.buildEffectiveAssignments(assets.value)
  return eligibleAssets.value.filter((asset) => {
    if (groupId && assignments[asset.id] !== groupId) return false
    if (!query) return true
    return [asset.name, asset.id, asset.type, asset.file]
      .join(" ")
      .toLowerCase()
      .includes(query)
  })
})

const folderFilters = computed(() => [
  { key: "all", label: m.picker_media_all(), count: eligibleAssets.value.length },
])

const folderSections = computed(() => {
  const assignments = grouping.buildEffectiveAssignments(assets.value)
  const options = grouping.customGroups.value.map((group) => ({
    key: `group:${group.id}`,
    label: group.name,
    count: eligibleAssets.value.filter(
      (asset) => assignments[asset.id] === group.id,
    ).length,
  }))
  return options.length > 0 ? [{ label: m.picker_media_folders(), options }] : []
})

const activeFolderLabel = computed(() => {
  if (activeFolder.value === "all") return m.picker_media_all()
  return (
    folderSections.value[0]?.options.find(
      (option) => option.key === activeFolder.value,
    )?.label ?? m.picker_media_all()
  )
})

const resultLabel = computed(() => {
  const count = filteredAssets.value.length
  return count === 1
    ? m.picker_media_asset_count_one()
    : m.picker_media_asset_count({ count: String(count) })
})

watch(filteredAssets, (next) => {
  activeIndex.value = Math.min(activeIndex.value, Math.max(0, next.length - 1))
  itemRefs.value = []
})

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ""
  try {
    assets.value = await listMedia(props.projectRoot)
    grouping.stripStaleAssignments(assets.value)
  } catch (cause) {
    assets.value = []
    error.value = cause instanceof Error ? cause.message : "Failed to load media"
  } finally {
    loading.value = false
  }
}

async function handleUpload(): Promise<void> {
  if (uploading.value) return
  uploading.value = true
  status.value = ""
  try {
    const result = await uploadMedia(props.projectRoot)
    if ("canceled" in result) return
    const uploaded = result.assets
    await refresh()
    const matching = findUploadedPickerAsset(
      assets.value,
      uploaded,
      props.mediaTypes,
      props.requireSvg,
    )
    if (matching) {
      emit("select", matching)
      return
    }
    status.value = m.picker_media_upload_mismatch()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Upload failed"
  } finally {
    uploading.value = false
  }
}

function setItemRef(index: number, element: unknown): void {
  itemRefs.value[index] = element instanceof HTMLButtonElement ? element : null
}

async function focusIndex(index: number): Promise<void> {
  const count = filteredAssets.value.length
  if (count === 0) return
  activeIndex.value = Math.min(count - 1, Math.max(0, index))
  await nextTick()
  itemRefs.value[activeIndex.value]?.focus()
}

function gridColumnCount(target: EventTarget | null): number {
  const button = target instanceof HTMLElement ? target : null
  const grid = button?.closest<HTMLElement>("[data-media-picker-grid]")
  if (!grid) return 1
  return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length)
}

function onItemKeydown(event: KeyboardEvent, index: number): void {
  const columns = viewMode.value === "grid" ? gridColumnCount(event.currentTarget) : 1
  let next = index
  if (event.key === "ArrowRight") next += 1
  else if (event.key === "ArrowLeft") next -= 1
  else if (event.key === "ArrowDown") next += columns
  else if (event.key === "ArrowUp") next -= columns
  else if (event.key === "Home") next = 0
  else if (event.key === "End") next = filteredAssets.value.length - 1
  else return
  event.preventDefault()
  void focusIndex(next)
}

void refresh()
</script>

<template>
  <div class="flex h-full min-h-0 w-full flex-col">
    <PageHeader
      :title="title"
      :description="description"
      :search-query="searchQuery"
      hide-create
      merge-actions
      reserve-close-space
      search-tooltip-side="top"
      @update:search-query="searchQuery = $event"
    >
      <template #toolbar>
        <FilterIconMenu
          v-if="folderSections.length > 0"
          v-model="activeFolder"
          :filters="folderFilters"
          :sections="folderSections"
          :active-label="activeFolderLabel"
        />
        <HeaderActionTooltip
          side="top"
          :label="viewMode === 'grid' ? m.picker_media_list_view() : m.picker_media_grid_view()"
        >
          <Button
            type="button"
            variant="headerAction"
            size="icon-header"
            :aria-label="viewMode === 'grid' ? m.picker_media_list_view() : m.picker_media_grid_view()"
            @click="viewMode = viewMode === 'grid' ? 'list' : 'grid'"
          >
            <AppIcon :name="viewMode === 'grid' ? 'list' : 'grid'" :size="14" />
          </Button>
        </HeaderActionTooltip>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          class="ml-2"
          :disabled="uploading || loading"
          @click="handleUpload"
        >
          <AppIcon name="upload" :size="14" />
          {{ uploading ? m.picker_media_uploading() : m.media_upload() }}
        </Button>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background/30">
      <div v-if="loading" class="flex min-h-64 items-center justify-center">
        <AppIcon name="refresh" :size="24" class="animate-spin text-muted-foreground" />
        <span class="sr-only">{{ m.picker_media_loading() }}</span>
      </div>

      <div
        v-else-if="error"
        class="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center"
        role="alert"
      >
        <p class="text-sm text-destructive">{{ error }}</p>
        <Button type="button" variant="outline" size="sm" @click="refresh">
          {{ m.picker_media_retry() }}
        </Button>
      </div>

      <div
        v-else-if="filteredAssets.length === 0"
        class="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <AppIcon name="media" :size="30" class="text-muted-foreground/60" />
        <div class="space-y-1">
          <p class="text-sm font-medium">{{ m.picker_media_empty() }}</p>
          <p class="text-xs text-muted-foreground">
            {{ searchQuery.trim() ? m.picker_media_empty_search() : m.picker_media_empty_upload() }}
          </p>
        </div>
        <Button v-if="!searchQuery.trim()" type="button" variant="outline" size="sm" @click="handleUpload">
          <AppIcon name="upload" :size="14" />
          {{ m.picker_media_upload() }}
        </Button>
      </div>

      <div
        v-else-if="viewMode === 'grid'"
        data-media-picker-grid
        role="grid"
        aria-label="Media assets"
        class="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-4"
      >
        <button
          v-for="(asset, index) in filteredAssets"
          :key="asset.id"
          :ref="(element) => setItemRef(index, element)"
          type="button"
          role="gridcell"
          :tabindex="activeIndex === index ? 0 : -1"
          :aria-label="m.picker_media_select({ name: asset.name })"
          class="group overflow-hidden rounded-md border border-border bg-background text-left transition-[border-color,box-shadow,transform] duration-100 hover:border-primary/70 hover:shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.96] motion-reduce:active:scale-100"
          @click="emit('select', asset)"
          @focus="activeIndex = index"
          @keydown="onItemKeydown($event, index)"
        >
          <div class="flex h-28 items-center justify-center overflow-hidden bg-input">
            <MediaPickerPreview :asset="asset" :project-root="projectRoot" />
          </div>
          <div class="space-y-0.5 px-2.5 py-2">
            <p class="truncate text-xs font-medium">{{ asset.name }}</p>
            <p class="truncate text-2xs capitalize text-muted-foreground">{{ asset.type }}</p>
          </div>
        </button>
      </div>

      <div v-else role="listbox" aria-label="Media assets" class="divide-y divide-dashed divide-border">
        <button
          v-for="(asset, index) in filteredAssets"
          :key="asset.id"
          :ref="(element) => setItemRef(index, element)"
          type="button"
          role="option"
          :tabindex="activeIndex === index ? 0 : -1"
          :aria-label="m.picker_media_select({ name: asset.name })"
          class="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-[background-color,box-shadow] duration-100 hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          @click="emit('select', asset)"
          @focus="activeIndex = index"
          @keydown="onItemKeydown($event, index)"
        >
          <span class="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-input">
            <MediaPickerPreview :asset="asset" :project-root="projectRoot" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">{{ asset.name }}</span>
            <span class="block truncate text-2xs text-muted-foreground">{{ asset.file }}</span>
          </span>
          <span class="shrink-0 text-2xs capitalize text-muted-foreground">{{ asset.type }}</span>
        </button>
      </div>
    </div>

    <div class="flex min-h-12 shrink-0 items-center justify-between gap-4 border-t border-dashed border-border px-5 text-xs text-muted-foreground">
      <span role="status" aria-live="polite">{{ status }}</span>
      <span class="shrink-0" role="status" aria-live="polite">{{ resultLabel }}</span>
    </div>
  </div>
</template>
