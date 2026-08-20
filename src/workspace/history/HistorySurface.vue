<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { toast } from "vue-sonner"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  listProjectHistory,
  redoProjectHistory,
  restoreProjectHistory,
  undoProjectHistory,
} from "@/lib/history"
import { m } from "@/paraglide/messages.js"
import type { HistoryRecord } from "../../../shared/history"

const props = defineProps<{ projectRoot: string }>()

const records = ref<HistoryRecord[]>([])
const canUndo = ref(false)
const canRedo = ref(false)
const loading = ref(true)
const busy = ref(false)
const loadError = ref<string | null>(null)

const statusText = computed(() => {
  if (loading.value) return m.history_loading()
  if (loadError.value) return loadError.value
  return m.history_result_count({ count: String(records.value.length) })
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function refresh() {
  loading.value = true
  loadError.value = null
  try {
    const result = await listProjectHistory(props.projectRoot)
    records.value = result.records
    canUndo.value = result.canUndo
    canRedo.value = result.canRedo
  } catch (error) {
    loadError.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

async function run(action: () => Promise<unknown>, success: string) {
  if (busy.value) return
  busy.value = true
  try {
    await action()
    toast.success(success)
    await refresh()
  } catch (error) {
    toast.error(m.history_action_failed(), { description: errorMessage(error) })
  } finally {
    busy.value = false
  }
}

function undo() {
  return run(() => undoProjectHistory(props.projectRoot), m.history_undo_success())
}

function redo() {
  return run(() => redoProjectHistory(props.projectRoot), m.history_redo_success())
}

function revert(record: HistoryRecord) {
  return run(
    () => restoreProjectHistory(props.projectRoot, record.id, "before"),
    m.history_revert_success(),
  )
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString()
}

function actorLabel(actor: HistoryRecord["actor"]): string {
  if (actor === "agent") return m.history_actor_agent()
  if (actor === "system") return m.history_actor_system()
  return m.history_actor_user()
}

onMounted(refresh)
watch(() => props.projectRoot, refresh)
</script>

<template>
  <main class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
    <header class="flex shrink-0 flex-wrap items-start justify-between gap-4 px-7 py-7">
      <div class="min-w-0 space-y-1">
        <h1 class="text-2xl font-medium tracking-tight">{{ m.history_title() }}</h1>
        <p class="max-w-2xl text-sm text-muted-foreground/70">
          {{ m.history_description() }}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          :disabled="busy || !canUndo"
          @click="undo"
        >
          <AppIcon name="undo" :size="14" />
          {{ m.history_undo() }}
        </Button>
        <Button
          type="button"
          variant="outline"
          :disabled="busy || !canRedo"
          @click="redo"
        >
          <AppIcon name="redo" :size="14" />
          {{ m.history_redo() }}
        </Button>
      </div>
    </header>

    <p class="sr-only" role="status" aria-live="polite">{{ statusText }}</p>

    <div class="min-h-0 flex-1 overflow-y-auto px-7 pb-8">
      <div
        v-if="loading"
        class="rounded-md bg-muted/40 px-5 py-10 text-center text-sm text-muted-foreground"
      >
        {{ m.history_loading() }}
      </div>
      <div
        v-else-if="loadError"
        role="alert"
        class="rounded-md border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive"
      >
        <p>{{ m.history_load_failed() }}</p>
        <p class="mt-1 text-xs opacity-80">{{ loadError }}</p>
        <Button type="button" variant="outline" size="sm" class="mt-4" @click="refresh">
          {{ m.history_try_again() }}
        </Button>
      </div>
      <div
        v-else-if="records.length === 0"
        class="rounded-md bg-muted/40 px-5 py-10 text-center"
      >
        <AppIcon name="history" :size="24" class="mx-auto text-muted-foreground/60" />
        <h2 class="mt-3 text-sm font-medium">{{ m.history_empty_title() }}</h2>
        <p class="mx-auto mt-1 max-w-md text-sm text-muted-foreground/70">
          {{ m.history_empty_description() }}
        </p>
      </div>
      <ol v-else class="space-y-3" :aria-label="m.history_list_label()">
        <li
          v-for="record in records"
          :key="record.id"
          class="flex flex-wrap items-start gap-4 rounded-md border border-border/70 bg-card px-4 py-4 shadow-sm"
        >
          <div class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <AppIcon :name="record.surface === 'composer' ? 'composer' : 'history'" :size="17" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 class="text-sm font-medium capitalize">{{ record.operation }}</h2>
              <span class="text-xs text-muted-foreground">
                {{ actorLabel(record.actor) }} · {{ formatTime(record.timestamp) }}
              </span>
            </div>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ record.surface }} · {{ record.files.length }} {{ m.history_files_changed() }}
            </p>
            <ul v-if="record.targets.length" class="mt-2 flex flex-wrap gap-1.5">
              <li
                v-for="target in record.targets.slice(0, 4)"
                :key="target"
                class="max-w-full truncate rounded-sm bg-muted px-2 py-1 font-mono text-[10.5px] text-muted-foreground"
                :title="target"
              >
                {{ target }}
              </li>
            </ul>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="busy || !record.restorable"
            :title="record.restorable ? undefined : m.history_not_restorable()"
            @click="revert(record)"
          >
            {{ m.history_revert() }}
          </Button>
        </li>
      </ol>
    </div>
  </main>
</template>
