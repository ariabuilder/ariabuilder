<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import AppContextMenuItems from "@/components/menu/AppContextMenuItems.vue"
import AppDropdownMenuItems from "@/components/menu/AppDropdownMenuItems.vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AppIconName } from "@/icons/registry"
import {
  getPlayableMediaUrl,
  previewMedia,
  type MediaAsset,
} from "@/lib/media"
import { cn } from "@/lib/utils"
import type { MenuItemDef } from "@/menu/types"
import { m } from "@/paraglide/messages.js"
import type { MediaPlaybackController } from "../composables/useMediaPlayback"
import { formatMediaClock } from "../lib/formatMediaClock"

const props = defineProps<{
  asset: MediaAsset
  projectRoot: string
  items: MenuItemDef[]
  selected?: boolean
  /** When true, preview uses natural aspect for masonry columns. */
  masonry?: boolean
  playback?: MediaPlaybackController
}>()

const emit = defineEmits<{
  open: []
  action: [id: string]
  dragStart: [event: DragEvent]
}>()

/** Stable across menu Content unmount (confirm deletes). */
function dispatchAction(id: string) {
  emit("action", id)
}

const thumbUrl = ref<string | null>(null)
const playableUrl = ref<string | null>(null)
const fontFamily = ref<string | null>(null)
const fontReady = ref(false)
const loadedDimensions = ref<{ width: number; height: number } | null>(null)
const overflowOpen = ref(false)
const mediaEl = ref<HTMLVideoElement | HTMLAudioElement | null>(null)
const durationSec = ref(0)
const currentSec = ref(0)
const videoMuted = ref(true)

let loadedFontFace: FontFace | null = null
let loadGeneration = 0

const PLACEHOLDER_ICONS = {
  document: "file",
  other: "hardDrive",
} as const satisfies Record<"document" | "other", AppIconName>

const isImage = computed(() => props.asset.type === "image")
const isFont = computed(() => props.asset.type === "font")
const isVideo = computed(() => props.asset.type === "video")
const isAudio = computed(() => props.asset.type === "audio")
const isAv = computed(() => isVideo.value || isAudio.value)

const isPlaying = computed(
  () => props.playback?.isPlaying(props.asset.id) ?? false,
)

const progress = computed(() => {
  if (durationSec.value <= 0) return 0
  return Math.min(1, Math.max(0, currentSec.value / durationSec.value))
})

const placeholderIcon = computed<AppIconName>(() => {
  if (isFont.value) return "typography"
  if (isVideo.value) return "video"
  if (isAudio.value) return "audioWave"
  if (props.asset.type === "image") return "media"
  if (props.asset.type === "document") return PLACEHOLDER_ICONS.document
  return PLACEHOLDER_ICONS.other
})

const previewFrameStyle = computed<Record<string, string> | undefined>(() => {
  if (!props.masonry) return undefined
  return { aspectRatio: resolvePreviewAspectRatio() }
})

function resolvePreviewAspectRatio(): string {
  const measuredWidth = loadedDimensions.value?.width ?? 0
  const measuredHeight = loadedDimensions.value?.height ?? 0
  if (measuredWidth > 0 && measuredHeight > 0) {
    return `${measuredWidth} / ${measuredHeight}`
  }

  const width = props.asset.dimensions?.width ?? 0
  const height = props.asset.dimensions?.height ?? 0
  if (width > 0 && height > 0) {
    return `${width} / ${height}`
  }

  if (props.asset.type === "video") return "16 / 10"
  if (props.asset.type === "font") return "5 / 4"
  return "4 / 3"
}

function fontFamilyId(assetId: string): string {
  const safe = assetId.replace(/[^a-zA-Z0-9_-]/g, "-")
  return `aria-media-font-${safe}`
}

function clearFontPreview() {
  if (loadedFontFace) {
    try {
      document.fonts.delete(loadedFontFace)
    } catch {
      // Ignore cleanup failures from stale faces.
    }
    loadedFontFace = null
  }
  fontFamily.value = null
  fontReady.value = false
}

function handlePreviewImageLoad(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLImageElement)) return
  if (target.naturalWidth <= 0 || target.naturalHeight <= 0) return
  loadedDimensions.value = {
    width: target.naturalWidth,
    height: target.naturalHeight,
  }
}

async function loadImageThumb(generation: number) {
  try {
    const result = await previewMedia(props.projectRoot, props.asset.id)
    if (generation !== loadGeneration) return
    thumbUrl.value = result.dataUrl
  } catch {
    if (generation !== loadGeneration) return
    thumbUrl.value = null
  }
}

async function loadFontPreview(generation: number) {
  clearFontPreview()
  try {
    const result = await previewMedia(props.projectRoot, props.asset.id)
    if (generation !== loadGeneration) return
    if (!result.dataUrl) return

    const family = fontFamilyId(props.asset.id)
    const face = new FontFace(family, `url(${result.dataUrl})`)
    await face.load()
    if (generation !== loadGeneration) return

    document.fonts.add(face)
    loadedFontFace = face
    fontFamily.value = family
    fontReady.value = true
  } catch {
    if (generation !== loadGeneration) return
    clearFontPreview()
  }
}

async function loadPreview() {
  const generation = ++loadGeneration
  thumbUrl.value = null
  clearFontPreview()

  if (props.asset.type === "image") {
    await loadImageThumb(generation)
    return
  }
  if (props.asset.type === "font") {
    await loadFontPreview(generation)
  }
}

async function ensurePlayableUrl(): Promise<string | null> {
  if (playableUrl.value) return playableUrl.value
  try {
    const result = await getPlayableMediaUrl(
      props.projectRoot,
      props.asset.id,
    )
    playableUrl.value = result.url
    return result.url
  } catch {
    playableUrl.value = null
    return null
  }
}

function syncMediaRegistration() {
  props.playback?.registerElement(
    props.asset.id,
    isAv.value ? mediaEl.value : null,
  )
}

async function togglePlayback(event: Event) {
  event.stopPropagation()
  event.preventDefault()
  if (!props.playback || !isAv.value) return

  if (isPlaying.value) {
    props.playback.requestPause(props.asset.id)
    return
  }

  const url = await ensurePlayableUrl()
  if (!url) return
  await nextTick()
  syncMediaRegistration()
  const el = mediaEl.value
  if (!el) return

  if (isVideo.value && el instanceof HTMLVideoElement) {
    el.muted = videoMuted.value
  }
  if (isAudio.value && el instanceof HTMLAudioElement) {
    el.volume = 0.8
  }
  await props.playback.requestPlay(props.asset.id)
}

function toggleMute(event: Event) {
  event.stopPropagation()
  event.preventDefault()
  videoMuted.value = !videoMuted.value
  const el = mediaEl.value
  if (el instanceof HTMLVideoElement) {
    el.muted = videoMuted.value
  }
}

function onMediaTimeUpdate() {
  const el = mediaEl.value
  if (!el) return
  currentSec.value = el.currentTime || 0
}

function onMediaLoadedMetadata() {
  const el = mediaEl.value
  if (!el) return
  durationSec.value = Number.isFinite(el.duration) ? el.duration : 0
}

function onMediaEnded() {
  props.playback?.requestPause(props.asset.id)
  currentSec.value = 0
}

onMounted(() => {
  void loadPreview()
})

onBeforeUnmount(() => {
  loadGeneration += 1
  clearFontPreview()
  props.playback?.registerElement(props.asset.id, null)
})

watch(
  () => [props.asset.id, props.asset.mtimeMs, props.asset.type],
  () => {
    loadedDimensions.value = null
    playableUrl.value = null
    durationSec.value = 0
    currentSec.value = 0
    videoMuted.value = true
    void loadPreview()
  },
)

watch(mediaEl, () => {
  syncMediaRegistration()
})
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <article
        draggable="true"
        :class="
          cn(
            'group relative w-full overflow-hidden rounded-xl border border-solid border-border/50 bg-card/80 text-left shadow-xs transition-[border-color,box-shadow,background-color] duration-150 ease-out hover:border-border hover:shadow-md',
            selected ? 'border-primary ring-1 ring-primary/40' : undefined,
          )
        "
        @dragstart="emit('dragStart', $event)"
      >
        <div
          class="preview-actions absolute right-3 top-3 z-30 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[open=true]:opacity-100"
          :data-open="overflowOpen ? 'true' : undefined"
          @click.stop
          @pointerdown.stop
        >
          <DropdownMenu v-model:open="overflowOpen">
            <DropdownMenuTrigger as-child>
              <Button
                variant="outline"
                size="icon-sm"
                class="size-8! bg-background/90 shadow-xs backdrop-blur-sm"
                :aria-label="asset.name"
              >
                <AppIcon name="moreHorizontal" :size="16" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-52 p-0" @click.stop>
              <DropdownMenuGroup>
                <AppDropdownMenuItems
                  :items="items"
                  :dispatch="dispatchAction"
                />
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          role="button"
          tabindex="0"
          class="block w-full cursor-pointer text-left"
          @click="emit('open')"
          @keydown.enter.prevent="emit('open')"
          @keydown.space.prevent="emit('open')"
        >
          <div
            data-organizer-drag-preview
            class="relative overflow-hidden"
            :class="[
              masonry ? undefined : 'aspect-4/3',
              isAv ? 'bg-muted/55' : 'bg-muted/40',
            ]"
            :style="previewFrameStyle"
          >
            <img
              v-if="thumbUrl && isImage"
              :src="thumbUrl"
              :alt="asset.name"
              class="h-full w-full object-cover"
              draggable="false"
              loading="lazy"
              decoding="async"
              @load="handlePreviewImageLoad"
            />

            <!-- Video player -->
            <template v-else-if="isVideo">
              <video
                v-show="playableUrl"
                ref="mediaEl"
                class="h-full w-full object-cover"
                :src="playableUrl ?? undefined"
                playsinline
                preload="metadata"
                :muted="videoMuted"
                @timeupdate="onMediaTimeUpdate"
                @loadedmetadata="onMediaLoadedMetadata"
                @ended="onMediaEnded"
              />
              <div
                v-if="!playableUrl || !isPlaying"
                class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-3"
                :class="playableUrl ? 'bg-black/25' : undefined"
              >
                <AppIcon
                  v-if="!playableUrl"
                  name="video"
                  class="size-8 text-muted-foreground/55"
                />
                <p
                  v-if="!isPlaying"
                  class="max-w-full truncate text-center text-xs font-medium"
                  :class="
                    playableUrl
                      ? 'text-white/90'
                      : 'text-foreground/75'
                  "
                >
                  {{ asset.name }}
                </p>
              </div>
              <button
                type="button"
                class="absolute left-1/2 top-1/2 z-10 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md backdrop-blur-sm transition-opacity"
                :class="
                  isPlaying
                    ? 'opacity-0 group-hover:opacity-100'
                    : 'opacity-100'
                "
                :aria-label="isPlaying ? m.media_pause() : m.media_play()"
                @click="togglePlayback"
              >
                <AppIcon
                  :name="isPlaying ? 'pause' : 'play'"
                  :size="20"
                />
              </button>
              <div
                v-if="durationSec > 0"
                class="pointer-events-none absolute bottom-2 left-2 z-20 rounded bg-background/90 px-1.5 py-0.5 text-2xs tabular-nums text-foreground"
              >
                {{ formatMediaClock(isPlaying ? currentSec : durationSec) }}
              </div>
              <button
                v-if="isPlaying || playableUrl"
                type="button"
                class="absolute bottom-2 right-2 z-20 flex size-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow-xs backdrop-blur-sm"
                :aria-label="videoMuted ? m.media_unmute() : m.media_mute()"
                @click="toggleMute"
              >
                <AppIcon
                  :name="videoMuted ? 'volumeMute' : 'volumeHigh'"
                  :size="14"
                />
              </button>
              <div
                class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5 bg-foreground/10"
              >
                <div
                  class="h-full bg-primary transition-[width] duration-100"
                  :style="{ width: `${progress * 100}%` }"
                />
              </div>
            </template>

            <!-- Audio player -->
            <template v-else-if="isAudio">
              <audio
                ref="mediaEl"
                class="hidden"
                :src="playableUrl ?? undefined"
                preload="metadata"
                @timeupdate="onMediaTimeUpdate"
                @loadedmetadata="onMediaLoadedMetadata"
                @ended="onMediaEnded"
              />
              <div
                class="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-3"
              >
                <div
                  class="flex items-end gap-0.5"
                  :class="isPlaying ? 'h-8' : undefined"
                >
                  <template v-if="isPlaying">
                    <span
                      v-for="n in 5"
                      :key="n"
                      class="media-eq-bar w-1 rounded-full bg-primary/80"
                      :style="{ animationDelay: `${(n - 1) * 0.12}s` }"
                    />
                  </template>
                  <AppIcon
                    v-else
                    name="audioWave"
                    class="size-8 text-muted-foreground/55"
                  />
                </div>
                <p
                  class="max-w-full truncate text-center text-xs font-medium text-foreground/75"
                >
                  {{ asset.name }}
                </p>
                <p
                  v-if="durationSec > 0"
                  class="text-2xs tabular-nums text-muted-foreground"
                >
                  {{
                    formatMediaClock(isPlaying ? currentSec : durationSec)
                  }}
                </p>
              </div>
              <button
                type="button"
                class="absolute left-1/2 top-[58%] z-10 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md backdrop-blur-sm transition-opacity"
                :class="
                  isPlaying
                    ? 'opacity-0 group-hover:opacity-100'
                    : 'opacity-90'
                "
                :aria-label="isPlaying ? m.media_pause() : m.media_play()"
                @click="togglePlayback"
              >
                <AppIcon
                  :name="isPlaying ? 'pause' : 'play'"
                  :size="18"
                />
              </button>
              <div
                class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5 bg-foreground/10"
              >
                <div
                  class="h-full bg-primary transition-[width] duration-100"
                  :style="{ width: `${progress * 100}%` }"
                />
              </div>
            </template>

            <!-- Font: live Aa sample + name, centered -->
            <div
              v-else-if="isFont"
              class="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-3"
            >
              <span
                class="select-none text-[2.75rem] leading-none tracking-tight text-foreground"
                :class="fontReady ? undefined : 'text-muted-foreground/40'"
                :style="
                  fontReady && fontFamily
                    ? { fontFamily: `'${fontFamily}', ui-sans-serif, system-ui` }
                    : undefined
                "
              >
                Aa
              </span>
              <p
                class="max-w-full truncate text-center text-xs font-medium text-foreground/80"
              >
                {{ asset.name }}
              </p>
            </div>

            <!-- Docs / other -->
            <div
              v-else-if="!isImage || !thumbUrl"
              class="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-3"
            >
              <AppIcon
                :name="placeholderIcon"
                class="size-8 text-muted-foreground/55"
              />
              <p
                class="max-w-full truncate text-center text-xs font-medium text-foreground/75"
              >
                {{ asset.name }}
              </p>
            </div>

            <span
              v-if="asset.cropCount > 0"
              class="absolute right-1.5 top-1.5 z-20 rounded bg-background/90 px-1.5 py-0.5 text-2xs tabular-nums text-foreground"
              :class="'group-hover:right-12'"
            >
              {{ asset.cropCount }}
            </span>
            <div
              v-if="isImage && thumbUrl"
              class="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-background/90 via-background/40 to-transparent px-2.5 pb-2 pt-8 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <p class="truncate text-xs font-medium text-foreground">
                {{ asset.name }}
              </p>
            </div>
          </div>
        </div>
      </article>
    </ContextMenuTrigger>

    <ContextMenuContent class="w-52 p-0">
      <ContextMenuGroup>
        <AppContextMenuItems
          :items="items"
          :dispatch="dispatchAction"
        />
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>

<style scoped>
.media-eq-bar {
  height: 30%;
  animation: media-eq 0.85s ease-in-out infinite;
}

.media-eq-bar:nth-child(2) {
  height: 55%;
}
.media-eq-bar:nth-child(3) {
  height: 100%;
}
.media-eq-bar:nth-child(4) {
  height: 45%;
}
.media-eq-bar:nth-child(5) {
  height: 70%;
}

@keyframes media-eq {
  0%,
  100% {
    transform: scaleY(0.45);
  }
  50% {
    transform: scaleY(1);
  }
}
</style>
