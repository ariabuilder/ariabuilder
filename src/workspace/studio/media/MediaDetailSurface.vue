<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import {
  deleteMediaVariant,
  getMediaTransformState,
  getPlayableMediaUrl,
  listMediaUsages,
  previewMedia,
  saveMediaProfile,
  saveMediaVariantWithProfile,
  type MediaAsset,
  type MediaAssetUsage,
  type MediaAspectRatio,
  type MediaCropRect,
  type MediaFocalPoint,
  type MediaTransformOutput,
  type MediaTransformVariant,
} from "@/lib/media"
import { m } from "@/paraglide/messages.js"
import {
  StudioLeftRailReveal,
  StudioPanelShell,
  HeaderActionTooltip,
} from "@/workspace/studio/core"
import MediaCropCanvas from "./components/MediaCropCanvas.vue"
import MediaUsageList from "./components/MediaUsageList.vue"
import MediaVariantRail from "./components/MediaVariantRail.vue"
import type { MediaPlaybackController } from "./composables/useMediaPlayback"
import { bakeMediaVariant } from "./lib/bakeMediaVariant"
import { createFocalAspectRatioCrop } from "./lib/crop"
import { formatMediaClock } from "./lib/formatMediaClock"
import { confirm } from "@/composables/useConfirm"
import {
  guardDirtyNavigation,
  registerDirtyState,
} from "@/workspace/dirtyState"

const props = defineProps<{
  asset: MediaAsset
  projectRoot: string
  playback?: MediaPlaybackController
  /**
   * When true, skip the left rail chrome — parent keeps the media organizer
   * rail visible (used for video/audio/other detail).
   */
  embed?: boolean
}>()

const fullWidth = defineModel<boolean>("fullWidth", { default: false })

const emit = defineEmits<{
  back: []
  changed: []
}>()

const ASPECTS: Array<{ label: string; value: MediaAspectRatio | null }> = [
  { label: "Free", value: null },
  { label: "1:1", value: { width: 1, height: 1 } },
  { label: "4:5", value: { width: 4, height: 5 } },
  { label: "3:2", value: { width: 3, height: 2 } },
  { label: "16:9", value: { width: 16, height: 9 } },
]

const sourceUrl = ref<string | null>(null)
const playableUrl = ref<string | null>(null)
const variants = ref<MediaTransformVariant[]>([])
const usages = ref<MediaAssetUsage[]>([])
const activeVariantId = ref<string | null>(null)
const draftVariantName = ref<string | null>(null)
const variantName = ref("Crop")
const crop = ref<MediaCropRect>({ x: 0, y: 0, width: 1, height: 1 })
const profileFocalPoint = ref<MediaFocalPoint | null>(null)
const variantFocalPoint = ref<MediaFocalPoint | null>(null)
const isFocalMode = ref(false)
const aspectRatio = ref<MediaAspectRatio | null>(null)
const outputWidth = ref("")
const outputHeight = ref("")
const outputFormat = ref<MediaTransformOutput["format"]>("auto")
const outputQuality = ref(100)
const altText = ref("")
const title = ref("")
const caption = ref("")
const credit = ref("")
const copyright = ref("")
const sourceDimensions = ref<{ width: number; height: number } | null>(null)
const saving = ref(false)
const loading = ref(true)
const error = ref<string | null>(null)
const isMetadataOpen = ref(false)
const variantRailRef = ref<InstanceType<typeof MediaVariantRail> | null>(null)
const mediaEl = ref<HTMLVideoElement | HTMLAudioElement | null>(null)
const durationSec = ref(0)
const currentSec = ref(0)
const videoMuted = ref(true)
const cleanSnapshot = ref("")

const isImage = computed(() => props.asset.type === "image")
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
const activeVariant = computed(
  () => variants.value.find((v) => v.id === activeVariantId.value) ?? null,
)
const hasActiveVariant = computed(
  () => Boolean(activeVariant.value) || Boolean(draftVariantName.value),
)
const effectiveFocalPoint = computed(
  () => variantFocalPoint.value ?? profileFocalPoint.value,
)
const focalPreviewPosition = computed(() => {
  const point = effectiveFocalPoint.value ?? { x: 0.5, y: 0.5 }
  return `${Math.round(point.x * 100)}% ${Math.round(point.y * 100)}%`
})

function editableSnapshot(): string {
  return JSON.stringify({
    assetId: props.asset.id,
    profile: profileInput(),
    activeVariantId: activeVariantId.value,
    draftVariantName: draftVariantName.value,
    variantName: variantName.value,
    crop: crop.value,
    variantFocalPoint: variantFocalPoint.value,
    aspectRatio: aspectRatio.value,
    outputWidth: outputWidth.value,
    outputHeight: outputHeight.value,
    outputFormat: outputFormat.value,
    outputQuality: outputQuality.value,
  })
}

const isDirty = computed(
  () => !loading.value && Boolean(cleanSnapshot.value) && editableSnapshot() !== cleanSnapshot.value,
)

function markClean() {
  cleanSnapshot.value = editableSnapshot()
}

let loadGeneration = 0

async function loadPreview() {
  if (!isImage.value) {
    sourceUrl.value = null
    return
  }
  const result = await previewMedia(props.projectRoot, props.asset.id)
  sourceUrl.value = result.dataUrl
}

async function loadPlayable() {
  if (!isAv.value) {
    playableUrl.value = null
    return
  }
  const result = await getPlayableMediaUrl(props.projectRoot, props.asset.id)
  playableUrl.value = result.url
}

function applyProfile(profile: {
  altText: string | null
  title: string | null
  caption: string | null
  credit: string | null
  copyright: string | null
  focalPoint: MediaFocalPoint | null
} | null) {
  altText.value = profile?.altText ?? ""
  title.value = profile?.title ?? ""
  caption.value = profile?.caption ?? ""
  credit.value = profile?.credit ?? ""
  copyright.value = profile?.copyright ?? ""
  profileFocalPoint.value = profile?.focalPoint ?? null
}

async function loadState() {
  const generation = ++loadGeneration
  loading.value = true
  error.value = null
  sourceUrl.value = null
  playableUrl.value = null
  sourceDimensions.value = null
  durationSec.value = 0
  currentSec.value = 0
  videoMuted.value = true
  usages.value = []
  try {
    usages.value = await listMediaUsages(props.projectRoot, props.asset.id).catch(() => [])
    if (generation !== loadGeneration) return
    if (isImage.value) {
      await loadPreview()
      if (generation !== loadGeneration) return
      const state = await getMediaTransformState(
        props.projectRoot,
        props.asset.id,
      )
      if (generation !== loadGeneration) return
      variants.value = state.variants
      applyProfile(state.profile)
      selectOriginal()
      markClean()
      if (!sourceUrl.value) {
        error.value = m.media_detail_preview_unavailable()
      }
    } else if (isAv.value) {
      await loadPlayable()
      if (generation !== loadGeneration) return
      if (!playableUrl.value) {
        error.value = m.media_detail_preview_unavailable()
      }
    }
  } catch (err) {
    if (generation !== loadGeneration) return
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

function syncMediaRegistration() {
  props.playback?.registerElement(
    props.asset.id,
    isAv.value ? mediaEl.value : null,
  )
}

async function togglePlayback() {
  if (!props.playback || !isAv.value || !playableUrl.value) return
  if (isPlaying.value) {
    props.playback.requestPause(props.asset.id)
    return
  }
  await nextTick()
  syncMediaRegistration()
  const el = mediaEl.value
  if (!el) return
  if (el instanceof HTMLVideoElement) el.muted = videoMuted.value
  if (el instanceof HTMLAudioElement) el.volume = 0.8
  await props.playback.requestPlay(props.asset.id)
}

function toggleMute() {
  videoMuted.value = !videoMuted.value
  const el = mediaEl.value
  if (el instanceof HTMLVideoElement) el.muted = videoMuted.value
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

function onProgressClick(event: MouseEvent) {
  const el = mediaEl.value
  const target = event.currentTarget
  if (!el || !(target instanceof HTMLElement) || durationSec.value <= 0) return
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0) return
  const fraction = (event.clientX - rect.left) / rect.width
  el.currentTime = Math.min(
    durationSec.value,
    Math.max(0, fraction * durationSec.value),
  )
}

function seekTo(seconds: number) {
  const el = mediaEl.value
  if (!el || durationSec.value <= 0) return
  el.currentTime = Math.min(durationSec.value, Math.max(0, seconds))
}

function onProgressKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") seekTo(currentSec.value - 5)
  else if (event.key === "ArrowRight" || event.key === "ArrowUp") seekTo(currentSec.value + 5)
  else if (event.key === "PageDown") seekTo(currentSec.value - 30)
  else if (event.key === "PageUp") seekTo(currentSec.value + 30)
  else if (event.key === "Home") seekTo(0)
  else if (event.key === "End") seekTo(durationSec.value)
  else return
  event.preventDefault()
}

function selectOriginal() {
  activeVariantId.value = null
  draftVariantName.value = null
  variantName.value = "Crop"
  crop.value = { x: 0, y: 0, width: 1, height: 1 }
  aspectRatio.value = null
  variantFocalPoint.value = null
  outputWidth.value = ""
  outputHeight.value = ""
  outputFormat.value = "auto"
  outputQuality.value = 100
  isFocalMode.value = false
}

function selectVariant(variant: MediaTransformVariant) {
  activeVariantId.value = variant.id
  draftVariantName.value = null
  variantName.value = variant.name
  crop.value = { ...variant.crop }
  variantFocalPoint.value = variant.focalPoint
  aspectRatio.value = variant.aspectRatio
  outputWidth.value =
    variant.output.width != null ? String(variant.output.width) : ""
  outputHeight.value =
    variant.output.height != null ? String(variant.output.height) : ""
  outputFormat.value = variant.output.format
  outputQuality.value = variant.output.quality
  isFocalMode.value = false
}

async function selectVariantById(id: string) {
  const variant = variants.value.find((item) => item.id === id)
  if (!variant || !(await guardDirtyNavigation(props.projectRoot))) return
  selectVariant(variant)
  markClean()
}

async function requestSelectOriginal() {
  if (!(await guardDirtyNavigation(props.projectRoot))) return
  selectOriginal()
  markClean()
}

async function requestBack() {
  if (await guardDirtyNavigation(props.projectRoot)) emit("back")
}

function setRatio(next: MediaAspectRatio | null) {
  aspectRatio.value = next
  if (next && Number(outputWidth.value) > 0) {
    outputHeight.value = String(
      Math.round((Number(outputWidth.value) * next.height) / next.width),
    )
  }
  if (!next || !sourceDimensions.value) return
  crop.value = createFocalAspectRatioCrop({
    source: sourceDimensions.value,
    aspectRatio: next,
    focalPoint: effectiveFocalPoint.value,
  })
}

async function createNewVariant(name: string) {
  if (!isImage.value) return
  const trimmed = name.trim()
  if (!trimmed) return
  if (!(await guardDirtyNavigation(props.projectRoot))) return
  activeVariantId.value = null
  draftVariantName.value = trimmed
  variantName.value = trimmed
  crop.value = { x: 0, y: 0, width: 1, height: 1 }
  variantFocalPoint.value = null
  outputWidth.value = "1600"
  outputHeight.value = "900"
  outputFormat.value = "auto"
  outputQuality.value = 100
  isFocalMode.value = false
  setRatio({ width: 16, height: 9 })
}

function handleSourceDimensions(value: {
  width: number
  height: number
}) {
  const wasUnknown = sourceDimensions.value === null
  sourceDimensions.value = value
  // Draft crops set 16:9 before the image reports size — apply once dims arrive.
  if (wasUnknown && draftVariantName.value && aspectRatio.value) {
    setRatio(aspectRatio.value)
  }
}

function handleQualityUpdate(value: number[] | undefined) {
  const next = value?.[0]
  if (typeof next !== "number") return
  outputQuality.value = Math.min(100, Math.max(1, Math.round(next)))
}

function handleFocalPointUpdate(value: MediaFocalPoint) {
  if (hasActiveVariant.value) {
    variantFocalPoint.value = value
  } else {
    profileFocalPoint.value = value
  }
}

function startNewVariant() {
  variantRailRef.value?.startCreate()
}

function profileInput() {
  return {
    assetPath: props.asset.id,
    altText: altText.value.trim() || null,
    title: title.value.trim() || null,
    caption: caption.value.trim() || null,
    credit: credit.value.trim() || null,
    copyright: copyright.value.trim() || null,
    focalPoint: profileFocalPoint.value,
  }
}

async function persistProfile(): Promise<boolean> {
  try {
    await saveMediaProfile(props.projectRoot, profileInput())
    markClean()
    emit("changed")
    return true
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    return false
  }
}

async function persistOriginal(): Promise<boolean> {
  saving.value = true
  error.value = null
  try {
    return await persistProfile()
  } finally {
    saving.value = false
  }
}

async function persistVariant(): Promise<boolean> {
  if (!sourceUrl.value || !isImage.value || !hasActiveVariant.value) return false
  saving.value = true
  error.value = null
  try {
    const output: MediaTransformOutput = {
      width: Number(outputWidth.value) || null,
      height: Number(outputHeight.value) || null,
      format: outputFormat.value,
      quality: outputQuality.value,
    }
    const baked = await bakeMediaVariant({
      sourceUrl: sourceUrl.value,
      crop: crop.value,
      output,
    })
    const id = activeVariantId.value ?? crypto.randomUUID()
    // Prefer the encode we actually produced (Chromium has no reliable AVIF encode).
    const resolvedFormat: MediaTransformOutput["format"] =
      output.format === "auto" || output.format === "avif"
        ? baked.extension === ".png"
          ? "png"
          : baked.extension === ".webp"
            ? "webp"
            : "jpeg"
        : output.format
    const result = await saveMediaVariantWithProfile(props.projectRoot, {
      variant: {
        id,
        assetPath: props.asset.id,
        name: variantName.value.trim() || "Crop",
        crop: crop.value,
        focalPoint: variantFocalPoint.value,
        aspectRatio: aspectRatio.value,
        output: {
          ...output,
          width: output.width ?? baked.width,
          height: output.height ?? baked.height,
          format: resolvedFormat,
        },
        bytes: baked.bytes,
      },
      profile: profileInput(),
    })
    variants.value = [
      ...variants.value.filter((v) => v.id !== result.variant.id),
      result.variant,
    ].sort((a, b) => a.name.localeCompare(b.name))
    selectVariant(result.variant)
    markClean()
    emit("changed")
    return true
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    return false
  } finally {
    saving.value = false
  }
}

async function removeVariant() {
  if (!activeVariant.value) return
  const ok = await confirm({
    title: m.media_detail_delete_variant(),
    description: m.media_delete_confirm_description(),
    confirmLabel: m.confirm_delete(),
    cancelLabel: m.confirm_cancel(),
    destructive: true,
  })
  if (!ok) return
  saving.value = true
  error.value = null
  try {
    const state = await deleteMediaVariant(
      props.projectRoot,
      props.asset.id,
      activeVariant.value.id,
    )
    variants.value = state.variants
    selectOriginal()
    markClean()
    emit("changed")
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

function isAspectActive(value: MediaAspectRatio | null): boolean {
  return JSON.stringify(aspectRatio.value) === JSON.stringify(value)
}

onMounted(() => {
  void loadState()
})

watch(
  [() => props.projectRoot, () => props.asset.id],
  ([projectRoot, assetId], _previous, onCleanup) => {
    const unregister = registerDirtyState(projectRoot, `media:${assetId}`, {
      label: m.media_dirty_label(),
      isDirty: () => isDirty.value,
      save: () => hasActiveVariant.value ? persistVariant() : persistOriginal(),
      discard: loadState,
    })
    onCleanup(unregister)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  props.playback?.registerElement(props.asset.id, null)
})

watch(
  () => props.asset.id,
  () => {
    fullWidth.value = false
    props.playback?.stop()
    void loadState()
  },
)

watch(mediaEl, () => {
  syncMediaRegistration()
})

watch(playableUrl, async (url) => {
  if (!url) return
  await nextTick()
  syncMediaRegistration()
})
</script>

<template>
  <StudioPanelShell :variant="embed || fullWidth ? 'default' : 'rail'">
    <template v-if="!embed && !fullWidth" #rail>
      <StudioLeftRailReveal>
        <MediaVariantRail
          v-if="isImage"
          ref="variantRailRef"
          :variants="variants"
          :selected-variant-id="activeVariantId"
          :draft-variant-name="draftVariantName"
          :source-dimensions="sourceDimensions"
          :can-create="isImage"
          @select-original="requestSelectOriginal"
          @select-variant="selectVariantById"
          @create-variant="createNewVariant"
        />
      </StudioLeftRailReveal>
    </template>

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header
        class="flex shrink-0 items-center gap-3 bg-background px-3 pt-3"
      >
        <Button variant="ghost" size="sm" @click="requestBack">
          <AppIcon name="arrowLeft" class="mr-1.5 size-3.5" />
          {{ m.media_detail_back() }}
        </Button>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-lg font-medium">{{ asset.name }}</h1>
          <p class="truncate text-xs text-muted-foreground">{{ asset.url }}</p>
        </div>
        <HeaderActionTooltip
          :label="
            fullWidth ? m.media_detail_collapse() : m.media_detail_expand()
          "
        >
          <Button
            variant="headerAction"
            size="icon-header"
            class="shrink-0"
            :aria-label="
              fullWidth ? m.media_detail_collapse() : m.media_detail_expand()
            "
            :aria-pressed="fullWidth"
            @click="fullWidth = !fullWidth"
          >
            <AppIcon
              :name="fullWidth ? 'minimizeScreen' : 'fullScreen'"
              class="size-3.5"
            />
          </Button>
        </HeaderActionTooltip>
        <Button
          v-if="isImage"
          size="sm"
          class="shrink-0"
          @click="startNewVariant"
        >
          <AppIcon name="plus" class="mr-1.5 size-3.5" />
          {{ m.media_detail_new_crop() }}
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-auto">
        <div
          v-if="loading"
          class="flex items-center justify-center py-24"
        >
          <AppIcon
            name="refresh"
            class="size-6 animate-spin text-muted-foreground"
          />
        </div>

        <div
          v-else
          class="relative mx-auto w-full px-7 py-6"
          :class="
            fullWidth
              ? isImage
                ? 'grid max-w-none grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]'
                : 'max-w-none'
              : isImage
                ? 'grid max-w-7xl grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]'
                : 'max-w-4xl'
          "
        >
          <p v-if="error" class="mb-3 text-sm text-destructive lg:col-span-2">
            {{ error }}
          </p>

          <!-- Video / audio player -->
          <div v-if="isAv && playableUrl" class="space-y-4">
            <div
              class="relative overflow-hidden rounded-xl border border-solid border-border/50 bg-muted/50"
              :class="
                isVideo
                  ? fullWidth
                    ? 'aspect-video max-h-[min(78vh,100%)] w-full'
                    : 'aspect-video'
                  : fullWidth
                    ? 'min-h-72'
                    : 'min-h-56'
              "
            >
              <video
                v-if="isVideo"
                ref="mediaEl"
                class="h-full w-full object-contain"
                :src="playableUrl"
                playsinline
                preload="metadata"
                :muted="videoMuted"
                @timeupdate="onMediaTimeUpdate"
                @loadedmetadata="onMediaLoadedMetadata"
                @ended="onMediaEnded"
                @click="togglePlayback"
              />
              <template v-else>
                <audio
                  ref="mediaEl"
                  class="hidden"
                  :src="playableUrl"
                  preload="metadata"
                  @timeupdate="onMediaTimeUpdate"
                  @loadedmetadata="onMediaLoadedMetadata"
                  @ended="onMediaEnded"
                />
                <div
                  class="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6"
                >
                  <div
                    class="flex items-end gap-1"
                    :class="isPlaying ? 'h-12' : undefined"
                  >
                    <template v-if="isPlaying">
                      <span
                        v-for="n in 7"
                        :key="n"
                        class="media-detail-eq-bar w-1.5 rounded-full bg-primary/80"
                        :style="{ animationDelay: `${(n - 1) * 0.1}s` }"
                      />
                    </template>
                    <AppIcon
                      v-else
                      name="audioWave"
                      class="size-12 text-muted-foreground/50"
                    />
                  </div>
                  <p class="max-w-full truncate text-sm font-medium">
                    {{ asset.name }}
                  </p>
                </div>
              </template>

              <div
                class="absolute inset-x-0 bottom-0 bg-linear-to-t from-background/90 via-background/40 to-transparent px-4 pb-3 pt-10"
              >
                <div class="mb-2 flex items-center gap-2">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="secondary"
                    class="size-9 shrink-0"
                    :aria-label="isPlaying ? m.media_pause() : m.media_play()"
                    @click="togglePlayback"
                  >
                    <AppIcon :name="isPlaying ? 'pause' : 'play'" :size="18" />
                  </Button>
                  <button
                    type="button"
                    class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/15"
                    role="slider"
                    :aria-label="m.media_seek()"
                    aria-valuemin="0"
                    :aria-valuemax="Math.round(durationSec)"
                    :aria-valuenow="Math.round(currentSec)"
                    :aria-valuetext="`${formatMediaClock(currentSec)} / ${formatMediaClock(durationSec)}`"
                    @click="onProgressClick"
                    @keydown="onProgressKeydown"
                  >
                    <div
                      class="h-full rounded-full bg-primary transition-[width] duration-100"
                      :style="{ width: `${progress * 100}%` }"
                    />
                  </button>
                  <span
                    class="shrink-0 text-2xs tabular-nums text-muted-foreground"
                  >
                    {{ formatMediaClock(currentSec) }}
                    /
                    {{ formatMediaClock(durationSec) }}
                  </span>
                  <Button
                    v-if="isVideo"
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    class="size-8 shrink-0"
                    :aria-label="
                      videoMuted ? m.media_unmute() : m.media_mute()
                    "
                    @click="toggleMute"
                  >
                    <AppIcon
                      :name="videoMuted ? 'volumeMute' : 'volumeHigh'"
                      :size="16"
                    />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <p
            v-else-if="!isImage"
            class="text-sm text-muted-foreground"
          >
            {{
              isAv
                ? m.media_detail_preview_unavailable()
                : m.media_detail_unsupported()
            }}
          </p>

          <template v-else-if="sourceUrl">
            <div class="grid overflow-hidden lg:contents">
              <div class="lg:col-start-1">
                <MediaCropCanvas
                  :src="sourceUrl"
                  :alt="asset.name"
                  v-model="crop"
                  :aspect-ratio="aspectRatio"
                  :focal-point="effectiveFocalPoint"
                  :focal-mode="isFocalMode"
                  @source-dimensions="handleSourceDimensions"
                  @update:focal-point="handleFocalPointUpdate"
                />
              </div>

              <aside class="space-y-5 p-5 lg:absolute lg:top-0 lg:right-0 lg:w-76">
                <div v-if="hasActiveVariant" class="space-y-5">
                  <div class="space-y-3">
                    <Label for="media-variant-name">{{
                      m.media_detail_variant_name()
                    }}</Label>
                    <Input
                      id="media-variant-name"
                      v-model="variantName"
                      maxlength="100"
                    />
                  </div>

                  <div class="space-y-3">
                    <Label>{{ m.media_detail_aspect() }}</Label>
                    <div class="grid grid-cols-3 gap-2">
                      <Button
                        v-for="option in ASPECTS"
                        :key="option.label"
                        type="button"
                        size="sm"
                        :variant="
                          isAspectActive(option.value) ? 'secondary' : 'outline'
                        "
                        @click="setRatio(option.value)"
                      >
                        {{
                          option.value == null
                            ? m.media_detail_aspect_free()
                            : option.label
                        }}
                      </Button>
                    </div>
                  </div>

                  <div class="space-y-3">
                    <Label>{{ m.media_detail_focal() }}</Label>
                    <div
                      class="overflow-hidden rounded-md border border-solid border-border/50 bg-card/40"
                    >
                      <div class="aspect-video overflow-hidden bg-muted/20">
                        <img
                          :src="sourceUrl"
                          :alt="altText || asset.name"
                          class="h-full w-full object-cover"
                          :style="{ objectPosition: focalPreviewPosition }"
                        />
                      </div>
                    </div>
                    <div class="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        class="flex-1"
                        :variant="isFocalMode ? 'secondary' : 'outline'"
                        @click="isFocalMode = !isFocalMode"
                      >
                        {{
                          isFocalMode
                            ? m.media_detail_click_image()
                            : variantFocalPoint
                              ? m.media_detail_adjust_focal()
                              : m.media_detail_set_focal()
                        }}
                      </Button>
                      <Button
                        v-if="variantFocalPoint"
                        type="button"
                        size="sm"
                        variant="outline"
                        :aria-label="m.media_detail_use_original_focal()"
                        @click="variantFocalPoint = null"
                      >
                        {{ m.media_detail_use_original_focal() }}
                      </Button>
                    </div>
                    <p
                      v-if="!variantFocalPoint"
                      class="text-2xs text-muted-foreground"
                    >
                      {{ m.media_detail_using_original_focal() }}
                    </p>
                  </div>

                  <div class="space-y-5">
                    <div class="flex items-center gap-3">
                      <Label for="media-output-width" class="w-16 shrink-0">{{
                        m.media_detail_width()
                      }}</Label>
                      <Input
                        id="media-output-width"
                        v-model="outputWidth"
                        inputmode="numeric"
                        class="flex-1"
                      />
                    </div>
                    <div class="flex items-center gap-3">
                      <Label for="media-output-height" class="w-16 shrink-0">{{
                        m.media_detail_height()
                      }}</Label>
                      <Input
                        id="media-output-height"
                        v-model="outputHeight"
                        inputmode="numeric"
                        class="flex-1"
                      />
                    </div>
                    <div class="flex items-center gap-3">
                      <Label for="media-output-format" class="w-16 shrink-0">{{
                        m.media_detail_format()
                      }}</Label>
                      <div class="min-w-0 flex-1">
                        <Select v-model="outputFormat">
                          <SelectTrigger
                            id="media-output-format"
                            class="w-full"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">{{
                              m.media_detail_format_auto()
                            }}</SelectItem>
                            <SelectItem value="webp">WebP</SelectItem>
                            <SelectItem value="avif">AVIF</SelectItem>
                            <SelectItem value="jpeg">JPEG</SelectItem>
                            <SelectItem value="png">PNG</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div class="flex items-center gap-3">
                      <Label for="media-output-quality" class="w-16 shrink-0">{{
                        m.media_detail_quality()
                      }}</Label>
                      <div class="flex min-w-0 flex-1 items-center gap-2">
                        <Slider
                          id="media-output-quality"
                          class="flex-1 py-2"
                          :model-value="[outputQuality]"
                          :min="1"
                          :max="100"
                          :step="1"
                          :aria-label="m.media_detail_output_quality()"
                          @update:model-value="handleQualityUpdate"
                        />
                        <output
                          for="media-output-quality"
                          class="w-9 shrink-0 text-right text-2xs tabular-nums text-muted-foreground"
                        >
                          {{ outputQuality }}%
                        </output>
                      </div>
                    </div>
                  </div>

                  <div class="flex gap-2 pt-1">
                    <Button
                      class="flex-1"
                      :disabled="saving || !sourceUrl"
                      @click="persistVariant"
                    >
                      <AppIcon
                        v-if="saving"
                        name="refresh"
                        class="mr-1.5 size-3.5 animate-spin"
                      />
                      {{
                        saving
                          ? m.media_detail_saving()
                          : m.media_detail_save()
                      }}
                    </Button>
                    <Button
                      v-if="activeVariant"
                      variant="outline"
                      :disabled="saving"
                      :aria-label="m.media_detail_delete_variant()"
                      @click="removeVariant"
                    >
                      <AppIcon name="trash" class="size-4" />
                    </Button>
                  </div>
                </div>

                <div v-else class="space-y-5">
                  <div class="space-y-3">
                    <Label>{{ m.media_detail_default_focal() }}</Label>
                    <div
                      class="overflow-hidden rounded-md border border-solid border-border/50 bg-card/40"
                    >
                      <div class="aspect-video overflow-hidden bg-muted/20">
                        <img
                          :src="sourceUrl"
                          :alt="altText || asset.name"
                          class="h-full w-full object-cover"
                          :style="{ objectPosition: focalPreviewPosition }"
                        />
                      </div>
                    </div>
                    <div class="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        class="flex-1"
                        :variant="isFocalMode ? 'secondary' : 'outline'"
                        @click="isFocalMode = !isFocalMode"
                      >
                        {{
                          isFocalMode
                            ? m.media_detail_click_image()
                            : m.media_detail_set_default_focal()
                        }}
                      </Button>
                      <Button
                        v-if="profileFocalPoint"
                        type="button"
                        size="sm"
                        variant="outline"
                        :aria-label="m.media_detail_clear_focal()"
                        @click="profileFocalPoint = null"
                      >
                        {{ m.media_detail_clear_focal() }}
                      </Button>
                    </div>
                  </div>

                  <Button
                    class="w-full"
                    :disabled="saving"
                    @click="persistOriginal"
                  >
                    <AppIcon
                      v-if="saving"
                      name="refresh"
                      class="mr-1.5 size-3.5 animate-spin"
                    />
                    {{
                      saving
                        ? m.media_detail_saving()
                        : m.media_detail_save_original()
                    }}
                  </Button>
                </div>
              </aside>
            </div>

            <Collapsible
              v-model:open="isMetadataOpen"
              class="rounded-lg border border-dashed border-border bg-card/50 p-5 lg:col-start-1"
            >
              <CollapsibleTrigger as-child>
                <button
                  type="button"
                  class="flex w-full items-start justify-between gap-4 text-left"
                >
                  <span>
                    <span class="m-0 block text-sm font-semibold">{{
                      m.media_detail_metadata()
                    }}</span>
                    <span
                      class="mt-1 block text-xs text-balance text-muted-foreground"
                    >
                      {{ m.media_detail_metadata_description() }}
                    </span>
                  </span>
                  <AppIcon
                    name="chevronDown"
                    class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform"
                    :class="isMetadataOpen ? 'rotate-180' : ''"
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent class="pt-7">
                <div class="grid gap-4 md:grid-cols-2">
                  <div class="space-y-2 md:col-span-2">
                    <Label for="media-alt-text">{{
                      m.media_detail_alt()
                    }}</Label>
                    <Textarea
                      id="media-alt-text"
                      v-model="altText"
                      rows="2"
                      :placeholder="m.media_detail_alt_placeholder()"
                    />
                  </div>
                  <div class="space-y-2">
                    <Label for="media-title">{{
                      m.media_detail_title()
                    }}</Label>
                    <Input id="media-title" v-model="title" />
                  </div>
                  <div class="space-y-2">
                    <Label for="media-credit">{{
                      m.media_detail_credit()
                    }}</Label>
                    <Input id="media-credit" v-model="credit" />
                  </div>
                  <div class="space-y-2 md:col-span-2">
                    <Label for="media-caption">{{
                      m.media_detail_caption()
                    }}</Label>
                    <Textarea
                      id="media-caption"
                      v-model="caption"
                      rows="2"
                    />
                  </div>
                  <div class="space-y-2 md:col-span-2">
                    <Label for="media-copyright">{{
                      m.media_detail_copyright()
                    }}</Label>
                    <Input id="media-copyright" v-model="copyright" />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </template>

          <MediaUsageList class="lg:col-start-1" :usages="usages" />
        </div>
      </div>
    </div>
  </StudioPanelShell>
</template>

<style scoped>
.media-detail-eq-bar {
  height: 30%;
  animation: media-detail-eq 0.85s ease-in-out infinite;
}
.media-detail-eq-bar:nth-child(2) {
  height: 55%;
}
.media-detail-eq-bar:nth-child(3) {
  height: 100%;
}
.media-detail-eq-bar:nth-child(4) {
  height: 40%;
}
.media-detail-eq-bar:nth-child(5) {
  height: 75%;
}
.media-detail-eq-bar:nth-child(6) {
  height: 50%;
}
.media-detail-eq-bar:nth-child(7) {
  height: 65%;
}

@keyframes media-detail-eq {
  0%,
  100% {
    transform: scaleY(0.45);
  }
  50% {
    transform: scaleY(1);
  }
}
</style>
