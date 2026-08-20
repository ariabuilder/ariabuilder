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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { m } from "@/paraglide/messages.js"
import {
  parseClassImportPayload,
  type ClassImportItem,
} from "../lib/classManagerCss"

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  submit: [payload: { mode: "merge" | "replace"; items: ClassImportItem[] }]
}>()

const raw = ref("")
const mode = ref<"merge" | "replace">("merge")
const error = ref<string | null>(null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    raw.value = ""
    mode.value = "merge"
    error.value = null
  },
)

function onOpenChange(value: boolean) {
  emit("update:open", value)
}

function submit() {
  const parsed = parseClassImportPayload(raw.value)
  if (parsed.error || parsed.items.length === 0) {
    error.value = parsed.error || m.design_classes_import_empty()
    return
  }
  error.value = null
  emit("submit", { mode: mode.value, items: parsed.items })
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ m.design_classes_import_title() }}</DialogTitle>
        <DialogDescription>
          {{ m.design_classes_import_description() }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <div class="space-y-2">
          <Label>{{ m.design_classes_import_payload() }}</Label>
          <Textarea
            v-model="raw"
            class="min-h-[180px] font-mono text-xs"
            :placeholder="m.design_classes_import_placeholder()"
          />
          <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
        </div>

        <div class="flex gap-2">
          <Button
            size="sm"
            :variant="mode === 'merge' ? 'default' : 'outline'"
            @click="mode = 'merge'"
          >
            {{ m.design_classes_import_merge() }}
          </Button>
          <Button
            size="sm"
            :variant="mode === 'replace' ? 'default' : 'outline'"
            @click="mode = 'replace'"
          >
            {{ m.design_classes_import_replace() }}
          </Button>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="onOpenChange(false)">
          {{ m.confirm_cancel() }}
        </Button>
        <Button @click="submit">{{ m.design_classes_menu_import() }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
