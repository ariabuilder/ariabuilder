<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { ColorField } from "@/components/ui/color-picker"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { AppIconName } from "@/icons/registry"
import type { MediaAsset, MediaTransformVariant } from "@/lib/media"
import { getMediaTransformState } from "@/lib/media"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import MediaPickerDialog from "@/workspace/studio/media/components/MediaPickerDialog.vue"
import {
  BACKGROUND_ATTACHMENT_OPTIONS,
  BACKGROUND_BLEND_MODE_OPTIONS,
  BACKGROUND_REPEAT_OPTIONS,
  BACKGROUND_SIZE_OPTIONS,
  clearedBackgroundUpdates,
  colorBackgroundUpdates,
  cssToGradient,
  extractBackgroundImageUrl,
  gradientBackgroundUpdates,
  gradientToCSS,
  imageBackgroundUpdates,
  inferBackgroundType,
  resolveBackgroundStyleValues,
  type BackgroundAttachment,
  type BackgroundBlendMode,
  type BackgroundRepeat,
  type BackgroundSize,
  type BackgroundStyleKey,
  type BackgroundType,
  type GradientConfig,
  type GradientType,
} from "../../../../shared/composer"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import GradientAngleDial from "./GradientAngleDial.vue"
import InspectorPositionGridPicker from "./InspectorPositionGridPicker.vue"
import {
  DEFAULT_POSITION_VALUE,
  normalizeBackgroundPositionValue,
} from "./positionOptions"

type BackgroundImageSourceMode = "media" | "url" | "collection"

const props = defineProps<{
  values: Partial<Record<BackgroundStyleKey, string>>
  inheritedProperties?: readonly string[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  preview: [updates: Record<string, string>]
  commit: [updates: Record<string, string>]
}>()

const inspector = tryUseInspectorContext()
const PROPERTY_ROW_CLASS = "grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2"
const PROPERTY_LABEL_CLASS =
  "flex items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground"
const SELECT_TRIGGER_CLASS =
  "h-9 border-dashed border-border/70 bg-sidebar text-xs hover:border-border hover:bg-sidebar/80 focus:ring-0 focus:ring-offset-0"
const INPUT_CLASS =
  "h-9 border-dashed border-border/70 bg-sidebar text-xs placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0"
const IMAGE_SOURCE_TOGGLE_CLASS =
  "flex h-8 min-w-0 flex-[1_1_auto] items-center justify-center whitespace-nowrap rounded-sm border border-dashed border-border/70 bg-sidebar px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:border-border hover:bg-sidebar/80 hover:text-foreground"
const ACTIVE_IMAGE_SOURCE_TOGGLE_CLASS =
  "border-primary/70 bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgb(var(--color-primary)/0.18)]"

const BACKGROUND_MODE_OPTIONS = [
  { value: "none" as const, label: m.composer_background_none, icon: "closeSquare" as const },
  { value: "color" as const, label: m.composer_background_color, icon: "colorPalette" as const },
  { value: "gradient" as const, label: m.composer_background_gradient, icon: "threeSquares" as const },
  { value: "image" as const, label: m.composer_background_image, icon: "galleryBold" as const },
] satisfies readonly { value: BackgroundType; label: () => string; icon: AppIconName }[]

const BACKGROUND_IMAGE_SOURCE_OPTIONS = [
  { value: "media" as const, label: m.composer_background_source_media },
  { value: "url" as const, label: m.composer_background_source_url },
  { value: "collection" as const, label: m.composer_background_source_collection },
] as const

const backgroundType = ref<BackgroundType>("none")
const backgroundColor = ref("transparent")
const gradientStart = ref("#000000")
const gradientMid = ref("")
const gradientMidPosition = ref("50")
const gradientEnd = ref("#ffffff")
const gradientAngle = ref("180")
const gradientType = ref<GradientType>("linear")
const backgroundImageUrl = ref("")
const backgroundImageSourceMode = ref<BackgroundImageSourceMode>("media")
const VARIANT_ORIGINAL = "original"
const backgroundSize = ref("cover")
const backgroundPosition = ref(DEFAULT_POSITION_VALUE)
const backgroundRepeat = ref<BackgroundRepeat>("no-repeat")
const backgroundAttachment = ref<BackgroundAttachment>("scroll")
const backgroundBlendMode = ref<BackgroundBlendMode>("normal")
const isDragging = ref(false)
const isMediaPickerOpen = ref(false)
const variants = ref<MediaTransformVariant[]>([])
const selectedAsset = ref<MediaAsset | null>(null)
const selectedVariantId = ref(VARIANT_ORIGINAL)
const loadingVariants = ref(false)
let mediaRequestGeneration = 0

const projectPath = computed(() => inspector?.projectPath.value ?? "")
const hasBackgroundImage = computed(() => backgroundImageUrl.value.trim().length > 0)
const isCustomBackgroundSize = computed(() =>
  Boolean(backgroundSize.value)
  && !(BACKGROUND_SIZE_OPTIONS as readonly string[]).includes(backgroundSize.value),
)
const showAdvancedControls = computed(
  () => backgroundType.value === "gradient" || backgroundType.value === "image",
)
const showStaticBackgroundImageSource = computed(
  () => backgroundImageSourceMode.value !== "collection",
)

function inherited(prop: string) {
  return Boolean(props.inheritedProperties?.includes(prop))
}

function buildCurrentGradientConfig(): GradientConfig {
  const angle = Number.parseFloat(gradientAngle.value.trim() || "180")
  const midColor = gradientMid.value.trim()
  const midPosition = Number.parseFloat(gradientMidPosition.value.trim() || "50")
  const stops: GradientConfig["stops"] = [
    { color: gradientStart.value.trim() || "#000000", position: 0 },
  ]
  if (midColor) {
    stops.push({
      color: midColor,
      position: Number.isFinite(midPosition) ? Math.min(100, Math.max(0, midPosition)) : 50,
    })
  }
  stops.push({ color: gradientEnd.value.trim() || "#ffffff", position: 100 })
  return {
    type: gradientType.value,
    angle: Number.isFinite(angle) ? angle : 180,
    stops,
  }
}

const gradientPreviewStyle = computed(() => ({
  background: gradientToCSS(buildCurrentGradientConfig()),
}))

const backgroundImageSummary = computed(() => {
  const next = backgroundImageUrl.value.trim()
  if (!next) return m.composer_background_none_selected()
  if (next.startsWith("data:")) return m.composer_background_dropped()
  try {
    const normalizedUrl = new URL(next, typeof window !== "undefined" ? window.location.origin : "http://localhost")
    const segments = normalizedUrl.pathname.split("/").filter(Boolean)
    const lastSegment = segments[segments.length - 1]
    return lastSegment ? decodeURIComponent(lastSegment) : next
  } catch {
    return next
  }
})

function resolveImageSourceMode(url: string): BackgroundImageSourceMode {
  if (/^https?:\/\//i.test(url.trim())) return "url"
  return "media"
}

function applyGradientConfig(gradient: GradientConfig) {
  gradientType.value = gradient.type
  gradientStart.value = gradient.stops[0]?.color || "#000000"
  gradientMid.value =
    gradient.stops[1] && gradient.stops.length > 2 ? gradient.stops[1].color : ""
  gradientMidPosition.value =
    gradient.stops[1] && gradient.stops.length > 2
      ? String(gradient.stops[1].position ?? 50)
      : "50"
  gradientEnd.value = gradient.stops[gradient.stops.length - 1]?.color || "#ffffff"
  gradientAngle.value = String(gradient.angle ?? 90)
}

let lastInferredType: BackgroundType | null = null

function syncFromProps() {
  const resolved = resolveBackgroundStyleValues(props.values)
  const colorValue = resolved["background-color"] || "transparent"
  const imageValue = resolved["background-image"] || ""
  const parsedGradient = imageValue ? cssToGradient(imageValue) : null
  const inferred = inferBackgroundType(resolved)
  const size = resolved["background-size"] || ""
  const repeat = resolved["background-repeat"] || ""
  const attachment = resolved["background-attachment"] || ""
  const blend = resolved["background-blend-mode"] || ""

  backgroundColor.value = colorValue
  backgroundSize.value = size || "cover"
  backgroundPosition.value = normalizeBackgroundPositionValue(
    resolved["background-position"] || DEFAULT_POSITION_VALUE,
  )
  backgroundRepeat.value = BACKGROUND_REPEAT_OPTIONS.includes(repeat as BackgroundRepeat)
    ? repeat as BackgroundRepeat
    : "no-repeat"
  backgroundAttachment.value = BACKGROUND_ATTACHMENT_OPTIONS.includes(attachment as BackgroundAttachment)
    ? attachment as BackgroundAttachment
    : "scroll"
  backgroundBlendMode.value = BACKGROUND_BLEND_MODE_OPTIONS.includes(blend as BackgroundBlendMode)
    ? blend as BackgroundBlendMode
    : "normal"

  if (parsedGradient) applyGradientConfig(parsedGradient)
  if (inferred === "image") {
    backgroundImageUrl.value = extractBackgroundImageUrl(imageValue)
    backgroundImageSourceMode.value = resolveImageSourceMode(backgroundImageUrl.value)
    if (!selectedAsset.value) void hydrateVariantsForUrl(backgroundImageUrl.value)
  } else if (inferred !== "gradient" && backgroundType.value !== "image") {
    backgroundImageUrl.value = ""
  }

  if (inferred !== lastInferredType) {
    backgroundType.value = inferred
    lastInferredType = inferred
  }
}

watch(() => props.values, syncFromProps, { deep: true, immediate: true })

function selectBackgroundType(nextType: BackgroundType) {
  if (props.disabled) return
  backgroundType.value = nextType
  if (nextType === "none") {
    lastInferredType = "none"
    emit("commit", clearedBackgroundUpdates())
    return
  }
  if (nextType === "image") {
    backgroundImageSourceMode.value = resolveImageSourceMode(backgroundImageUrl.value)
  }
}

function previewColor(next: string) {
  if (props.disabled) return
  backgroundColor.value = next
  emit("preview", colorBackgroundUpdates(next))
}

function commitColor(next: string) {
  if (props.disabled) return
  backgroundColor.value = next
  const normalized = next.trim() || "transparent"
  lastInferredType = normalized.toLowerCase() === "transparent" ? "none" : "color"
  emit("commit", colorBackgroundUpdates(next))
}

function previewGradient() {
  if (props.disabled) return
  emit("preview", gradientBackgroundUpdates(
    gradientToCSS(buildCurrentGradientConfig()),
    backgroundBlendMode.value,
  ))
}

function commitGradient() {
  if (props.disabled) return
  lastInferredType = "gradient"
  emit("commit", gradientBackgroundUpdates(
    gradientToCSS(buildCurrentGradientConfig()),
    backgroundBlendMode.value,
  ))
}

function commitImage() {
  if (props.disabled) return
  lastInferredType = backgroundImageUrl.value.trim() ? "image" : "none"
  emit("commit", imageBackgroundUpdates({
    url: backgroundImageUrl.value,
    size: backgroundSize.value,
    position: normalizeBackgroundPositionValue(backgroundPosition.value),
    repeat: backgroundRepeat.value,
    attachment: backgroundAttachment.value,
    blendMode: backgroundBlendMode.value,
  }))
}

function handleGradientTypeChange(next: unknown) {
  if (next !== "linear" && next !== "radial") return
  gradientType.value = next
  commitGradient()
}

function handleGradientStartPreview(next: string) {
  gradientStart.value = next
  previewGradient()
}

function handleGradientMidPreview(next: string) {
  gradientMid.value = next
  previewGradient()
}

function handleGradientEndPreview(next: string) {
  gradientEnd.value = next
  previewGradient()
}

function handleGradientMidPositionBlur() {
  commitGradient()
}

function handleGradientAngleInput(next: string) {
  gradientAngle.value = next
  previewGradient()
}

function setBackgroundSize(next: unknown) {
  if (typeof next !== "string" || !next.trim()) return
  backgroundSize.value = next
  commitImage()
}

function setBackgroundRepeat(next: unknown) {
  if (!BACKGROUND_REPEAT_OPTIONS.includes(next as BackgroundRepeat)) return
  backgroundRepeat.value = next as BackgroundRepeat
  commitImage()
}

function setBackgroundPosition(next: string) {
  backgroundPosition.value = normalizeBackgroundPositionValue(next)
  commitImage()
}

function setBackgroundAttachment(next: unknown) {
  if (!BACKGROUND_ATTACHMENT_OPTIONS.includes(next as BackgroundAttachment)) return
  backgroundAttachment.value = next as BackgroundAttachment
  if (backgroundType.value === "gradient") commitGradient()
  else commitImage()
}

function setBackgroundBlendMode(next: unknown) {
  if (!BACKGROUND_BLEND_MODE_OPTIONS.includes(next as BackgroundBlendMode)) return
  backgroundBlendMode.value = next as BackgroundBlendMode
  if (backgroundType.value === "gradient") commitGradient()
  else commitImage()
}

function handleBackgroundImageSourceModeChange(next: BackgroundImageSourceMode) {
  backgroundImageSourceMode.value = next
}

function sizeLabel(option: BackgroundSize) {
  if (option === "cover") return m.composer_background_size_cover()
  if (option === "contain") return m.composer_background_size_contain()
  return m.composer_background_size_auto()
}

function repeatLabel(option: BackgroundRepeat) {
  if (option === "no-repeat") return m.composer_background_repeat_no_repeat()
  if (option === "repeat-x") return m.composer_background_repeat_x()
  if (option === "repeat-y") return m.composer_background_repeat_y()
  return m.composer_background_repeat_repeat()
}

function attachmentLabel(option: BackgroundAttachment) {
  if (option === "fixed") return m.composer_background_attachment_fixed()
  if (option === "local") return m.composer_background_attachment_local()
  return m.composer_background_attachment_scroll()
}

function blendLabel(option: BackgroundBlendMode) {
  switch (option) {
    case "multiply": return m.composer_background_blend_multiply()
    case "screen": return m.composer_background_blend_screen()
    case "overlay": return m.composer_background_blend_overlay()
    case "darken": return m.composer_background_blend_darken()
    case "lighten": return m.composer_background_blend_lighten()
    case "soft-light": return m.composer_background_blend_soft_light()
    case "difference": return m.composer_background_blend_difference()
    case "luminosity": return m.composer_background_blend_luminosity()
    default: return m.composer_background_blend_normal()
  }
}

function openBackgroundPicker() {
  if (props.disabled || backgroundType.value !== "image") return
  isMediaPickerOpen.value = true
}

function clearBackgroundImage() {
  backgroundImageUrl.value = ""
  selectedAsset.value = null
  variants.value = []
  selectedVariantId.value = VARIANT_ORIGINAL
  commitImage()
}

function guessAssetIdFromUrl(url: string): string | null {
  const extracted = extractBackgroundImageUrl(url).split("?")[0]
  if (!extracted.startsWith("/uploads/") || extracted.includes("/variants/")) return null
  return `public${extracted}`
}

function mediaAssetFromUploadPath(assetId: string, url: string, cropCount: number): MediaAsset {
  return {
    id: assetId,
    name: assetId.split("/").pop() ?? assetId,
    type: "image",
    file: assetId,
    url,
    size: 0,
    mimeType: "image",
    mtimeMs: 0,
    dimensions: null,
    cropCount,
  }
}

async function hydrateVariantsForUrl(url: string) {
  const path = projectPath.value
  const assetId = guessAssetIdFromUrl(url)
  if (!path || !assetId) return
  const request = ++mediaRequestGeneration
  loadingVariants.value = true
  try {
    const state = await getMediaTransformState(path, assetId)
    if (request !== mediaRequestGeneration) return
    const currentVersion = state.profile?.currentSourceVersion
    variants.value = state.variants.filter(
      (variant) => variant.sourceVersion === (currentVersion ?? variant.sourceVersion),
    )
    const extracted = extractBackgroundImageUrl(url)
    const match = variants.value.find((variant) => variant.url === extracted)
    selectedVariantId.value = match?.id ?? VARIANT_ORIGINAL
    selectedAsset.value = mediaAssetFromUploadPath(
      assetId,
      `/${assetId.replace(/^public\//, "")}`,
      variants.value.length,
    )
  } catch {
    if (request !== mediaRequestGeneration) return
    variants.value = []
    selectedVariantId.value = VARIANT_ORIGINAL
  } finally {
    if (request === mediaRequestGeneration) loadingVariants.value = false
  }
}

function applyImageUrl(url: string) {
  backgroundType.value = "image"
  backgroundImageUrl.value = url
  backgroundImageSourceMode.value = resolveImageSourceMode(url)
  commitImage()
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  isDragging.value = true
}

function handleDragLeave(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  const current = event.currentTarget
  const related = event.relatedTarget
  if (current instanceof Node && related instanceof Node && current.contains(related)) return
  isDragging.value = false
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  isDragging.value = false
  if (props.disabled) return
  const mediaUrl = event.dataTransfer?.getData("media-url")
  if (mediaUrl) {
    selectedAsset.value = null
    variants.value = []
    applyImageUrl(mediaUrl)
    return
  }
  const file = event.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith("image/")) return
  const reader = new FileReader()
  reader.onload = (loadEvent) => {
    const dataUrl = loadEvent.target?.result
    if (typeof dataUrl !== "string") return
    selectedAsset.value = null
    variants.value = []
    applyImageUrl(dataUrl)
  }
  reader.readAsDataURL(file)
}

async function selectSource(asset: MediaAsset) {
  const request = ++mediaRequestGeneration
  selectedAsset.value = asset
  loadingVariants.value = true
  let state: Awaited<ReturnType<typeof getMediaTransformState>> | null = null
  try {
    state = await getMediaTransformState(projectPath.value, asset.id)
  } catch {
    state = null
  }
  try {
    if (request !== mediaRequestGeneration) return
    variants.value = state?.variants.filter(
      (variant) => variant.sourceVersion === (state?.profile?.currentSourceVersion ?? variant.sourceVersion),
    ) ?? []
    selectedVariantId.value = VARIANT_ORIGINAL
    applyImageUrl(asset.url)
  } finally {
    if (request === mediaRequestGeneration) loadingVariants.value = false
  }
}

function selectVariant(id: unknown) {
  const nextId = String(id)
  if (nextId === VARIANT_ORIGINAL || !nextId) {
    selectedVariantId.value = VARIANT_ORIGINAL
    if (selectedAsset.value) applyImageUrl(selectedAsset.value.url)
    return
  }
  const variant = variants.value.find((item) => item.id === nextId)
  if (!variant) return
  selectedVariantId.value = variant.id
  applyImageUrl(variant.url)
}

watch(() => backgroundImageUrl.value, (next) => {
  const belongsToSelectedAsset = Boolean(selectedAsset.value && (
    next === selectedAsset.value.url
    || variants.value.some((variant) => variant.url === next)
  ))
  if (belongsToSelectedAsset) return
  mediaRequestGeneration += 1
  loadingVariants.value = false
  selectedAsset.value = null
  variants.value = []
  selectedVariantId.value = VARIANT_ORIGINAL
}, { flush: "sync" })

async function onBackgroundTypeKeydown(event: KeyboardEvent) {
  const modes = BACKGROUND_MODE_OPTIONS.map((option) => option.value)
  const current = modes.indexOf(backgroundType.value)
  let index = current < 0 ? 0 : current
  if (["ArrowRight", "ArrowDown"].includes(event.key)) index = (index + 1) % modes.length
  else if (["ArrowLeft", "ArrowUp"].includes(event.key)) index = (index - 1 + modes.length) % modes.length
  else if (event.key === "Home") index = 0
  else if (event.key === "End") index = modes.length - 1
  else return
  event.preventDefault()
  const next = modes[index]
  if (!next) return
  const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
  selectBackgroundType(next)
  await nextTick()
  ;(group?.querySelector(`[data-background-mode="${next}"]`) as HTMLElement | null)?.focus()
}

async function onSourceModeKeydown(event: KeyboardEvent) {
  const current = BACKGROUND_IMAGE_SOURCE_OPTIONS.findIndex((option) => option.value === backgroundImageSourceMode.value)
  let index = current < 0 ? 0 : current
  if (["ArrowRight", "ArrowDown"].includes(event.key)) index = (index + 1) % BACKGROUND_IMAGE_SOURCE_OPTIONS.length
  else if (["ArrowLeft", "ArrowUp"].includes(event.key)) index = (index - 1 + BACKGROUND_IMAGE_SOURCE_OPTIONS.length) % BACKGROUND_IMAGE_SOURCE_OPTIONS.length
  else if (event.key === "Home") index = 0
  else if (event.key === "End") index = BACKGROUND_IMAGE_SOURCE_OPTIONS.length - 1
  else return
  event.preventDefault()
  const next = BACKGROUND_IMAGE_SOURCE_OPTIONS[index]
  if (!next) return
  const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
  handleBackgroundImageSourceModeChange(next.value)
  await nextTick()
  ;(group?.querySelector(`[data-source-mode="${next.value}"]`) as HTMLElement | null)?.focus()
}

defineExpose({ selectSource, selectVariant, applyImageUrl })
</script>

<template>
  <div data-testid="composer-background-controls" class="space-y-3">
    <div
      class="flex h-9 overflow-hidden rounded-sm border border-dashed border-border/70 bg-sidebar"
      role="radiogroup"
      :aria-label="m.composer_inspector_section_background()"
      @keydown="onBackgroundTypeKeydown"
    >
      <Tooltip
        v-for="option in BACKGROUND_MODE_OPTIONS"
        :key="option.value"
      >
        <TooltipTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            role="radio"
            :aria-checked="backgroundType === option.value"
            :aria-label="option.label()"
            :tabindex="backgroundType === option.value ? 0 : -1"
            :data-testid="`background-mode-${option.value}`"
            :data-background-mode="option.value"
            class="h-full flex-1 rounded-none border-0 px-0 text-muted-foreground hover:bg-sidebar/80 hover:text-foreground"
            :class="backgroundType === option.value ? 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary' : ''"
            :disabled="disabled"
            @click.stop="selectBackgroundType(option.value)"
          >
            <AppIcon :name="option.icon" :size="16" class="size-4 shrink-0" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" class="text-xs">
          {{ option.label() }}
        </TooltipContent>
      </Tooltip>
    </div>

    <div v-if="backgroundType === 'color'" :class="PROPERTY_ROW_CLASS">
      <label :class="PROPERTY_LABEL_CLASS">
        {{ m.composer_background_color() }}
        <span
          v-if="inherited('background-color')"
          class="size-1.5 rounded-full border border-primary/60"
          :title="m.composer_inspector_inherited_value()"
        />
      </label>
      <ColorField
        :model-value="backgroundColor"
        layout="unified"
        persist-mode="commit"
        show-variables
        show-alpha
        show-design-colors
        content-side="left"
        content-align="center"
        class="min-w-0 w-full"
        data-testid="background-color-input"
        contrast-against="#ffffff"
        :disabled="disabled"
        :trigger-label="m.composer_background_color()"
        @preview="previewColor"
        @commit="commitColor"
      />
    </div>

    <div v-if="backgroundType === 'gradient'" class="space-y-3">
      <div
        data-testid="background-gradient-preview"
        class="h-20 overflow-hidden rounded-md border border-dashed border-border/50"
        :style="gradientPreviewStyle"
        aria-hidden="true"
      />

      <div :class="PROPERTY_ROW_CLASS">
        <label :class="PROPERTY_LABEL_CLASS">{{ m.composer_background_type() }}</label>
        <Select :model-value="gradientType" :disabled="disabled" @update:model-value="handleGradientTypeChange">
          <SelectTrigger :class="SELECT_TRIGGER_CLASS">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="linear">{{ m.composer_background_linear() }}</SelectItem>
            <SelectItem value="radial">{{ m.composer_background_radial() }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div v-if="gradientType === 'linear'" :class="PROPERTY_ROW_CLASS">
        <label :class="PROPERTY_LABEL_CLASS">{{ m.composer_background_angle() }}</label>
        <div class="flex items-center gap-2">
          <GradientAngleDial
            :model-value="gradientAngle"
            :disabled="disabled"
            @update:model-value="handleGradientAngleInput"
            @commit="commitGradient"
          />
          <div class="flex h-9 flex-1 items-center overflow-hidden rounded-sm border border-dashed border-border/70 bg-sidebar">
            <Input
              v-model="gradientAngle"
              type="text"
              inputmode="numeric"
              placeholder="180"
              class="h-full flex-1 border-0 bg-transparent px-2 text-center text-xs shadow-none focus-visible:ring-0"
              :disabled="disabled"
              @blur="commitGradient"
              @keydown.enter="commitGradient"
            />
            <span class="border-l border-dashed border-border/70 px-2 text-xs text-muted-foreground">deg</span>
          </div>
        </div>
      </div>

      <div :class="PROPERTY_ROW_CLASS">
        <label :class="PROPERTY_LABEL_CLASS">{{ m.composer_background_start() }}</label>
        <ColorField
          :model-value="gradientStart"
          layout="unified"
          persist-mode="commit"
          show-variables
          show-alpha
          show-design-colors
          content-side="left"
          content-align="center"
          class="min-w-0 w-full"
          :contrast-against="gradientEnd"
          :disabled="disabled"
          @preview="handleGradientStartPreview"
          @update:model-value="gradientStart = $event"
          @commit="commitGradient"
        />
      </div>

      <div :class="PROPERTY_ROW_CLASS">
        <label :class="PROPERTY_LABEL_CLASS">{{ m.composer_background_middle() }}</label>
        <div class="flex items-center gap-2">
          <ColorField
            :model-value="gradientMid"
            layout="unified"
            persist-mode="commit"
            show-variables
            show-alpha
            show-design-colors
            content-side="left"
            content-align="center"
            class="min-w-0 flex-1"
            :contrast-against="gradientStart"
            :disabled="disabled"
            @preview="handleGradientMidPreview"
            @update:model-value="gradientMid = $event"
            @commit="commitGradient"
          />
          <div class="flex h-9 w-16 shrink-0 items-center overflow-hidden rounded-sm border border-dashed border-border/70 bg-sidebar">
            <Input
              v-model="gradientMidPosition"
              type="text"
              inputmode="numeric"
              placeholder="50"
              class="h-full flex-1 border-0 bg-transparent px-1 text-center text-xs shadow-none focus-visible:ring-0"
              :disabled="disabled || !gradientMid"
              @blur="handleGradientMidPositionBlur"
              @keydown.enter="commitGradient"
            />
            <span class="border-l border-dashed border-border/70 px-1.5 text-xs text-muted-foreground">%</span>
          </div>
        </div>
      </div>

      <div :class="PROPERTY_ROW_CLASS">
        <label :class="PROPERTY_LABEL_CLASS">{{ m.composer_background_end() }}</label>
        <ColorField
          :model-value="gradientEnd"
          layout="unified"
          persist-mode="commit"
          show-variables
          show-alpha
          show-design-colors
          content-side="left"
          content-align="center"
          class="min-w-0 w-full"
          :contrast-against="gradientStart"
          :disabled="disabled"
          @preview="handleGradientEndPreview"
          @update:model-value="gradientEnd = $event"
          @commit="commitGradient"
        />
      </div>
    </div>

    <div v-if="backgroundType === 'image'" class="space-y-3">
      <div
        class="flex w-full flex-nowrap items-center gap-1.5"
        role="radiogroup"
        :aria-label="m.composer_background_source()"
        data-testid="background-image-source-mode"
        @keydown="onSourceModeKeydown"
      >
        <button
          v-for="option in BACKGROUND_IMAGE_SOURCE_OPTIONS"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="backgroundImageSourceMode === option.value"
          :tabindex="backgroundImageSourceMode === option.value ? 0 : -1"
          :data-testid="`background-image-source-mode-${option.value}`"
          :data-source-mode="option.value"
          :class="cn(IMAGE_SOURCE_TOGGLE_CLASS, backgroundImageSourceMode === option.value && ACTIVE_IMAGE_SOURCE_TOGGLE_CLASS)"
          :disabled="disabled"
          @click="handleBackgroundImageSourceModeChange(option.value)"
        >
          {{ option.label() }}
        </button>
      </div>

      <p
        v-if="backgroundImageSourceMode === 'collection'"
        class="rounded-md border border-dashed border-border/70 p-2 text-[10px] text-muted-foreground"
      >
        {{ m.composer_background_collection_hint() }}
      </p>

      <div
        v-if="showStaticBackgroundImageSource"
        class="space-y-2.5 rounded-md border border-dashed border-border/50 bg-muted/20 p-2.5"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 space-y-0.5">
            <span class="text-[10px] uppercase tracking-wide text-muted-foreground">{{ m.composer_background_preview() }}</span>
            <p class="truncate text-xs font-medium text-foreground">{{ backgroundImageSummary }}</p>
          </div>
          <div class="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-7 shrink-0"
              data-testid="background-replace-button"
              :aria-label="m.composer_background_choose_image()"
              :disabled="disabled"
              @click="openBackgroundPicker"
            >
              <AppIcon name="imageUpload" :size="14" class="size-3.5 shrink-0" />
            </Button>
            <Button
              v-if="hasBackgroundImage"
              type="button"
              variant="ghost"
              size="icon"
              class="size-7 shrink-0"
              data-testid="background-clear-button"
              :aria-label="m.composer_background_clear_image()"
              :disabled="disabled"
              @click="clearBackgroundImage"
            >
              <AppIcon name="close" :size="14" class="size-3.5 shrink-0" />
            </Button>
          </div>
        </div>

        <div
          data-testid="background-preview"
          role="button"
          tabindex="0"
          :aria-label="m.composer_background_choose_image()"
          class="flex h-28 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border/50 bg-background/60 transition-colors hover:border-primary/40 hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          :class="isDragging ? 'border-primary/60 bg-primary/5' : ''"
          @click="openBackgroundPicker"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          @drop="handleDrop"
          @keydown.enter.prevent="openBackgroundPicker"
          @keydown.space.prevent="openBackgroundPicker"
        >
          <img
            v-if="hasBackgroundImage"
            :src="backgroundImageUrl"
            :alt="m.composer_background_preview_alt()"
            class="h-full w-full object-cover"
            :style="{ objectPosition: backgroundPosition }"
          />
          <p v-else class="px-4 text-center text-xs text-muted-foreground">
            {{ m.composer_background_drop_or_choose() }}
          </p>
        </div>

        <label v-if="variants.length" class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
          <span :class="PROPERTY_LABEL_CLASS">{{ m.composer_background_variant() }}</span>
          <Select
            :model-value="selectedVariantId"
            :disabled="disabled || loadingVariants"
            @update:model-value="selectVariant"
          >
            <SelectTrigger :class="SELECT_TRIGGER_CLASS" data-testid="background-variant-select">
              <SelectValue :placeholder="m.composer_background_variant_original()" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="VARIANT_ORIGINAL">{{ m.composer_background_variant_original() }}</SelectItem>
              <SelectItem v-for="variant in variants" :key="variant.id" :value="variant.id">
                {{ variant.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>

        <div :class="PROPERTY_ROW_CLASS">
          <label :class="PROPERTY_LABEL_CLASS">{{ m.composer_background_url() }}</label>
          <Input
            v-model="backgroundImageUrl"
            placeholder="https://..."
            :class="INPUT_CLASS"
            :disabled="disabled"
            data-testid="background-url-input"
            @blur="commitImage"
            @keydown.enter="commitImage"
          />
        </div>

        <div :class="PROPERTY_ROW_CLASS">
          <label :class="PROPERTY_LABEL_CLASS">{{ m.composer_background_size() }}</label>
          <Select
            :model-value="backgroundSize"
            :disabled="disabled"
            @update:model-value="setBackgroundSize"
          >
            <SelectTrigger data-testid="background-size-select" :class="SELECT_TRIGGER_CLASS">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-if="isCustomBackgroundSize" :value="backgroundSize">
                {{ backgroundSize }}
              </SelectItem>
              <SelectItem v-for="option in BACKGROUND_SIZE_OPTIONS" :key="option" :value="option">
                {{ sizeLabel(option) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div :class="PROPERTY_ROW_CLASS">
          <label :class="PROPERTY_LABEL_CLASS">{{ m.composer_background_position() }}</label>
          <InspectorPositionGridPicker
            :model-value="backgroundPosition"
            :disabled="disabled"
            preview-key-prefix="background-position"
            @update:model-value="setBackgroundPosition"
          />
        </div>

        <div :class="PROPERTY_ROW_CLASS">
          <label :class="PROPERTY_LABEL_CLASS">{{ m.composer_background_repeat() }}</label>
          <Select
            :model-value="backgroundRepeat"
            :disabled="disabled"
            @update:model-value="setBackgroundRepeat"
          >
            <SelectTrigger data-testid="background-repeat-select" :class="SELECT_TRIGGER_CLASS">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in BACKGROUND_REPEAT_OPTIONS" :key="option" :value="option">
                {{ repeatLabel(option) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>

    <div
      v-if="showAdvancedControls"
      class="space-y-2 border-t border-dashed border-border/50 pt-3"
    >
      <div :class="PROPERTY_ROW_CLASS">
        <label :class="PROPERTY_LABEL_CLASS">{{ m.composer_background_attachment() }}</label>
        <Select
          :model-value="backgroundAttachment"
          :disabled="disabled"
          @update:model-value="setBackgroundAttachment"
        >
          <SelectTrigger data-testid="background-attachment-select" :class="SELECT_TRIGGER_CLASS">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in BACKGROUND_ATTACHMENT_OPTIONS" :key="option" :value="option">
              {{ attachmentLabel(option) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div :class="PROPERTY_ROW_CLASS">
        <label :class="PROPERTY_LABEL_CLASS">{{ m.composer_background_blend() }}</label>
        <Select
          :model-value="backgroundBlendMode"
          :disabled="disabled"
          @update:model-value="setBackgroundBlendMode"
        >
          <SelectTrigger data-testid="background-blend-mode-select" :class="SELECT_TRIGGER_CLASS">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in BACKGROUND_BLEND_MODE_OPTIONS" :key="option" :value="option">
              {{ blendLabel(option) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <MediaPickerDialog
      v-model:open="isMediaPickerOpen"
      :project-root="projectPath"
      :title="m.composer_background_select_image()"
      :description="m.composer_background_select_image_description()"
      :media-types="['image']"
      @select="selectSource"
    />
  </div>
</template>
