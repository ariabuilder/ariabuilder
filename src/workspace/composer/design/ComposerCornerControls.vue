<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import { m } from "@/paraglide/messages.js"
import {
  CORNER_SHAPE_OPTIONS,
  CORNER_SHAPE_SLIDER_MAX,
  CORNER_SHAPE_SLIDER_MIN,
  CORNER_SHAPE_SLIDER_STEP,
  canonicalRadiusUpdates,
  canonicalShapeUpdates,
  cornerShapeCurvature,
  cornerShapeFromCurvature,
  formatRadiusInput,
  normalizeCornerShapeValue,
  normalizeRadiusValue,
  radiusScrubOrigin,
  resolveCornerStyleState,
  type CornerValues,
  type PhysicalCorner,
} from "../../../../shared/composer"
import type { AppIconName } from "@/icons/registry"
import { beginPointerScrub } from "../inspector/useInspectorLiveStyleSession"

const props = withDefaults(defineProps<{
  styles: Readonly<Record<string, string>>
  inheritedStyles?: Readonly<Record<string, string>>
  resolvedPhysicalRadius?: CornerValues | null
  logicalRadiusResolutionFailed?: boolean
  disabled?: boolean
  resetKey?: string
}>(), {
  inheritedStyles: () => ({}),
  resolvedPhysicalRadius: null,
  logicalRadiusResolutionFailed: false,
  disabled: false,
  resetKey: "",
})

const emit = defineEmits<{
  preview: [updates: Record<string, string>]
  commit: [updates: Record<string, string>]
  cancel: []
}>()

const corners: readonly {
  key: PhysicalCorner
  icon: AppIconName
  label: () => string
  testId: string
}[] = [
  { key: "topLeft", icon: "arrowUpLeft", label: m.composer_corner_top_left, testId: "corner-top-left" },
  { key: "topRight", icon: "arrowUpRight", label: m.composer_corner_top_right, testId: "corner-top-right" },
  { key: "bottomRight", icon: "arrowDownRight", label: m.composer_corner_bottom_right, testId: "corner-bottom-right" },
  { key: "bottomLeft", icon: "arrowDownLeft", label: m.composer_corner_bottom_left, testId: "corner-bottom-left" },
]

const state = computed(() => resolveCornerStyleState(
  props.inheritedStyles,
  props.styles,
  props.resolvedPhysicalRadius,
))
const radiusLinked = ref(true)
const shapeLinked = ref(true)
const radiusLinkTouched = ref(false)
const shapeLinkTouched = ref(false)
const validationError = ref<string | null>(null)
const scrubActive = ref(false)
const radiusDrafts = reactive<CornerValues>({ topLeft: "0", topRight: "0", bottomRight: "0", bottomLeft: "0" })
const linkedRadiusDraft = ref("0")

function syncRadiusDrafts() {
  for (const corner of corners) radiusDrafts[corner.key] = formatRadiusInput(state.value.radius[corner.key])
  linkedRadiusDraft.value = state.value.unsafeRadiusShorthand
    ? state.value.unsafeRadiusShorthand
    : formatRadiusInput(state.value.radius.topLeft)
}

function resetLocalState() {
  radiusLinkTouched.value = false
  shapeLinkTouched.value = false
  radiusLinked.value = state.value.unsafeRadiusShorthand ? true : state.value.radiusLinked
  shapeLinked.value = state.value.shapeLinked
  validationError.value = null
  syncRadiusDrafts()
}

watch(() => props.resetKey, resetLocalState, { immediate: true })
watch(() => state.value.radius, () => {
  if (!scrubActive.value) syncRadiusDrafts()
}, { deep: true })
watch(() => state.value.shapeLinked, (linked) => {
  if (!shapeLinkTouched.value) shapeLinked.value = linked
})
watch(() => state.value.radiusLinked, (linked) => {
  if (!radiusLinkTouched.value && !state.value.unsafeRadiusShorthand) radiusLinked.value = linked
})
watch(() => state.value.unsafeRadiusShorthand, (unsafe) => {
  if (unsafe) radiusLinked.value = true
})

const radiusError = computed(() => validationError.value
  ?? (state.value.logicalRadiusNeedsResolution && !props.resolvedPhysicalRadius
    ? (props.logicalRadiusResolutionFailed
        ? m.composer_corner_radius_logical_unsafe()
        : m.composer_corner_radius_resolving())
    : null)
  ?? (state.value.unsafeRadiusShorthand ? m.composer_corner_radius_unsafe() : null))
const radiusDisabled = computed(() => props.disabled
  || state.value.logicalRadiusNeedsResolution && !props.resolvedPhysicalRadius)
const radiusErrorId = computed(() => `${props.resetKey || "composer"}-corner-radius-error`)

function formatCurvature(value: number): string {
  return String(Number.parseFloat(value.toFixed(1)))
}

function shapeOptionLabel(value: string): string {
  const normalized = normalizeCornerShapeValue(value)
  const labels: Record<string, () => string> = {
    round: m.composer_corner_shape_round,
    squircle: m.composer_corner_shape_squircle,
    bevel: m.composer_corner_shape_bevel,
    scoop: m.composer_corner_shape_scoop,
    notch: m.composer_corner_shape_notch,
    square: m.composer_corner_shape_square,
    "superellipse(1.5)": m.composer_corner_shape_soft_superellipse,
    "superellipse(0.5)": m.composer_corner_shape_pinched_superellipse,
    "superellipse(-0.5)": m.composer_corner_shape_soft_scoop,
    "superellipse(-1.5)": m.composer_corner_shape_deep_scoop,
  }
  const label = labels[normalized]
  if (label) return label()
  const curvature = cornerShapeCurvature(normalized)
  return curvature == null
    ? normalized
    : m.composer_corner_shape_superellipse({ value: formatCurvature(curvature) })
}

function shapeValuesWith(corner: PhysicalCorner | null, value: string): CornerValues {
  const normalized = normalizeCornerShapeValue(value)
  if (!corner) {
    return { topLeft: normalized, topRight: normalized, bottomRight: normalized, bottomLeft: normalized }
  }
  return { ...state.value.shape, [corner]: normalized }
}

function commitShape(corner: PhysicalCorner | null, value: unknown) {
  if (props.disabled || typeof value !== "string") return
  emit("commit", canonicalShapeUpdates(shapeValuesWith(corner, value)))
}

function previewShapeCurvature(corner: PhysicalCorner | null, values: number[] | undefined) {
  const value = values?.[0]
  if (props.disabled || typeof value !== "number" || !Number.isFinite(value)) return
  emit("preview", canonicalShapeUpdates(shapeValuesWith(corner, cornerShapeFromCurvature(value))))
}

function commitShapeCurvature(corner: PhysicalCorner | null, values: number[] | undefined) {
  const value = values?.[0]
  if (props.disabled || typeof value !== "number" || !Number.isFinite(value)) return
  emit("commit", canonicalShapeUpdates(shapeValuesWith(corner, cornerShapeFromCurvature(value))))
}

function sameRadiusValues(left: CornerValues, right: CornerValues): boolean {
  return corners.every(({ key }) => (
    normalizeRadiusValue(left[key]) === normalizeRadiusValue(right[key])
  ))
}

function radiusValueIsSupported(value: string): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return true
  return CSS.supports("border-top-left-radius", value)
}

function normalizedRadiusDrafts(linked: boolean): CornerValues | null {
  const values = linked
    ? {
        topLeft: normalizeRadiusValue(linkedRadiusDraft.value),
        topRight: normalizeRadiusValue(linkedRadiusDraft.value),
        bottomRight: normalizeRadiusValue(linkedRadiusDraft.value),
        bottomLeft: normalizeRadiusValue(linkedRadiusDraft.value),
      }
    : {
        topLeft: normalizeRadiusValue(radiusDrafts.topLeft),
        topRight: normalizeRadiusValue(radiusDrafts.topRight),
        bottomRight: normalizeRadiusValue(radiusDrafts.bottomRight),
        bottomLeft: normalizeRadiusValue(radiusDrafts.bottomLeft),
      }
  const invalid = corners.find(({ key }) => !radiusValueIsSupported(values[key]))
  if (invalid) {
    validationError.value = m.composer_corner_radius_invalid({ corner: invalid.label() })
    return null
  }
  validationError.value = null
  return values
}

function commitRadius(linked: boolean) {
  if (radiusDisabled.value || scrubActive.value) return
  if (linked && state.value.unsafeRadiusShorthand
    && linkedRadiusDraft.value.trim() === state.value.unsafeRadiusShorthand.trim()) return
  const values = normalizedRadiusDrafts(linked)
  if (!values || sameRadiusValues(values, state.value.radius)) return
  emit("commit", canonicalRadiusUpdates(values))
}

function formatScrubValue(value: number, unit: string): string {
  return unit.toLowerCase() === "px" ? String(value) : `${value}${unit}`
}

function scrubRadius(corner: PhysicalCorner | null, event: MouseEvent) {
  if (radiusDisabled.value || state.value.unsafeRadiusShorthand) return
  const draft = corner ? radiusDrafts[corner] : linkedRadiusDraft.value
  const origin = radiusScrubOrigin(draft)
  if (!origin) return
  const originDrafts = { ...radiusDrafts }
  const originLinked = linkedRadiusDraft.value
  scrubActive.value = true
  const release = () => { scrubActive.value = false }
  window.addEventListener("mouseup", release, { once: true })
  window.addEventListener("pointerup", release, { once: true })
  beginPointerScrub({
    event,
    value: origin.value,
    step: 1,
    pixelsPerStep: 1,
    onPreview: (next) => {
      const display = formatScrubValue(Math.max(0, Math.round(next)), origin.unit)
      if (corner) radiusDrafts[corner] = display
      else {
        linkedRadiusDraft.value = display
        for (const item of corners) radiusDrafts[item.key] = display
      }
      const values = normalizedRadiusDrafts(!corner)
      if (values) emit("preview", canonicalRadiusUpdates(values))
    },
    onCommit: () => {
      scrubActive.value = false
      const values = normalizedRadiusDrafts(!corner)
      if (values) emit("commit", canonicalRadiusUpdates(values))
    },
    onCancel: () => {
      scrubActive.value = false
      Object.assign(radiusDrafts, originDrafts)
      linkedRadiusDraft.value = originLinked
      emit("cancel")
    },
  })
}

function toggleShapeLinked() {
  shapeLinkTouched.value = true
  shapeLinked.value = !shapeLinked.value
}

function toggleRadiusLinked() {
  if (state.value.unsafeRadiusShorthand) return
  radiusLinkTouched.value = true
  radiusLinked.value = !radiusLinked.value
}

function shapeIsKnown(value: string): boolean {
  const normalized = normalizeCornerShapeValue(value)
  return CORNER_SHAPE_OPTIONS.some((option) => option.value === normalized)
}

function radiusInputClass(value: string): string {
  return [
    "h-8 w-full ps-8 border-dashed border-border/70 bg-sidebar text-xs focus:cursor-text",
    radiusScrubOrigin(value) && !state.value.unsafeRadiusShorthand ? "cursor-ew-resize" : "cursor-text",
  ].filter(Boolean).join(" ")
}
</script>

<template>
  <div data-testid="composer-corner-controls" class="space-y-6">
    <section class="space-y-3" :aria-labelledby="`${resetKey}-corner-shape-label`">
      <div class="flex items-center justify-between">
        <h4 :id="`${resetKey}-corner-shape-label`" class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{{ m.composer_corner_shape() }}</h4>
        <button
          type="button"
          class="inline-flex size-8 items-center justify-center rounded-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40"
          :class="shapeLinked ? 'bg-muted text-foreground' : 'text-muted-foreground'"
          :aria-pressed="shapeLinked"
          :aria-label="shapeLinked ? m.composer_corner_shape_unlink() : m.composer_corner_shape_link()"
          :title="shapeLinked ? m.composer_corner_shape_unlink() : m.composer_corner_shape_link()"
          :disabled="disabled"
          data-testid="corner-shape-link-toggle"
          @click="toggleShapeLinked"
        ><AppIcon :name="shapeLinked ? 'link' : 'unlink02'" :size="14" aria-hidden="true" /></button>
      </div>

      <div v-if="shapeLinked" class="space-y-2">
        <Select :model-value="state.shape.topLeft" :disabled="disabled" @update:model-value="commitShape(null, $event)">
          <SelectTrigger class="h-9! border-dashed bg-sidebar px-3 text-xs" :aria-label="m.composer_corner_shape()" data-testid="corner-shape-select">
            <span class="truncate">{{ shapeOptionLabel(state.shape.topLeft) }}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-if="!shapeIsKnown(state.shape.topLeft)" :value="state.shape.topLeft">{{ shapeOptionLabel(state.shape.topLeft) }}</SelectItem>
            <SelectItem v-for="option in CORNER_SHAPE_OPTIONS" :key="option.value" :value="option.value">{{ shapeOptionLabel(option.value) }}</SelectItem>
          </SelectContent>
        </Select>
        <div v-if="cornerShapeCurvature(state.shape.topLeft) !== null" class="flex items-center gap-3">
          <div class="flex h-9 flex-1 items-center rounded-sm border border-dashed border-border/70 bg-sidebar px-3">
            <Slider
              :model-value="[cornerShapeCurvature(state.shape.topLeft) ?? 0]"
              :min="CORNER_SHAPE_SLIDER_MIN"
              :max="CORNER_SHAPE_SLIDER_MAX"
              :step="CORNER_SHAPE_SLIDER_STEP"
              :disabled="disabled"
              :aria-label="m.composer_corner_shape_curvature()"
              data-testid="corner-linked-shape-slider"
              @update:model-value="previewShapeCurvature(null, $event)"
              @value-commit="commitShapeCurvature(null, $event)"
            />
          </div>
          <output class="w-10 text-end text-xs tabular-nums text-muted-foreground">{{ formatCurvature(cornerShapeCurvature(state.shape.topLeft) ?? 0) }}</output>
        </div>
      </div>

      <div v-else class="grid grid-cols-2 gap-3">
        <div v-for="corner in corners" :key="corner.key" class="min-w-0 space-y-2">
          <span class="block truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{{ corner.label() }}</span>
          <Select :model-value="state.shape[corner.key]" :disabled="disabled" @update:model-value="commitShape(corner.key, $event)">
            <SelectTrigger class="h-8! border-dashed bg-sidebar px-2 text-xs" :aria-label="`${corner.label()} ${m.composer_corner_shape().toLowerCase()}`" :data-testid="`${corner.testId}-shape-select`">
              <span class="truncate">{{ shapeOptionLabel(state.shape[corner.key]) }}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-if="!shapeIsKnown(state.shape[corner.key])" :value="state.shape[corner.key]">{{ shapeOptionLabel(state.shape[corner.key]) }}</SelectItem>
              <SelectItem v-for="option in CORNER_SHAPE_OPTIONS" :key="option.value" :value="option.value">{{ shapeOptionLabel(option.value) }}</SelectItem>
            </SelectContent>
          </Select>
          <div v-if="cornerShapeCurvature(state.shape[corner.key]) !== null" class="flex items-center gap-2">
            <Slider
              :model-value="[cornerShapeCurvature(state.shape[corner.key]) ?? 0]"
              :min="CORNER_SHAPE_SLIDER_MIN"
              :max="CORNER_SHAPE_SLIDER_MAX"
              :step="CORNER_SHAPE_SLIDER_STEP"
              :disabled="disabled"
              :aria-label="`${corner.label()} ${m.composer_corner_shape_curvature().toLowerCase()}`"
              :data-testid="`${corner.testId}-shape-slider`"
              @update:model-value="previewShapeCurvature(corner.key, $event)"
              @value-commit="commitShapeCurvature(corner.key, $event)"
            />
            <output class="w-7 text-end text-[10px] tabular-nums text-muted-foreground">{{ formatCurvature(cornerShapeCurvature(state.shape[corner.key]) ?? 0) }}</output>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-3" :aria-labelledby="`${resetKey}-corner-radius-label`">
      <div class="flex items-center justify-between">
        <h4 :id="`${resetKey}-corner-radius-label`" class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{{ m.composer_corner_radius() }}</h4>
        <button
          type="button"
          class="inline-flex size-8 items-center justify-center rounded-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40"
          :class="radiusLinked ? 'bg-muted text-foreground' : 'text-muted-foreground'"
          :aria-pressed="radiusLinked"
          :aria-label="radiusLinked ? m.composer_corner_radius_unlink() : m.composer_corner_radius_link()"
          :title="radiusLinked ? m.composer_corner_radius_unlink() : m.composer_corner_radius_link()"
          :disabled="radiusDisabled || Boolean(state.unsafeRadiusShorthand)"
          data-testid="corner-radius-link-toggle"
          @click="toggleRadiusLinked"
        ><AppIcon :name="radiusLinked ? 'link' : 'unlink02'" :size="14" aria-hidden="true" /></button>
      </div>

      <div v-if="radiusLinked" class="space-y-2">
        <div class="relative block">
          <AppIcon name="rounding" :size="14" class="pointer-events-none absolute start-2.5 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
          <VariableAssignableInput
            v-model="linkedRadiusDraft"
            :placeholder="m.composer_corner_radius()"
            :aria-label="m.composer_corner_radius()"
            :input-class="radiusInputClass(linkedRadiusDraft)"
            :disabled="radiusDisabled"
            :aria-invalid="Boolean(validationError)"
            :aria-describedby="radiusError ? radiusErrorId : undefined"
            data-testid="corner-linked-radius-input"
            @commit="commitRadius(true)"
            @mousedown="scrubRadius(null, $event)"
          />
        </div>
      </div>

      <div v-else class="grid grid-cols-2 gap-3">
        <div v-for="corner in corners" :key="corner.key" class="relative block min-w-0">
          <AppIcon :name="corner.icon" :size="14" class="pointer-events-none absolute start-2.5 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
          <VariableAssignableInput
            v-model="radiusDrafts[corner.key]"
            :placeholder="corner.label()"
            :aria-label="`${corner.label()} ${m.composer_corner_radius().toLowerCase()}`"
            :input-class="radiusInputClass(radiusDrafts[corner.key])"
            :disabled="radiusDisabled"
            :aria-invalid="Boolean(validationError)"
            :aria-describedby="radiusError ? radiusErrorId : undefined"
            :data-testid="`${corner.testId}-radius-input`"
            @commit="commitRadius(false)"
            @mousedown="scrubRadius(corner.key, $event)"
          />
        </div>
      </div>

      <p v-if="radiusError" :id="radiusErrorId" class="text-xs leading-relaxed text-destructive" role="status" aria-live="polite" data-testid="corner-radius-error">
        {{ radiusError }}
      </p>
    </section>
  </div>
</template>
