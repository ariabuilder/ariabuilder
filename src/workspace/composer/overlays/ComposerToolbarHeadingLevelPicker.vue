<script setup lang="ts">
import { ref } from "vue"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const

const props = defineProps<{
  modelValue: number
  disabled?: boolean
}>()

const emit = defineEmits<{
  select: [level: number]
}>()

const open = ref(false)

function selectLevel(level: number) {
  if (level !== props.modelValue) emit("select", level)
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="relative ml-1.5 size-5 shrink-0 cursor-pointer overflow-hidden rounded-sm border border-border transition-[border-color,filter] hover:border-dashed hover:brightness-105 disabled:pointer-events-none disabled:opacity-50"
        :disabled="disabled"
        aria-label="Change heading level"
        @click.stop
      >
        <span class="absolute inset-0 flex items-center justify-center text-[10px] font-medium leading-none tracking-tight text-foreground">
          H{{ modelValue }}
        </span>
      </button>
    </PopoverTrigger>

    <PopoverContent
      class="w-auto p-0"
      align="start"
      side="bottom"
      :side-offset="6"
      @click.stop
    >
      <div class="flex items-center gap-0.5 p-0.5" role="radiogroup" aria-label="Heading level">
        <button
          v-for="level in HEADING_LEVELS"
          :key="level"
          type="button"
          role="radio"
          :aria-checked="modelValue === level"
          class="flex h-6 min-w-6 items-center justify-center rounded border px-1 text-[10px] font-medium tracking-wider transition-[border-color,background-color,color] duration-150 ease-out"
          :class="
            modelValue === level
              ? 'border-solid border-primary/70 bg-primary/10 text-foreground shadow-none'
              : 'border-transparent text-muted-foreground hover:border-dashed hover:border-border hover:bg-muted/40 hover:text-foreground'
          "
          @click="selectLevel(level)"
        >
          H{{ level }}
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
