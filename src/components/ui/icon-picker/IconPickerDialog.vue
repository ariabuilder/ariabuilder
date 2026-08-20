<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getDesignSnapshot, detectIconRuntime, resolveProjectIcons, searchProjectIcons } from "@/lib/design"
import type { DesignIconSearchItem, DesignIconSearchResult } from "../../../../shared/design"
import {
  resolveIconPickerPack,
  toStoredIconValue,
} from "@/lib/pickers/iconPicker"
import type { MediaAsset } from "@/lib/media"
import { getPlayableMediaUrl } from "@/lib/media"
import { ExpandableSearchInput } from "@/workspace/studio/core"
import { m } from "@/paraglide/messages.js"
import MediaPickerDialog from "@/workspace/studio/media/components/MediaPickerDialog.vue"

const props = withDefaults(
  defineProps<{
    open: boolean
    projectRoot: string
    value?: string
    title?: string
    description?: string
    enabledPacks?: readonly string[]
  }>(),
  {
    value: "",
    title: m.picker_icon_title(),
    description: m.picker_icon_description(),
    enabledPacks: undefined,
  },
)

const emit = defineEmits<{
  "update:open": [value: boolean]
  select: [icon: string, resolvedDataUrl?: string]
}>()

const PAGE_SIZE = 48
const PAGE_CACHE = new Map<string, DesignIconSearchResult>()

const uid = useId()
const titleId = `icon-picker-title-${uid}`
const descriptionId = `icon-picker-description-${uid}`
const search = ref("")
const eligiblePacks = ref<string[]>([])
const missingPacks = ref<string[]>([])
const currentPack = ref("")
const items = ref<DesignIconSearchItem[]>([])
const iconDataUrls = ref<Record<string, string>>({})
const loading = ref(false)
const loadError = ref("")
const status = ref("")
const nextCursor = ref<string | null>(null)
const currentCursor = ref<string | null>(null)
const cursorHistory = ref<Array<string | null>>([])
const mediaPickerOpen = ref(false)
const mediaError = ref("")
const activeIndex = ref(0)
const itemRefs = ref<Array<HTMLButtonElement | null>>([])
const packRefs = ref<Array<HTMLButtonElement | null>>([])
let requestGeneration = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

const hasPacks = computed(() => eligiblePacks.value.length > 0)
const searching = computed(() => search.value.trim().length > 0)
const canPrevious = computed(() => !searching.value && cursorHistory.value.length > 0)
const canNext = computed(() => !searching.value && nextCursor.value !== null)
const canLoadMore = computed(() => searching.value && nextCursor.value !== null)
const resultLabel = computed(() => {
  if (searching.value) return `${items.value.length} search results`
  const start = items.value.length ? cursorHistory.value.length * PAGE_SIZE + 1 : 0
  const end = start ? start + items.value.length - 1 : 0
  return start ? `${start}–${end}` : "No results"
})

function packLabel(pack: string): string {
  return pack
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function cacheKey(pack: string, query: string, cursor: string | null): string {
  return `${props.projectRoot}\u0000${pack}\u0000${query.toLowerCase()}\u0000${cursor ?? "root"}`
}

function clearPageCacheForProject(): void {
  const prefix = `${props.projectRoot}\u0000`
  for (const key of PAGE_CACHE.keys()) {
    if (key.startsWith(prefix)) PAGE_CACHE.delete(key)
  }
}

async function hydrate(itemsToHydrate: readonly DesignIconSearchItem[], generation: number): Promise<void> {
  if (itemsToHydrate.length === 0) return
  try {
    const result = await resolveProjectIcons(
      props.projectRoot,
      itemsToHydrate.map((item) => item.id),
    )
    if (generation !== requestGeneration) return
    const next = { ...iconDataUrls.value }
    for (const [id, icon] of Object.entries(result.icons)) next[id] = icon.dataUrl
    iconDataUrls.value = next
  } catch {
    // Search remains usable if an individual preview cannot be resolved.
  }
}

async function fetchPage(
  cursor: string | null,
  append: boolean,
): Promise<void> {
  if (!currentPack.value) return
  const generation = ++requestGeneration
  const query = search.value.trim()
  const key = cacheKey(currentPack.value, query, cursor)
  loading.value = true
  loadError.value = ""
  try {
    const cached = PAGE_CACHE.get(key)
    const result = cached ?? (await searchProjectIcons(props.projectRoot, {
      pack: currentPack.value,
      query,
      cursor,
      limit: PAGE_SIZE,
    }))
    if (generation !== requestGeneration) return
    if (!cached) PAGE_CACHE.set(key, result)
    currentCursor.value = cursor
    nextCursor.value = result.nextCursor
    items.value = append ? [...items.value, ...result.items] : result.items
    activeIndex.value = 0
    itemRefs.value = []
    await hydrate(items.value, generation)
  } catch (cause) {
    if (generation !== requestGeneration) return
    if (!append) items.value = []
    loadError.value = cause instanceof Error ? cause.message : "Failed to load icons"
  } finally {
    if (generation === requestGeneration) loading.value = false
  }
}

async function loadInitial(): Promise<void> {
  cursorHistory.value = []
  currentCursor.value = null
  nextCursor.value = null
  items.value = []
  iconDataUrls.value = {}
  await fetchPage(null, false)
}

async function loadSettings(): Promise<void> {
  clearPageCacheForProject()
  loading.value = true
  loadError.value = ""
  try {
    const [snapshot, runtime] = await Promise.all([
      getDesignSnapshot(props.projectRoot),
      detectIconRuntime(props.projectRoot),
    ])
    const enabled = (props.enabledPacks ?? snapshot.icons.enabledPacks)
      .map((pack) => pack.trim().toLowerCase())
      .filter(Boolean)
    const installed = new Set(runtime.installedJsonPrefixes)
    eligiblePacks.value = enabled.filter((pack) => installed.has(pack))
    missingPacks.value = enabled.filter((pack) => !installed.has(pack))
    currentPack.value = resolveIconPickerPack(eligiblePacks.value, props.value)
    if (currentPack.value) await loadInitial()
    else items.value = []
  } catch (cause) {
    eligiblePacks.value = []
    missingPacks.value = []
    loadError.value = cause instanceof Error ? cause.message : "Failed to load icon settings"
  } finally {
    loading.value = false
  }
}

function selectIcon(id: string): void {
  emit("select", toStoredIconValue(id), iconDataUrls.value[id])
  emit("update:open", false)
}

function clearSelection(): void {
  emit("select", "")
  emit("update:open", false)
}

async function selectMedia(asset: MediaAsset): Promise<void> {
  mediaError.value = ""
  if (asset.mimeType !== "image/svg+xml" && !/\.svg(?:$|[?#])/i.test(asset.url)) {
    mediaError.value = m.picker_icon_svg_error()
    return
  }
  try {
    const playable = await getPlayableMediaUrl(props.projectRoot, asset.id)
    const source = await (await fetch(playable.url)).text()
    emit("select", asset.url, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`)
    emit("update:open", false)
  } catch (cause) {
    mediaError.value = cause instanceof Error ? cause.message : m.picker_icon_svg_error()
  }
}

async function nextPage(): Promise<void> {
  if (!nextCursor.value) return
  cursorHistory.value.push(currentCursor.value)
  await fetchPage(nextCursor.value, false)
}

async function previousPage(): Promise<void> {
  const cursor = cursorHistory.value.pop()
  await fetchPage(cursor ?? null, false)
}

async function loadMore(): Promise<void> {
  if (nextCursor.value) await fetchPage(nextCursor.value, true)
}

function setItemRef(index: number, element: unknown): void {
  itemRefs.value[index] = element instanceof HTMLButtonElement ? element : null
}

function setPackRef(index: number, element: unknown): void {
  packRefs.value[index] = element instanceof HTMLButtonElement ? element : null
}

async function activatePack(index: number): Promise<void> {
  if (eligiblePacks.value.length === 0) return
  const normalized = (index + eligiblePacks.value.length) % eligiblePacks.value.length
  currentPack.value = eligiblePacks.value[normalized] ?? ""
  await nextTick()
  packRefs.value[normalized]?.focus()
}

function onPackKeydown(event: KeyboardEvent, index: number): void {
  let next = index
  if (event.key === "ArrowRight") next += 1
  else if (event.key === "ArrowLeft") next -= 1
  else if (event.key === "Home") next = 0
  else if (event.key === "End") next = eligiblePacks.value.length - 1
  else return
  event.preventDefault()
  void activatePack(next)
}

async function focusIndex(index: number): Promise<void> {
  if (items.value.length === 0) return
  activeIndex.value = Math.min(items.value.length - 1, Math.max(0, index))
  await nextTick()
  itemRefs.value[activeIndex.value]?.focus()
}

function onIconKeydown(event: KeyboardEvent, index: number): void {
  const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  const grid = button?.closest<HTMLElement>("[data-icon-picker-grid]")
  const columns = grid
    ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length)
    : 1
  let next = index
  if (event.key === "ArrowRight") next += 1
  else if (event.key === "ArrowLeft") next -= 1
  else if (event.key === "ArrowDown") next += columns
  else if (event.key === "ArrowUp") next -= columns
  else if (event.key === "Home") next = 0
  else if (event.key === "End") next = items.value.length - 1
  else return
  event.preventDefault()
  void focusIndex(next)
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      search.value = ""
      status.value = ""
      mediaError.value = ""
      void loadSettings()
    } else {
      requestGeneration++
      mediaPickerOpen.value = false
      if (searchTimer) clearTimeout(searchTimer)
    }
  },
  { immediate: true },
)

watch(currentPack, (next, previous) => {
  if (props.open && next && previous && next !== previous) void loadInitial()
})

watch(search, () => {
  if (!props.open || !currentPack.value) return
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void loadInitial(), 200)
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      :aria-labelledby="titleId"
      :aria-describedby="descriptionId"
      class="max-h-[min(80dvh,720px)]! w-[min(860px,calc(100vw-1.5rem))]! max-w-[calc(100vw-1.5rem)]! gap-0 overflow-hidden p-0! overscroll-contain"
    >
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="flex items-start justify-between gap-4 px-6 pb-4 pt-6 pr-14">
          <DialogHeader class="min-w-0 space-y-1">
            <DialogTitle :id="titleId" class="truncate font-sans font-normal">
              {{ title }}
            </DialogTitle>
            <DialogDescription :id="descriptionId" class="text-xs">
              {{ description }}
            </DialogDescription>
          </DialogHeader>
          <div class="flex shrink-0 items-center">
            <ExpandableSearchInput
              :model-value="search"
              :placeholder="currentPack ? `Search ${packLabel(currentPack)}…` : 'Search icons…'"
              tooltip-side="top"
              @update:model-value="search = $event"
            />
            <Button
              type="button"
              variant="headerAction"
              size="icon-header"
              :aria-label="m.picker_icon_upload_svg()"
              :title="m.picker_icon_upload_svg()"
              @click="mediaPickerOpen = true"
            >
              <AppIcon name="upload" :size="14" />
            </Button>
            <Button
              v-if="value"
              type="button"
              variant="headerAction"
              size="icon-header"
              :aria-label="m.picker_icon_clear()"
              :title="m.picker_icon_clear()"
              @click="clearSelection"
            >
              <AppIcon name="closeCircleBold" :size="14" />
            </Button>
          </div>
        </div>

        <div v-if="hasPacks" class="border-b border-dashed border-border px-6 pb-4">
          <div role="tablist" :aria-label="m.picker_icon_pack()" class="flex gap-2 overflow-x-auto pb-1">
            <button
              v-for="(pack, index) in eligiblePacks"
              :key="pack"
              :ref="(element) => setPackRef(index, element)"
              type="button"
              role="tab"
              :aria-selected="currentPack === pack"
              :tabindex="currentPack === pack ? 0 : -1"
              class="min-w-36 shrink-0 rounded-sm border px-3 py-3 text-left transition-[background-color,border-color,color] duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              :class="currentPack === pack ? 'border-primary/60 bg-sidebar text-foreground' : 'border-dashed border-border text-muted-foreground hover:bg-sidebar/50'"
              @click="currentPack = pack"
              @keydown="onPackKeydown($event, index)"
            >
              <span class="block truncate text-sm font-medium">{{ packLabel(pack) }}</span>
              <span class="mt-1 block truncate text-2xs text-muted-foreground">{{ pack }}</span>
            </button>
          </div>
          <p v-if="missingPacks.length" class="mt-2 text-2xs text-muted-foreground" role="status">
            {{ m.picker_icon_missing({ packs: missingPacks.join(", ") }) }}
          </p>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <div
            v-if="!hasPacks && !loading && !loadError"
            class="flex min-h-72 flex-col items-center justify-center gap-4 px-6 text-center"
          >
            <AppIcon name="galleryBold" :size="32" class="text-muted-foreground/60" />
            <div class="max-w-md space-y-1">
              <p class="text-sm font-medium">{{ m.picker_icon_empty() }}</p>
              <p class="text-xs text-muted-foreground">
                {{ m.picker_icon_empty_hint() }}
              </p>
              <p v-if="missingPacks.length" class="text-xs text-muted-foreground">
                {{ m.picker_icon_missing({ packs: missingPacks.join(", ") }) }}
              </p>
            </div>
            <Button type="button" size="sm" @click="mediaPickerOpen = true">
              <AppIcon name="upload" :size="14" />
              {{ m.picker_icon_upload_svg() }}
            </Button>
          </div>

          <div v-else-if="loadError" role="alert" class="flex min-h-72 flex-col items-center justify-center gap-3 text-center">
            <p class="text-sm text-destructive">{{ loadError }}</p>
            <Button type="button" variant="outline" size="sm" @click="loadSettings">{{ m.picker_media_retry() }}</Button>
          </div>

          <div
            v-else-if="loading && items.length === 0"
            :aria-label="m.picker_icon_loading()"
            class="grid grid-cols-6 gap-2 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12"
          >
            <div v-for="index in PAGE_SIZE" :key="index" class="aspect-square animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none" />
          </div>

          <p v-else-if="items.length === 0" class="py-16 text-center text-sm text-muted-foreground">
            {{ m.picker_icon_no_results() }}
          </p>

          <div
            v-else
            data-icon-picker-grid
            role="grid"
            :aria-label="`${packLabel(currentPack)} icons`"
            class="grid grid-cols-6 gap-2 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12"
          >
            <button
              v-for="(icon, index) in items"
              :key="icon.id"
              :ref="(element) => setItemRef(index, element)"
              type="button"
              role="gridcell"
              :tabindex="activeIndex === index ? 0 : -1"
              :aria-label="m.picker_icon_select({ name: icon.label })"
              :aria-pressed="value === toStoredIconValue(icon.id)"
              :title="icon.label"
              class="group relative flex aspect-square min-h-10 items-center justify-center rounded-md border bg-background/70 text-muted-foreground transition-[background-color,border-color,color,box-shadow,transform] duration-100 hover:border-primary/70 hover:bg-input hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.96] motion-reduce:active:scale-100"
              :class="value === toStoredIconValue(icon.id) ? 'border-primary bg-input text-primary shadow-xs' : 'border-transparent'"
              @click="selectIcon(icon.id)"
              @focus="activeIndex = index"
              @keydown="onIconKeydown($event, index)"
            >
              <span
                v-if="iconDataUrls[icon.id]"
                class="size-6 bg-current"
                :style="{
                  maskImage: `url(${JSON.stringify(iconDataUrls[icon.id])})`,
                  WebkitMaskImage: `url(${JSON.stringify(iconDataUrls[icon.id])})`,
                  maskPosition: 'center',
                  WebkitMaskPosition: 'center',
                  maskRepeat: 'no-repeat',
                  WebkitMaskRepeat: 'no-repeat',
                  maskSize: 'contain',
                  WebkitMaskSize: 'contain',
                }"
                aria-hidden="true"
              />
              <span v-else class="size-5 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
              <span class="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-sm bg-popover px-2 py-1 text-2xs text-popover-foreground opacity-0 shadow-sm transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100">
                {{ icon.label }}
              </span>
            </button>
          </div>
        </div>

        <div class="grid min-h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-dashed border-border px-4 text-xs text-muted-foreground">
          <span class="truncate">{{ currentPack ? packLabel(currentPack) : m.picker_icon_svg_available() }}</span>
          <span role="status" aria-live="polite">{{ status || resultLabel }}</span>
          <div class="flex justify-end gap-2">
            <Button v-if="!searching" type="button" variant="outline" size="sm" :disabled="!canPrevious || loading" @click="previousPage">{{ m.picker_icon_previous() }}</Button>
            <Button v-if="!searching" type="button" variant="outline" size="sm" :disabled="!canNext || loading" @click="nextPage">{{ m.picker_icon_next() }}</Button>
            <Button v-else type="button" variant="outline" size="sm" :disabled="!canLoadMore || loading" @click="loadMore">{{ m.picker_icon_load_more() }}</Button>
          </div>
        </div>
        <p v-if="mediaError" role="alert" class="border-t border-dashed border-border px-4 py-2 text-xs text-destructive">{{ mediaError }}</p>
      </div>
    </DialogContent>
  </Dialog>

  <MediaPickerDialog
    v-model:open="mediaPickerOpen"
    :project-root="projectRoot"
    title="Upload icon SVG"
    description="Choose or upload an SVG from this project's media library."
    :media-types="['image']"
    require-svg
    @select="selectMedia"
  />
</template>
