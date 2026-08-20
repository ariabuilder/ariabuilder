<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { m } from "@/paraglide/messages.js"
import { isValidClassName, sanitizeClassName } from "../lib/classManagerCss"
import CssEditor from "../components/CssEditor.vue"
import type { VariableReferenceOption } from "../lib/variableReferences"

type ClassManagerNameDialogMode = "create" | "rename" | "duplicate" | "fork"

const props = defineProps<{
  open: boolean
  mode: ClassManagerNameDialogMode
  initialName?: string
  initialCss?: string
  variableReferences?: readonly VariableReferenceOption[]
  classReferences?: readonly string[]
  utilityReferences?: readonly string[]
  keyframeReferences?: readonly string[]
  heading?: string
  description?: string
  submitLabel?: string
  placeholder?: string
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  submit: [payload: { name: string; cssText?: string }]
}>()

const nameDraft = ref("")
const cssDraft = ref("")
const nameError = ref<string | null>(null)

const title = computed(() => {
  if (props.heading) return props.heading
  if (props.mode === "create") return m.design_classes_name_dialog_create_title()
  if (props.mode === "rename") return m.design_classes_name_dialog_rename_title()
  if (props.mode === "fork") return m.composer_inspector_bem_fork_title()
  return m.design_classes_name_dialog_duplicate_title()
})

const description = computed(() => {
  if (props.description) return props.description
  if (props.mode === "create")
    return m.design_classes_name_dialog_create_description()
  if (props.mode === "rename")
    return m.design_classes_name_dialog_rename_description()
  if (props.mode === "fork") return m.composer_inspector_bem_fork_description()
  return m.design_classes_name_dialog_duplicate_description()
})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    nameDraft.value = props.initialName ?? ""
    cssDraft.value = props.initialCss ?? ""
    nameError.value = null
  },
)

function onOpenChange(value: boolean) {
  emit("update:open", value)
}

function submit() {
  const name = sanitizeClassName(nameDraft.value)
  if (!name || !isValidClassName(name)) {
    nameError.value = m.design_classes_name_invalid()
    return
  }
  nameError.value = null
  emit("submit", {
    name,
    cssText: props.mode === "create" ? cssDraft.value : undefined,
  })
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <div class="space-y-2">
          <Label for="class-manager-name">{{
            m.design_classes_name_label()
          }}</Label>
          <Input
            id="class-manager-name"
            v-model="nameDraft"
            class="font-mono"
            :placeholder="placeholder ?? (mode === 'fork' ? m.composer_inspector_bem_fork_placeholder() : m.design_classes_name_placeholder())"
            @keydown.enter.prevent="submit"
          />
          <p v-if="nameError" class="text-xs text-destructive">{{ nameError }}</p>
        </div>

        <div v-if="mode === 'create'" class="space-y-2">
          <Label>{{ m.design_classes_column_css() }}</Label>
          <CssEditor
            :model-value="cssDraft"
            :variable-references="variableReferences ?? []"
            :class-references="classReferences ?? []"
            :utility-references="utilityReferences ?? []"
            :keyframe-references="keyframeReferences ?? []"
            document-kind="declarations"
            :placeholder="m.design_classes_editor_placeholder()"
            @update:model-value="(v) => (cssDraft = v)"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="onOpenChange(false)">
          {{ m.confirm_cancel() }}
        </Button>
        <Button @click="submit">
          {{
            submitLabel
              ? submitLabel
              : mode === "create"
                ? m.design_classes_create_button()
                : mode === "rename"
                  ? m.design_classes_action_rename()
                  : mode === "fork"
                    ? m.composer_inspector_bem_fork_submit()
                    : m.design_classes_action_duplicate()
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
