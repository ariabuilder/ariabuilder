<script setup lang="ts">
import { AppIcon } from "@/components/ui/app-icon"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import type { AppIconName } from "@/icons/registry"
import { m } from "@/paraglide/messages.js"
import type { SpacingSides } from "../../../../shared/composer/styleAttr"

type SpacingSide = keyof SpacingSides

const props = defineProps<{
  label: string
  linked: boolean
  values: SpacingSides
  disabled?: boolean
  inputClass?: string
}>()

const emit = defineEmits<{
  "update:linked": [value: boolean]
  "update:values": [value: SpacingSides]
}>()

const linkedAxes = [
  { id: "y", icon: "arrowUpDown" as const, sides: ["top", "bottom"] as const, placeholderKey: "axisY" },
  { id: "x", icon: "arrowLeftRight" as const, sides: ["left", "right"] as const, placeholderKey: "axisX" },
] as const

const unlinkedSides: readonly { id: SpacingSide; icon: AppIconName; placeholderKey: SpacingSide }[] = [
  { id: "top", icon: "chevronUp", placeholderKey: "top" },
  { id: "bottom", icon: "chevronDown", placeholderKey: "bottom" },
  { id: "left", icon: "chevronLeft", placeholderKey: "left" },
  { id: "right", icon: "chevronRight", placeholderKey: "right" },
]

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

function commitSides(sides: readonly SpacingSide[], value: string) {
  const next: SpacingSides = { ...props.values }
  for (const side of sides) next[side] = value
  emit("update:values", next)
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <span class="text-2xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{{ label }}</span>
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
          class="pointer-events-none absolute left-3 z-10 text-muted-foreground/60"
        />
        <VariableAssignableInput
          class="w-full"
          :model-value="displayValue(axis.sides)"
          :input-class="inputClass"
          :placeholder="placeholderFor(axis.placeholderKey)"
          :disabled="disabled"
          @update:model-value="commitSides(axis.sides, String($event))"
        />
      </div>
    </div>

    <div v-else class="grid grid-cols-2 gap-2">
      <div v-for="side in unlinkedSides" :key="side.id" class="relative flex items-center">
        <AppIcon
          :name="side.icon"
          :size="14"
          class="pointer-events-none absolute left-3 z-10 text-muted-foreground/60"
        />
        <VariableAssignableInput
          class="w-full"
          :model-value="values[side.id]"
          :input-class="inputClass"
          :placeholder="placeholderFor(side.placeholderKey)"
          :disabled="disabled"
          @update:model-value="commitSides([side.id], String($event))"
        />
      </div>
    </div>
  </div>
</template>
