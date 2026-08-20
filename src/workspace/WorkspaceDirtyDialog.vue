<script setup lang="ts">
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { m } from "@/paraglide/messages.js"
import { useDirtyPromptState } from "@/workspace/dirtyState"

const {
  open,
  labels,
  saveLabel,
  discardLabel,
  settle,
  onOpenChange,
} = useDirtyPromptState()
</script>

<template>
  <AlertDialog :open="open" @update:open="onOpenChange">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ m.dirty_navigation_title() }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ m.dirty_navigation_description() }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <ul v-if="labels.length" class="space-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        <li v-for="label in labels" :key="label">{{ label }}</li>
      </ul>
      <AlertDialogFooter class="sm:justify-between">
        <Button type="button" variant="ghost" @click="settle('cancel')">
          {{ m.dirty_navigation_cancel() }}
        </Button>
        <div class="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" @click="settle('discard')">
            {{ discardLabel || m.dirty_navigation_discard() }}
          </Button>
          <Button type="button" @click="settle('save')">
            {{ saveLabel || m.dirty_navigation_save() }}
          </Button>
        </div>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
