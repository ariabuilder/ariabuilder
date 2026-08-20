<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import type { AppIconName } from "@/icons/registry"
import {
  HEIGHT_SIZING_PROP,
  WIDTH_SIZING_PROP,
  axisHasExplicitSizing,
  formatExactInputValue,
  normalizeSizeValue,
  resolveSizeMode,
  type SizeAxis,
  type SizeMode,
} from "../../../../shared/composer"
import { beginPointerScrub } from "../inspector/useInspectorLiveStyleSession"

export type SizeControlValues = Record<string, string>

type SizeInputKey = "width" | "height" | "min-width" | "min-height" | "max-width" | "max-height"

const SIZE_MODES = ["hug", "fill", "exact"] as const satisfies readonly SizeMode[]

const INPUT_CLASS =
  "h-8 cursor-ew-resize border-dashed border-border/70 bg-sidebar pl-8 text-xs focus:cursor-text"

const props = defineProps<{
  values: SizeControlValues
  inheritedProperties?: readonly string[]
  disabled?: boolean
  resetKey?: string
  cancelEpoch?: number
}>()

const emit = defineEmits<{
  mode: [axis: SizeAxis, mode: SizeMode]
  preview: [updates: Record<string, string>]
  commit: [updates: Record<string, string>]
  cancel: []
}>()

const widthModeLocked = ref(false)
const heightModeLocked = ref(false)
const widthInput = ref("")
const heightInput = ref("")
const minWidth = ref("")
const minHeight = ref("")
const maxWidth = ref("")
const maxHeight = ref("")
let scrubbing = false

const widthMode = computed<SizeMode | null>(() =>
  displayedMode("width", widthModeLocked.value),
)
const heightMode = computed<SizeMode | null>(() =>
  displayedMode("height", heightModeLocked.value),
)

function displayedMode(axis: SizeAxis, locked: boolean): SizeMode | null {
  if (locked) return "exact"
  if (!axisHasExplicitSizing(props.values, axis)) return null
  return resolveSizeMode(props.values, axis)
}

function unlockExactModes(): void {
  widthModeLocked.value = false
  heightModeLocked.value = false
}

function syncExactInputsFromProps(): void {
  widthInput.value = formatExactInputValue(props.values.width ?? "")
  heightInput.value = formatExactInputValue(props.values.height ?? "")
}

watch(
  () => props.resetKey,
  () => {
    unlockExactModes()
  },
)

watch(
  () => props.cancelEpoch,
  () => {
    unlockExactModes()
    syncExactInputsFromProps()
  },
)

watch(
  () => props.values,
  () => {
    if (!widthModeLocked.value) {
      widthInput.value = formatExactInputValue(props.values.width ?? "")
    }
    if (!heightModeLocked.value) {
      heightInput.value = formatExactInputValue(props.values.height ?? "")
    }
    minWidth.value = props.values["min-width"] ?? ""
    minHeight.value = props.values["min-height"] ?? ""
    maxWidth.value = props.values["max-width"] ?? ""
    maxHeight.value = props.values["max-height"] ?? ""
  },
  { deep: true, immediate: true },
)

function inherited(property: string): boolean {
  return props.inheritedProperties?.includes(property) ?? false
}

function modeLabel(mode: SizeMode): string {
  if (mode === "hug") return m.composer_size_mode_hug()
  if (mode === "fill") return m.composer_size_mode_fill()
  return m.composer_size_mode_exact()
}

function selectMode(axis: SizeAxis, mode: SizeMode): void {
  if (props.disabled) return
  if (axis === "width") {
    widthModeLocked.value = mode === "exact"
    if (mode === "exact") {
      widthInput.value = formatExactInputValue(props.values.width ?? "")
      return
    }
  } else {
    heightModeLocked.value = mode === "exact"
    if (mode === "exact") {
      heightInput.value = formatExactInputValue(props.values.height ?? "")
      return
    }
  }
  emit("mode", axis, mode)
}

function exactUpdates(axis: SizeAxis, raw: string): Record<string, string> {
  return {
    [axis]: normalizeSizeValue(raw),
    [axis === "width" ? WIDTH_SIZING_PROP : HEIGHT_SIZING_PROP]: "exact",
  }
}

function constraintUpdates(key: Exclude<SizeInputKey, SizeAxis>, raw: string): Record<string, string> {
  return { [key]: normalizeSizeValue(raw) }
}

function previewExact(axis: SizeAxis, raw: string): void {
  if (axis === "width") widthInput.value = raw
  else heightInput.value = raw
  emit("preview", exactUpdates(axis, raw))
}

function commitExact(axis: SizeAxis, raw: string): void {
  if (scrubbing) return
  if (axis === "width") {
    widthInput.value = formatExactInputValue(normalizeSizeValue(raw))
    widthModeLocked.value = false
  } else {
    heightInput.value = formatExactInputValue(normalizeSizeValue(raw))
    heightModeLocked.value = false
  }
  emit("commit", exactUpdates(axis, raw))
}

function previewConstraint(key: Exclude<SizeInputKey, SizeAxis>, raw: string): void {
  setConstraintRef(key, raw)
  emit("preview", constraintUpdates(key, raw))
}

function commitConstraint(key: Exclude<SizeInputKey, SizeAxis>, raw: string): void {
  if (scrubbing) return
  const updates = constraintUpdates(key, raw)
  setConstraintRef(key, updates[key] ?? raw)
  emit("commit", updates)
}

function setConstraintRef(key: Exclude<SizeInputKey, SizeAxis>, raw: string): void {
  switch (key) {
    case "min-width":
      minWidth.value = raw
      break
    case "min-height":
      minHeight.value = raw
      break
    case "max-width":
      maxWidth.value = raw
      break
    case "max-height":
      maxHeight.value = raw
      break
  }
}

function constraintRef(key: Exclude<SizeInputKey, SizeAxis>): string {
  switch (key) {
    case "min-width":
      return minWidth.value
    case "min-height":
      return minHeight.value
    case "max-width":
      return maxWidth.value
    case "max-height":
      return maxHeight.value
  }
}

function scrubOrigin(raw: string): { startValue: number; unit: string } {
  const trimmed = raw.trim()
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)([a-zA-Z%]+)?$/)
  if (!match) return { startValue: 0, unit: "px" }
  return {
    startValue: Number.parseFloat(match[1] ?? "0"),
    unit: match[2] ?? "px",
  }
}

function formatScrubValue(value: number, unit: string): string {
  return unit === "px" ? String(value) : `${value}${unit}`
}

function endScrub(): void {
  scrubbing = false
}

function beginSizeScrub(
  event: MouseEvent,
  origin: string,
  handlers: {
    onPreview: (raw: string) => void
    onCommit: (raw: string) => void
  },
): void {
  if (props.disabled || event.button !== 0) return
  if (!(event.target instanceof HTMLInputElement)) return
  const { startValue, unit } = scrubOrigin(origin || event.target.value)
  scrubbing = true
  const onPointerEnd = () => {
    window.removeEventListener("pointerup", onPointerEnd)
    window.removeEventListener("mouseup", onPointerEnd)
    endScrub()
  }
  window.addEventListener("pointerup", onPointerEnd)
  window.addEventListener("mouseup", onPointerEnd)
  beginPointerScrub({
    event,
    value: startValue,
    step: 1,
    pixelsPerStep: 1,
    onPreview: (number) => handlers.onPreview(formatScrubValue(Math.round(number), unit)),
    onCommit: (number) => {
      endScrub()
      handlers.onCommit(formatScrubValue(Math.round(number), unit))
    },
    onCancel: () => {
      endScrub()
      emit("cancel")
    },
  })
}

function handleExactScrub(axis: SizeAxis, event: MouseEvent): void {
  beginSizeScrub(event, event.target instanceof HTMLInputElement ? event.target.value : "", {
    onPreview: (raw) => previewExact(axis, raw),
    onCommit: (raw) => commitExact(axis, raw),
  })
}

function handleConstraintScrub(key: Exclude<SizeInputKey, SizeAxis>, event: MouseEvent): void {
  beginSizeScrub(event, constraintRef(key), {
    onPreview: (raw) => previewConstraint(key, raw),
    onCommit: (raw) => commitConstraint(key, raw),
  })
}

function moveRadio(
  event: KeyboardEvent,
  current: SizeMode | null,
  select: (mode: SizeMode) => void,
): void {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
  event.preventDefault()
  const currentIndex = current ? Math.max(0, SIZE_MODES.indexOf(current)) : 0
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? SIZE_MODES.length - 1
      : (currentIndex + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + SIZE_MODES.length) % SIZE_MODES.length
  const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
  const buttons = group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
  buttons?.[nextIndex]?.focus()
  select(SIZE_MODES[nextIndex]!)
}

const constraintFields: readonly {
  key: Exclude<SizeInputKey, SizeAxis>
  icon: AppIconName
  testId: string
}[] = [
  { key: "min-width", icon: "arrowLeftRight", testId: "size-min-width" },
  { key: "min-height", icon: "arrowUpDown", testId: "size-min-height" },
  { key: "max-width", icon: "arrowLeftRight", testId: "size-max-width" },
  { key: "max-height", icon: "arrowUpDown", testId: "size-max-height" },
]
</script>

<template>
  <div class="space-y-4 pb-1" data-testid="composer-size-controls">
    <div class="space-y-2">
      <span class="flex items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_size_width() }}
        <span v-if="inherited('width') || inherited(WIDTH_SIZING_PROP)" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <div
        class="flex rounded-md border border-border/70 bg-background/75 p-0.5 dark:bg-sidebar/55"
        role="radiogroup"
        :aria-label="m.composer_size_width()"
        data-testid="size-width-mode-group"
      >
        <button
          v-for="mode in SIZE_MODES"
          :key="mode"
          type="button"
          role="radio"
          :aria-checked="widthMode === mode"
          :tabindex="widthMode === mode || (widthMode == null && mode === 'hug') ? 0 : -1"
          :disabled="disabled"
          :data-testid="`size-width-mode-${mode}`"
          :class="cn(
            'flex h-7 flex-1 items-center justify-center rounded-sm border text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-45',
            widthMode === mode
              ? 'border-primary/70 bg-primary/10 text-primary dark:bg-primary/15'
              : 'border-transparent text-foreground/75 hover:bg-sidebar/80 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground',
          )"
          @click="selectMode('width', mode)"
          @keydown="moveRadio($event, widthMode, (next) => selectMode('width', next))"
        >{{ modeLabel(mode) }}</button>
      </div>
      <div v-if="widthMode === 'exact'" class="relative flex items-center">
        <AppIcon name="arrowLeftRight" :size="14" class="pointer-events-none absolute left-2.5 z-10 text-muted-foreground/60" />
        <VariableAssignableInput
          v-model="widthInput"
          class="w-full"
          :input-class="INPUT_CLASS"
          :placeholder="m.composer_size_width()"
          :disabled="disabled"
          data-testid="size-width-exact"
          @update:model-value="previewExact('width', String($event))"
          @commit="commitExact('width', $event)"
          @mousedown="handleExactScrub('width', $event)"
        />
      </div>
    </div>

    <div class="space-y-2">
      <span class="flex items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_size_height() }}
        <span v-if="inherited('height') || inherited(HEIGHT_SIZING_PROP)" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <div
        class="flex rounded-md border border-border/70 bg-background/75 p-0.5 dark:bg-sidebar/55"
        role="radiogroup"
        :aria-label="m.composer_size_height()"
        data-testid="size-height-mode-group"
      >
        <button
          v-for="mode in SIZE_MODES"
          :key="mode"
          type="button"
          role="radio"
          :aria-checked="heightMode === mode"
          :tabindex="heightMode === mode || (heightMode == null && mode === 'hug') ? 0 : -1"
          :disabled="disabled"
          :data-testid="`size-height-mode-${mode}`"
          :class="cn(
            'flex h-7 flex-1 items-center justify-center rounded-sm border text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-45',
            heightMode === mode
              ? 'border-primary/70 bg-primary/10 text-primary dark:bg-primary/15'
              : 'border-transparent text-foreground/75 hover:bg-sidebar/80 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground',
          )"
          @click="selectMode('height', mode)"
          @keydown="moveRadio($event, heightMode, (next) => selectMode('height', next))"
        >{{ modeLabel(mode) }}</button>
      </div>
      <div v-if="heightMode === 'exact'" class="relative flex items-center">
        <AppIcon name="arrowUpDown" :size="14" class="pointer-events-none absolute left-2.5 z-10 text-muted-foreground/60" />
        <VariableAssignableInput
          v-model="heightInput"
          class="w-full"
          :input-class="INPUT_CLASS"
          :placeholder="m.composer_size_height()"
          :disabled="disabled"
          data-testid="size-height-exact"
          @update:model-value="previewExact('height', String($event))"
          @commit="commitExact('height', $event)"
          @mousedown="handleExactScrub('height', $event)"
        />
      </div>
    </div>

    <div class="h-px w-full bg-border/70" />

    <div class="space-y-3">
      <span class="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">{{ m.composer_size_constraints() }}</span>
      <div class="space-y-1.5">
        <span class="text-3xs uppercase tracking-widest text-muted-foreground/60">{{ m.composer_size_min() }}</span>
        <div class="grid grid-cols-2 gap-2">
          <div v-for="field in constraintFields.slice(0, 2)" :key="field.key" class="relative flex items-center">
            <AppIcon :name="field.icon" :size="14" class="pointer-events-none absolute left-2.5 z-10 text-muted-foreground/60" />
            <VariableAssignableInput
              class="w-full"
              :model-value="constraintRef(field.key)"
              :input-class="INPUT_CLASS"
              placeholder="0"
              :disabled="disabled"
              :data-testid="field.testId"
              @update:model-value="previewConstraint(field.key, String($event))"
              @commit="commitConstraint(field.key, $event)"
              @mousedown="handleConstraintScrub(field.key, $event)"
            />
          </div>
        </div>
      </div>
      <div class="space-y-1.5">
        <span class="text-3xs uppercase tracking-widest text-muted-foreground/60">{{ m.composer_size_max() }}</span>
        <div class="grid grid-cols-2 gap-2">
          <div v-for="field in constraintFields.slice(2)" :key="field.key" class="relative flex items-center">
            <AppIcon :name="field.icon" :size="14" class="pointer-events-none absolute left-2.5 z-10 text-muted-foreground/60" />
            <VariableAssignableInput
              class="w-full"
              :model-value="constraintRef(field.key)"
              :input-class="INPUT_CLASS"
              placeholder="none"
              :disabled="disabled"
              :data-testid="field.testId"
              @update:model-value="previewConstraint(field.key, String($event))"
              @commit="commitConstraint(field.key, $event)"
              @mousedown="handleConstraintScrub(field.key, $event)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
