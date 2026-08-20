<script setup lang="ts">
import { computed, nextTick } from "vue"
import { Input } from "@/components/ui/input"
import {
  POSITION_OPTIONS_3X3,
  getPositionOption,
  parsePositionAxes,
  serializePositionAxes,
  type PositionOption,
} from "./positionOptions"

const props = defineProps<{
  modelValue?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  "update:modelValue": [value: string]
}>()

const axes = computed(() => parsePositionAxes(props.modelValue))
const selected = computed(() => axes.value.option ?? getPositionOption(props.modelValue))

function optionTestId(option: PositionOption) {
  return `object-position-${option.value.replaceAll(" ", "-")}`
}

function selectOption(option: PositionOption) {
  if (props.disabled) return
  emit("update:modelValue", option.value)
}

function commitAxis(axis: "x" | "y", raw: string) {
  if (props.disabled) return
  emit("update:modelValue", serializePositionAxes(
    axis === "x" ? raw : axes.value.x,
    axis === "y" ? raw : axes.value.y,
  ))
}

function onGridKeydown(event: KeyboardEvent) {
  const delta = event.key === "ArrowRight" ? [0, 1]
    : event.key === "ArrowLeft" ? [0, -1]
    : event.key === "ArrowDown" ? [1, 0]
    : event.key === "ArrowUp" ? [-1, 0]
    : null
  if (!delta) return
  event.preventDefault()
  const current = selected.value ?? getPositionOption("center")
  if (!current) return
  const row = Math.min(2, Math.max(0, current.row + delta[0]!))
  const column = Math.min(2, Math.max(0, current.column + delta[1]!))
  const next = POSITION_OPTIONS_3X3.find((option) => option.row === row && option.column === column)
  if (!next) return
  selectOption(next)
  void nextTick().then(() => {
    const group = event.currentTarget as HTMLElement
    group.querySelector<HTMLButtonElement>(`[data-testid="${optionTestId(next)}"]`)?.focus()
  })
}
</script>

<template>
  <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2" data-testid="object-position-control">
    <div
      role="radiogroup"
      aria-label="Image position"
      class="inline-grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border/70 bg-muted/25 p-px"
      @keydown="onGridKeydown"
    >
      <button
        v-for="option in POSITION_OPTIONS_3X3"
        :key="option.value"
        type="button"
        role="radio"
        :aria-checked="selected?.value === option.value"
        :aria-label="option.label"
        :title="option.label"
        :disabled="disabled"
        :tabindex="selected?.value === option.value ? 0 : -1"
        :data-testid="optionTestId(option)"
        class="flex size-6 items-center justify-center rounded-[3px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
        :class="selected?.value === option.value
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground/55 hover:bg-muted/80 hover:text-foreground'"
        @click="selectOption(option)"
      >
        <span class="size-1 rounded-full bg-current" />
      </button>
    </div>
    <div class="flex min-w-0 flex-col gap-1">
      <label class="relative block min-w-0">
        <span class="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">X</span>
        <Input
          :model-value="axes.x"
          class="h-8 pl-6 text-xs"
          :disabled="disabled"
          aria-label="Position X"
          data-testid="object-position-x"
          @change="commitAxis('x', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="relative block min-w-0">
        <span class="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Y</span>
        <Input
          :model-value="axes.y"
          class="h-8 pl-6 text-xs"
          :disabled="disabled"
          aria-label="Position Y"
          data-testid="object-position-y"
          @change="commitAxis('y', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>
  </div>
</template>
