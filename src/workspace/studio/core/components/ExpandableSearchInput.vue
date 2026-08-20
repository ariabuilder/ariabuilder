<script setup lang="ts">
import { nextTick, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { m } from "@/paraglide/messages.js"
import HeaderActionTooltip from "./HeaderActionTooltip.vue"

const props = withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    tooltipSide?: "top" | "bottom" | "left" | "right"
    compact?: boolean
  }>(),
  {
    modelValue: "",
    placeholder: undefined,
    tooltipSide: "bottom",
    compact: false,
  },
)

const emit = defineEmits<{
  "update:modelValue": [value: string]
  "update:open": [open: boolean]
}>()

const isOpen = ref(false)
const fieldRef = ref<HTMLElement | null>(null)

watch(
  () => props.modelValue,
  (value) => {
    if (value.trim()) {
      isOpen.value = true
      return
    }

    const input = fieldRef.value?.querySelector("input")
    if (input instanceof HTMLInputElement && document.activeElement === input) {
      return
    }

    isOpen.value = false
  },
  { immediate: true },
)

watch(isOpen, (open) => {
  emit("update:open", open)
})

function focusInput(): void {
  const input = fieldRef.value?.querySelector("input")
  if (input instanceof HTMLInputElement) {
    input.focus()
    input.select()
  }
}

function openSearch(): void {
  isOpen.value = true
  void nextTick().then(focusInput)
}

function toggleSearch(): void {
  if (isOpen.value) {
    if (!props.modelValue.trim()) {
      isOpen.value = false
    } else {
      focusInput()
    }
    return
  }

  openSearch()
}

function handleBlur(): void {
  if (!props.modelValue.trim()) {
    isOpen.value = false
  }
}

function handleInput(val: string | number) {
  emit("update:modelValue", String(val))
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    emit("update:modelValue", "")
    isOpen.value = false
  }
}

defineExpose({ open: openSearch, focus: focusInput })
</script>

<template>
  <div class="inline-flex shrink-0 items-center overflow-hidden">
    <HeaderActionTooltip
      :label="m.studio_search()"
      :side="props.tooltipSide"
    >
      <Button
        variant="headerAction"
        size="icon-header"
        :aria-expanded="isOpen"
        :aria-label="m.studio_search()"
        @click="toggleSearch"
      >
        <AppIcon name="search" :size="14" />
      </Button>
    </HeaderActionTooltip>

    <div
      ref="fieldRef"
      :class="[
        'overflow-hidden transition-all duration-200 ease-out',
        isOpen
          ? props.compact
            ? 'ml-1 w-42 opacity-100'
            : 'ml-1.5 w-52 opacity-100'
          : 'ml-0 w-0 opacity-0',
      ]"
    >
      <Input
        :model-value="props.modelValue"
        :placeholder="props.placeholder ?? m.studio_search_placeholder()"
        :tabindex="isOpen ? 0 : -1"
        :class="
          props.compact
            ? 'h-6! rounded-sm border-transparent! bg-input! px-2 text-xs shadow-none ring-0! hover:border-transparent! hover:bg-input! focus:border-transparent! focus:bg-input! focus:ring-0! focus-visible:border-transparent! focus-visible:bg-input! focus-visible:ring-0!'
            : 'h-7.5! w-full rounded-sm border border-solid border-border/50 bg-sidebar/40 px-2.5 text-xs shadow-none ring-0! focus:border-border focus:bg-sidebar/80 focus:ring-0! focus-visible:border-border focus-visible:bg-sidebar/80 focus-visible:ring-0!'
        "
        @update:model-value="handleInput"
        @blur="handleBlur"
        @keydown="handleKeydown"
      />
    </div>
  </div>
</template>
