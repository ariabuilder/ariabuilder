<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { toast } from "vue-sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { m } from "@/paraglide/messages.js"
import type { DesignVariables } from "../../../../shared/design"
import {
  parseVariableImportInput,
  VariableImportModeSchema,
  type VariableImportMode,
} from "../lib/variableManagerImport"

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  submit: [
    payload: { mode: VariableImportMode; variables: DesignVariables },
  ]
}>()

const importDraft = ref("")
const importMode = ref<VariableImportMode>("merge")

const importModeOptions = computed(() => [
  {
    value: "merge" as const,
    label: m.design_variables_import_mode_merge(),
  },
  {
    value: "replace" as const,
    label: m.design_variables_import_mode_replace(),
  },
])

const importPreview = computed(() =>
  parseVariableImportInput(importDraft.value),
)
const canSubmitImport = computed(
  () =>
    importPreview.value.success && importPreview.value.summary.totalCount > 0,
)

function resetState(): void {
  importDraft.value = ""
  importMode.value = "merge"
}

function setImportMode(value: string | number | bigint | Record<string, unknown> | null): void {
  const parsedImportMode = VariableImportModeSchema.safeParse(String(value ?? ""))
  if (!parsedImportMode.success) {
    return
  }

  importMode.value = parsedImportMode.data
}

function handleOpenChange(value: boolean): void {
  emit("update:open", value)
}

function handleSubmit(): void {
  if (!importPreview.value.success) {
    toast.error(importPreview.value.error)
    return
  }

  emit("submit", {
    mode: importMode.value,
    variables: importPreview.value.data,
  })
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      resetState()
    }
  },
)
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent
      class="sm:max-w-[720px] border border-solid border-border bg-card/50! p-4"
    >
      <DialogHeader class="space-y-2">
        <DialogTitle class="text-2xl font-medium text-foreground">
          {{ m.design_variables_import_title() }}
        </DialogTitle>
        <DialogDescription
          class="text-xs leading-relaxed text-muted-foreground"
        >
          {{ m.design_variables_import_description() }}
        </DialogDescription>
      </DialogHeader>

      <Textarea
        v-model="importDraft"
        rows="6"
        class="min-h-40 w-full font-mono text-xs"
        :placeholder="m.design_variables_import_placeholder()"
      />

      <div class="flex items-center gap-3">
        <span class="text-xs text-muted-foreground">{{
          m.design_variables_import_mode_label()
        }}</span>
        <Select :model-value="importMode" @update:model-value="setImportMode">
          <SelectTrigger class="h-8 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="option in importModeOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p
        v-if="importDraft.trim() && importPreview.success"
        class="text-xs text-muted-foreground"
      >
        {{ importPreview.summary.customCount }}
        {{ m.design_variables_filter_variable() }},
        {{ importPreview.summary.aliasCount }}
        {{ m.design_variables_filter_alias() }}
      </p>
      <p
        v-else-if="importDraft.trim() && !importPreview.success"
        class="text-xs text-destructive"
      >
        {{ importPreview.error }}
      </p>

      <DialogFooter>
        <Button variant="outline" @click="handleOpenChange(false)">
          {{ m.confirm_cancel() }}
        </Button>
        <Button :disabled="!canSubmitImport" @click="handleSubmit">
          {{ m.design_variables_import_submit() }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
