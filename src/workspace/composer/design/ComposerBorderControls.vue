<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { ColorField } from "@/components/ui/color-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import { m } from "@/paraglide/messages.js"
import type { AppIconName } from "@/icons/registry"
import { beginPointerScrub } from "../inspector/useInspectorLiveStyleSession"
import {
  BORDER_RADIUS_PROPERTIES,
  BORDER_STYLE_OPTIONS,
  BORDER_WIDTH_UNITS,
  buildBorderWidthValue,
  buildLinkedRadiusUpdates,
  buildMaterializedBorderUpdates,
  buildUnlinkedRadiusUpdates,
  formatBorderRadiusInput,
  parseBorderWidthInput,
  resolveBorderCorners,
  resolveBorderValues,
  type BorderControlValues,
  type BorderRadiusCorner,
  type ComposerBorderStyle,
  type ComposerBorderWidthUnit,
  type ResolvedBorderCorners,
} from "./composerBorder"

const props = defineProps<{
  values: BorderControlValues
  inheritedProperties?: readonly string[]
  disabled?: boolean
  resetKey?: string
}>()

const emit = defineEmits<{
  preview: [updates: Record<string, string>]
  commit: [updates: Record<string, string>]
  cancel: []
}>()

const PROPERTY_ROW_CLASS = "grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2"
const PROPERTY_LABEL_CLASS = "flex items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground"
const INPUT_CLASS = "h-8 cursor-ew-resize border-dashed border-border/70 bg-sidebar ps-8 text-xs focus:cursor-text"
const SELECT_TRIGGER_CLASS = "h-8 border-dashed border-border/70 bg-sidebar text-xs hover:border-border focus:ring-0 focus:ring-offset-0"

const border = computed(() => resolveBorderValues(props.values))
const corners = computed(() => resolveBorderCorners(props.values))
const widthDraft = ref("1")
const widthUnit = ref<ComposerBorderWidthUnit>("px")
const radiusDrafts = ref<ResolvedBorderCorners>(resolveBorderCorners(props.values))
const linkedRadiusDraft = ref("0")
const radiusLinked = ref(true)
let widthScrubbing = false
let radiusScrubbing = false

const cornerFields: readonly {
  property: BorderRadiusCorner
  icon: AppIconName
  label: () => string
  testId: string
}[] = [
  { property: "border-start-start-radius", icon: "arrowUpLeft", label: m.composer_border_radius_start_start, testId: "border-start-start-radius-input" },
  { property: "border-start-end-radius", icon: "arrowUpRight", label: m.composer_border_radius_start_end, testId: "border-start-end-radius-input" },
  { property: "border-end-start-radius", icon: "arrowDownLeft", label: m.composer_border_radius_end_start, testId: "border-end-start-radius-input" },
  { property: "border-end-end-radius", icon: "arrowDownRight", label: m.composer_border_radius_end_end, testId: "border-end-end-radius-input" },
]

function inherited(property: string) {
  const inheritedProperties = props.inheritedProperties ?? []
  if (inheritedProperties.includes(property)) return true
  if (["border-color", "border-width", "border-style"].includes(property)) return inheritedProperties.includes("border")
  if (BORDER_RADIUS_PROPERTIES.includes(property as (typeof BORDER_RADIUS_PROPERTIES)[number])) {
    return inheritedProperties.some((item) => BORDER_RADIUS_PROPERTIES.includes(item as (typeof BORDER_RADIUS_PROPERTIES)[number]))
  }
  return false
}

function syncWidth() {
  const parsed = parseBorderWidthInput(border.value.width)
  widthDraft.value = parsed.value
  widthUnit.value = parsed.unit
}

const radiusSignature = computed(() => BORDER_RADIUS_PROPERTIES.map((property) => props.values[property] ?? "").join("\u0000"))
watch(() => border.value.width, syncWidth, { immediate: true })
watch(radiusSignature, () => {
  const resolved = corners.value
  radiusDrafts.value = { ...resolved }
  const values = Object.values(resolved)
  radiusLinked.value = values.every((value) => value === values[0])
  linkedRadiusDraft.value = formatBorderRadiusInput(values[0] ?? "0")
}, { immediate: true })
watch(() => props.resetKey, () => {
  syncWidth()
})

function borderUpdates(overrides: Partial<{ color: string; width: string; style: ComposerBorderStyle }> = {}) {
  return buildMaterializedBorderUpdates(props.values, overrides)
}

function preview(updates: Record<string, string>) {
  emit("preview", updates)
}

function commit(updates: Record<string, string>) {
  emit("commit", updates)
}

function cancelPreview() {
  emit("cancel")
}

function commitColor(value: string) {
  commit(borderUpdates({ color: value.trim() || "transparent" }))
}

function previewColor(value: string) {
  preview(borderUpdates({ color: value.trim() || "transparent" }))
}

function previewWidth(value: string) {
  widthDraft.value = value
  preview(borderUpdates({ width: buildBorderWidthValue(value, widthUnit.value) }))
}

function commitWidth(value: string) {
  if (widthScrubbing) return
  widthDraft.value = value
  commit(borderUpdates({ width: buildBorderWidthValue(value, widthUnit.value) }))
}

function commitWidthUnit(value: unknown) {
  if (!BORDER_WIDTH_UNITS.includes(value as ComposerBorderWidthUnit)) return
  widthUnit.value = value as ComposerBorderWidthUnit
  commit(borderUpdates({ width: buildBorderWidthValue(widthDraft.value, widthUnit.value) }))
}

function styleLabel(style: ComposerBorderStyle) {
  const labels: Record<ComposerBorderStyle, () => string> = {
    none: m.composer_border_style_none,
    hidden: m.composer_border_style_hidden,
    solid: m.composer_border_style_solid,
    dashed: m.composer_border_style_dashed,
    dotted: m.composer_border_style_dotted,
    double: m.composer_border_style_double,
    groove: m.composer_border_style_groove,
    ridge: m.composer_border_style_ridge,
    inset: m.composer_border_style_inset,
    outset: m.composer_border_style_outset,
  }
  return labels[style]()
}

function commitStyle(value: unknown) {
  if (!BORDER_STYLE_OPTIONS.includes(value as ComposerBorderStyle)) return
  commit(borderUpdates({ style: value as ComposerBorderStyle }))
}

function setRadiusDraft(property: BorderRadiusCorner, value: string) {
  radiusDrafts.value = { ...radiusDrafts.value, [property]: value }
}

function previewLinkedRadius(value: string) {
  linkedRadiusDraft.value = value
  preview(buildLinkedRadiusUpdates(value))
}

function commitLinkedRadius(value: string) {
  if (radiusScrubbing) return
  linkedRadiusDraft.value = value
  commit(buildLinkedRadiusUpdates(value))
}

function previewCorner(property: BorderRadiusCorner, value: string) {
  setRadiusDraft(property, value)
  preview(buildUnlinkedRadiusUpdates(radiusDrafts.value, property, value))
}

function commitCorner(property: BorderRadiusCorner, value: string) {
  if (radiusScrubbing) return
  setRadiusDraft(property, value)
  commit(buildUnlinkedRadiusUpdates(radiusDrafts.value, property, value))
}

function resolveScrubOrigin(value: string, fallbackUnit = "px") {
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))([a-zA-Z%]+)?$/)
  return match
    ? { value: Number.parseFloat(match[1] ?? "0"), unit: match[2] ?? fallbackUnit }
    : { value: 0, unit: fallbackUnit }
}

function releaseScrub(kind: "width" | "radius") {
  const release = () => {
    if (kind === "width") widthScrubbing = false
    else radiusScrubbing = false
  }
  window.addEventListener("pointerup", release, { once: true })
  window.addEventListener("mouseup", release, { once: true })
}

function handleWidthScrub(event: MouseEvent) {
  if (props.disabled || !(event.target instanceof HTMLInputElement)) return
  const origin = resolveScrubOrigin(widthDraft.value, widthUnit.value)
  widthScrubbing = true
  beginPointerScrub({
    event,
    value: origin.value,
    step: 1,
    pixelsPerStep: 1,
    onPreview: (value) => previewWidth(String(Math.round(value))),
    onCommit: (value) => {
      widthScrubbing = false
      widthDraft.value = String(Math.round(value))
      commit(borderUpdates({ width: buildBorderWidthValue(widthDraft.value, widthUnit.value) }))
    },
    onCancel: () => {
      widthScrubbing = false
      cancelPreview()
    },
  })
  releaseScrub("width")
}

function handleRadiusScrub(property: BorderRadiusCorner | null, event: MouseEvent) {
  if (props.disabled || !(event.target instanceof HTMLInputElement)) return
  const current = property ? radiusDrafts.value[property] : linkedRadiusDraft.value
  const origin = resolveScrubOrigin(current)
  radiusScrubbing = true
  const format = (value: number) => origin.unit === "px" ? String(Math.round(value)) : `${Math.round(value)}${origin.unit}`
  beginPointerScrub({
    event,
    value: origin.value,
    step: 1,
    pixelsPerStep: 1,
    onPreview: (value) => {
      const formatted = format(value)
      if (property) previewCorner(property, formatted)
      else previewLinkedRadius(formatted)
    },
    onCommit: (value) => {
      radiusScrubbing = false
      const formatted = format(value)
      if (property) {
        setRadiusDraft(property, formatted)
        commit(buildUnlinkedRadiusUpdates(radiusDrafts.value, property, formatted))
      } else {
        linkedRadiusDraft.value = formatted
        commit(buildLinkedRadiusUpdates(formatted))
      }
    },
    onCancel: () => {
      radiusScrubbing = false
      cancelPreview()
    },
  })
  releaseScrub("radius")
}

function toggleRadiusLinking() {
  radiusLinked.value = !radiusLinked.value
  if (radiusLinked.value) {
    const value = radiusDrafts.value["border-start-start-radius"] || "0"
    linkedRadiusDraft.value = formatBorderRadiusInput(value)
  } else {
    radiusDrafts.value = { ...corners.value }
  }
}
</script>

<template>
  <div data-testid="composer-border-controls" class="space-y-3 py-1">
    <div :class="PROPERTY_ROW_CLASS">
      <span :class="PROPERTY_LABEL_CLASS">
        {{ m.composer_border_color() }}
        <span v-if="inherited('border-color')" class="size-1.5 shrink-0 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" :aria-label="m.composer_inspector_inherited_value()" />
      </span>
      <ColorField
        :model-value="border.color"
        layout="unified"
        persist-mode="commit"
        show-alpha
        show-design-colors
        show-variables
        :disabled="disabled"
        content-side="left"
        content-align="center"
        :trigger-label="m.composer_border_color()"
        data-testid="border-color-input"
        @preview="previewColor"
        @commit="commitColor"
      />
    </div>

    <div :class="PROPERTY_ROW_CLASS">
      <span :class="PROPERTY_LABEL_CLASS">
        {{ m.composer_border_size() }}
        <span v-if="inherited('border-width')" class="size-1.5 shrink-0 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" :aria-label="m.composer_inspector_inherited_value()" />
      </span>
      <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div class="relative min-w-0">
          <AppIcon name="strokeCenter" :size="14" class="pointer-events-none absolute start-2.5 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
          <VariableAssignableInput
            :model-value="widthDraft"
            :input-class="INPUT_CLASS"
            :placeholder="m.composer_border_width()"
            :aria-label="m.composer_border_width()"
            :disabled="disabled"
            data-testid="border-width-input"
            @update:model-value="previewWidth(String($event))"
            @commit="commitWidth"
            @mousedown="handleWidthScrub"
          />
        </div>
        <Select :model-value="widthUnit" :disabled="disabled" @update:model-value="commitWidthUnit">
          <SelectTrigger class="h-8 w-13 justify-center border-dashed border-border/70 bg-sidebar px-1.5 text-xs text-muted-foreground" hide-icon :aria-label="m.composer_inspector_value_unit()" data-testid="border-width-unit-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" class="w-16 min-w-0">
            <SelectItem v-for="unit in BORDER_WIDTH_UNITS" :key="unit" :value="unit" class="text-xs">{{ unit }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div :class="PROPERTY_ROW_CLASS">
      <span :class="PROPERTY_LABEL_CLASS">
        {{ m.composer_border_type() }}
        <span v-if="inherited('border-style')" class="size-1.5 shrink-0 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" :aria-label="m.composer_inspector_inherited_value()" />
      </span>
      <Select :model-value="border.style" :disabled="disabled" @update:model-value="commitStyle">
        <SelectTrigger :class="SELECT_TRIGGER_CLASS" :aria-label="m.composer_border_type()" data-testid="border-style-select"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="style in BORDER_STYLE_OPTIONS" :key="style" :value="style">{{ styleLabel(style) }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="space-y-3 pt-1">
      <div class="flex min-h-6 items-center justify-between">
        <span :class="PROPERTY_LABEL_CLASS">
          {{ m.composer_border_radius() }}
          <span v-if="inherited('border-radius')" class="size-1.5 shrink-0 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" :aria-label="m.composer_inspector_inherited_value()" />
        </span>
        <button
          type="button"
          class="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50"
          :class="radiusLinked && 'bg-muted text-foreground'"
          :aria-pressed="radiusLinked"
          :aria-label="radiusLinked ? m.composer_border_unlink_radius() : m.composer_border_link_radius()"
          :title="radiusLinked ? m.composer_border_unlink_radius() : m.composer_border_link_radius()"
          :disabled="disabled"
          data-testid="border-radius-link-toggle"
          @click="toggleRadiusLinking"
        >
          <AppIcon :name="radiusLinked ? 'link' : 'unlink02'" :size="14" aria-hidden="true" />
        </button>
      </div>

      <div v-if="radiusLinked" class="relative min-w-0">
        <AppIcon name="rounding" :size="14" class="pointer-events-none absolute start-2.5 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
        <VariableAssignableInput
          :model-value="linkedRadiusDraft"
          :input-class="INPUT_CLASS"
          :placeholder="m.composer_border_radius()"
          :aria-label="m.composer_border_radius()"
          :disabled="disabled"
          data-testid="border-linked-radius-input"
          @update:model-value="previewLinkedRadius(String($event))"
          @commit="commitLinkedRadius"
          @mousedown="handleRadiusScrub(null, $event)"
        />
      </div>

      <div v-else class="grid grid-cols-2 gap-2" data-testid="border-unlinked-radius-grid">
        <div v-for="corner in cornerFields" :key="corner.property" class="relative min-w-0">
          <AppIcon :name="corner.icon" :size="14" class="pointer-events-none absolute start-2.5 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/60 rtl:scale-x-[-1]" aria-hidden="true" />
          <VariableAssignableInput
            :model-value="formatBorderRadiusInput(radiusDrafts[corner.property])"
            :input-class="INPUT_CLASS"
            :placeholder="corner.label()"
            :disabled="disabled"
            :aria-label="corner.label()"
            :data-testid="corner.testId"
            @update:model-value="previewCorner(corner.property, String($event))"
            @commit="commitCorner(corner.property, String($event))"
            @mousedown="handleRadiusScrub(corner.property, $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
