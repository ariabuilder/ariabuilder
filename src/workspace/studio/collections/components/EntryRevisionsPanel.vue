<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { toast } from "vue-sonner"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { listCmsRevisions, restoreCmsRevision } from "@/lib/cms"
import { m } from "@/paraglide/messages.js"
import type { AriaEntryRecord, AriaEntryRevision } from "../../../../../shared/cms"
import RestoreEntryRevisionDialog from "../dialogs/RestoreEntryRevisionDialog.vue"

const props = defineProps<{
  projectRoot: string
  entryId: string
  entryVersion: string
}>()

const emit = defineEmits<{
  restored: [record: AriaEntryRecord]
}>()

const revisions = ref<AriaEntryRevision[]>([])
const isLoading = ref(false)
const hasLoaded = ref(false)
const isRestoring = ref(false)
const error = ref<string | null>(null)
const isOpen = ref(false)
const pendingRestoreId = ref<string | null>(null)

const hasRevisions = computed(() => revisions.value.length > 0)
const isRestoreDialogOpen = computed({
  get: () => pendingRestoreId.value !== null,
  set: (value: boolean) => {
    if (!value) pendingRestoreId.value = null
  },
})

const summaryLabel = computed(() => {
  if (isLoading.value) return m.cms_entry_revisions_loading_snapshots()
  if (!hasLoaded.value) return m.cms_entry_revisions_snapshots()
  return m.cms_entry_revisions_saved_snapshots({
    count: revisions.value.length,
  })
})

function formatRevisionDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed)
}

async function loadRevisions(): Promise<void> {
  if (!props.projectRoot || !props.entryId) return
  isLoading.value = true
  error.value = null
  try {
    revisions.value = await listCmsRevisions(props.projectRoot, props.entryId)
    hasLoaded.value = true
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : m.cms_entry_revisions_load_failed()
  } finally {
    isLoading.value = false
  }
}

function toggleOpen(): void {
  isOpen.value = !isOpen.value
  if (isOpen.value && !hasLoaded.value) {
    void loadRevisions()
  }
}

function requestRestore(revisionId: string): void {
  pendingRestoreId.value = revisionId
}

async function confirmRestore(): Promise<void> {
  const revisionId = pendingRestoreId.value
  if (!revisionId || !props.projectRoot || !props.entryId) return
  isRestoring.value = true
  try {
    const record = await restoreCmsRevision(
      props.projectRoot,
      props.entryId,
      revisionId,
      props.entryVersion,
    )
    toast.success(m.cms_entry_restore_success())
    pendingRestoreId.value = null
    await loadRevisions()
    emit("restored", record)
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : m.cms_entry_restore_failed(),
    )
  } finally {
    isRestoring.value = false
  }
}

watch(
  () => [props.projectRoot, props.entryId] as const,
  () => {
    revisions.value = []
    hasLoaded.value = false
    error.value = null
    pendingRestoreId.value = null
    if (isOpen.value) {
      void loadRevisions()
    }
  },
)

defineExpose({
  reload: loadRevisions,
  hasLoaded,
  revisions,
})
</script>

<template>
  <section class="grid border-t border-border pt-5">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-3 py-1 text-left"
      :aria-expanded="isOpen"
      @click="toggleOpen"
    >
      <div>
        <p class="m-0 text-sm font-medium leading-none text-foreground">
          {{ m.cms_entry_revisions_title() }}
        </p>
        <p class="m-0 mt-1 text-xs leading-snug text-muted-foreground">
          {{ summaryLabel }}
        </p>
      </div>
      <AppIcon
        :name="isOpen ? 'chevronUp' : 'chevronDown'"
        :size="16"
        class="shrink-0 text-muted-foreground"
      />
    </button>

    <div v-if="isOpen" class="mt-4 grid gap-3">
      <p v-if="error" class="m-0 text-xs text-destructive">{{ error }}</p>
      <p v-else-if="isLoading" class="m-0 text-xs text-muted-foreground">
        {{ m.cms_entry_revisions_loading() }}
      </p>
      <p v-else-if="!hasRevisions" class="m-0 text-xs text-muted-foreground">
        {{ m.cms_entry_revisions_empty() }}
      </p>

      <div v-else class="grid border-t border-border">
        <div
          v-for="revision in revisions"
          :key="revision.id"
          class="flex items-center justify-between gap-3 border-b border-border/50 py-3"
        >
          <div class="min-w-0">
            <p class="m-0 truncate text-xs leading-tight text-foreground">
              {{ revision.message ?? m.cms_entry_revisions_saved() }}
            </p>
            <p class="m-0 mt-1 truncate text-2xs leading-tight text-muted-foreground">
              {{ formatRevisionDate(revision.createdAt) }}
              <span v-if="revision.locale"> · {{ revision.locale }}</span>
              <span> · v{{ revision.version.slice(0, 8) }}</span>
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-7 shrink-0 px-2.5 text-xs"
            :disabled="isRestoring"
            @click="requestRestore(revision.id)"
          >
            {{
              isRestoring
                ? m.cms_entry_restore_restoring()
                : m.cms_entry_revisions_restore()
            }}
          </Button>
        </div>
      </div>
    </div>

    <RestoreEntryRevisionDialog
      :open="isRestoreDialogOpen"
      :is-restoring="isRestoring"
      @update:open="isRestoreDialogOpen = $event"
      @confirm="confirmRestore"
    />
  </section>
</template>
