<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { MediaAsset, MediaTransformVariant } from "@/lib/media"
import { getMediaTransformState, getPlayableMediaUrl } from "@/lib/media"
import MediaPickerDialog from "@/workspace/studio/media/components/MediaPickerDialog.vue"
import {
  COMPOSER_IMAGE_PLACEHOLDER_SRC,
  LEGACY_BRANDED_COMPOSER_IMAGE_PLACEHOLDER_SRC,
  LEGACY_COMPOSER_IMAGE_PLACEHOLDER_SRC,
  nodeAtMarkerPath,
  isBooleanChecked,
  parseStyleAttr,
  serializeStyleAttr,
  setPropAtPath,
  stringFieldDisplay,
} from "../../../../shared/composer"
import type { ElementNode, PropValue } from "../../../../shared/composer/types"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import InspectorPropertySection from "./InspectorPropertySection.vue"
import InspectorObjectPositionControl from "./InspectorObjectPositionControl.vue"

const props = defineProps<{
  node: ElementNode
  openSection?: string | null
  disabled?: boolean
  /** Path of `node` when it is nested under the current selection (e.g. Avatar image). */
  targetPath?: string | null
}>()
const emit = defineEmits<{ "update:openSection": [value: string | null] }>()
const inspector = tryUseInspectorContext()
const mediaPath = computed(() => props.targetPath?.trim() || inspector?.selectedPath.value || "")
const selectionPath = computed(() => inspector?.selectedPath.value || mediaPath.value)
const isImage = computed(() => ["img", "picture"].includes(props.node.name.toLowerCase()))
const sectionId = computed(() => isImage.value ? "image" : "video")
const pickerOpen = ref(false)
const posterPickerOpen = ref(false)
const VARIANT_ORIGINAL = "original"
const variants = ref<MediaTransformVariant[]>([])
const selectedAsset = ref<MediaAsset | null>(null)
const selectedVariantId = ref(VARIANT_ORIGINAL)
const loadingVariants = ref(false)
const sourceModes = ["media", "url", "collection"] as const
const LEGACY_IMAGE_PLACEHOLDER_SRC = "/placeholder.svg"
let mediaRequestGeneration = 0
let previewRequestGeneration = 0
let previewAssetId = ""
const src = computed(() => stringFieldDisplay(props.node.props.src).text)
const poster = computed(() => stringFieldDisplay(props.node.props.poster).text)
const previewSrc = ref("")
const previewFailed = ref(false)
const renderedSrc = ref("")
const renderedAlt = ref("")
let renderedMediaRequestGeneration = 0
const style = computed(() => parseStyleAttr(stringFieldDisplay(props.node.props.style).text))
const fit = computed(() => style.value["object-fit"] ?? "cover")
const objectPosition = computed(() => style.value["object-position"] ?? "center")
const aspectRatio = computed(() => style.value["aspect-ratio"] ?? "")
const dynamicSrc = computed(() => Boolean(props.node.props.src && props.node.props.src.type !== "string"))
const dynamicAlt = computed(() => Boolean(props.node.props.alt && props.node.props.alt.type !== "string"))
const previewSource = computed(() => dynamicSrc.value ? renderedSrc.value : src.value)
const altText = computed(() => dynamicAlt.value
  ? renderedAlt.value
  : stringFieldDisplay(props.node.props.alt).text)
const ownedProps = computed(() => isImage.value
  ? ["src", "alt", "width", "height", "srcset", "sizes", "loading"]
  : ["src", "poster", "aria-label", "autoplay", "muted", "loop", "controls", "playsinline", "preload"])
const hasChanges = computed(() =>
  ownedProps.value.some((name) => props.node.props[name] != null)
  || ["object-fit", "object-position", ...(isImage.value ? [] : ["aspect-ratio"])].some((name) => Boolean(style.value[name])),
)
const resetDisabled = computed(() =>
  props.disabled
  || ownedProps.value.some((name) => props.node.props[name] != null && props.node.props[name]?.type !== "string" && props.node.props[name]?.type !== "bare")
  || Boolean(props.node.props.style && props.node.props.style.type !== "string"),
)
function isImagePlaceholderSource(value: string): boolean {
  return value === COMPOSER_IMAGE_PLACEHOLDER_SRC
    || value === LEGACY_BRANDED_COMPOSER_IMAGE_PLACEHOLDER_SRC
    || value === LEGACY_COMPOSER_IMAGE_PLACEHOLDER_SRC
    || value === LEGACY_IMAGE_PLACEHOLDER_SRC
}

const isPlaceholderSource = computed(() => isImagePlaceholderSource(src.value))

function projectMediaPathnameForSource(value: string): string {
  const source = value.trim()
  try {
    const parsed = new URL(source)
    const isLoopbackPreview = parsed.protocol === "http:"
      && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    if (isLoopbackPreview) {
      try {
        return decodeURIComponent(parsed.pathname)
      } catch {
        return parsed.pathname
      }
    }
  } catch {
    // Relative project media paths are handled below.
  }
  return source.split(/[?#]/, 1)[0] ?? ""
}

function projectMediaIdForSource(value: string): string | null {
  const pathname = projectMediaPathnameForSource(value)
  if (pathname.startsWith("/src/assets/")) return pathname.slice(1)
  if (/^\/[A-Za-z0-9._-]+\/.+\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|mp4|m4v|mov|ogv|webm)$/i.test(pathname)) {
    return `public${pathname}`
  }
  return null
}

function transformAssetIdForSource(value: string): string | null {
  const pathname = projectMediaPathnameForSource(value)
  if (!pathname || isImagePlaceholderSource(pathname)) return null
  const variantFolder = pathname.match(/^\/uploads\/variants\/([^/]+)\//)?.[1]
  if (variantFolder) return variantFolder.replace(/__/g, "/")
  const mediaId = projectMediaIdForSource(pathname)
  if (!mediaId || mediaId.includes("/variants/")) return null
  return mediaId
}

function publicUrlForAssetId(assetId: string): string {
  return assetId.startsWith("public/") ? `/${assetId.slice("public/".length)}` : `/${assetId}`
}

function mediaAssetStub(assetId: string, cropCount: number): MediaAsset {
  return {
    id: assetId,
    name: assetId.split("/").pop() ?? assetId,
    type: isImage.value ? "image" : "video",
    file: assetId,
    url: publicUrlForAssetId(assetId),
    size: 0,
    mimeType: null,
    mtimeMs: 0,
    dimensions: null,
    cropCount,
  }
}

function currentVariantsFromState(state: Awaited<ReturnType<typeof getMediaTransformState>> | null | undefined) {
  const currentVersion = state?.profile?.currentSourceVersion
  return state?.variants.filter((variant) => variant.sourceVersion === (currentVersion ?? variant.sourceVersion)) ?? []
}

function previewAssetIdForSource(value: string): string | null {
  const original = transformAssetIdForSource(value)
  if (original) return original
  const mediaId = projectMediaIdForSource(value)
  if (mediaId && !mediaId.includes("/variants/")) return mediaId
  return selectedAsset.value?.id ?? null
}

function sourceBelongsToSelectedAsset(value: string) {
  return Boolean(selectedAsset.value && (
    value === selectedAsset.value.url
    || variants.value.some((variant) => variant.url === value)
  ))
}

const projectMediaId = computed(() => projectMediaIdForSource(src.value))
const sourceMode = ref<"media" | "url" | "collection">("media")
watch([src, dynamicSrc, projectMediaId, () => selectedAsset.value?.url], ([value, dynamic, mediaId]) => {
  sourceMode.value = dynamic
    ? "collection"
    : selectedAsset.value || isImagePlaceholderSource(value) || mediaId
      ? "media"
      : value
        ? "url"
        : "media"
}, { immediate: true })

const libraryPickerEnabled = computed(() => !dynamicSrc.value && sourceMode.value === "media")
const pickerActionLabel = computed(() => src.value && !isPlaceholderSource.value ? "Replace media" : "Choose media")
const showPreviewCard = computed(() => Boolean(src.value) || libraryPickerEnabled.value)

function openLibraryPicker() {
  if (props.disabled || !libraryPickerEnabled.value) return
  pickerOpen.value = true
}

watch(
  [previewSource, () => inspector?.projectPath.value ?? ""],
  async ([value, projectPath]) => {
    if (!value) {
      previewRequestGeneration += 1
      previewSrc.value = ""
      previewFailed.value = false
      previewAssetId = ""
      return
    }
    if (isImagePlaceholderSource(value)) {
      previewRequestGeneration += 1
      previewSrc.value = COMPOSER_IMAGE_PLACEHOLDER_SRC
      previewFailed.value = false
      previewAssetId = ""
      return
    }
    const playableId = previewAssetIdForSource(value)
    if (!playableId) {
      previewRequestGeneration += 1
      previewSrc.value = value
      previewFailed.value = false
      previewAssetId = ""
      return
    }
    if (!projectPath) {
      previewRequestGeneration += 1
      previewSrc.value = ""
      previewFailed.value = false
      previewAssetId = playableId
      return
    }
    if (playableId === previewAssetId && previewSrc.value && !previewFailed.value) return
    const request = ++previewRequestGeneration
    previewAssetId = playableId
    previewFailed.value = false
    try {
      const playable = await getPlayableMediaUrl(projectPath, playableId)
      if (request === previewRequestGeneration) previewSrc.value = playable.url
    } catch {
      if (request === previewRequestGeneration) {
        previewFailed.value = true
        previewSrc.value = ""
      }
    }
  },
  { immediate: true },
)

watch(
  [
    () => props.node.id,
    mediaPath,
    dynamicSrc,
    dynamicAlt,
    src,
    () => stringFieldDisplay(props.node.props.alt).text,
  ],
  async ([, path, sourceIsDynamic, altIsDynamic]) => {
    const request = ++renderedMediaRequestGeneration
    renderedSrc.value = ""
    renderedAlt.value = ""
    if (!path || (!sourceIsDynamic && !altIsDynamic) || !inspector) return
    const values = await inspector.document.computedStyle({
      path,
      properties: ["aria-rendered-src", "aria-rendered-alt"],
    })
    if (request !== renderedMediaRequestGeneration) return
    renderedSrc.value = values["aria-rendered-src"] ?? ""
    renderedAlt.value = values["aria-rendered-alt"] ?? ""
  },
  { immediate: true, flush: "post" },
)

function handlePreviewError() {
  previewFailed.value = true
  previewSrc.value = ""
}

function propIsDynamic(name: string, allowBare = false) {
  const value = props.node.props[name]
  return Boolean(value && value.type !== "string" && !(allowBare && value.type === "bare"))
}
function commitProp(name: string, value: PropValue | undefined, allowBare = false) {
  const path = mediaPath.value
  const nodeId = props.node.id
  const context = inspector
  if (!path || props.disabled || !context) return
  context.document.commitInspectorMutation(`Edit ${sectionId.value} ${name}`, (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    const current = node?.kind === "element" ? node.props[name] : undefined
    if (node?.kind !== "element" || node.id !== nodeId) {
      return { ok: false, selectPath: selectionPath.value, reason: "Media selection changed" }
    }
    if (current && current.type !== "string" && !(allowBare && current.type === "bare")) {
      return { ok: false, selectPath: selectionPath.value, reason: `${name} is expression-bound` }
    }
    const result = setPropAtPath(model, path, name, value)
    return result.ok === false ? result : { ...result, selectPath: selectionPath.value }
  }, { immediate: true, coalesceKey: null })
}
function setString(name: string, value: unknown) { const next = String(value); commitProp(name, next ? { type: "string", value: next } : undefined) }
function setBoolean(name: string, value: boolean) { commitProp(name, value ? { type: "bare" } : undefined, true) }
function setStyle(name: string, value: string) {
  if (propIsDynamic("style")) return
  const next = { ...style.value, [name]: value }
  commitProp("style", { type: "string", value: serializeStyleAttr(next) })
}
function resetMedia() {
  const path = mediaPath.value
  const context = inspector
  if (!path || resetDisabled.value || !context) return
  context.document.commitInspectorMutation(`Reset ${sectionId.value}`, (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    if (node?.kind !== "element") {
      return { ok: false, selectPath: selectionPath.value, reason: "Media element is unavailable" }
    }
    for (const name of ownedProps.value) delete node.props[name]
    const nextStyle = parseStyleAttr(stringFieldDisplay(node.props.style).text)
    for (const name of ["object-fit", "object-position", "aspect-ratio"]) delete nextStyle[name]
    const serialized = serializeStyleAttr(nextStyle)
    if (serialized) node.props.style = { type: "string", value: serialized }
    else delete node.props.style
    return { ok: true, selectPath: selectionPath.value }
  }, { immediate: true, coalesceKey: null })
}

async function selectSource(asset: MediaAsset) {
  const path = mediaPath.value
  const nodeId = props.node.id
  const context = inspector
  if (!path || props.disabled || !context) return
  const request = ++mediaRequestGeneration
  selectedAsset.value = asset
  const imageAtRequest = isImage.value
  loadingVariants.value = true
  let state: Awaited<ReturnType<typeof getMediaTransformState>> | null = null
  try {
    state = await getMediaTransformState(context.projectPath.value, asset.id)
  } catch {
    state = null
  }
  try {
    const current = context.document.model.value
      ? nodeAtMarkerPath(context.document.model.value.nodes, path)
      : null
    if (
      request !== mediaRequestGeneration
      || current?.kind !== "element"
      || current.id !== nodeId
    ) return
    variants.value = currentVariantsFromState(state)
    selectedVariantId.value = VARIANT_ORIGINAL
    const committed = context.document.commitInspectorMutation("Choose media source", (model) => {
      const node = nodeAtMarkerPath(model.nodes, path)
      if (node?.kind !== "element" || node.id !== nodeId || node.props.src && node.props.src.type !== "string") {
        return { ok: false, selectPath: selectionPath.value, reason: "Media source is unavailable or expression-bound" }
      }
      node.props.src = { type: "string", value: asset.url }
      if (imageAtRequest) {
        if (!node.props.width || node.props.width.type === "string") {
          if (asset.dimensions) node.props.width = { type: "string", value: String(asset.dimensions.width) }
          else delete node.props.width
        }
        if (!node.props.height || node.props.height.type === "string") {
          if (asset.dimensions) node.props.height = { type: "string", value: String(asset.dimensions.height) }
          else delete node.props.height
        }
        if ((!node.props.alt || node.props.alt.type === "string") && !stringFieldDisplay(node.props.alt).text && state?.profile?.altText) {
          node.props.alt = { type: "string", value: state.profile.altText }
        }
      }
      return { ok: true, selectPath: selectionPath.value }
    }, { immediate: true, coalesceKey: null })
    if (!committed) {
      selectedAsset.value = null
      variants.value = []
      selectedVariantId.value = VARIANT_ORIGINAL
    }
  } finally {
    if (request === mediaRequestGeneration) loadingVariants.value = false
  }
}
function selectPoster(asset: MediaAsset) { setString("poster", asset.url) }
function changeSourceMode(value: string) {
  if (value !== "media" && value !== "url" && value !== "collection") return
  sourceMode.value = value
  if (value === "media") pickerOpen.value = true
}
async function onSourceModeKeydown(event: KeyboardEvent) {
  const enabled = sourceModes.filter((value) => !(dynamicSrc.value && value !== "collection"))
  const current = enabled.indexOf(sourceMode.value)
  let index = current < 0 ? 0 : current
  if (["ArrowRight", "ArrowDown"].includes(event.key)) index = (index + 1) % enabled.length
  else if (["ArrowLeft", "ArrowUp"].includes(event.key)) index = (index - 1 + enabled.length) % enabled.length
  else if (event.key === "Home") index = 0
  else if (event.key === "End") index = enabled.length - 1
  else return
  event.preventDefault()
  const value = enabled[index]
  if (!value) return
  const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
  changeSourceMode(value)
  await nextTick()
  ;(group?.querySelector(`[data-source-mode="${value}"]`) as HTMLElement | null)?.focus()
}
function sameCrop(left: MediaTransformVariant, right: MediaTransformVariant) {
  return left.crop.x === right.crop.x
    && left.crop.y === right.crop.y
    && left.crop.width === right.crop.width
    && left.crop.height === right.crop.height
}
function sameAspectRatio(left: MediaTransformVariant, right: MediaTransformVariant) {
  if (!left.aspectRatio || !right.aspectRatio) return left.aspectRatio === right.aspectRatio
  return left.aspectRatio.width === right.aspectRatio.width
    && left.aspectRatio.height === right.aspectRatio.height
}
function selectVariant(id: unknown) {
  const nextId = String(id)
  const path = mediaPath.value
  const nodeId = props.node.id
  const imageAtRequest = isImage.value
  const context = inspector
  if (!path || props.disabled || !context) return
  if (nextId === VARIANT_ORIGINAL) {
    const original = selectedAsset.value
    if (!original) return
    selectedVariantId.value = VARIANT_ORIGINAL
    context.document.commitInspectorMutation("Choose media variant", (model) => {
      const node = nodeAtMarkerPath(model.nodes, path)
      if (node?.kind !== "element" || node.id !== nodeId || node.props.src && node.props.src.type !== "string") {
        return { ok: false, selectPath: selectionPath.value, reason: "Media selection changed or source is expression-bound" }
      }
      node.props.src = { type: "string", value: original.url }
      if (imageAtRequest) {
        if (!node.props.width || node.props.width.type === "string") {
          if (original.dimensions) node.props.width = { type: "string", value: String(original.dimensions.width) }
          else delete node.props.width
        }
        if (!node.props.height || node.props.height.type === "string") {
          if (original.dimensions) node.props.height = { type: "string", value: String(original.dimensions.height) }
          else delete node.props.height
        }
      }
      if (!node.props.srcset || node.props.srcset.type === "string") delete node.props.srcset
      return { ok: true, selectPath: selectionPath.value }
    }, { immediate: true, coalesceKey: null })
    return
  }
  const variant = variants.value.find((item) => item.id === nextId)
  if (!variant) return
  selectedVariantId.value = variant.id
  const candidates = variants.value
    .filter((item) => item.output.width
      && item.sourceVersion === variant.sourceVersion
      && item.output.format === variant.output.format
      && sameCrop(item, variant)
      && sameAspectRatio(item, variant))
    .sort((a, b) => (a.output.width ?? 0) - (b.output.width ?? 0))
  context.document.commitInspectorMutation("Choose media variant", (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    if (node?.kind !== "element" || node.id !== nodeId || node.props.src && node.props.src.type !== "string") {
      return { ok: false, selectPath: selectionPath.value, reason: "Media selection changed or source is expression-bound" }
    }
    node.props.src = { type: "string", value: variant.url }
    if (imageAtRequest) {
      if (!node.props.width || node.props.width.type === "string") {
        if (variant.output.width) node.props.width = { type: "string", value: String(variant.output.width) }
        else delete node.props.width
      }
      if (!node.props.height || node.props.height.type === "string") {
        if (variant.output.height) node.props.height = { type: "string", value: String(variant.output.height) }
        else delete node.props.height
      }
    }
    if (candidates.length > 1) {
      if (!node.props.srcset || node.props.srcset.type === "string") node.props.srcset = { type: "string", value: candidates.map((item) => `${item.url} ${item.output.width}w`).join(", ") }
    } else if (!node.props.srcset || node.props.srcset.type === "string") delete node.props.srcset
    return { ok: true, selectPath: selectionPath.value }
  }, { immediate: true, coalesceKey: null })
}

watch(
  [src, () => props.node.id, () => inspector?.projectPath.value ?? "", dynamicSrc],
  async ([value, , projectPath, dynamic]) => {
    if (sourceBelongsToSelectedAsset(value)) return
    const request = ++mediaRequestGeneration
    loadingVariants.value = false
    selectedAsset.value = null
    variants.value = []
    selectedVariantId.value = VARIANT_ORIGINAL
    const assetId = !dynamic ? transformAssetIdForSource(value) : null
    if (!assetId || !projectPath) return
    loadingVariants.value = true
    try {
      const state = await getMediaTransformState(projectPath, assetId)
      if (request !== mediaRequestGeneration) return
      variants.value = currentVariantsFromState(state)
      const match = variants.value.find((variant) => variant.url === value)
      selectedVariantId.value = match?.id ?? VARIANT_ORIGINAL
      selectedAsset.value = mediaAssetStub(assetId, variants.value.length)
    } catch {
      if (request !== mediaRequestGeneration) return
      variants.value = []
      selectedVariantId.value = VARIANT_ORIGINAL
    } finally {
      if (request === mediaRequestGeneration) loadingVariants.value = false
    }
  },
  { flush: "sync", immediate: true },
)

onBeforeUnmount(() => {
  mediaRequestGeneration += 1
  previewRequestGeneration += 1
  renderedMediaRequestGeneration += 1
  previewAssetId = ""
})

defineExpose({ selectSource, selectVariant })
</script>

<template>
  <InspectorPropertySection
    :title="isImage ? 'Image' : 'Video'"
    :open="openSection === sectionId"
    :has-changes="hasChanges"
    :show-reset="openSection === sectionId && hasChanges"
    :reset-disabled="resetDisabled"
    :reset-label="`Reset ${isImage ? 'Image' : 'Video'}`"
    @update:open="emit('update:openSection', $event ? sectionId : openSection === sectionId ? null : openSection ?? null)"
    @reset="resetMedia"
  >
    <div class="space-y-3">
      <div class="grid grid-cols-3 gap-1" role="radiogroup" :aria-label="`${sectionId} source type`"><Button v-for="value in sourceModes" :key="value" type="button" size="sm" :variant="sourceMode === value ? 'default' : 'outline'" role="radio" :aria-checked="sourceMode === value" :tabindex="sourceMode === value ? 0 : -1" :data-source-mode="value" class="h-8 px-1 text-[10px] uppercase" :disabled="disabled || dynamicSrc && value !== 'collection'" @click="changeSourceMode(value)" @keydown="onSourceModeKeydown">{{ value }}</Button></div>
      <div v-if="showPreviewCard" class="overflow-hidden rounded-md border border-border/70 bg-background dark:bg-sidebar">
        <component
          :is="libraryPickerEnabled ? 'button' : 'div'"
          :type="libraryPickerEnabled ? 'button' : undefined"
          :disabled="libraryPickerEnabled ? disabled : undefined"
          :aria-label="libraryPickerEnabled ? pickerActionLabel : undefined"
          :data-testid="libraryPickerEnabled ? 'media-preview-trigger' : undefined"
          class="relative block w-full overflow-hidden"
          :class="libraryPickerEnabled
            ? 'group cursor-pointer text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
            : undefined"
          @click="openLibraryPicker"
        >
          <img v-if="isImage && previewSrc && !previewFailed" :src="previewSrc" alt="" class="pointer-events-none aspect-video w-full" :style="`object-fit: ${fit}; object-position: ${objectPosition};`" @error="handlePreviewError" />
          <video v-else-if="!isImage && previewSrc && !previewFailed" :src="previewSrc" :poster="poster || undefined" class="pointer-events-none aspect-video w-full" :style="`object-fit: ${fit}; object-position: ${objectPosition};`" muted playsinline @error="handlePreviewError" />
          <div v-else class="flex aspect-video w-full flex-col items-center justify-center gap-1.5 bg-muted/35 px-3 text-muted-foreground" data-testid="media-preview-fallback">
            <AppIcon :name="isImage ? 'image' : 'video'" :size="26" class="text-muted-foreground/60" />
            <span v-if="libraryPickerEnabled && !src" class="text-[10px] font-medium uppercase tracking-wide">{{ pickerActionLabel }}</span>
          </div>
          <div
            v-if="libraryPickerEnabled && src"
            class="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <span class="rounded-md bg-background/90 px-2.5 py-1 text-[11px] font-medium text-foreground">{{ pickerActionLabel }}</span>
          </div>
        </component>
        <div v-if="src" class="flex items-center gap-1 px-1 py-1.5">
          <div v-if="variants.length" class="min-w-0 flex-1">
            <Select :model-value="selectedVariantId" :disabled="disabled || loadingVariants || dynamicSrc" @update:model-value="selectVariant">
              <SelectTrigger class="h-7! border-transparent bg-transparent px-2 text-[11px] shadow-none hover:bg-muted/50" data-testid="media-variant-select" aria-label="Variant">
                <SelectValue placeholder="Original" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="VARIANT_ORIGINAL">Original</SelectItem>
                <SelectItem v-for="variant in variants" :key="variant.id" :value="variant.id">{{ variant.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span v-else class="min-w-0 flex-1" />
          <Button type="button" size="sm" variant="ghost" class="h-7 shrink-0" :disabled="disabled || dynamicSrc" @click="setString('src', '')">Clear</Button>
        </div>
      </div>
      <p v-if="dynamicSrc || sourceMode === 'collection'" class="rounded-md border border-dashed border-border/70 p-2 text-[10px] text-muted-foreground">{{ dynamicSrc ? 'Source is expression-bound. Use Props → CMS to detach or replace it.' : 'Choose this element’s src target in Props → CMS to bind a collection field.' }}</p>
      <div v-else-if="sourceMode === 'url'" class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">URL</span><Input :model-value="src" class="h-8 min-w-0 text-xs" type="url" :disabled="disabled" @change="setString('src', ($event.target as HTMLInputElement).value)" /></div>
      <label v-if="isImage" class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Alt text</span><Input :model-value="altText" class="h-8 text-xs" :disabled="disabled || dynamicAlt" @change="setString('alt', ($event.target as HTMLInputElement).value)" /></label>
      <template v-else>
        <div class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Poster</span><div class="flex gap-1"><Input :model-value="poster" class="h-8 min-w-0 text-xs" :disabled="disabled || propIsDynamic('poster')" @change="setString('poster', ($event.target as HTMLInputElement).value)" /><Button type="button" size="sm" variant="outline" class="h-8" :disabled="disabled || propIsDynamic('poster')" @click="posterPickerOpen = true">Media</Button></div></div>
        <label class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Label</span><Input :model-value="stringFieldDisplay(node.props['aria-label']).text" class="h-8 text-xs" :disabled="disabled || propIsDynamic('aria-label')" @change="setString('aria-label', ($event.target as HTMLInputElement).value)" /></label>
        <div class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><Label v-for="name in ['autoplay','muted','loop','controls','playsinline']" :key="name" class="flex items-center justify-between gap-2 capitalize">{{ name }} <Switch :model-value="isBooleanChecked(node.props[name], false)" :disabled="disabled || propIsDynamic(name, true)" @update:model-value="setBoolean(name, Boolean($event))" /></Label></div>
        <label class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Preload</span><Select :model-value="stringFieldDisplay(node.props.preload).text || 'metadata'" :disabled="disabled || propIsDynamic('preload')" @update:model-value="setString('preload', $event)"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="metadata">Metadata</SelectItem><SelectItem value="auto">Auto</SelectItem></SelectContent></Select></label>
      </template>
      <label v-if="!isImage" class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Aspect</span><Select :model-value="aspectRatio" :disabled="disabled || propIsDynamic('style')" @update:model-value="setStyle('aspect-ratio', String($event))"><SelectTrigger class="h-8 text-xs"><SelectValue placeholder="Auto" /></SelectTrigger><SelectContent><SelectItem v-for="value in ['16 / 9','9 / 16','4 / 3','1 / 1','21 / 9','3 / 2','4 / 5']" :key="value" :value="value">{{ value.replace(' / ', ':') }}</SelectItem></SelectContent></Select></label>
      <label class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Scale</span><Select :model-value="fit" :disabled="disabled || propIsDynamic('style')" @update:model-value="setStyle('object-fit', String($event))"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="value in ['cover','contain','scale-down','fill','none']" :key="value" :value="value">{{ value }}</SelectItem></SelectContent></Select></label>
      <div class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Position</span>
        <InspectorObjectPositionControl
          :model-value="objectPosition"
          :disabled="disabled || propIsDynamic('style')"
          @update:model-value="setStyle('object-position', $event)"
        />
      </div>
      <label v-if="isImage" class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Loading</span><Select :model-value="stringFieldDisplay(node.props.loading).text || 'lazy'" :disabled="disabled || propIsDynamic('loading')" @update:model-value="setString('loading', $event)"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="lazy">Lazy</SelectItem><SelectItem value="eager">Eager</SelectItem></SelectContent></Select></label>
    </div>
    <MediaPickerDialog v-model:open="pickerOpen" :project-root="inspector?.projectPath.value ?? ''" :media-types="isImage ? ['image'] : ['video']" @select="selectSource" />
    <MediaPickerDialog v-model:open="posterPickerOpen" :project-root="inspector?.projectPath.value ?? ''" :media-types="['image']" @select="selectPoster" />
  </InspectorPropertySection>
</template>
