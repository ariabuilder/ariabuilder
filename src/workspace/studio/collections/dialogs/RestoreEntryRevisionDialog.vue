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
  isRestoring: boolean
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  confirm: []
}>()
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader class="gap-0">
        <DialogTitle>{{ m.cms_entry_restore_title() }}</DialogTitle>
        <DialogDescription>
          {{ m.cms_entry_restore_description() }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          class="h-9!"
          :disabled="isRestoring"
          @click="emit('update:open', false)"
        >
          {{ m.cms_common_cancel() }}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          class="h-9!"
          :disabled="isRestoring"
          @click="emit('confirm')"
        >
          {{
            isRestoring
              ? m.cms_entry_restore_restoring()
              : m.cms_entry_restore_confirm()
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
