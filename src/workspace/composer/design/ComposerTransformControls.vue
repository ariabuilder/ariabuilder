<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import {
  TRANSFORM_DEFAULTS,
  hasUnsupportedTransformFunctions,
  isOriginPresetActive,
  styleMapToTransformState,
  transformOriginStateToCSS,
  transformStateToCSS,
  transformStateToStyleUpdates,
  type TransformState,
} from "../../../../shared/composer"
import { beginPointerScrub } from "../inspector/useInspectorLiveStyleSession"

type TransformFieldKey =
  | "translateX"
  | "translateY"
  | "rotate"
  | "scaleX"
  | "scaleY"
  | "skewX"
  | "skewY"

type OriginFieldKey = "originX" | "originY"

const props = defineProps<{
  transform: string
  transformOrigin: string
  translate?: string
  rotate?: string
  scale?: string
  inheritedTransform?: string
  inheritedTransformOrigin?: string
  resetKey?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  preview: [updates: Record<string, string>]
  commit: [updates: Record<string, string>]
  cancel: []
}>()

const LINK_BUTTON_CLASS =
  "flex size-6 items-center justify-center rounded-sm border border-transparent text-foreground/70 transition-colors hover:border-border/70 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
const PRESET_BUTTON_CLASS =
  "flex h-6 min-w-0 items-center justify-center rounded-sm border border-dashed border-border/70 bg-sidebar px-1 text-xs font-medium text-foreground/75 transition-colors hover:border-primary/55 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
const ACTIVE_PRESET_BUTTON_CLASS =
  "border-primary/70 bg-primary/10 text-primary"
const SECTION_LABEL_CLASS =
  "text-3xs font-semibold uppercase tracking-widest text-muted-foreground"
const AXIS_ROW_CLASS = "grid grid-cols-[1fr_auto_1fr] items-center gap-2"
const SCRUB_INPUT_CLASS =
  "h-8 w-full cursor-ew-resize border-dashed border-border/70 bg-sidebar pl-8 text-xs focus:cursor-text"
const AXIS_LABEL_CLASS =
  "pointer-events-none absolute left-2.5 z-10 size-3.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70"
const ORIGIN_PRESET_CLASS =
  "flex size-6 items-center justify-center rounded-sm border border-dashed border-border/70 bg-sidebar text-foreground/70 transition-colors hover:border-primary/55 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
const ORIGIN_PRESETS = [
  ["left", "top"],
  ["center", "top"],
  ["right", "top"],
  ["left", "center"],
  ["center", "center"],
  ["right", "center"],
  ["left", "bottom"],
  ["center", "bottom"],
  ["right", "bottom"],
] as const
const ROTATE_PRESETS = ["0deg", "45deg", "90deg", "180deg"] as const

const translateX = ref(TRANSFORM_DEFAULTS.translateX)
const translateY = ref(TRANSFORM_DEFAULTS.translateY)
const rotate = ref(TRANSFORM_DEFAULTS.rotate)
const scaleX = ref(TRANSFORM_DEFAULTS.scaleX)
const scaleY = ref(TRANSFORM_DEFAULTS.scaleY)
const skewX = ref(TRANSFORM_DEFAULTS.skewX)
const skewY = ref(TRANSFORM_DEFAULTS.skewY)
const originX = ref(TRANSFORM_DEFAULTS.originX)
const originY = ref(TRANSFORM_DEFAULTS.originY)
const linkTranslate = ref(true)
const linkScale = ref(true)
const linkSkew = ref(true)
let syncLinksOnHydrate = true

const previewTransformCss = computed(() => transformStateToCSS(getCurrentState()))
const previewOriginCss = computed(() => transformOriginStateToCSS(getCurrentState()))
const previewOriginAnchorStyle = computed(() => ({
  left: resolveOriginPreviewOffset(originX.value, "x"),
  top: resolveOriginPreviewOffset(originY.value, "y"),
}))
const unsupportedTransformMessage = computed(() => {
  if (!hasUnsupportedTransformFunctions(props.transform)) return null
  return m.composer_inspector_transform_unsupported()
})

watch(
  () => props.resetKey,
  () => {
    syncLinksOnHydrate = true
  },
)

watch(
  () => [
    props.transform,
    props.transformOrigin,
    props.translate ?? "",
    props.rotate ?? "",
    props.scale ?? "",
  ],
  () => {
    applyState(incomingState(), syncLinksOnHydrate)
    syncLinksOnHydrate = false
  },
  { immediate: true },
)

function incomingState(): TransformState {
  return styleMapToTransformState({
    transform: props.transform,
    "transform-origin": props.transformOrigin,
    translate: props.translate ?? "",
    rotate: props.rotate ?? "",
    scale: props.scale ?? "",
  })
}

function transformContext() {
  return {
    inheritedTransform: props.inheritedTransform,
    inheritedTransformOrigin: props.inheritedTransformOrigin,
  }
}

function getCurrentState(): TransformState {
  return {
    translateX: translateX.value,
    translateY: translateY.value,
    rotate: rotate.value,
    scaleX: scaleX.value,
    scaleY: scaleY.value,
    skewX: skewX.value,
    skewY: skewY.value,
    originX: originX.value,
    originY: originY.value,
  }
}

function resolveOriginPreviewOffset(value: string, axis: "x" | "y"): string {
  const normalized = value.trim().toLowerCase()
  const keywordOffsets =
    axis === "x"
      ? { left: "0%", center: "50%", right: "100%" }
      : { top: "0%", center: "50%", bottom: "100%" }
  return keywordOffsets[normalized as keyof typeof keywordOffsets] ?? (normalized || "50%")
}

function applyState(state: TransformState, syncLinks = false): void {
  translateX.value = state.translateX
  translateY.value = state.translateY
  rotate.value = state.rotate
  scaleX.value = state.scaleX
  scaleY.value = state.scaleY
  skewX.value = state.skewX
  skewY.value = state.skewY
  originX.value = state.originX
  originY.value = state.originY
  if (!syncLinks) return
  linkTranslate.value = state.translateX === state.translateY
  linkScale.value = state.scaleX === state.scaleY
  linkSkew.value = state.skewX === state.skewY
}

function getMirrorKey(key: TransformFieldKey): TransformFieldKey | null {
  switch (key) {
    case "translateX":
      return linkTranslate.value ? "translateY" : null
    case "translateY":
      return linkTranslate.value ? "translateX" : null
    case "scaleX":
      return linkScale.value ? "scaleY" : null
    case "scaleY":
      return linkScale.value ? "scaleX" : null
    case "skewX":
      return linkSkew.value ? "skewY" : null
    case "skewY":
      return linkSkew.value ? "skewX" : null
    default:
      return null
  }
}

function setTransformField(key: TransformFieldKey, value: string): void {
  switch (key) {
    case "translateX":
      translateX.value = value
      break
    case "translateY":
      translateY.value = value
      break
    case "rotate":
      rotate.value = value
      break
    case "scaleX":
      scaleX.value = value
      break
    case "scaleY":
      scaleY.value = value
      break
    case "skewX":
      skewX.value = value
      break
    case "skewY":
      skewY.value = value
      break
  }
}

function applyFieldValue(key: TransformFieldKey, value: string): void {
  setTransformField(key, value)
  const mirrorKey = getMirrorKey(key)
  if (mirrorKey) setTransformField(mirrorKey, value)
}

function commitTransform(): void {
  if (props.disabled) return
  if (transformStateToCSS(getCurrentState()) === transformStateToCSS(incomingState())) return
  emit("commit", transformStateToStyleUpdates(getCurrentState(), ["transform"], transformContext()))
}

function commitOrigin(): void {
  if (props.disabled) return
  const incoming = incomingState()
  if (
    transformOriginStateToCSS(getCurrentState()) === transformOriginStateToCSS(incoming)
  ) {
    return
  }
  emit("commit", transformStateToStyleUpdates(getCurrentState(), ["transform-origin"], transformContext()))
}

function saveTransformField(key: TransformFieldKey, value: string): void {
  applyFieldValue(key, value)
  commitTransform()
}

function saveOriginField(key: OriginFieldKey, value: string): void {
  if (key === "originX") originX.value = value
  else originY.value = value
  commitOrigin()
}

function toggleLink(kind: "translate" | "scale" | "skew"): void {
  if (props.disabled) return
  if (kind === "translate") {
    linkTranslate.value = !linkTranslate.value
    if (linkTranslate.value) {
      translateY.value = translateX.value
      commitTransform()
    }
    return
  }
  if (kind === "scale") {
    linkScale.value = !linkScale.value
    if (linkScale.value) {
      scaleY.value = scaleX.value
      commitTransform()
    }
    return
  }
  linkSkew.value = !linkSkew.value
  if (linkSkew.value) {
    skewY.value = skewX.value
    commitTransform()
  }
}

function setOriginPreset(nextOriginX: string, nextOriginY: string): void {
  originX.value = nextOriginX
  originY.value = nextOriginY
  commitOrigin()
}

function resolveScrubConfig(key: TransformFieldKey): {
  defaultValue: number
  unit: string
  step: number
} {
  switch (key) {
    case "translateX":
    case "translateY":
      return { defaultValue: 0, unit: "px", step: 1 }
    case "rotate":
    case "skewX":
    case "skewY":
      return { defaultValue: 0, unit: "deg", step: 1 }
    case "scaleX":
    case "scaleY":
      return { defaultValue: 1, unit: "", step: 0.01 }
  }
}

function parseScrubOrigin(
  value: string,
  defaultValue: number,
  unit: string,
): number | null {
  const trimmed = value.trim()
  if (!trimmed) return defaultValue
  const match = unit
    ? trimmed.match(new RegExp(`^(-?\\d+(?:\\.\\d+)?)(?:${unit})?$`, "i"))
    : trimmed.match(/^(-?\d+(?:\.\d+)?)$/)
  if (!match) return null
  const parsed = Number.parseFloat(match[1] ?? "")
  return Number.isFinite(parsed) ? parsed : null
}

function formatScrubValue(value: number, unit: string): string {
  if (!unit) return String(Number.parseFloat(value.toFixed(2)))
  const rounded = Math.round(value * 100) / 100
  return `${rounded}${unit}`
}

function handleScrub(key: TransformFieldKey, event: MouseEvent): void {
  if (props.disabled) return
  if (!(event.target instanceof HTMLInputElement) || event.button !== 0) return
  const originState = getCurrentState()
  const { defaultValue, unit, step } = resolveScrubConfig(key)
  const startValue = parseScrubOrigin(originState[key], defaultValue, unit)
  if (startValue === null) return
  const mirrorKey = getMirrorKey(key)

  function applyScrub(nextValue: number): void {
    const displayValue = formatScrubValue(nextValue, unit)
    setTransformField(key, displayValue)
    if (mirrorKey) setTransformField(mirrorKey, displayValue)
  }

  beginPointerScrub({
    event,
    value: startValue,
    step,
    pixelsPerStep: 1,
    onPreview: (nextValue) => {
      applyScrub(nextValue)
      emit("preview", transformStateToStyleUpdates(getCurrentState(), ["transform"]))
    },
    onCommit: (nextValue) => {
      applyScrub(nextValue)
      commitTransform()
    },
    onCancel: () => {
      applyState(originState)
      emit("cancel")
    },
  })
}
</script>

<template>
  <div class="space-y-3">
    <div
      class="rounded-md border border-border/70 bg-background/65 p-3"
      data-testid="transform-preview-shell"
    >
      <div class="mb-2">
        <span :class="SECTION_LABEL_CLASS">{{ m.composer_inspector_transform_preview() }}</span>
      </div>
      <div
        class="relative h-28 overflow-hidden rounded-md border border-dashed border-border/70 bg-sidebar/70 shadow-inner dark:bg-background/25"
        data-testid="transform-preview-stage"
      >
        <div aria-hidden="true" class="absolute top-3 bottom-3 left-1/2 w-px -translate-x-1/2 bg-border/70" />
        <div aria-hidden="true" class="absolute top-1/2 right-4 left-4 h-px -translate-y-1/2 bg-border/70" />
        <div aria-hidden="true" class="absolute inset-4 grid grid-cols-3 grid-rows-3">
          <span
            v-for="dotIndex in 9"
            :key="`transform-preview-origin-dot-${dotIndex}`"
            class="m-auto size-1 rounded-full bg-muted-foreground/35"
          />
        </div>
        <div class="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <div
            class="relative z-10 size-10 rounded-sm border border-primary/35 bg-primary/16 shadow-[0_10px_24px_rgb(var(--color-primary)/0.12)] transition-transform dark:bg-primary/18"
            data-testid="transform-preview-subject"
            :style="{
              transform: previewTransformCss,
              transformOrigin: previewOriginCss,
            }"
          >
            <span
              aria-hidden="true"
              class="absolute z-20 size-2.5 rounded-full border border-background bg-primary shadow-[0_0_0_2px_rgb(var(--color-primary)/0.22)] dark:border-sidebar"
              data-testid="transform-preview-origin-anchor"
              :style="{
                ...previewOriginAnchorStyle,
                transform: 'translate(-50%, -50%)',
              }"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <span :class="SECTION_LABEL_CLASS">{{ m.composer_inspector_transform_translate() }}</span>
      <div :class="AXIS_ROW_CLASS">
        <div class="relative flex items-center">
          <span :class="AXIS_LABEL_CLASS">X</span>
          <VariableAssignableInput
            data-testid="transform-translate-x-input"
            :model-value="translateX"
            :disabled="disabled"
            class="w-full"
            :input-class="SCRUB_INPUT_CLASS"
            placeholder="0px"
            @update:model-value="applyFieldValue('translateX', String($event))"
            @mousedown="handleScrub('translateX', $event)"
            @commit="saveTransformField('translateX', String($event))"
          />
        </div>
        <button
          data-testid="transform-translate-link-toggle"
          type="button"
          :class="[LINK_BUTTON_CLASS, linkTranslate ? 'bg-muted text-foreground' : 'text-muted-foreground']"
          :disabled="disabled"
          :aria-pressed="linkTranslate"
          :title="m.composer_inspector_transform_link_axes()"
          :aria-label="m.composer_inspector_transform_link_axes()"
          @click="toggleLink('translate')"
        >
          <AppIcon :name="linkTranslate ? 'link' : 'unlink02'" :size="14" />
        </button>
        <div class="relative flex items-center">
          <span :class="AXIS_LABEL_CLASS">Y</span>
          <VariableAssignableInput
            data-testid="transform-translate-y-input"
            :model-value="translateY"
            :disabled="disabled"
            class="w-full"
            :input-class="SCRUB_INPUT_CLASS"
            placeholder="0px"
            @update:model-value="applyFieldValue('translateY', String($event))"
            @mousedown="handleScrub('translateY', $event)"
            @commit="saveTransformField('translateY', String($event))"
          />
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <span :class="SECTION_LABEL_CLASS">{{ m.composer_inspector_transform_rotate() }}</span>
      <div class="space-y-2">
        <div class="relative flex items-center">
          <span :class="AXIS_LABEL_CLASS">R</span>
          <VariableAssignableInput
            data-testid="transform-rotate-input"
            :model-value="rotate"
            :disabled="disabled"
            class="w-full"
            :input-class="SCRUB_INPUT_CLASS"
            placeholder="0deg"
            @update:model-value="rotate = String($event)"
            @mousedown="handleScrub('rotate', $event)"
            @commit="saveTransformField('rotate', String($event))"
          />
        </div>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="preset in ROTATE_PRESETS"
            :key="preset"
            type="button"
            :class="[PRESET_BUTTON_CLASS, rotate === preset && ACTIVE_PRESET_BUTTON_CLASS]"
            :disabled="disabled"
            @click="saveTransformField('rotate', preset)"
          >
            {{ preset.replace("deg", "") }}
          </button>
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <span :class="SECTION_LABEL_CLASS">{{ m.composer_inspector_transform_scale() }}</span>
      <div :class="AXIS_ROW_CLASS">
        <div class="relative flex items-center">
          <span :class="AXIS_LABEL_CLASS">X</span>
          <VariableAssignableInput
            data-testid="transform-scale-x-input"
            :model-value="scaleX"
            :disabled="disabled"
            class="w-full"
            :input-class="SCRUB_INPUT_CLASS"
            placeholder="1"
            @update:model-value="applyFieldValue('scaleX', String($event))"
            @mousedown="handleScrub('scaleX', $event)"
            @commit="saveTransformField('scaleX', String($event))"
          />
        </div>
        <button
          data-testid="transform-scale-link-toggle"
          type="button"
          :class="[LINK_BUTTON_CLASS, linkScale ? 'bg-muted text-foreground' : 'text-muted-foreground']"
          :disabled="disabled"
          :aria-pressed="linkScale"
          :title="m.composer_inspector_transform_link_axes()"
          :aria-label="m.composer_inspector_transform_link_axes()"
          @click="toggleLink('scale')"
        >
          <AppIcon :name="linkScale ? 'link' : 'unlink02'" :size="14" />
        </button>
        <div class="relative flex items-center">
          <span :class="AXIS_LABEL_CLASS">Y</span>
          <VariableAssignableInput
            data-testid="transform-scale-y-input"
            :model-value="scaleY"
            :disabled="disabled"
            class="w-full"
            :input-class="SCRUB_INPUT_CLASS"
            placeholder="1"
            @update:model-value="applyFieldValue('scaleY', String($event))"
            @mousedown="handleScrub('scaleY', $event)"
            @commit="saveTransformField('scaleY', String($event))"
          />
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <span :class="SECTION_LABEL_CLASS">{{ m.composer_inspector_transform_skew() }}</span>
      <div :class="AXIS_ROW_CLASS">
        <div class="relative flex items-center">
          <span :class="AXIS_LABEL_CLASS">X</span>
          <VariableAssignableInput
            data-testid="transform-skew-x-input"
            :model-value="skewX"
            :disabled="disabled"
            class="w-full"
            :input-class="SCRUB_INPUT_CLASS"
            placeholder="0deg"
            @update:model-value="applyFieldValue('skewX', String($event))"
            @mousedown="handleScrub('skewX', $event)"
            @commit="saveTransformField('skewX', String($event))"
          />
        </div>
        <button
          data-testid="transform-skew-link-toggle"
          type="button"
          :class="[LINK_BUTTON_CLASS, linkSkew ? 'bg-muted text-foreground' : 'text-muted-foreground']"
          :disabled="disabled"
          :aria-pressed="linkSkew"
          :title="m.composer_inspector_transform_link_axes()"
          :aria-label="m.composer_inspector_transform_link_axes()"
          @click="toggleLink('skew')"
        >
          <AppIcon :name="linkSkew ? 'link' : 'unlink02'" :size="14" />
        </button>
        <div class="relative flex items-center">
          <span :class="AXIS_LABEL_CLASS">Y</span>
          <VariableAssignableInput
            data-testid="transform-skew-y-input"
            :model-value="skewY"
            :disabled="disabled"
            class="w-full"
            :input-class="SCRUB_INPUT_CLASS"
            placeholder="0deg"
            @update:model-value="applyFieldValue('skewY', String($event))"
            @mousedown="handleScrub('skewY', $event)"
            @commit="saveTransformField('skewY', String($event))"
          />
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <span :class="SECTION_LABEL_CLASS">{{ m.composer_inspector_transform_origin() }}</span>
      <div class="grid grid-cols-[auto_1fr] items-start gap-2">
        <div class="inline-grid grid-cols-3 gap-1">
          <button
            v-for="preset in ORIGIN_PRESETS"
            :key="preset.join('-')"
            :data-testid="`transform-origin-${preset.join('-')}`"
            type="button"
            :class="cn(ORIGIN_PRESET_CLASS, isOriginPresetActive(getCurrentState(), preset[0], preset[1]) && ACTIVE_PRESET_BUTTON_CLASS)"
            :disabled="disabled"
            :aria-label="`${preset[0]} ${preset[1]}`"
            :title="`${preset[0]} ${preset[1]}`"
            @click="setOriginPreset(preset[0], preset[1])"
          >
            <span class="size-1.5 rounded-full bg-current opacity-80" />
          </button>
        </div>
        <div class="flex min-w-0 flex-col gap-2">
          <div class="relative flex items-center">
            <span :class="AXIS_LABEL_CLASS">X</span>
            <VariableAssignableInput
              data-testid="transform-origin-x-input"
              :model-value="originX"
              :disabled="disabled"
              class="w-full"
              :input-class="SCRUB_INPUT_CLASS"
              :placeholder="m.composer_inspector_transform_center()"
              @update:model-value="originX = String($event)"
              @commit="saveOriginField('originX', String($event))"
            />
          </div>
          <div class="relative flex items-center">
            <span :class="AXIS_LABEL_CLASS">Y</span>
            <VariableAssignableInput
              data-testid="transform-origin-y-input"
              :model-value="originY"
              :disabled="disabled"
              class="w-full"
              :input-class="SCRUB_INPUT_CLASS"
              :placeholder="m.composer_inspector_transform_center()"
              @update:model-value="originY = String($event)"
              @commit="saveOriginField('originY', String($event))"
            />
          </div>
        </div>
      </div>
    </div>

    <p v-if="unsupportedTransformMessage" class="text-xs text-muted-foreground">
      {{ unsupportedTransformMessage }}
    </p>
  </div>
</template>
