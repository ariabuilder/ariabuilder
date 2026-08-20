<script setup lang="ts">
import { computed } from "vue"
import { m } from "@/paraglide/messages.js"
import type { VariableReferenceOption } from "../lib/variableReferences"
import CssEditorDialog from "./CssEditorDialog.vue"

const props = defineProps<{
  open: boolean
  className: string
  initialCss: string
  variableReferences?: readonly VariableReferenceOption[]
  classReferences?: readonly string[]
  utilityReferences?: readonly string[]
  keyframeReferences?: readonly string[]
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  save: [css: string]
}>()

const title = computed(() =>
  m.design_classes_css_dialog_title({ name: props.className }),
)
</script>

<template>
  <CssEditorDialog
    :open="open"
    :title="title"
    :description="m.design_classes_css_dialog_description()"
    :initial-value="initialCss"
    :placeholder="m.design_classes_editor_placeholder()"
    :variable-references="variableReferences ?? []"
    :class-references="classReferences ?? []"
    :utility-references="utilityReferences ?? []"
    :keyframe-references="keyframeReferences ?? []"
    document-kind="declarations"
    :editor-focus-outline="false"
    @update:open="emit('update:open', $event)"
    @save="emit('save', $event)"
  />
</template>
