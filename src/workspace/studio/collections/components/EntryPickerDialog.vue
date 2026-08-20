<script setup lang="ts">
import { computed, toRef } from "vue"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useCmsEntriesList } from "../composables/useCmsEntriesList"
import type { CmsEntryRow } from "../lib/entryRow"

const props = defineProps<{
  open: boolean
  projectRoot: string
  targetCollection: string
  title?: string
  description?: string
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  select: [entry: CmsEntryRow]
}>()

const projectRootRef = toRef(props, "projectRoot")
const targetCollectionId = toRef(props, "targetCollection")

const {
  rows,
  total,
  page,
  totalPages,
  searchQuery,
  isLoading,
  loadError,
  setPage,
} = useCmsEntriesList(projectRootRef, targetCollectionId, toRef(props, "open"))

const dialogTitle = computed(() => props.title ?? "Choose entry")
const displayDescription = computed(
  () =>
    props.description ??
    (props.targetCollection
      ? `Select an entry from ${props.targetCollection}`
      : "Select an entry"),
)

function selectEntry(entry: CmsEntryRow): void {
  emit("select", entry)
  emit("update:open", false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="overflow-hidden p-0 sm:max-w-[680px]">
      <DialogHeader class="gap-1 border-b border-border px-5 pt-5 pb-4">
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
        <DialogDescription>{{ displayDescription }}</DialogDescription>
      </DialogHeader>

      <div class="grid gap-3 px-5 py-4">
        <Input
          v-model="searchQuery"
          placeholder="Search entries…"
          class="h-9"
        />

        <p v-if="loadError" class="text-xs text-destructive">
          {{ loadError }}
        </p>
        <p
          v-else-if="isLoading"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          Loading entries…
        </p>
        <p
          v-else-if="rows.length === 0"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          No entries found
        </p>

        <div
          v-else
          class="max-h-[420px] overflow-auto rounded-md border border-border"
        >
          <button
            v-for="row in rows"
            :key="row.id"
            type="button"
            class="flex w-full items-center justify-between gap-3 border-b border-dashed border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/40"
            @click="selectEntry(row)"
          >
            <span class="min-w-0">
              <span class="block truncate text-sm text-foreground">
                {{ row.title }}
              </span>
              <span class="block truncate text-2xs text-muted-foreground">
                {{ row.slug }} · {{ row.status }}
              </span>
            </span>
            <span class="shrink-0 text-2xs text-muted-foreground">
              {{ row.locale }}
            </span>
          </button>
        </div>

        <div
          class="flex items-center justify-between text-2xs text-muted-foreground"
        >
          <span>{{ total }} entries</span>
          <div v-if="totalPages > 1" class="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="page <= 1 || isLoading"
              @click="setPage(page - 1)"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="page >= totalPages || isLoading"
              @click="setPage(page + 1)"
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
