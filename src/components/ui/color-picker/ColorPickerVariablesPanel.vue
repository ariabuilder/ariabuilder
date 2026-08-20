<script setup lang="ts">
import { VariableReferencePicker } from "@/components/ui/variable-reference-picker"
import type { VariableReferenceOption } from "@/workspace/design/lib/variableReferences"

defineProps<{
  modelValue: string
  options: readonly VariableReferenceOption[]
  previewByKey?: Record<string, string>
  isLoading?: boolean
  pickerPlaceholder?: string
}>()

const emit = defineEmits<{
  select: [value: string | null]
}>()
</script>

<template>
  <div class="min-w-0 overflow-hidden">
    <VariableReferencePicker
      embedded
      :model-value="modelValue"
      :options="options"
      :preview-by-key="previewByKey"
      :is-loading="isLoading"
      :picker-placeholder="pickerPlaceholder ?? 'Search variables…'"
      @select="emit('select', $event)"
    />
  </div>
</template>
