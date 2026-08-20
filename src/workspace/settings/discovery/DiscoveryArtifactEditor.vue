<script setup lang="ts">
import { computed } from "vue"
import { Textarea } from "@/components/ui/textarea"
import {
  discoveryArtifactEditorHeightPx,
  discoveryArtifactMaxEditorHeightPx,
} from "@/workspace/settings/lib/discoveryArtifactEditorLayout"

const props = withDefaults(
  defineProps<{
    modelValue: string
    language?: "plain" | "xml"
    readonly?: boolean
    disabled?: boolean
  }>(),
  {
    language: "plain",
    readonly: false,
    disabled: false,
  },
)

const emit = defineEmits<{
  "update:modelValue": [value: string]
}>()

const editorHeightPx = computed(() => {
  const lineCount = props.modelValue.split("\n").length
  return discoveryArtifactEditorHeightPx(lineCount)
})

const editorContainerStyle = computed(() => ({
  height: `${editorHeightPx.value}px`,
  maxHeight: `${discoveryArtifactMaxEditorHeightPx()}px`,
}))

function onUpdate(value: string | number) {
  if (props.readonly || props.disabled) return
  emit("update:modelValue", String(value))
}
</script>

<template>
  <Textarea
    :model-value="modelValue"
    :readonly="readonly || disabled"
    :disabled="disabled"
    spellcheck="false"
    class="discovery-artifact-editor overflow-auto rounded-md border border-border/50 bg-background font-mono text-[13px] leading-[1.7]"
    :style="editorContainerStyle"
    :aria-readonly="readonly || undefined"
    @update:model-value="onUpdate"
  />
</template>
