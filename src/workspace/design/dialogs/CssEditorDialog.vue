<script setup lang="ts">
import { ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { m } from "@/paraglide/messages.js"
import CssEditor from "../components/CssEditor.vue"
import type { VariableReferenceOption } from "../lib/variableReferences"

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    initialValue: string
    placeholder?: string
    variableReferences?: readonly VariableReferenceOption[]
    classReferences?: readonly string[]
    utilityReferences?: readonly string[]
    keyframeReferences?: readonly string[]
    documentKind?: "stylesheet" | "declarations"
    /** Taller editor when the dialog also hosts source controls. */
    editorMinHeightClass?: string
    editorFocusOutline?: boolean
  }>(),
  {
    description: "",
    placeholder: "",
    variableReferences: () => [],
    classReferences: () => [],
    utilityReferences: () => [],
    keyframeReferences: () => [],
    documentKind: "stylesheet",
    editorMinHeightClass: "min-h-[240px]",
    editorFocusOutline: true,
  },
)

const emit = defineEmits<{
  "update:open": [value: boolean]
  save: [value: string]
}>()

const draft = ref("")

watch(
  () => [props.open, props.initialValue] as const,
  ([open, initialValue]) => {
    if (open) draft.value = initialValue
  },
  { immediate: true },
)

function onOpenChange(value: boolean) {
  emit("update:open", value)
}

function submit() {
  emit("save", draft.value)
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="flex max-h-[85vh] flex-col sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="description">
          {{ description }}
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="$slots.controls"
        class="shrink-0 space-y-3 border-b border-dashed border-border/60 pb-3"
      >
        <slot name="controls" />
      </div>

      <div
        class="min-h-0 flex-1 overflow-hidden py-2"
        :class="editorMinHeightClass"
      >
        <CssEditor
          :model-value="draft"
          :variable-references="variableReferences"
          :class-references="classReferences"
          :utility-references="utilityReferences"
          :keyframe-references="keyframeReferences"
          :document-kind="documentKind"
          :placeholder="placeholder"
          :focus-outline="editorFocusOutline"
          @update:model-value="(v) => (draft = v)"
        />
      </div>

      <DialogFooter>
        <Button variant="outline" @click="onOpenChange(false)">
          {{ m.confirm_cancel() }}
        </Button>
        <Button @click="submit">{{ m.design_save() }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
