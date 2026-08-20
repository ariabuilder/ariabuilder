<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ColorField } from "@/components/ui/color-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import type { AppIconName } from "@/icons/registry"
import { m } from "@/paraglide/messages.js"
import {
  enableComposerFilterEffect,
  isComposerFilterEffectEnabled,
  parseComposerFilterCss,
  resetComposerFilterEffect,
  serializeComposerFilterCss,
  validateComposerFilterCss,
  type ComposerFilterEffect,
  type ComposerFilterState,
  type ParsedComposerFilter,
} from "../../../../shared/composer"
import { beginPointerScrub } from "../inspector/useInspectorLiveStyleSession"

type FilterSection = "filter" | "backdrop"
type FilterProperty = "filter" | "backdrop-filter"
type FilterNumericField = Exclude<keyof ComposerFilterState, "dropShadowColor">

type SliderConfig = {
  min: number
  max: number
  step: number
}

const props = withDefaults(defineProps<{
  values: Partial<Record<FilterProperty | "mix-blend-mode", string>>
  inheritedProperties?: readonly string[]
  resetKey?: string
  disabled?: boolean
}>(), {
  inheritedProperties: () => [],
  resetKey: "",
  disabled: false,
})

const emit = defineEmits<{
  preview: [updates: Record<string, string>]
  commit: [updates: Record<string, string>]
  cancel: []
}>()

const FILTER_SECTIONS: readonly FilterSection[] = ["filter", "backdrop"]
const SECTION_PROPERTY: Record<FilterSection, FilterProperty> = {
  filter: "filter",
  backdrop: "backdrop-filter",
}
const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten"] as const
const EFFECT_ROWS: readonly {
  effect: Exclude<ComposerFilterEffect, "dropShadow">
  field: Exclude<FilterNumericField, "dropShadowX" | "dropShadowY" | "dropShadowBlur">
  icon: AppIconName
  placeholder: string
}[] = [
  { effect: "blur", field: "blur", icon: "blur", placeholder: "0" },
  { effect: "brightness", field: "brightness", icon: "sunLinear", placeholder: "100" },
  { effect: "contrast", field: "contrast", icon: "circleHalf", placeholder: "100" },
  { effect: "grayscale", field: "grayscale", icon: "waterdrop", placeholder: "0" },
  { effect: "hueRotate", field: "hueRotate", icon: "paletteLinear", placeholder: "0" },
  { effect: "invert", field: "invert", icon: "layersLinear", placeholder: "0" },
  { effect: "saturate", field: "saturate", icon: "dropLinear", placeholder: "100" },
  { effect: "sepia", field: "sepia", icon: "sunFog", placeholder: "0" },
]
const SHADOW_ROWS: readonly {
  field: "dropShadowX" | "dropShadowY" | "dropShadowBlur"
  label: () => string
  placeholder: string
}[] = [
  { field: "dropShadowX", label: () => "X", placeholder: "0" },
  { field: "dropShadowY", label: () => "Y", placeholder: "0" },
  { field: "dropShadowBlur", label: m.composer_filter_blur, placeholder: "0" },
]

const parsed = ref<Record<FilterSection, ParsedComposerFilter>>({
  filter: parseComposerFilterCss("none"),
  backdrop: parseComposerFilterCss("none"),
})
const states = ref<Record<FilterSection, ComposerFilterState>>({
  filter: { ...parsed.value.filter.state },
  backdrop: { ...parsed.value.backdrop.state },
})
const rawDrafts = ref<Record<FilterSection, string>>({ filter: "none", backdrop: "none" })
const rawSources = ref<Record<FilterSection, string>>({ filter: "none", backdrop: "none" })
const rawOrigins = ref<Record<FilterSection, string>>({ filter: "none", backdrop: "none" })
const rawDirty = ref<Record<FilterSection, boolean>>({ filter: false, backdrop: false })
const rawErrors = ref<Record<FilterSection, string>>({ filter: "", backdrop: "" })
const fieldDrafts = ref<Record<string, string>>({})
const fieldErrors = ref<Record<string, string>>({})
const advancedOpen = ref(false)
const scrubbing = new Set<string>()

const valueSignature = computed(() => [
  props.values.filter ?? "",
  props.values["backdrop-filter"] ?? "",
  props.values["mix-blend-mode"] ?? "",
].join("\u0000"))

function sourceValue(section: FilterSection): string {
  return props.values[SECTION_PROPERTY[section]]?.trim() || "none"
}

function syncSection(section: FilterSection, force = false): void {
  const source = sourceValue(section)
  const nextParsed = parseComposerFilterCss(source)
  parsed.value = { ...parsed.value, [section]: nextParsed }
  states.value = { ...states.value, [section]: { ...nextParsed.state } }
  rawSources.value = { ...rawSources.value, [section]: source }
  if (force || !rawDirty.value[section]) {
    rawDrafts.value = { ...rawDrafts.value, [section]: source }
    rawOrigins.value = { ...rawOrigins.value, [section]: source }
    rawErrors.value = { ...rawErrors.value, [section]: "" }
  }
}

function syncAll(force = false): void {
  for (const section of FILTER_SECTIONS) syncSection(section, force)
}

function fieldKey(section: FilterSection, field: FilterNumericField): string {
  return `${section}:${field}`
}

function fieldErrorId(section: FilterSection, field: FilterNumericField): string {
  return `composer-${section}-${field}-error`
}

function fieldValue(section: FilterSection, field: FilterNumericField): string {
  return fieldDrafts.value[fieldKey(section, field)] ?? states.value[section][field]
}

function setFieldFeedback(
  section: FilterSection,
  field: FilterNumericField,
  draft: string | null,
  error: string,
): void {
  const key = fieldKey(section, field)
  const nextDrafts = { ...fieldDrafts.value }
  const nextErrors = { ...fieldErrors.value }
  if (draft == null) delete nextDrafts[key]
  else nextDrafts[key] = draft
  if (error) nextErrors[key] = error
  else delete nextErrors[key]
  fieldDrafts.value = nextDrafts
  fieldErrors.value = nextErrors
}

function clearSectionFieldFeedback(section: FilterSection): void {
  const prefix = `${section}:`
  fieldDrafts.value = Object.fromEntries(
    Object.entries(fieldDrafts.value).filter(([key]) => !key.startsWith(prefix)),
  )
  fieldErrors.value = Object.fromEntries(
    Object.entries(fieldErrors.value).filter(([key]) => !key.startsWith(prefix)),
  )
}

function fieldError(section: FilterSection, field: FilterNumericField): string {
  return fieldErrors.value[fieldKey(section, field)] ?? ""
}

watch(valueSignature, () => syncAll(false), { immediate: true })
watch(() => props.resetKey, () => {
  rawDirty.value = { filter: false, backdrop: false }
  fieldDrafts.value = {}
  fieldErrors.value = {}
  advancedOpen.value = false
  syncAll(true)
})

function sectionLabel(section: FilterSection): string {
  return section === "filter" ? m.composer_filter_filter() : m.composer_filter_backdrop()
}

function effectLabel(effect: ComposerFilterEffect): string {
  const labels: Record<ComposerFilterEffect, () => string> = {
    blur: m.composer_filter_blur,
    brightness: m.composer_filter_brightness,
    contrast: m.composer_filter_contrast,
    grayscale: m.composer_filter_grayscale,
    hueRotate: m.composer_filter_hue_rotate,
    invert: m.composer_filter_invert,
    saturate: m.composer_filter_saturate,
    sepia: m.composer_filter_sepia,
    dropShadow: m.composer_filter_drop_shadow,
  }
  return labels[effect]()
}

function inherited(property: FilterProperty | "mix-blend-mode"): boolean {
  return props.inheritedProperties.includes(property)
}

function sectionLocked(section: FilterSection): boolean {
  return parsed.value[section].opaque
}

function sectionDisabled(section: FilterSection): boolean {
  return props.disabled || sectionLocked(section)
}

function enabled(section: FilterSection, effect: ComposerFilterEffect): boolean {
  return isComposerFilterEffectEnabled(states.value[section], effect)
}

function sliderConfig(section: FilterSection, field: FilterNumericField): SliderConfig {
  switch (field) {
    case "blur":
      return section === "backdrop"
        ? { min: 0, max: 40, step: 1 }
        : { min: 0, max: 64, step: 1 }
    case "brightness":
    case "contrast":
      return { min: 0, max: 200, step: 1 }
    case "grayscale":
    case "invert":
    case "sepia":
      return { min: 0, max: 100, step: 1 }
    case "hueRotate":
      return { min: 0, max: 360, step: 1 }
    case "saturate":
      return { min: 0, max: 300, step: 1 }
    case "dropShadowX":
    case "dropShadowY":
      return { min: -100, max: 100, step: 1 }
    case "dropShadowBlur":
      return { min: 0, max: 100, step: 1 }
  }
}

function numericValue(section: FilterSection, field: FilterNumericField): number | null {
  const value = fieldValue(section, field).trim()
  const match = value.match(/^(-?(?:\d+\.?\d*|\.\d+))(?:px|deg|%)?$/i)
  if (!match) return null
  const number = Number.parseFloat(match[1] ?? "")
  return Number.isFinite(number) ? number : null
}

function clamp(value: number, config: SliderConfig): number {
  return Math.min(config.max, Math.max(config.min, value))
}

function sliderValue(section: FilterSection, field: FilterNumericField): number[] {
  const config = sliderConfig(section, field)
  return [clamp(numericValue(section, field) ?? config.min, config)]
}

function setState(section: FilterSection, next: ComposerFilterState): void {
  states.value = { ...states.value, [section]: next }
}

function updatesFor(section: FilterSection, next = states.value[section]): Record<string, string> {
  return {
    [SECTION_PROPERTY[section]]: serializeComposerFilterCss(parsed.value[section], next),
  }
}

function previewState(section: FilterSection, next: ComposerFilterState): void {
  setState(section, next)
  emit("preview", updatesFor(section, next))
}

function commitState(section: FilterSection, next = states.value[section]): void {
  setState(section, next)
  emit("commit", updatesFor(section, next))
}

function toggleEffect(section: FilterSection, effect: ComposerFilterEffect): void {
  if (sectionDisabled(section)) return
  for (const field of effect === "dropShadow"
    ? ["dropShadowX", "dropShadowY", "dropShadowBlur"] as const
    : [effect] as const) {
    setFieldFeedback(section, field, null, "")
  }
  const current = states.value[section]
  commitState(
    section,
    enabled(section, effect)
      ? resetComposerFilterEffect(current, effect)
      : enableComposerFilterEffect(current, effect),
  )
}

function updateField(section: FilterSection, field: FilterNumericField, value: string): void {
  const next = { ...states.value[section], [field]: value }
  if (!validateComposerFilterCss(SECTION_PROPERTY[section], updatesFor(section, next)[SECTION_PROPERTY[section]]!)) {
    setFieldFeedback(
      section,
      field,
      value,
      m.composer_filter_invalid({ property: sectionLabel(section) }),
    )
    emit("cancel")
    return
  }
  setFieldFeedback(section, field, null, "")
  previewState(section, next)
}

function normalizedFieldValue(section: FilterSection, field: FilterNumericField, value: string): string {
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(?:px|deg|%)?$/i)
  if (!match) return value.trim()
  const number = Number.parseFloat(match[1] ?? "")
  if (!Number.isFinite(number)) return value.trim()
  return String(clamp(number, sliderConfig(section, field)))
}

function commitField(section: FilterSection, field: FilterNumericField, value: string): void {
  if (scrubbing.has(`${section}:${field}`)) return
  const normalized = normalizedFieldValue(section, field, value)
  const next = {
    ...states.value[section],
    [field]: normalized,
  }
  if (!validateComposerFilterCss(SECTION_PROPERTY[section], updatesFor(section, next)[SECTION_PROPERTY[section]]!)) {
    setFieldFeedback(
      section,
      field,
      normalized,
      m.composer_filter_invalid({ property: sectionLabel(section) }),
    )
    emit("cancel")
    return
  }
  setFieldFeedback(section, field, null, "")
  commitState(section, next)
}

function updateSlider(section: FilterSection, field: FilterNumericField, value: number[] | undefined): void {
  const nextValue = value?.[0]
  if (nextValue == null || !Number.isFinite(nextValue)) return
  const config = sliderConfig(section, field)
  updateField(section, field, String(clamp(nextValue, config)))
}

function commitSlider(section: FilterSection, field: FilterNumericField, value: number[]): void {
  const nextValue = value[0]
  if (nextValue == null || !Number.isFinite(nextValue)) return
  const config = sliderConfig(section, field)
  commitField(section, field, String(clamp(nextValue, config)))
}

function startScrub(section: FilterSection, field: FilterNumericField, event: PointerEvent | MouseEvent): void {
  if (sectionDisabled(section) || !(event.target instanceof HTMLInputElement)) return
  const origin = numericValue(section, field)
  if (origin == null) return
  const config = sliderConfig(section, field)
  const key = `${section}:${field}`
  scrubbing.add(key)
  beginPointerScrub({
    event,
    value: origin,
    pixelsPerStep: 1,
    step: config.step,
    onPreview: (value) => updateField(section, field, String(clamp(Math.round(value), config))),
    onCommit: (value) => {
      scrubbing.delete(key)
      commitField(section, field, String(clamp(Math.round(value), config)))
    },
    onCancel: () => {
      scrubbing.delete(key)
      emit("cancel")
    },
  })
  const release = () => scrubbing.delete(key)
  window.addEventListener("pointerup", release, { once: true })
  window.addEventListener("mouseup", release, { once: true })
}

function setShadowColor(section: FilterSection, value: string, commit: boolean): void {
  const next = { ...states.value[section], dropShadowColor: value }
  if (commit) commitState(section, next)
  else previewState(section, next)
}

function blendLabel(mode: (typeof BLEND_MODES)[number]): string {
  const labels = {
    normal: m.composer_background_blend_normal,
    multiply: m.composer_background_blend_multiply,
    screen: m.composer_background_blend_screen,
    overlay: m.composer_background_blend_overlay,
    darken: m.composer_background_blend_darken,
    lighten: m.composer_background_blend_lighten,
  } as const
  return labels[mode]()
}

function commitBlend(value: unknown): void {
  const normalized = String(value)
  emit("commit", { "mix-blend-mode": normalized === "__unset__" ? "" : normalized })
}

function rawErrorId(section: FilterSection): string {
  return `composer-${SECTION_PROPERTY[section]}-error`
}

function setRawError(section: FilterSection, value: string): void {
  rawErrors.value = { ...rawErrors.value, [section]: value }
}

function rawIsValid(section: FilterSection, value: string): boolean {
  return validateComposerFilterCss(SECTION_PROPERTY[section], value)
}

function previewRaw(section: FilterSection, value: string): void {
  clearSectionFieldFeedback(section)
  if (!rawDirty.value[section]) {
    rawOrigins.value = { ...rawOrigins.value, [section]: rawSources.value[section] }
  }
  rawDirty.value = { ...rawDirty.value, [section]: true }
  rawDrafts.value = { ...rawDrafts.value, [section]: value }
  if (!rawIsValid(section, value)) {
    setRawError(section, m.composer_filter_invalid({ property: sectionLabel(section) }))
    emit("cancel")
    return
  }
  setRawError(section, "")
  emit("preview", { [SECTION_PROPERTY[section]]: value.trim() })
}

function commitRaw(section: FilterSection): void {
  const value = rawDrafts.value[section]
  if (!rawIsValid(section, value)) {
    setRawError(section, m.composer_filter_invalid({ property: sectionLabel(section) }))
    return
  }
  setRawError(section, "")
  rawDirty.value = { ...rawDirty.value, [section]: false }
  rawOrigins.value = { ...rawOrigins.value, [section]: value.trim() || "none" }
  emit("commit", { [SECTION_PROPERTY[section]]: value.trim() })
}

function cancelRaw(section: FilterSection): void {
  rawDrafts.value = { ...rawDrafts.value, [section]: rawOrigins.value[section] }
  rawDirty.value = { ...rawDirty.value, [section]: false }
  setRawError(section, "")
  emit("cancel")
  void nextTick(() => syncSection(section, true))
}

function handleRawKeydown(section: FilterSection, event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault()
    event.stopPropagation()
    cancelRaw(section)
    return
  }
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    commitRaw(section)
  }
}
</script>

<template>
  <div data-testid="composer-filter-controls" class="space-y-6 py-1">
    <div class="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3">
      <span id="composer-filter-blend-label" class="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_filter_blend() }}
        <span v-if="inherited('mix-blend-mode')" class="size-1.5 shrink-0 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" :aria-label="m.composer_inspector_inherited_value()" />
      </span>
      <Select
        :model-value="values['mix-blend-mode'] || '__unset__'"
        :disabled="disabled"
        @update:model-value="commitBlend"
      >
        <SelectTrigger aria-labelledby="composer-filter-blend-label" data-testid="filter-blend-select" class="h-8 min-w-0 border-dashed border-border/70 bg-sidebar text-xs focus:ring-0 focus:ring-offset-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__unset__">{{ m.composer_filter_unset() }}</SelectItem>
          <SelectItem v-for="mode in BLEND_MODES" :key="mode" :value="mode">{{ blendLabel(mode) }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <section
      v-for="section in FILTER_SECTIONS"
      :key="section"
      class="space-y-3"
      :aria-label="sectionLabel(section)"
      :data-testid="`${section}-filter-section`"
    >
      <div class="flex min-h-7 items-center gap-1.5">
        <h4 class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{{ sectionLabel(section) }}</h4>
        <span v-if="inherited(SECTION_PROPERTY[section])" class="size-1.5 shrink-0 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" :aria-label="m.composer_inspector_inherited_value()" />
      </div>

      <p
        v-if="sectionLocked(section)"
        class="rounded-sm border border-dashed border-amber-500/35 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300"
        role="status"
      >
        {{ m.composer_filter_opaque() }}
      </p>

      <div
        v-for="row in EFFECT_ROWS"
        :key="row.effect"
        class="grid min-h-8 grid-cols-[104px_minmax(0,1fr)] items-center gap-3"
      >
        <button
          type="button"
          class="group inline-flex min-h-6 min-w-0 items-center gap-1.5 rounded-sm text-start text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-45"
          :class="enabled(section, row.effect) ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="enabled(section, row.effect)"
          :aria-label="m.composer_filter_toggle({ effect: `${sectionLabel(section)} ${effectLabel(row.effect)}` })"
          :title="m.composer_filter_toggle({ effect: `${sectionLabel(section)} ${effectLabel(row.effect)}` })"
          :disabled="sectionDisabled(section)"
          :data-testid="`${section}-${row.effect}-toggle`"
          @click="toggleEffect(section, row.effect)"
        >
          <AppIcon
            :name="row.icon"
            :size="14"
            :stroke-width="1.5"
            :class="enabled(section, row.effect) ? 'text-primary' : 'text-muted-foreground/55 group-hover:text-muted-foreground'"
            aria-hidden="true"
          />
          <span class="min-w-0 truncate">{{ effectLabel(row.effect) }}</span>
        </button>

        <div class="min-w-0 space-y-1">
          <div class="grid min-w-0 grid-cols-[minmax(3rem,1fr)_5rem] items-center gap-2">
            <Slider
              :model-value="sliderValue(section, row.field)"
              :min="sliderConfig(section, row.field).min"
              :max="sliderConfig(section, row.field).max"
              :step="sliderConfig(section, row.field).step"
              :disabled="sectionDisabled(section) || numericValue(section, row.field) === null"
              class="min-h-6 min-w-0"
              :aria-label="m.composer_filter_amount({ section: sectionLabel(section), effect: effectLabel(row.effect) })"
              :aria-describedby="fieldError(section, row.field) ? fieldErrorId(section, row.field) : undefined"
              :aria-invalid="Boolean(fieldError(section, row.field))"
              :data-testid="`${section}-${row.effect}-slider`"
              @update:model-value="updateSlider(section, row.field, $event)"
              @value-commit="commitSlider(section, row.field, $event)"
            />
            <VariableAssignableInput
              :model-value="fieldValue(section, row.field)"
              input-class="h-8 border-dashed border-border/70 bg-sidebar text-xs cursor-ew-resize focus:cursor-text"
              :placeholder="row.placeholder"
              :aria-label="m.composer_filter_amount({ section: sectionLabel(section), effect: effectLabel(row.effect) })"
              :aria-describedby="fieldError(section, row.field) ? fieldErrorId(section, row.field) : undefined"
              :aria-invalid="Boolean(fieldError(section, row.field))"
              :disabled="sectionDisabled(section)"
              :data-testid="`${section}-${row.effect}-input`"
              @update:model-value="updateField(section, row.field, String($event))"
              @commit="commitField(section, row.field, String($event))"
              @pointerdown="startScrub(section, row.field, $event)"
            />
          </div>
          <span v-if="fieldError(section, row.field)" :id="fieldErrorId(section, row.field)" class="block text-[10px] leading-relaxed text-destructive">
            {{ fieldError(section, row.field) }}
          </span>
        </div>
      </div>

      <div class="grid min-h-8 grid-cols-[104px_minmax(0,1fr)] items-center gap-3">
        <button
          type="button"
          class="group inline-flex min-h-6 min-w-0 items-center gap-1.5 rounded-sm text-start text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-45"
          :class="enabled(section, 'dropShadow') ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="enabled(section, 'dropShadow')"
          :aria-label="m.composer_filter_toggle({ effect: `${sectionLabel(section)} ${effectLabel('dropShadow')}` })"
          :title="m.composer_filter_toggle({ effect: `${sectionLabel(section)} ${effectLabel('dropShadow')}` })"
          :disabled="sectionDisabled(section)"
          :data-testid="`${section}-dropShadow-toggle`"
          @click="toggleEffect(section, 'dropShadow')"
        >
          <AppIcon name="shadow" :size="14" :stroke-width="1.5" :class="enabled(section, 'dropShadow') ? 'text-primary' : 'text-muted-foreground/55 group-hover:text-muted-foreground'" aria-hidden="true" />
          <span class="min-w-0 truncate">{{ effectLabel("dropShadow") }}</span>
        </button>
        <span />
      </div>

      <div v-if="enabled(section, 'dropShadow')" class="space-y-3 rounded-md border border-dashed border-border/70 bg-sidebar/25 p-3">
        <div class="space-y-2">
          <div
            v-for="row in SHADOW_ROWS"
            :key="row.field"
            class="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-2"
          >
            <span class="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{{ row.label() }}</span>
            <div class="min-w-0 space-y-1">
              <div class="grid min-w-0 grid-cols-[minmax(3rem,1fr)_5rem] items-center gap-2">
              <Slider
                :model-value="sliderValue(section, row.field)"
                :min="sliderConfig(section, row.field).min"
                :max="sliderConfig(section, row.field).max"
                :step="sliderConfig(section, row.field).step"
                :disabled="sectionDisabled(section) || numericValue(section, row.field) === null"
                class="min-h-6 min-w-0"
                :aria-label="m.composer_filter_shadow_amount({ section: sectionLabel(section), field: row.label() })"
                :aria-describedby="fieldError(section, row.field) ? fieldErrorId(section, row.field) : undefined"
                :aria-invalid="Boolean(fieldError(section, row.field))"
                :data-testid="`${section}-${row.field}-slider`"
                @update:model-value="updateSlider(section, row.field, $event)"
                @value-commit="commitSlider(section, row.field, $event)"
              />
              <VariableAssignableInput
                :model-value="fieldValue(section, row.field)"
                input-class="h-8 border-dashed border-border/70 bg-sidebar text-xs cursor-ew-resize focus:cursor-text"
                :placeholder="row.placeholder"
                :aria-label="m.composer_filter_shadow_amount({ section: sectionLabel(section), field: row.label() })"
                :aria-describedby="fieldError(section, row.field) ? fieldErrorId(section, row.field) : undefined"
                :aria-invalid="Boolean(fieldError(section, row.field))"
                :disabled="sectionDisabled(section)"
                :data-testid="`${section}-${row.field}-input`"
                @update:model-value="updateField(section, row.field, String($event))"
                @commit="commitField(section, row.field, String($event))"
                @pointerdown="startScrub(section, row.field, $event)"
              />
              </div>
              <span v-if="fieldError(section, row.field)" :id="fieldErrorId(section, row.field)" class="block text-[10px] leading-relaxed text-destructive">
                {{ fieldError(section, row.field) }}
              </span>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-2">
          <span class="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{{ m.composer_filter_color() }}</span>
          <ColorField
            :model-value="states[section].dropShadowColor"
            layout="unified"
            persist-mode="commit"
            show-alpha
            show-design-colors
            show-variables
            :trigger-label="m.composer_filter_shadow_color({ section: sectionLabel(section) })"
            :disabled="sectionDisabled(section)"
            content-side="left"
            content-align="center"
            :data-testid="`${section}-dropShadow-color`"
            @preview="setShadowColor(section, $event, false)"
            @commit="setShadowColor(section, $event, true)"
          />
        </div>
      </div>
    </section>

    <Collapsible v-model:open="advancedOpen" class="rounded-md border border-dashed border-border/70 bg-sidebar/20">
      <CollapsibleTrigger class="flex min-h-8 w-full items-center gap-2 rounded-md px-2.5 text-start text-[10px] font-semibold uppercase tracking-widest text-muted-foreground transition-colors hover:bg-sidebar/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        <AppIcon name="code" :size="14" aria-hidden="true" />
        <span>{{ m.composer_filter_advanced() }}</span>
        <AppIcon name="chevronDown" :size="13" class="ms-auto transition-transform motion-reduce:transition-none" :class="advancedOpen ? 'rotate-180' : ''" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent class="overflow-hidden">
        <div class="space-y-4 border-t border-dashed border-border/70 px-3 py-3">
          <label v-for="section in FILTER_SECTIONS" :key="section" class="block space-y-1.5">
            <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{{ sectionLabel(section) }}</span>
            <Textarea
              :model-value="rawDrafts[section]"
              class="min-h-16 resize-y font-mono text-xs leading-relaxed"
              :disabled="disabled"
              :aria-label="m.composer_filter_raw_label({ property: sectionLabel(section) })"
              :aria-invalid="Boolean(rawErrors[section])"
              :aria-describedby="rawErrors[section] ? rawErrorId(section) : undefined"
              :data-testid="`${section}-filter-raw`"
              data-inspector-escape-owner
              @update:model-value="previewRaw(section, String($event))"
              @blur="rawDirty[section] && commitRaw(section)"
              @keydown="handleRawKeydown(section, $event)"
            />
            <span v-if="rawErrors[section]" :id="rawErrorId(section)" class="block text-[11px] leading-relaxed text-destructive">
              {{ rawErrors[section] }}
            </span>
          </label>
          <p class="text-[10px] leading-relaxed text-muted-foreground">{{ m.composer_filter_advanced_hint() }}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>
