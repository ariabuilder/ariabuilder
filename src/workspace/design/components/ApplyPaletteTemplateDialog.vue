<script setup lang="ts">
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

defineProps<{
  open: boolean
  templateName?: string
  previewRows?: string[][]
  isApplying?: boolean
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  confirm: []
}>()

function handleOpenChange(value: boolean): void {
  emit("update:open", value)
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ m.design_colors_apply_dialog_title() }}</DialogTitle>
        <DialogDescription>
          {{ m.design_colors_apply_dialog_description() }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <div
          v-if="previewRows?.length"
          class="space-y-2 rounded-md border border-border bg-muted/30 p-3"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="truncate text-sm font-medium text-foreground">
              {{ templateName }}
            </span>
            <span class="shrink-0 text-xs text-muted-foreground">
              {{ m.design_colors_template_preview() }}
            </span>
          </div>
          <div
            class="grid gap-px overflow-hidden rounded-[3px] border border-solid border-black/5 dark:border-white/8"
            aria-hidden="true"
          >
            <div
              v-for="(row, rowIndex) in previewRows"
              :key="rowIndex"
              class="flex h-2"
            >
              <span
                v-for="(color, colorIndex) in row"
                :key="colorIndex"
                class="min-w-0 flex-1"
                :style="{ backgroundColor: color }"
              />
            </div>
          </div>
        </div>

        <p class="text-sm leading-relaxed text-muted-foreground">
          {{
            m.design_colors_apply_dialog_body({
              name:
                templateName || m.design_colors_apply_dialog_this_template(),
            })
          }}
        </p>
      </div>

      <DialogFooter class="gap-2 sm:justify-end">
        <Button
          type="button"
          variant="outline"
          :disabled="isApplying"
          @click="handleOpenChange(false)"
        >
          {{ m.design_stylesheets_stay() }}
        </Button>
        <Button
          type="button"
          variant="destructive"
          :disabled="isApplying"
          @click="emit('confirm')"
        >
          {{
            isApplying
              ? m.design_colors_applying()
              : m.design_colors_apply_template()
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
