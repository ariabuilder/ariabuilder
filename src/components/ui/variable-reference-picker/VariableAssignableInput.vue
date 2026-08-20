<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { computed, ref, useSlots, watch } from "vue"

import { Input } from "@/components/ui/input"
import VariableReferenceAssignButton from "./VariableReferenceAssignButton.vue"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import { useVariableReferenceOptions } from "@/composables/useVariableReferenceOptions"
import {
  createVariableReferenceValue,
  extractVariableReferenceKey,
  type VariableReferenceOption,
} from "@/workspace/design/lib/variableReferences"

interface Props {
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  inputClass?: HTMLAttributes["class"]
  endActionsPaddingClass?: HTMLAttributes["class"]
  contentClass?: HTMLAttributes["class"]
  options?: readonly VariableReferenceOption[]
  pickerPlaceholder?: string
  ariaLabel?: string
  ariaDescribedby?: string
  ariaInvalid?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: "",
  placeholder: "",
  disabled: false,
  inputClass: undefined,
  endActionsPaddingClass: undefined,
  contentClass: undefined,
  options: undefined,
  pickerPlaceholder: "",
  ariaLabel: undefined,
  ariaDescribedby: undefined,
  ariaInvalid: false,
})

const emit = defineEmits<{
  "update:modelValue": [value: string]
  commit: [value: string]
}>()

const isOpen = ref(false)
const lastDirectValue = ref("")
const slots = useSlots()

const { variableReferenceOptions, isLoadingVariableReferences } =
  useVariableReferenceOptions({
    options: () => props.options,
  })

const currentValue = computed(() => String(props.modelValue ?? ""))
const draftValue = ref(currentValue.value)

const resolvedOptions = computed<readonly VariableReferenceOption[]>(
  () => variableReferenceOptions.value,
)

const variableKey = computed(() =>
  extractVariableReferenceKey(currentValue.value),
)

const isVariableAssigned = computed(() => variableKey.value !== null)

const resolvedVariableDirectValue = computed(() => {
  if (!variableKey.value) return ""
  return resolvedOptions.value
    .find((option) => option.value === variableKey.value)
    ?.directValue?.trim() ?? ""
})

const hasEndActions = computed(() => Boolean(slots["end-actions"]))
const hasCustomControl = computed(() => Boolean(slots.control))

const resolvedInputPaddingClass = computed(() => {
  if (!hasEndActions.value) return undefined

  return props.endActionsPaddingClass ?? "pe-[4.25rem]"
})

watch(
  currentValue,
  (nextValue) => {
    draftValue.value = nextValue
    if (extractVariableReferenceKey(nextValue) === null) {
      lastDirectValue.value = nextValue
    }
  },
  { immediate: true },
)

function updateModelValue(nextValue: string): void {
  emit("update:modelValue", nextValue)
}

function commitValue(nextValue: string = draftValue.value): void {
  emit("commit", nextValue)
}

function handleInputUpdate(nextValue: string | number): void {
  draftValue.value = String(nextValue)
  updateModelValue(draftValue.value)
}

function handleInputBlur(event: FocusEvent): void {
  const next = event.relatedTarget
  if (next instanceof Element && next.closest("[data-variable-reference-trigger]")) return
  const inputValue = event.target instanceof HTMLInputElement
    ? event.target.value
    : draftValue.value
  draftValue.value = inputValue
  commitValue(inputValue)
}

function handleInputEnter(event: KeyboardEvent): void {
  const inputValue = event.target instanceof HTMLInputElement
    ? event.target.value
    : draftValue.value
  draftValue.value = inputValue
  commitValue(inputValue)
}

function handleVariableUpdate(nextValue: string | null): void {
  if (!nextValue) {
    const restoreValue = lastDirectValue.value || resolvedVariableDirectValue.value
    if (currentValue.value === restoreValue) {
      isOpen.value = false
      return
    }
    updateModelValue(restoreValue)
    commitValue(restoreValue)
    isOpen.value = false
    return
  }

  if (variableKey.value === null) {
    lastDirectValue.value = currentValue.value
  }

  const resolvedValue = createVariableReferenceValue(nextValue)
  if (currentValue.value === resolvedValue) {
    isOpen.value = false
    return
  }
  updateModelValue(resolvedValue)
  commitValue(resolvedValue)
  isOpen.value = false
}
</script>

<template>
  <div class="group/variable relative" :data-state="isOpen ? 'open' : 'closed'">
    <div
      v-if="hasCustomControl"
      :class="
        cn(
          'relative w-full min-w-0 rounded-sm border border-border/50 border-solid bg-sidebar/40',
          resolvedInputPaddingClass,
          disabled && 'pointer-events-none opacity-50',
        )
      "
    >
      <slot name="control" />
    </div>
    <Input
      v-else
      :model-value="currentValue"
      :placeholder="placeholder"
      :aria-label="ariaLabel"
      :aria-describedby="ariaDescribedby"
      :aria-invalid="ariaInvalid || undefined"
      :disabled="disabled"
      :class="
        cn(
          props.inputClass,
          isVariableAssigned &&
            'border-primary/50 text-foreground selection:bg-primary/20',
          resolvedInputPaddingClass,
        )
      "
      @update:model-value="handleInputUpdate"
      @blur="handleInputBlur"
      @keydown.enter.prevent="handleInputEnter"
    />

    <div
      class="absolute end-2 top-1/2 flex -translate-y-1/2 items-center gap-px"
    >
      <div class="flex items-center">
        <slot name="end-actions" />
      </div>

      <VariableReferenceAssignButton
        v-model:open="isOpen"
        appearance="overlay"
        :model-value="currentValue"
        :disabled="disabled"
        :options="resolvedOptions"
        :is-loading="isLoadingVariableReferences"
        :picker-placeholder="pickerPlaceholder || m.design_variables_search_placeholder()"
        :content-class="contentClass"
        :button-class="hasEndActions ? 'absolute end-full top-1/2 z-10 me-0.5 -translate-y-1/2' : 'absolute end-0 top-1/2 z-10 -translate-y-1/2'"
        :side-offset="14"
        @select="handleVariableUpdate"
      />
    </div>
  </div>
</template>
