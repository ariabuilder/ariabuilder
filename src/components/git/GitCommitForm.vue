<script setup lang="ts">
import { computed, useId } from "vue"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

const props = defineProps<{
  modelValue: string
  label: string
  placeholder: string
  commitLabel: string
  committingLabel: string
  disabled?: boolean
  busy?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  "update:modelValue": [value: string]
  commit: []
}>()

const fieldId = useId()

const canCommit = computed(
  () =>
    !props.disabled &&
    !props.busy &&
    props.modelValue.trim().length > 0,
)
</script>

<template>
  <div class="flex flex-col gap-2">
    <Label :for="fieldId" class="text-xs font-regular select-none pl-1">{{ label }}</Label>
    <Textarea
      :id="fieldId"
      :model-value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled || busy"
      :class="compact ? 'min-h-16 text-xs!' : 'min-h-24'"
      @update:model-value="emit('update:modelValue', String($event))"
    />
    <div class="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        size="sm"
        :disabled="!canCommit"
        :aria-busy="busy || undefined"
        @click="emit('commit')"
      >
        <Spinner v-if="busy" />
        {{ busy ? committingLabel : commitLabel }}
      </Button>
      <slot />
    </div>
  </div>
</template>
