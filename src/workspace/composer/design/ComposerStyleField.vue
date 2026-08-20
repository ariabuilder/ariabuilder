<script setup lang="ts">
import { computed } from "vue"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AppIcon } from "@/components/ui/app-icon"
import { m } from "@/paraglide/messages.js"

const emit = defineEmits<{
  preview: [value: string]
  commit: [value: string]
  scrub: [event: PointerEvent]
  browseMedia: []
}>()

const props = defineProps<{
  label: string
  modelValue: string
  placeholder?: string
  options?: readonly string[]
  scrub?: boolean
  disabled?: boolean
  mediaPicker?: boolean
  inherited?: boolean
  unitless?: boolean
  units?: readonly string[]
}>()

const numeric = computed(() => props.modelValue.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))([a-zA-Z%]+)$/))
const controlValue = computed(() => numeric.value?.[1] ?? props.modelValue)
const availableUnits = computed(() => props.units ?? ["px", "rem", "em", "%", "vw", "vh"])
const currentUnit = computed(() => numeric.value?.[2] ?? availableUnits.value[0] ?? "px")
const showUnit = computed(() => Boolean(props.scrub && !props.unitless && (numeric.value || !props.modelValue)))
function withUnit(value: string | number) {
  const next = String(value)
  return showUnit.value ? `${next}${currentUnit.value}` : next
}
function changeUnit(unit: string) {
  const number = numeric.value?.[1] ?? props.modelValue.match(/^-?(?:\d+\.?\d*|\.\d+)/)?.[0] ?? "0"
  emit("commit", `${number}${unit}`)
}
</script>

<template>
  <label class="min-w-0 space-y-1">
    <span
      :class="['flex items-center gap-1 truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground', scrub && 'cursor-ew-resize select-none']"
      @pointerdown="scrub && emit('scrub', $event)"
    >{{ label }}<span v-if="inherited" class="size-1.5 shrink-0 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" :aria-label="m.composer_inspector_inherited_value()" /></span>
    <Select
      v-if="options"
      :model-value="modelValue || '__unset__'"
      :disabled="disabled"
      @update:model-value="emit('commit', String($event) === '__unset__' ? '' : String($event))"
    >
      <SelectTrigger class="h-8 min-w-0 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__unset__">—</SelectItem>
        <SelectItem v-for="option in options" :key="option" :value="option">{{ option }}</SelectItem>
      </SelectContent>
    </Select>
    <VariableAssignableInput
      v-else
      :model-value="controlValue"
      input-class="h-8 min-w-0 font-mono text-xs"
      :placeholder="placeholder"
      :disabled="disabled"
      :end-actions-padding-class="mediaPicker && showUnit ? 'pe-[4.5rem]' : mediaPicker ? 'pe-8' : showUnit ? 'pe-12' : undefined"
      @update:model-value="emit('preview', withUnit($event))"
      @commit="emit('commit', withUnit($event))"
    >
      <template v-if="mediaPicker || showUnit" #end-actions>
        <button
          v-if="mediaPicker"
          type="button"
          class="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          :aria-label="m.picker_media_title()"
          :title="m.picker_media_title()"
          @click.prevent="emit('browseMedia')"
        ><AppIcon name="image" :size="14" /></button>
        <select
          v-if="showUnit"
          :value="currentUnit"
          class="h-6 w-10 bg-transparent px-0.5 text-[9px] text-muted-foreground outline-none"
          :aria-label="m.composer_inspector_value_unit()"
          :disabled="disabled"
          @click.stop
          @change="changeUnit(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="unit in availableUnits" :key="unit" :value="unit">{{ unit }}</option>
        </select>
      </template>
    </VariableAssignableInput>
  </label>
</template>
