<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { computed, ref } from "vue"

import AppIcon from "@/components/ui/app-icon/AppIcon.vue"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import VariableReferencePicker from "./VariableReferencePicker.vue"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import {
  extractVariableReferenceKey,
  type VariableReferenceOption,
} from "@/workspace/design/lib/variableReferences"

interface Props {
  modelValue?: string
  disabled?: boolean
  options: readonly VariableReferenceOption[]
  isLoading?: boolean
  pickerPlaceholder?: string
  buttonClass?: HTMLAttributes["class"]
  contentClass?: HTMLAttributes["class"]
  appearance?: "overlay" | "inline"
  iconSize?: number
  popoverAlign?: "start" | "center" | "end"
  sideOffset?: number
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: "",
  disabled: false,
  isLoading: false,
  pickerPlaceholder: "",
  buttonClass: undefined,
  contentClass: undefined,
  appearance: "overlay",
  iconSize: undefined,
  popoverAlign: "end",
  sideOffset: 8,
})

const emit = defineEmits<{
  select: [value: string | null]
}>()

const isOpen = defineModel<boolean>("open", { default: false })
const pendingSelection = ref<string>()
const iconSize = computed(() => props.iconSize ?? (props.appearance === "overlay" ? 14 : 16))
const iconClass = computed(() => (iconSize.value <= 14 ? "size-3.5 shrink-0" : "size-4 shrink-0"))

const variableKey = computed(() =>
  extractVariableReferenceKey(String(props.modelValue ?? "")),
)

const isVariableAssigned = computed(() => variableKey.value !== null)

const selectedVariableOption = computed(
  () =>
    props.options.find((option) => option.value === variableKey.value) ?? null,
)

const buttonTitle = computed(() =>
  selectedVariableOption.value
    ? m.design_variables_assigned({ variable: selectedVariableOption.value.label ?? selectedVariableOption.value.value })
    : m.design_variables_assign(),
)

function handleSelect(nextValue: string | null): void {
  const selectionKey = nextValue ?? ""
  if (pendingSelection.value === selectionKey) return
  pendingSelection.value = selectionKey
  queueMicrotask(() => {
    if (pendingSelection.value === selectionKey) pendingSelection.value = undefined
  })
  emit("select", nextValue)
  isOpen.value = false
}
</script>

<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <button
        type="button"
        data-variable-reference-trigger
        :data-appearance="appearance"
        :data-assigned="isVariableAssigned ? 'true' : 'false'"
        :title="buttonTitle"
        :aria-label="buttonTitle"
        aria-haspopup="dialog"
        :aria-expanded="isOpen"
        :disabled="disabled"
        :class="
          cn(
            'flex shrink-0 items-center justify-center text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary',
            appearance === 'overlay'
              ? 'size-6 rounded-sm bg-transparent shadow-none transition-[color,background-color,opacity] duration-100 group-hover/variable:pointer-events-auto group-hover/variable:opacity-100 group-focus-within/variable:pointer-events-auto group-focus-within/variable:opacity-100 hover:bg-muted/70 hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100'
              : 'h-9 w-9 rounded-sm border border-dashed border-border/50 bg-sidebar/40 transition-colors hover:bg-sidebar/80 hover:text-foreground',
            appearance === 'overlay' && !isVariableAssigned && !isOpen && 'pointer-events-none opacity-0',
            (isVariableAssigned || isOpen) && !disabled && 'pointer-events-auto opacity-100 text-primary hover:text-primary',
            (isVariableAssigned || isOpen) && disabled && 'pointer-events-none opacity-50 text-primary',
            appearance === 'overlay' && !isVariableAssigned && disabled && 'pointer-events-none opacity-0',
            appearance === 'inline' && !isVariableAssigned && disabled && 'pointer-events-none opacity-50',
            buttonClass,
          )
        "
      >
        <AppIcon
          name="variable"
          :size="iconSize"
          :class="iconClass"
          aria-hidden="true"
        />
      </button>
    </PopoverTrigger>

    <PopoverContent
      :align="popoverAlign"
      :side-offset="sideOffset"
      :class="cn('w-58 overflow-hidden rounded-md p-0', contentClass)"
    >
      <VariableReferencePicker
        :model-value="modelValue"
        :options="options"
        :is-loading="isLoading"
        :picker-placeholder="pickerPlaceholder || m.design_variables_search_placeholder()"
        @select="handleSelect"
      />
    </PopoverContent>
  </Popover>
</template>
