<script setup lang="ts">
import { computed, ref, watchEffect } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import { m } from "@/paraglide/messages.js"
import type { AppIconName } from "@/icons/registry"
import {
  normalizePositionValue,
  type PositionOffsetKey,
  type PositionValueKey,
} from "../../../../shared/composer"
import { beginPointerScrub } from "../inspector/useInspectorLiveStyleSession"

export type PositionMode = "static" | "relative" | "absolute" | "fixed" | "sticky"

export type PositionControlValues = {
  position?: string
  top?: string
  right?: string
  bottom?: string
  left?: string
  "z-index"?: string
}

const POSITION_MODES = [
  "static",
  "relative",
  "absolute",
  "fixed",
  "sticky",
] as const satisfies readonly PositionMode[]

const OFFSET_FIELDS: readonly {
  key: PositionOffsetKey
  icon: AppIconName
  testId: string
}[] = [
  { key: "top", icon: "chevronUp", testId: "position-top-input" },
  { key: "right", icon: "chevronRight", testId: "position-right-input" },
  { key: "bottom", icon: "chevronDown", testId: "position-bottom-input" },
  { key: "left", icon: "chevronLeft", testId: "position-left-input" },
]

const OFFSET_INPUT_CLASS =
  "h-8 cursor-ew-resize border-dashed border-border/70 bg-sidebar pl-8 text-xs focus:cursor-text"
const Z_INDEX_INPUT_CLASS =
  "h-8 cursor-ew-resize border-dashed border-border/70 bg-sidebar pl-7 text-xs focus:cursor-text"

const props = defineProps<{
  values: PositionControlValues
  disabled?: boolean
}>()

const emit = defineEmits<{
  preview: [updates: Record<string, string>]
  commit: [updates: Record<string, string>]
  cancel: []
}>()

const topValue = ref("")
const rightValue = ref("")
const bottomValue = ref("")
const leftValue = ref("")
const zIndexValue = ref("")
let previewDirty = false

watchEffect(() => {
  topValue.value = props.values.top ?? ""
  rightValue.value = props.values.right ?? ""
  bottomValue.value = props.values.bottom ?? ""
  leftValue.value = props.values.left ?? ""
  zIndexValue.value = props.values["z-index"] ?? ""
})

function isKnownPositionMode(value: string): value is PositionMode {
  return POSITION_MODES.includes(value as PositionMode)
}

function isStaticPosition(value: string) {
  const raw = value.trim()
  return !raw || raw === "static"
}

const authoredPosition = computed(() => props.values.position?.trim() ?? "")
const positionMode = computed(() => authoredPosition.value || "static")
const isInsetEditable = computed(() => !isStaticPosition(authoredPosition.value))
const modeOptions = computed(() => {
  const current = positionMode.value
  return isKnownPositionMode(current) ? POSITION_MODES : [current, ...POSITION_MODES]
})

function modeLabel(mode: string) {
  switch (mode) {
    case "static":
      return m.composer_inspector_position_mode_static()
    case "relative":
      return m.composer_inspector_position_mode_relative()
    case "absolute":
      return m.composer_inspector_position_mode_absolute()
    case "fixed":
      return m.composer_inspector_position_mode_fixed()
    case "sticky":
      return m.composer_inspector_position_mode_sticky()
    default:
      return mode
  }
}

function offsetPlaceholder(key: PositionOffsetKey) {
  switch (key) {
    case "top":
      return m.composer_inspector_position_top()
    case "right":
      return m.composer_inspector_position_right()
    case "bottom":
      return m.composer_inspector_position_bottom()
    case "left":
      return m.composer_inspector_position_left()
  }
}

function offsetDraft(key: PositionOffsetKey) {
  switch (key) {
    case "top":
      return topValue.value
    case "right":
      return rightValue.value
    case "bottom":
      return bottomValue.value
    case "left":
      return leftValue.value
  }
}

function setOffsetDraft(key: PositionOffsetKey, value: string) {
  switch (key) {
    case "top":
      topValue.value = value
      break
    case "right":
      rightValue.value = value
      break
    case "bottom":
      bottomValue.value = value
      break
    case "left":
      leftValue.value = value
      break
  }
}

function currentOffset(key: PositionOffsetKey) {
  return (props.values[key] ?? "").trim()
}

function buildOffsetUpdates(key: PositionOffsetKey, value: string) {
  return {
    inset: "",
    top: normalizePositionValue("top", key === "top" ? value : (props.values.top ?? "")),
    right: normalizePositionValue("right", key === "right" ? value : (props.values.right ?? "")),
    bottom: normalizePositionValue("bottom", key === "bottom" ? value : (props.values.bottom ?? "")),
    left: normalizePositionValue("left", key === "left" ? value : (props.values.left ?? "")),
  }
}

function markPreview(updates: Record<string, string>) {
  previewDirty = true
  emit("preview", updates)
}

function discardPreviewIfUnchanged() {
  if (!previewDirty) return
  previewDirty = false
  emit("cancel")
}

function previewOffset(key: PositionOffsetKey, value: string) {
  setOffsetDraft(key, value)
  markPreview(buildOffsetUpdates(key, value))
}

function commitOffset(key: PositionOffsetKey, value: string) {
  const normalized = normalizePositionValue(key, value)
  if (normalized === currentOffset(key)) {
    setOffsetDraft(key, props.values[key] ?? "")
    discardPreviewIfUnchanged()
    return
  }
  previewDirty = false
  emit("commit", buildOffsetUpdates(key, value))
}

function commitMode(value: string) {
  const next = value.trim() || "static"
  const current = authoredPosition.value
  if (isStaticPosition(next)) {
    if (isStaticPosition(current)) return
    emit("commit", { position: "static" })
    return
  }
  if (next === current) return
  emit("commit", { position: next })
}

function previewZIndex(value: string) {
  zIndexValue.value = value
  markPreview({ "z-index": normalizePositionValue("z-index", value) })
}

function commitZIndex(value: string) {
  const normalized = normalizePositionValue("z-index", value)
  const current = (props.values["z-index"] ?? "").trim()
  if (normalized === current) {
    zIndexValue.value = props.values["z-index"] ?? ""
    discardPreviewIfUnchanged()
    return
  }
  previewDirty = false
  emit("commit", { "z-index": normalized })
}

function resolveScrubOrigin(
  key: PositionValueKey,
  value: string,
): { startValue: number; unit: string } {
  const trimmed = value.trim()
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)([a-zA-Z%]+)?$/)
  const fallbackUnit = key === "z-index" ? "" : "px"
  if (!match) return { startValue: 0, unit: fallbackUnit }
  return {
    startValue: Number.parseFloat(match[1] ?? "0"),
    unit: match[2] ?? fallbackUnit,
  }
}

function formatScrubDisplayValue(value: number, unit: string) {
  return unit ? `${value}${unit}` : String(value)
}

function handleScrub(key: PositionValueKey, event: MouseEvent) {
  if (props.disabled) return
  if (key !== "z-index" && !isInsetEditable.value) return
  if (!(event.target instanceof HTMLInputElement)) return

  const { startValue, unit } = resolveScrubOrigin(key, event.target.value)
  beginPointerScrub({
    event,
    value: startValue,
    step: 1,
    pixelsPerStep: 1,
    onPreview: (number) => {
      const formatted = formatScrubDisplayValue(Math.round(number), unit)
      if (key === "z-index") previewZIndex(formatted)
      else previewOffset(key, formatted)
    },
    onCommit: (number) => {
      const formatted = formatScrubDisplayValue(Math.round(number), unit)
      if (key === "z-index") commitZIndex(formatted)
      else commitOffset(key, formatted)
    },
    onCancel: () => {
      previewDirty = false
      emit("cancel")
    },
  })
}
</script>

<template>
  <div data-testid="composer-position-controls" class="space-y-3">
    <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
      <label class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_inspector_position_mode() }}
      </label>
      <Select
        :model-value="positionMode"
        :disabled="disabled"
        @update:model-value="commitMode(String($event ?? ''))"
      >
        <SelectTrigger
          data-testid="position-mode-select"
          :data-mode="positionMode"
          class="h-8 text-xs"
        >
          <SelectValue :placeholder="modeLabel(positionMode)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="mode in modeOptions"
            :key="mode"
            :value="mode"
          >
            {{ modeLabel(mode) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <div
        v-for="field in OFFSET_FIELDS"
        :key="field.key"
        class="relative flex items-center"
      >
        <AppIcon
          :name="field.icon"
          :size="14"
          class="pointer-events-none absolute left-2.5 z-10 text-muted-foreground/60"
        />
        <VariableAssignableInput
          :data-testid="field.testId"
          class="w-full"
          :model-value="offsetDraft(field.key)"
          :input-class="OFFSET_INPUT_CLASS"
          :placeholder="offsetPlaceholder(field.key)"
          :disabled="disabled || !isInsetEditable"
          @update:model-value="setOffsetDraft(field.key, String($event))"
          @commit="commitOffset(field.key, String($event))"
          @mousedown="handleScrub(field.key, $event)"
        />
      </div>
    </div>

    <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
      <label class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_inspector_position_z_index() }}
      </label>
      <div class="relative flex items-center">
        <span
          data-testid="position-z-prefix"
          class="pointer-events-none absolute left-2.5 z-10 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60"
        >
          Z
        </span>
        <VariableAssignableInput
          data-testid="position-z-index-input"
          class="w-full"
          :model-value="zIndexValue"
          :input-class="Z_INDEX_INPUT_CLASS"
          :placeholder="m.composer_inspector_position_auto()"
          :disabled="disabled"
          @update:model-value="zIndexValue = String($event)"
          @commit="commitZIndex(String($event))"
          @mousedown="handleScrub('z-index', $event)"
        />
      </div>
    </div>
  </div>
</template>
