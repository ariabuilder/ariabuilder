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
import {
  assessCollectionMigration,
  migrateCollectionToAria,
} from "@/lib/workspace"
import type {
  CollectionMigrationAssessment,
  CollectionMigrationResult,
} from "../../../../../shared/types"

const props = defineProps<{
  open: boolean
  projectRoot: string
  collectionId: string
  collectionLabel: string
  sourceLabel: string
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  migrated: [result: CollectionMigrationResult]
}>()

const assessment = ref<CollectionMigrationAssessment | null>(null)
const result = ref<CollectionMigrationResult | null>(null)
const error = ref<string | null>(null)
const isAssessing = ref(false)
const isMigrating = ref(false)
let assessmentRequest = 0

const entryCount = computed(() => assessment.value?.entryCount ?? 0)
const entryLabel = computed(() => `${entryCount.value} ${entryCount.value === 1 ? "entry" : "entries"}`)
const statusMessage = computed(() => {
  if (isMigrating.value) return `Migrating ${props.collectionLabel} to Aria Collections.`
  if (isAssessing.value) return `Checking ${props.collectionLabel} before migration.`
  if (result.value) {
    const noun = result.value.importedEntries === 1 ? "entry" : "entries"
    return `${result.value.importedEntries} ${noun} migrated to Aria Collections.`
  }
  if (error.value) return "Migration could not continue."
  if (assessment.value?.requiresExplicitMapping) return "This collection needs a manual configuration update before migration."
  if (assessment.value) return `${entryCount.value} entries are ready to migrate.`
  return ""
})

function readableError(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback
  return cause.message.replace(/^[A-Z][A-Z0-9_]+:\s*/, "") || fallback
}

async function prepareMigration(): Promise<void> {
  const request = ++assessmentRequest
  assessment.value = null
  result.value = null
  error.value = null
  isAssessing.value = true
  try {
    const next = await assessCollectionMigration(
      props.projectRoot,
      props.collectionId,
    )
    if (request !== assessmentRequest || !props.open) return
    assessment.value = next
  } catch (cause) {
    if (request !== assessmentRequest || !props.open) return
    error.value = readableError(
      cause,
      "Aria could not prepare this collection for import.",
    )
  } finally {
    if (request === assessmentRequest) isAssessing.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      void prepareMigration()
      return
    }
    assessmentRequest += 1
    isAssessing.value = false
    assessment.value = null
    result.value = null
    error.value = null
  },
  { immediate: true },
)

function handleOpenChange(open: boolean): void {
  if (isMigrating.value) return
  emit("update:open", open)
}

async function beginMigration(): Promise<void> {
  if (
    !assessment.value
    || assessment.value.requiresExplicitMapping
    || isMigrating.value
    || entryCount.value === 0
  ) return
  isMigrating.value = true
  error.value = null
  try {
    result.value = await migrateCollectionToAria(
      props.projectRoot,
      props.collectionId,
      assessment.value.previewHash,
    )
  } catch (cause) {
    error.value = readableError(cause, "Aria could not migrate this collection. Check the source and try again.")
  } finally {
    isMigrating.value = false
  }
}

function viewCollection(): void {
  if (!result.value) return
  emit("migrated", result.value)
  emit("update:open", false)
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-[460px]" :show-close-button="!isMigrating">
      <DialogHeader>
        <DialogTitle>
          {{ result ? "Migration complete" : "Migrate to Aria Collections" }}
        </DialogTitle>
        <DialogDescription v-if="result">
          {{ result.importedEntries }}
          {{ result.importedEntries === 1 ? "entry was" : "entries were" }}
          migrated as drafts. Aria now manages this collection for your site.
        </DialogDescription>
        <DialogDescription v-else-if="isAssessing">
          Checking {{ collectionLabel }} before migration…
        </DialogDescription>
        <DialogDescription v-else-if="error">
          Aria couldn’t migrate this collection. Follow the message below and try again.
        </DialogDescription>
        <DialogDescription v-else-if="assessment?.requiresExplicitMapping">
          Aria found this collection but can’t safely update its Astro configuration automatically.
        </DialogDescription>
        <DialogDescription v-else-if="assessment && entryCount > 0">
          Aria is ready to migrate {{ entryLabel }} from {{ sourceLabel }}.
          Aria will become the content source, and every entry will remain a draft until you publish it.
        </DialogDescription>
        <DialogDescription v-else-if="assessment">
          Aria couldn’t find any entries to migrate. Check the source collection and try again.
        </DialogDescription>
        <DialogDescription v-else>
          Aria couldn’t prepare {{ collectionLabel }} for import.
        </DialogDescription>
      </DialogHeader>

      <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {{ statusMessage }}
      </p>

      <p
        v-if="error"
        role="alert"
        class="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      >
        {{ error }}
      </p>

      <DialogFooter>
        <Button
          v-if="result"
          type="button"
          size="sm"
          class="h-9!"
          @click="viewCollection"
        >
          View collection
        </Button>
        <template v-else>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-9!"
            :disabled="isMigrating"
            @click="handleOpenChange(false)"
          >
            Cancel
          </Button>
          <Button
            v-if="error"
            type="button"
            size="sm"
            class="h-9!"
            :disabled="isAssessing"
            @click="prepareMigration"
          >
            Check again
          </Button>
          <Button
            v-else-if="!assessment?.requiresExplicitMapping"
            type="button"
            size="sm"
            class="h-9!"
            :disabled="isAssessing || isMigrating || !assessment || entryCount === 0"
            @click="beginMigration"
          >
            {{ isMigrating ? "Migrating…" : "Migrate collection" }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
