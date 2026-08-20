<script setup lang="ts">
import { computed } from "vue"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useConfirmState } from "@/composables/useConfirm"
import { m } from "@/paraglide/messages.js"

defineOptions({ name: "ConfirmDialogHost" })

const { open, request, settle, onOpenChange } = useConfirmState()

const title = computed(() => request.value?.title ?? "")
const description = computed(() => request.value?.description ?? "")
const confirmLabel = computed(
  () => request.value?.confirmLabel ?? m.confirm_delete(),
)
const cancelLabel = computed(
  () => request.value?.cancelLabel ?? m.confirm_cancel(),
)
const destructive = computed(() => request.value?.destructive ?? true)
</script>

<template>
  <AlertDialog :open="open" @update:open="onOpenChange">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="description">
          {{ description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <!--
          Plain buttons — do not use AlertDialogAction/Cancel.
          Those wrap DialogClose, which emits update:open(false) on click.
          Nested component fallthrough drops @click.capture, so DialogClose
          cancels the pending confirm before settle(true) can run — deletes
          look like a no-op (dialog closes, nothing happens, no error toast).
        -->
        <Button type="button" variant="outline" @click="settle(false)">
          {{ cancelLabel }}
        </Button>
        <Button
          type="button"
          :variant="destructive ? 'destructive' : 'default'"
          @click="settle(true)"
        >
          {{ confirmLabel }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
