<script setup lang="ts">
import { AppIcon } from "@/components/ui/app-icon"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import { m } from "@/paraglide/messages.js"
import type { AppIconName } from "@/icons/registry"
import { beginPointerScrub } from "../inspector/useInspectorLiveStyleSession"

type SpacingSide = "top" | "right" | "bottom" | "left"

const props = defineProps<{
  label: string
  property: "padding" | "margin"
  linked: boolean
  values: Record<SpacingSide, string>
  disabled?: boolean
}>()

const emit = defineEmits<{
  "update:linked": [value: boolean]
  preview: [updates: Record<string, string>]
  commit: [updates: Record<string, string>]
  cancel: []
}>()

const INPUT_CLASS =
  "h-8 text-xs pl-8 bg-sidebar border-border/70 border-dashed cursor-ew-resize focus:cursor-text"

const linkedAxes = [
  { id: "y", icon: "arrowUpDown" as const, sides: ["top", "bottom"] as const, placeholderKey: "axisY" },
  { id: "x", icon: "arrowLeftRight" as const, sides: ["left", "right"] as const, placeholderKey: "axisX" },
] as const

const unlinkedSides: readonly { id: SpacingSide; icon: AppIconName; placeholderKey: "top" | "right" | "bottom" | "left" }[] = [
  { id: "top", icon: "chevronUp", placeholderKey: "top" },
  { id: "bottom", icon: "chevronDown", placeholderKey: "bottom" },
  { id: "left", icon: "chevronLeft", placeholderKey: "left" },
  { id: "right", icon: "chevronRight", placeholderKey: "right" },
]

function sideProperty(side: SpacingSide) {
  return `${props.property}-${side}`
}

function displayValue(sides: readonly SpacingSide[]) {
  for (const side of sides) {
    const value = props.values[side]?.trim()
    if (value) return value
  }
  return props.values[sides[0]!] ?? ""
}

function placeholderFor(key: "axisY" | "axisX" | SpacingSide) {
  switch (key) {
    case "axisY":
      return m.composer_inspector_spacing_axis_y()
    case "axisX":
      return m.composer_inspector_spacing_axis_x()
    case "top":
      return m.composer_inspector_spacing_top()
    case "right":
      return m.composer_inspector_spacing_right()
    case "bottom":
      return m.composer_inspector_spacing_bottom()
    case "left":
      return m.composer_inspector_spacing_left()
  }
}

function buildUpdates(sides: readonly SpacingSide[], value: string) {
  // Expand to longhand while preserving the opposite axis/sides from the
  // currently resolved values (important when the source was a shorthand).
  const updates: Record<string, string> = {
    [props.property]: "",
    [sideProperty("top")]: props.values.top,
    [sideProperty("right")]: props.values.right,
    [sideProperty("bottom")]: props.values.bottom,
    [sideProperty("left")]: props.values.left,
  }
  for (const side of sides) {
    updates[sideProperty(side)] = value
  }
  return updates
}

function previewSides(sides: readonly SpacingSide[], value: string) {
  emit("preview", buildUpdates(sides, value))
}

function commitSides(sides: readonly SpacingSide[], value: string) {
  emit("commit", buildUpdates(sides, value))
}

function handleScrub(sides: readonly SpacingSide[], event: MouseEvent) {
  if (props.disabled) return
  if (!(event.target instanceof HTMLInputElement)) return
  const raw = displayValue(sides) || "0"
  const match = raw.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/)
  if (!match) return
  const origin = Number(match[1])
  const unit = match[2] ?? ""
  if (!Number.isFinite(origin)) return
  beginPointerScrub({
    event,
    value: origin,
    step: 1,
    pixelsPerStep: 1,
    onPreview: (number) => previewSides(sides, `${Math.round(number)}${unit}`),
    onCommit: (number) => commitSides(sides, `${Math.round(number)}${unit}`),
    onCancel: () => emit("cancel"),
  })
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <span class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{{ label }}</span>
      <button
        type="button"
        class="inline-flex size-6 items-center justify-center rounded-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
        :class="linked ? 'bg-muted text-foreground' : 'text-muted-foreground'"
        :aria-pressed="linked"
        :aria-label="linked ? m.composer_inspector_unlink_sides({ property: label.toLowerCase() }) : m.composer_inspector_link_sides({ property: label.toLowerCase() })"
        :title="m.composer_inspector_spacing_toggle_sides()"
        :disabled="disabled"
        @click="emit('update:linked', !linked)"
      ><AppIcon :name="linked ? 'link' : 'unlink02'" :size="14" /></button>
    </div>

    <div v-if="linked" class="grid grid-cols-2 gap-2">
      <div v-for="axis in linkedAxes" :key="axis.id" class="relative flex items-center">
        <AppIcon
          :name="axis.icon"
          :size="14"
          class="pointer-events-none absolute left-2.5 z-10 text-muted-foreground/60"
        />
        <VariableAssignableInput
          class="w-full"
          :model-value="displayValue(axis.sides)"
          :input-class="INPUT_CLASS"
          :placeholder="placeholderFor(axis.placeholderKey)"
          :disabled="disabled"
          @update:model-value="previewSides(axis.sides, String($event))"
          @commit="commitSides(axis.sides, String($event))"
          @mousedown="handleScrub(axis.sides, $event)"
        />
      </div>
    </div>

    <div v-else class="grid grid-cols-2 gap-2">
      <div v-for="side in unlinkedSides" :key="side.id" class="relative flex items-center">
        <AppIcon
          :name="side.icon"
          :size="14"
          class="pointer-events-none absolute left-2.5 z-10 text-muted-foreground/60"
        />
        <VariableAssignableInput
          class="w-full"
          :model-value="values[side.id]"
          :input-class="INPUT_CLASS"
          :placeholder="placeholderFor(side.placeholderKey)"
          :disabled="disabled"
          @update:model-value="previewSides([side.id], String($event))"
          @commit="commitSides([side.id], String($event))"
          @mousedown="handleScrub([side.id], $event)"
        />
      </div>
    </div>
  </div>
</template>
