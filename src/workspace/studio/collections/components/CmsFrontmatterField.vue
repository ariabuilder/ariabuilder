<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRaw, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { IconPickerDialog, ProjectIconPreview } from "@/components/ui/icon-picker"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ColorField } from "@/components/ui/color-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { listMedia, previewMedia, type MediaAsset } from "@/lib/media"
import type { FieldSchema } from "../../../../../shared/cms"
import {
  StructuredTextDocumentSchema,
  type StructuredTextDocument,
} from "../../../../../shared/cms"
import { isCmsColorField } from "../lib/colorField"
import {
  cloneCmsRepeaterItemDraft,
  createFrontmatterDraft,
  isEditableCmsField,
  normalizeCmsLinkDraftValue,
  normalizeCmsMediaDraftValue,
  resolveCmsRepeaterItemTitle,
  type CmsLinkDraftValue,
} from "../lib/frontmatterForm"
import { cmsImageFieldLayout } from "../lib/imageFieldLayout"
import { resolveCmsMediaPreviewUrl } from "../lib/resolveMediaPreviewUrl"
import type { CmsEntryRow } from "../lib/entryRow"
import CmsEntryCommandSelect from "./CmsEntryCommandSelect.vue"
import StructuredTextEditor from "./StructuredTextEditor.vue"
import MediaPickerDialog from "@/workspace/studio/media/components/MediaPickerDialog.vue"

const repeaterItemKeys = new WeakMap<Record<string, unknown>, string>()
let repeaterItemKeyIndex = 0

const props = withDefaults(
  defineProps<{
    field: FieldSchema
    modelValue: unknown
    disabled?: boolean
    projectRoot?: string
    collectionId?: string
    error?: string
  }>(),
  {
    disabled: false,
    projectRoot: "",
    collectionId: "",
    error: undefined,
  },
)

const emit = defineEmits<{
  "update:modelValue": [value: unknown]
}>()

defineOptions({
  name: "CmsFrontmatterField",
})

const fieldId = computed(() => `cms-field-${props.field.key}`)
const errorId = computed(() => `${fieldId.value}-error`)
const isRequired = computed(() => props.field.required === true)
const isEditable = computed(() => isEditableCmsField(props.field))

const isMediaPickerOpen = ref(false)
const isIconPickerOpen = ref(false)
const isMediaMetaOpen = ref(false)
const mediaAssets = ref<MediaAsset[]>([])
const expandedRepeaterIndex = ref<number | null>(null)
const imagePreviewUrl = ref("")
const imagePreviewFailed = ref(false)
const repeaterDragFromIndex = ref<number | null>(null)
const repeaterDropTargetIndex = ref<number | null>(null)
let imagePreviewGeneration = 0

const stringValue = computed({
  get: () => {
    const value = props.modelValue
    if (typeof value === "string" || typeof value === "number") {
      return String(value)
    }
    return ""
  },
  set: (value: string | number) => emit("update:modelValue", String(value)),
})

const booleanValue = computed({
  get: () => props.modelValue === true,
  set: (value: boolean | "indeterminate") =>
    emit("update:modelValue", value === true),
})

const multiSelectValue = computed<string[]>({
  get: () => {
    if (Array.isArray(props.modelValue)) {
      return props.modelValue.filter(
        (value): value is string => typeof value === "string",
      )
    }
    if (typeof props.modelValue === "string") {
      return props.modelValue
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    }
    return []
  },
  set: (value: string[]) => emit("update:modelValue", value),
})

const jsonValue = computed({
  get: () => {
    if (typeof props.modelValue === "string") {
      return props.modelValue
    }
    if (props.modelValue == null) {
      return "{}"
    }
    try {
      return JSON.stringify(props.modelValue, null, 2)
    } catch {
      return "{}"
    }
  },
  set: (value: string | number) => {
    const raw = String(value)
    try {
      emit("update:modelValue", JSON.parse(raw))
    } catch {
      emit("update:modelValue", raw)
    }
  },
})

const structuredTextValue = computed<StructuredTextDocument>({
  get: () => {
    const parsed = StructuredTextDocumentSchema.safeParse(props.modelValue)
    return parsed.success ? parsed.data : []
  },
  set: (value) => emit("update:modelValue", value),
})

const nestedFields = computed(() => props.field.fields ?? [])

const objectValue = computed<Record<string, unknown>>({
  get: () => {
    const value = props.modelValue
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    return createFrontmatterDraft(nestedFields.value)
  },
  set: (value) => emit("update:modelValue", value),
})

const repeaterValue = computed<Record<string, unknown>[]>({
  get: () => {
    if (!Array.isArray(props.modelValue)) {
      return []
    }
    return props.modelValue.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    )
  },
  set: (value) => emit("update:modelValue", value),
})

const repeaterAddButtonLabel = computed(() => {
  const label = props.field.repeaterDisplay?.addButtonLabel?.trim()
  return label || "Add item"
})

function mediaDraftValue(): Record<string, string> {
  const draft = normalizeCmsMediaDraftValue(props.modelValue)
  return {
    mediaId: draft.mediaId,
    alt: draft.alt ?? "",
    caption: draft.caption ?? "",
    label: draft.label ?? "",
  }
}

function updateMediaDraft(
  key: "mediaId" | "alt" | "caption" | "label",
  value: string,
): void {
  emit("update:modelValue", {
    ...mediaDraftValue(),
    [key]: value,
  })
}

const mediaIdValue = computed({
  get: () => mediaDraftValue().mediaId,
  set: (value: string | number) => updateMediaDraft("mediaId", String(value)),
})

const mediaAltValue = computed({
  get: () => mediaDraftValue().alt,
  set: (value: string | number) => updateMediaDraft("alt", String(value)),
})

const mediaCaptionValue = computed({
  get: () => mediaDraftValue().caption,
  set: (value: string | number) => updateMediaDraft("caption", String(value)),
})

const fileLabelValue = computed({
  get: () => mediaDraftValue().label,
  set: (value: string | number) => updateMediaDraft("label", String(value)),
})

const selectedMediaAsset = computed(
  () => mediaAssets.value.find((asset) => asset.id === mediaIdValue.value) ?? null,
)

const selectedMediaLabel = computed(() => {
  if (selectedMediaAsset.value) return selectedMediaAsset.value.name
  return mediaIdValue.value || "No media selected"
})

const imageFieldLayout = computed(() =>
  props.field.type === "image" ? cmsImageFieldLayout(props.field) : null,
)

const isCompactImageLayout = computed(
  () => imageFieldLayout.value === "compact",
)

const imageActionLabel = computed(() => {
  if (mediaIdValue.value) return "Replace image"
  return imageFieldLayout.value === "cover" ? "Add cover" : "Choose image"
})

const selectedImagePreviewSrc = computed(() => {
  if (imagePreviewFailed.value) return ""
  if (imagePreviewUrl.value) return imagePreviewUrl.value
  return mediaIdValue.value
    ? resolveCmsMediaPreviewUrl(mediaIdValue.value)
    : ""
})

async function loadImagePreview(): Promise<void> {
  const generation = ++imagePreviewGeneration
  imagePreviewUrl.value = ""
  imagePreviewFailed.value = false

  const mediaId = mediaIdValue.value
  if (!mediaId || props.field.type !== "image") return

  if (props.projectRoot) {
    try {
      const result = await previewMedia(props.projectRoot, mediaId)
      if (generation !== imagePreviewGeneration) return
      if (result.dataUrl) {
        imagePreviewUrl.value = result.dataUrl
        return
      }
    } catch {
      if (generation !== imagePreviewGeneration) return
    }
  }
}

function handleImagePreviewError(): void {
  imagePreviewFailed.value = true
  imagePreviewUrl.value = ""
}

function toggleMediaMeta(): void {
  isMediaMetaOpen.value = !isMediaMetaOpen.value
}

function clearIcon(): void {
  stringValue.value = ""
}

function linkDraftValue(): CmsLinkDraftValue {
  return normalizeCmsLinkDraftValue(props.modelValue)
}

function updateLinkDraft(next: Partial<CmsLinkDraftValue>): void {
  emit("update:modelValue", {
    ...linkDraftValue(),
    ...next,
  })
}

const linkTypeValue = computed({
  get: () => linkDraftValue().type,
  set: (value: CmsLinkDraftValue["type"]) => updateLinkDraft({ type: value }),
})

const linkUrlValue = computed({
  get: () => linkDraftValue().url,
  set: (value: string | number) => updateLinkDraft({ url: String(value) }),
})

const linkLabelValue = computed({
  get: () => linkDraftValue().label,
  set: (value: string | number) => updateLinkDraft({ label: String(value) }),
})

const linkOpenInNewTabValue = computed({
  get: () => linkDraftValue().openInNewTab,
  set: (value: boolean | "indeterminate") =>
    updateLinkDraft({ openInNewTab: value === true }),
})

function clearReference(): void {
  emit("update:modelValue", "")
}

function handleEntrySelect(entry: CmsEntryRow): void {
  emit("update:modelValue", entry.id)
}

function openMediaPicker(): void {
  if (props.disabled || !props.projectRoot) return
  isMediaPickerOpen.value = true
}

async function ensureMediaAssetsLoaded(): Promise<void> {
  if (!props.projectRoot || mediaAssets.value.length > 0) return
  try {
    mediaAssets.value = await listMedia(props.projectRoot)
  } catch {
    // Preview/label fallback still works without the catalog.
  }
}

function clearMedia(): void {
  isMediaMetaOpen.value = false
  emit("update:modelValue", {
    ...mediaDraftValue(),
    mediaId: "",
  })
}

function handleMediaSelect(asset: MediaAsset): void {
  if (!mediaAssets.value.some((candidate) => candidate.id === asset.id)) {
    mediaAssets.value = [asset, ...mediaAssets.value]
  }
  const current = mediaDraftValue()
  emit("update:modelValue", {
    ...current,
    mediaId: asset.id,
    alt:
      props.field.type === "image" && !current.alt.trim()
        ? asset.name
        : current.alt,
    label:
      props.field.type === "file" && !current.label.trim()
        ? asset.name
        : current.label,
  })
  isMediaPickerOpen.value = false
}

function handleLinkEntrySelect(entry: CmsEntryRow): void {
  updateLinkDraft({
    type: "entry",
    entryId: entry.id,
    collectionId: entry.collectionId,
    slug: entry.slug,
  })
}

function isMultiSelectOptionSelected(option: string): boolean {
  return multiSelectValue.value.includes(option)
}

function toggleMultiSelectOption(option: string): void {
  if (props.disabled) return
  const current = multiSelectValue.value
  multiSelectValue.value = current.includes(option)
    ? current.filter((value) => value !== option)
    : [...current, option]
}

function updateObjectField(fieldKey: string, value: unknown): void {
  objectValue.value = {
    ...objectValue.value,
    [fieldKey]: value,
  }
}

function createRepeaterItem(): Record<string, unknown> {
  return createFrontmatterDraft(nestedFields.value)
}

function addRepeaterItem(): void {
  if (props.disabled) return
  const next = [...repeaterValue.value, createRepeaterItem()]
  repeaterValue.value = next
  expandedRepeaterIndex.value = next.length - 1
}

function removeRepeaterItem(index: number): void {
  if (props.disabled) return
  repeaterValue.value = repeaterValue.value.filter(
    (_, itemIndex) => itemIndex !== index,
  )
  if (expandedRepeaterIndex.value === index) {
    expandedRepeaterIndex.value = null
    return
  }
  if (
    expandedRepeaterIndex.value !== null &&
    expandedRepeaterIndex.value > index
  ) {
    expandedRepeaterIndex.value -= 1
  }
}

function duplicateRepeaterItem(index: number): void {
  if (props.disabled) return
  const item = repeaterValue.value[index]
  if (!item) return
  const next = [...repeaterValue.value]
  next.splice(index + 1, 0, cloneCmsRepeaterItemDraft(item))
  repeaterValue.value = next
  expandedRepeaterIndex.value = index + 1
}

function updateRepeaterItemField(
  index: number,
  fieldKey: string,
  value: unknown,
): void {
  const next = repeaterValue.value.map((item, itemIndex) => {
    if (itemIndex !== index) return item
    const nextItem = { ...item, [fieldKey]: value }
    repeaterItemKeys.set(toRaw(nextItem), getRepeaterItemKey(item))
    return nextItem
  })
  repeaterValue.value = next
}

function getRepeaterItemKey(item: Record<string, unknown>): string {
  const itemIdentity = toRaw(item)
  const existing = repeaterItemKeys.get(itemIdentity)
  if (existing) return existing
  const key = `${props.field.key}-${repeaterItemKeyIndex}`
  repeaterItemKeyIndex += 1
  repeaterItemKeys.set(itemIdentity, key)
  return key
}

function repeaterItemTitle(
  item: Record<string, unknown>,
  index: number,
): string {
  return resolveCmsRepeaterItemTitle(
    nestedFields.value,
    item,
    index,
    props.field.repeaterDisplay?.titleFieldKey?.trim(),
  )
}

function setRepeaterItemOpen(index: number, open: boolean): void {
  expandedRepeaterIndex.value = open ? index : null
}

function moveRepeaterItem(index: number, direction: -1 | 1): void {
  if (props.disabled) return
  const targetIndex = index + direction
  const next = [...repeaterValue.value]
  if (targetIndex < 0 || targetIndex >= next.length) return
  const [item] = next.splice(index, 1)
  if (!item) return
  next.splice(targetIndex, 0, item)
  repeaterValue.value = next
  if (expandedRepeaterIndex.value === index) {
    expandedRepeaterIndex.value = targetIndex
  } else if (expandedRepeaterIndex.value === targetIndex) {
    expandedRepeaterIndex.value = index
  }
}

function handleRepeaterDragStart(index: number, event: DragEvent): void {
  if (props.disabled) {
    event.preventDefault()
    return
  }
  repeaterDragFromIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", String(index))
  }
}

function handleRepeaterDragOver(index: number, event: DragEvent): void {
  if (props.disabled || repeaterDragFromIndex.value === null) return
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move"
  }
  repeaterDropTargetIndex.value = index
}

function handleRepeaterDrop(index: number, event: DragEvent): void {
  event.preventDefault()
  const fromIndex = repeaterDragFromIndex.value
  repeaterDragFromIndex.value = null
  repeaterDropTargetIndex.value = null
  if (fromIndex === null || fromIndex === index || props.disabled) return

  const next = [...repeaterValue.value]
  const [item] = next.splice(fromIndex, 1)
  if (!item) return
  next.splice(index, 0, item)
  repeaterValue.value = next

  if (expandedRepeaterIndex.value === fromIndex) {
    expandedRepeaterIndex.value = index
  } else if (expandedRepeaterIndex.value !== null) {
    const expanded = expandedRepeaterIndex.value
    if (fromIndex < expanded && index >= expanded) {
      expandedRepeaterIndex.value = expanded - 1
    } else if (fromIndex > expanded && index <= expanded) {
      expandedRepeaterIndex.value = expanded + 1
    }
  }
}

function handleRepeaterDragEnd(): void {
  repeaterDragFromIndex.value = null
  repeaterDropTargetIndex.value = null
}

watch(
  () =>
    [mediaIdValue.value, props.projectRoot, props.field.type] as const,
  ([mediaId]) => {
    void loadImagePreview()
    if (mediaId && (props.field.type === "image" || props.field.type === "file")) {
      void ensureMediaAssetsLoaded()
    }
  },
  { immediate: true },
)

watch(
  () => [props.field.key, repeaterValue.value.length] as const,
  ([, length]) => {
    if (length === 0) {
      expandedRepeaterIndex.value = null
      return
    }
    if (
      expandedRepeaterIndex.value !== null &&
      expandedRepeaterIndex.value >= length
    ) {
      expandedRepeaterIndex.value = length - 1
    }
  },
)

onBeforeUnmount(() => {
  imagePreviewGeneration += 1
})
</script>

<template>
  <div v-if="isEditable" class="grid gap-2">
    <Label
      v-if="field.type !== 'repeater'"
      :for="fieldId"
      class="text-xs text-muted-foreground"
    >
      {{ field.label }}
      <span v-if="isRequired" class="text-destructive">*</span>
    </Label>

    <Textarea
      v-if="field.type === 'text'"
      :id="fieldId"
      v-model="stringValue"
      rows="3"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
    />

    <StructuredTextEditor
      v-else-if="field.type === 'structuredText' || field.type === 'richtext'"
      v-model="structuredTextValue"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
      :project-root="projectRoot"
      :placeholder="`Write ${field.label.toLowerCase()}…`"
      min-height-class="min-h-28"
    />

    <Input
      v-else-if="field.type === 'number' || field.type === 'integer'"
      :id="fieldId"
      v-model="stringValue"
      type="number"
      :step="field.type === 'integer' ? 1 : 'any'"
      :disabled="disabled"
    />

    <div
      v-else-if="field.type === 'boolean'"
      class="flex h-9 items-center gap-2"
    >
      <Checkbox
        :id="fieldId"
        :checked="booleanValue"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? errorId : undefined"
        @update:checked="booleanValue = $event"
      />
      <span class="text-xs text-muted-foreground">{{ field.label }}</span>
    </div>

    <Input
      v-else-if="field.type === 'date'"
      :id="fieldId"
      v-model="stringValue"
      type="date"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
    />

    <Input
      v-else-if="field.type === 'datetime'"
      :id="fieldId"
      v-model="stringValue"
      type="datetime-local"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
    />

    <Select
      v-else-if="field.type === 'select'"
      :model-value="stringValue || undefined"
      :disabled="disabled"
      @update:model-value="stringValue = String($event ?? '')"
    >
      <SelectTrigger
        :id="fieldId"
        class="w-full"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? errorId : undefined"
      >
        <SelectValue :placeholder="field.label" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          v-for="option in field.options ?? []"
          :key="option"
          :value="option"
        >
          {{ option }}
        </SelectItem>
      </SelectContent>
    </Select>

    <ColorField
      v-else-if="isCmsColorField(field)"
      :model-value="stringValue || '#000000'"
      :disabled="disabled"
      show-alpha
      layout="unified"
      persist-mode="commit"
      @update:model-value="stringValue = $event"
    />

    <div
      v-else-if="field.type === 'multiSelect'"
      :id="fieldId"
      class="flex flex-wrap gap-1.5"
      role="group"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
    >
      <button
        v-for="option in field.options ?? []"
        :key="option"
        type="button"
        class="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
        :class="
          isMultiSelectOptionSelected(option)
            ? 'border-primary/55 bg-primary/15 text-foreground'
            : 'border-border/50 bg-card/30 text-muted-foreground hover:border-primary/35 hover:text-foreground'
        "
        :aria-pressed="isMultiSelectOptionSelected(option)"
        :disabled="disabled"
        @click="toggleMultiSelectOption(option)"
      >
        <span class="truncate">{{ option }}</span>
      </button>
      <p
        v-if="(field.options ?? []).length === 0"
        class="basis-full text-xs text-muted-foreground"
      >
        Add options to this field in the schema
      </p>
    </div>

    <div v-else-if="field.type === 'icon'" class="grid gap-2">
      <div
        class="flex items-center gap-2 rounded-md border border-border bg-card/30 px-3 py-2"
      >
        <div
          class="grid size-8 shrink-0 place-items-center rounded-sm border border-border/50 bg-muted/20 text-muted-foreground"
          aria-hidden="true"
        >
          <ProjectIconPreview
            v-if="stringValue"
            :project-root="projectRoot"
            :value="stringValue"
            class="size-4"
          />
          <AppIcon v-else name="image" :size="16" class="opacity-50" />
        </div>
        <Input
          :id="fieldId"
          v-model="stringValue"
          class="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          :disabled="disabled"
          placeholder="Icon name (e.g. star)"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="size-7 shrink-0"
          :disabled="disabled || !projectRoot"
          aria-label="Choose icon"
          @click="isIconPickerOpen = true"
        >
          <AppIcon name="galleryBold" :size="14" />
        </Button>
        <Button
          v-if="stringValue"
          type="button"
          variant="ghost"
          size="icon"
          class="size-7 shrink-0"
          :disabled="disabled"
          aria-label="Clear icon"
          @click="clearIcon"
        >
          <AppIcon name="close" :size="14" />
        </Button>
      </div>
    </div>

    <div
      v-else-if="field.type === 'image' && isCompactImageLayout"
      :id="fieldId"
      class="grid w-fit max-w-full gap-3"
    >
      <div class="flex items-start gap-3">
        <button
          type="button"
          class="group relative size-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/10 transition-colors hover:border-primary/40 hover:bg-muted/20 disabled:pointer-events-none disabled:opacity-50"
          :class="mediaIdValue ? 'border-solid' : 'border-dashed'"
          :disabled="disabled || !projectRoot"
          :aria-label="imageActionLabel"
          @click="openMediaPicker"
        >
          <img
            v-if="mediaIdValue && selectedImagePreviewSrc"
            :src="selectedImagePreviewSrc"
            :alt="mediaAltValue || selectedMediaLabel"
            class="size-full object-cover"
            @error="handleImagePreviewError"
          />
          <div
            v-else-if="mediaIdValue"
            class="flex size-full items-center justify-center px-2 text-center text-2xs text-muted-foreground"
          >
            {{ selectedMediaLabel }}
          </div>
          <div v-else class="flex size-full items-center justify-center">
            <AppIcon name="image" :size="20" class="text-muted-foreground/60" />
          </div>
          <div
            class="absolute inset-0 flex items-center justify-center bg-background/50 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <AppIcon
              :name="mediaIdValue ? 'edit' : 'plus'"
              :size="16"
              class="text-foreground"
            />
          </div>
        </button>

        <div class="grid min-w-0 gap-2 pt-0.5">
          <div class="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              :disabled="disabled || !projectRoot"
              @click="openMediaPicker"
            >
              {{ imageActionLabel }}
            </Button>
            <Button
              v-if="mediaIdValue"
              type="button"
              variant="ghost"
              size="sm"
              :disabled="disabled"
              @click="clearMedia"
            >
              Remove
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              :disabled="disabled"
              @click="toggleMediaMeta"
            >
              Alt / caption
            </Button>
          </div>
          <p class="m-0 text-2xs leading-snug text-muted-foreground">
            {{ selectedMediaLabel }}
          </p>
        </div>
      </div>

      <div
        v-if="isMediaMetaOpen"
        class="grid w-full max-w-sm gap-2 rounded-md border border-border bg-card/20 p-3"
      >
        <Input
          v-model="mediaAltValue"
          placeholder="Alt text"
          :disabled="disabled"
        />
        <Input
          v-model="mediaCaptionValue"
          placeholder="Caption"
          :disabled="disabled"
        />
      </div>
    </div>

    <div
      v-else-if="field.type === 'image'"
      :id="fieldId"
      class="grid gap-3"
    >
      <button
        type="button"
        class="group relative flex min-h-40 w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/10 transition-colors hover:border-primary/40 hover:bg-muted/20 disabled:pointer-events-none disabled:opacity-50"
        :class="mediaIdValue ? 'border-solid' : 'border-dashed'"
        :disabled="disabled || !projectRoot"
        :aria-label="imageActionLabel"
        @click="openMediaPicker"
      >
        <img
          v-if="mediaIdValue && selectedImagePreviewSrc"
          :src="selectedImagePreviewSrc"
          :alt="mediaAltValue || selectedMediaLabel"
          class="absolute inset-0 size-full object-cover"
          @error="handleImagePreviewError"
        />
        <div
          v-else
          class="relative z-10 flex flex-col items-center gap-2 px-4 py-8 text-muted-foreground"
        >
          <AppIcon name="image" :size="28" class="opacity-60" />
          <span class="text-sm">{{ imageActionLabel }}</span>
        </div>
        <div
          v-if="mediaIdValue"
          class="absolute inset-0 z-10 flex items-center justify-center bg-background/45 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <span class="rounded-md bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground">
            {{ imageActionLabel }}
          </span>
        </div>
      </button>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="disabled || !projectRoot"
          @click="openMediaPicker"
        >
          {{ imageActionLabel }}
        </Button>
        <Button
          v-if="mediaIdValue"
          type="button"
          variant="ghost"
          size="sm"
          :disabled="disabled"
          @click="clearMedia"
        >
          Remove
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          :disabled="disabled"
          @click="toggleMediaMeta"
        >
          Alt / caption
        </Button>
      </div>
      <div
        v-if="isMediaMetaOpen"
        class="grid max-w-md gap-2 rounded-md border border-border bg-card/20 p-3"
      >
        <Input
          v-model="mediaAltValue"
          placeholder="Alt text"
          :disabled="disabled"
        />
        <Input
          v-model="mediaCaptionValue"
          placeholder="Caption"
          :disabled="disabled"
        />
      </div>
    </div>

    <div v-else-if="field.type === 'file'" class="grid gap-2">
      <div
        class="flex items-center justify-between gap-2 rounded-md border border-border bg-card/30 px-3 py-2"
      >
        <span class="truncate text-xs text-muted-foreground">
          {{ selectedMediaLabel }}
        </span>
        <div class="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="disabled || !projectRoot"
            @click="openMediaPicker"
          >
            {{ mediaIdValue ? "Change" : "Choose" }}
          </Button>
          <Button
            v-if="mediaIdValue"
            type="button"
            variant="ghost"
            size="sm"
            :disabled="disabled"
            @click="clearMedia"
          >
            Clear
          </Button>
        </div>
      </div>
      <Input
        v-model="fileLabelValue"
        placeholder="File label"
        :disabled="disabled"
      />
    </div>

    <div v-else-if="field.type === 'reference'" class="grid gap-2">
      <CmsEntryCommandSelect
        v-if="projectRoot"
        :model-value="stringValue"
        :project-root="projectRoot"
        :target-collection="field.targetCollection ?? collectionId ?? ''"
        :disabled="disabled || !field.targetCollection"
        placeholder="Choose entry…"
        clearable
        @select="handleEntrySelect"
        @clear="clearReference"
      />
      <Input
        v-else
        :id="fieldId"
        v-model="stringValue"
        :disabled="disabled"
        placeholder="Entry id"
        class="font-mono text-xs"
      />
    </div>

    <div v-else-if="field.type === 'link'" class="grid gap-2">
      <Select
        :model-value="linkTypeValue"
        :disabled="disabled"
        @update:model-value="
          linkTypeValue = ($event as CmsLinkDraftValue['type']) ?? 'external'
        "
      >
        <SelectTrigger :id="fieldId" class="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="external">URL</SelectItem>
          <SelectItem value="internal">Internal path</SelectItem>
          <SelectItem value="page">Page</SelectItem>
          <SelectItem value="entry">Entry</SelectItem>
          <SelectItem value="email">Email</SelectItem>
          <SelectItem value="phone">Phone</SelectItem>
        </SelectContent>
      </Select>

      <CmsEntryCommandSelect
        v-if="linkTypeValue === 'entry' && projectRoot"
        :model-value="linkDraftValue().entryId"
        :project-root="projectRoot"
        :target-collection="field.targetCollection ?? ''"
        :disabled="disabled || !field.targetCollection"
        placeholder="Choose entry…"
        @select="handleLinkEntrySelect"
      />

      <Input
        v-else
        v-model="linkUrlValue"
        :placeholder="
          linkTypeValue === 'email'
            ? 'hello@example.com'
            : linkTypeValue === 'phone'
              ? '+1 555 123 4567'
              : linkTypeValue === 'page'
                ? '/about'
                : 'https://example.com'
        "
        :disabled="disabled"
      />

      <Input
        v-model="linkLabelValue"
        placeholder="Label"
        :disabled="disabled"
      />

      <label class="flex items-center gap-3 text-sm text-muted-foreground">
        <Checkbox
          :checked="linkOpenInNewTabValue"
          :disabled="disabled"
          @update:checked="linkOpenInNewTabValue = $event"
        />
        Open in new tab
      </label>
    </div>

    <div
      v-else-if="field.type === 'object'"
      :id="fieldId"
      class="grid gap-3 rounded-md border border-border bg-card/30 p-3"
    >
      <CmsFrontmatterField
        v-for="nestedField in nestedFields"
        :key="nestedField.key"
        :field="nestedField"
        :model-value="objectValue[nestedField.key]"
        :disabled="disabled"
        :project-root="projectRoot"
        :collection-id="collectionId"
        @update:model-value="updateObjectField(nestedField.key, $event)"
      />
      <p v-if="nestedFields.length === 0" class="text-xs text-muted-foreground">
        Add nested fields in the schema
      </p>
    </div>

    <div v-else-if="field.type === 'repeater'" :id="fieldId" class="grid gap-4">
      <div class="flex items-center justify-between gap-3">
        <Label class="m-0 text-xs leading-none text-muted-foreground">
          {{ field.label }}
          <span v-if="isRequired" class="text-destructive">*</span>
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="disabled || nestedFields.length === 0"
          @click="addRepeaterItem"
        >
          {{ repeaterAddButtonLabel }}
        </Button>
      </div>

      <div class="grid gap-2 rounded-sm border border-border bg-card/30 p-2">
        <p
          v-if="repeaterValue.length === 0"
          class="px-1 py-2 text-xs text-muted-foreground"
        >
          No items yet
        </p>

        <Collapsible
          v-for="(item, index) in repeaterValue"
          :key="getRepeaterItemKey(item)"
          :open="expandedRepeaterIndex === index"
          class="grid gap-0 rounded-sm border border-border/50 bg-card/30 transition-colors"
          :class="
            repeaterDropTargetIndex === index
              ? 'border-primary/50 bg-primary/5'
              : undefined
          "
          @update:open="setRepeaterItemOpen(index, $event)"
        >
          <div
            class="flex min-w-0 items-center justify-between gap-2 px-2 py-1.5"
            :draggable="!disabled"
            @dragstart="handleRepeaterDragStart(index, $event)"
            @dragover="handleRepeaterDragOver(index, $event)"
            @drop="handleRepeaterDrop(index, $event)"
            @dragend="handleRepeaterDragEnd"
          >
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="cms-repeater-item-drag-handle size-7 cursor-grab active:cursor-grabbing"
                :disabled="disabled"
                :aria-label="`Drag to reorder ${repeaterItemTitle(item, index)}`"
                @mousedown.stop
              >
                <AppIcon name="dragHandle" :size="14" />
              </Button>
              <button
                type="button"
                class="min-w-0 flex-1 text-left"
                @click="
                  expandedRepeaterIndex =
                    expandedRepeaterIndex === index ? null : index
                "
              >
                <span class="truncate text-xs text-foreground">
                  {{ repeaterItemTitle(item, index) }}
                </span>
              </button>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="size-7"
                :disabled="disabled || index === 0"
                :aria-label="`Move ${repeaterItemTitle(item, index)} up`"
                @click="moveRepeaterItem(index, -1)"
              >
                <AppIcon name="chevronUp" :size="14" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="size-7"
                :disabled="disabled || index === repeaterValue.length - 1"
                :aria-label="`Move ${repeaterItemTitle(item, index)} down`"
                @click="moveRepeaterItem(index, 1)"
              >
                <AppIcon name="chevronDown" :size="14" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="size-7"
                :disabled="disabled"
                :aria-label="`Duplicate ${repeaterItemTitle(item, index)}`"
                @click="duplicateRepeaterItem(index)"
              >
                <AppIcon name="plus" :size="14" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="size-7 hover:text-destructive"
                :disabled="disabled"
                :aria-label="`Delete ${repeaterItemTitle(item, index)}`"
                @click="removeRepeaterItem(index)"
              >
                <AppIcon name="trash" :size="14" />
              </Button>
              <CollapsibleTrigger as-child>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="size-7"
                  :aria-label="`${expandedRepeaterIndex === index ? 'Collapse' : 'Expand'} ${repeaterItemTitle(item, index)}`"
                >
                  <AppIcon
                    :name="
                      expandedRepeaterIndex === index
                        ? 'chevronUp'
                        : 'chevronDown'
                    "
                    :size="14"
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>

          <CollapsibleContent class="border-t border-dashed border-border/50 p-3">
            <div class="grid gap-3">
              <CmsFrontmatterField
                v-for="nestedField in nestedFields"
                :key="nestedField.key"
                :field="nestedField"
                :model-value="item[nestedField.key]"
                :disabled="disabled"
                :project-root="projectRoot"
                :collection-id="collectionId"
                @update:model-value="
                  updateRepeaterItemField(index, nestedField.key, $event)
                "
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>

    <Textarea
      v-else-if="field.type === 'json'"
      :id="fieldId"
      v-model="jsonValue"
      rows="5"
      class="font-mono text-xs"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
    />

    <Input
      v-else
      :id="fieldId"
      v-model="stringValue"
      :disabled="disabled"
      :placeholder="field.type"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
    />

    <p
      v-if="error"
      :id="errorId"
      class="text-xs text-destructive"
      role="alert"
    >
      {{ error }}
    </p>

    <MediaPickerDialog
      v-model:open="isMediaPickerOpen"
      :project-root="projectRoot"
      :title="field.type === 'image' ? 'Choose image' : 'Choose file'"
      description="Choose or upload a media asset from this project."
      :media-types="field.type === 'image' ? ['image'] : ['document', 'other']"
      @select="handleMediaSelect"
    />

    <IconPickerDialog
      v-model:open="isIconPickerOpen"
      :project-root="projectRoot"
      :value="stringValue"
      @select="stringValue = $event"
    />
  </div>
</template>
