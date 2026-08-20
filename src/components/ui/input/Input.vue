<script setup lang="ts">
import type { HTMLAttributes, InputHTMLAttributes } from "vue"
import { ref } from "vue"
import { useVModel } from "@vueuse/core"
import { cn } from "@/lib/utils"

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  class?: HTMLAttributes["class"]
  plain?: boolean
  type?: InputHTMLAttributes["type"]
  placeholder?: string
  disabled?: boolean
}>()

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void
}>()

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
})

const inputEl = ref<HTMLInputElement | null>(null)

defineExpose({
  focus: () => inputEl.value?.focus(),
  select: () => inputEl.value?.select(),
})
</script>

<template>
  <input
    ref="inputEl"
    v-bind="$attrs"
    v-model="modelValue"
    data-slot="input"
    :type="props.type ?? 'text'"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :class="
      cn(
        props.plain
          ? 'appearance-none h-9! w-full min-w-0 rounded-sm border-0 bg-input p-0 text-xs shadow-none outline-none ring-0 placeholder:text-muted-foreground/30 selection:bg-primary/30 selection:text-primary-foreground focus:outline-none focus:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring file:inline-flex file:h-9.5 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
          : 'h-9! w-full min-w-0 rounded-sm border border-solid border-border/50 bg-sidebar/40 px-4 py-1 text-sm caret-primary shadow-none outline-none ring-0 transition-[color,background-color,border-color] placeholder:text-muted-foreground/50 hover:bg-sidebar/80 focus:border-border focus:bg-sidebar focus:outline-none focus:ring-0 focus-visible:border-border focus-visible:bg-sidebar/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring selection:bg-primary/30 selection:text-primary-foreground file:inline-flex file:h-9.5 file:border-0 file:bg-muted-foreground file:text-sm file:font-medium file:text-muted-foreground/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
        props.class,
      )
    "
  />
</template>
