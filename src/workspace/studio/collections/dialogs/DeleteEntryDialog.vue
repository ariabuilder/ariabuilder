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
  title: string
  isDeleting: boolean
  count?: number
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
        <DialogTitle>{{ m.cms_entry_delete_title() }}</DialogTitle>
        <DialogDescription>
          <template v-if="count && count > 1">
            {{ m.cms_entry_delete_many_description({ count }) }}
          </template>
          <template v-else>
            {{ m.cms_entry_delete_one_description({ title }) }}
          </template>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          class="h-9!"
          :disabled="isDeleting"
          @click="emit('update:open', false)"
        >
          {{ m.cms_common_cancel() }}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          class="h-9!"
          :disabled="isDeleting"
          @click="emit('confirm')"
        >
          {{
            isDeleting
              ? m.cms_common_deleting()
              : count && count > 1
                ? m.cms_entry_delete_many_confirm()
                : m.cms_entry_delete_one_confirm()
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
