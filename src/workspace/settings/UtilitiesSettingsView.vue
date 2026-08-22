<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { m } from "@/paraglide/messages.js"
import { tryUseWorkspaceNavigate } from "@/workspace/useWorkspaceNavigate"
import type {
  UtilityActionProgress,
  UtilityLibraryInspection,
  UtilityManagerInspection,
} from "../../../shared/utilities"
import { toast } from "vue-sonner"

const props = defineProps<{
  projectRoot: string
}>()

const inspection = ref<UtilityManagerInspection | null>(null)
const loading = ref(true)
const busy = ref<"activate" | "disable" | null>(null)
const error = ref<string | null>(null)
const progress = ref<UtilityActionProgress | null>(null)
const confirmDisable = ref(false)
const navigate = tryUseWorkspaceNavigate()
let unsubscribeProgress: (() => void) | null = null

const library = computed<UtilityLibraryInspection | null>(
  () => inspection.value?.libraries.find((item) => item.id === "tailwind") ?? null,
)

const statusLabel = computed(() => {
  switch (library.value?.status) {
    case "active":
      return m.settings_utilities_status_active()
    case "partial":
      return m.settings_utilities_status_partial()
    case "blocked":
      return m.settings_utilities_status_blocked()
    default:
      return m.settings_utilities_status_inactive()
  }
})

const ownershipLabel = computed(() => {
  switch (library.value?.ownership) {
    case "aria":
      return m.settings_utilities_ownership_aria()
    case "project":
      return m.settings_utilities_ownership_project()
    default:
      return m.settings_utilities_ownership_none()
  }
})

const primaryLabel = computed(() =>
  library.value?.primaryAction === "connect"
    ? m.settings_utilities_connect_colors()
    : m.settings_utilities_activate(),
)

const disableLabel = computed(() =>
  library.value?.management === "connected"
    ? m.settings_utilities_disconnect_colors()
    : m.settings_utilities_disable(),
)

async function refresh() {
  loading.value = true
  error.value = null
  try {
    if (!window.aria?.utilities) {
      throw new Error(m.settings_utilities_bridge_unavailable())
    }
    inspection.value = await window.aria.utilities.inspect(props.projectRoot)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

async function activate() {
  if (busy.value || !window.aria?.utilities) return
  busy.value = "activate"
  error.value = null
  const action = library.value?.primaryAction
  try {
    const result = await window.aria.utilities.activate(props.projectRoot, "tailwind")
    inspection.value = result.inspection
    toast.success(
      action === "connect"
        ? m.settings_utilities_connected_success()
        : m.settings_utilities_activated_success(),
    )
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    error.value = message
    toast.error(m.settings_utilities_action_failed(), { description: message })
    await refresh()
  } finally {
    busy.value = null
  }
}

async function disable() {
  if (busy.value || !window.aria?.utilities) return
  confirmDisable.value = false
  busy.value = "disable"
  error.value = null
  try {
    const result = await window.aria.utilities.disable(props.projectRoot, "tailwind")
    inspection.value = result.inspection
    toast.success(m.settings_utilities_disabled_success())
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    error.value = message
    toast.error(m.settings_utilities_action_failed(), { description: message })
    await refresh()
  } finally {
    busy.value = null
  }
}

function openColors() {
  navigate?.openDesignSection("colors")
}

onMounted(() => {
  if (window.aria?.utilities) {
    unsubscribeProgress = window.aria.utilities.onProgress((next) => {
      if (next.projectPath === props.projectRoot && next.library === "tailwind") {
        progress.value = next
      }
    })
  }
  void refresh()
})

onUnmounted(() => unsubscribeProgress?.())

watch(
  () => props.projectRoot,
  () => {
    progress.value = null
    void refresh()
  },
)
</script>

<template>
  <div class="space-y-6" :aria-busy="loading || Boolean(busy)">
    <div
      v-if="loading"
      class="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <Spinner class="size-4" />
      {{ m.settings_utilities_checking() }}
    </div>

    <section
      v-else-if="library"
      class="rounded-md border border-border/70 bg-background p-5 dark:bg-sidebar"
      :aria-labelledby="`utility-${library.id}-title`"
    >
      <div class="flex flex-wrap items-start justify-between gap-5">
        <div class="flex min-w-0 items-start gap-4">
          <div class="min-w-0 space-y-1.5">
            <div class="flex flex-wrap items-center gap-2">
              <h2 :id="`utility-${library.id}-title`" class="text-base font-semibold">
                {{ library.name }}
              </h2>
              <Badge :variant="library.status === 'active' ? 'secondary' : 'outline'">
                {{ statusLabel }}
              </Badge>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Button
            v-if="library.primaryAction"
            type="button"
            :disabled="Boolean(busy)"
            @click="activate"
          >
            <Spinner v-if="busy === 'activate'" class="size-4" />
            {{ primaryLabel }}
          </Button>
          <Button
            v-if="library.ownership === 'aria'"
            type="button"
            variant="destructive"
            :disabled="Boolean(busy) || !library.canDisable"
            @click="confirmDisable = true"
          >
            {{ disableLabel }}
          </Button>
        </div>
      </div>

      <dl class="mt-7 grid gap-4 rounded-md bg-sidebar/30 dark:bg-background/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="space-y-1">
          <dt class="text-xs text-muted-foreground">{{ m.settings_utilities_version() }}</dt>
          <dd class="text-sm font-medium">
            {{ library.version ? `Tailwind ${library.version}` : m.settings_utilities_not_installed() }}
          </dd>
        </div>
        <div class="space-y-1">
          <dt class="text-xs text-muted-foreground">{{ m.settings_utilities_ownership() }}</dt>
          <dd class="text-sm font-medium">{{ ownershipLabel }}</dd>
        </div>
        <div class="space-y-1">
          <dt class="text-xs text-muted-foreground">{{ m.settings_utilities_package_manager() }}</dt>
          <dd class="font-mono text-sm font-medium">{{ library.packageManager }}</dd>
        </div>
        <div class="space-y-1">
          <dt class="text-xs text-muted-foreground">{{ m.settings_utilities_color_aliases() }}</dt>
          <dd class="text-sm font-medium">{{ library.paletteAliasCount }}</dd>
        </div>
      </dl>

      <div
        v-if="progress && busy"
        class="mt-5 rounded-md border border-primary/20 bg-sidebar/30 dark:bg-background/30 px-4 py-3"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div class="flex items-center gap-2 text-sm font-medium">
          <Spinner class="size-4" />
          {{ progress.message }}
        </div>
        <p v-if="progress.log" class="mt-2 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
          {{ progress.log }}
        </p>
      </div>

      <div v-if="library.diagnostics.length" class="mt-5 space-y-2">
        <p
          v-for="diagnostic in library.diagnostics"
          :key="`${diagnostic.code}:${diagnostic.message}`"
          class="rounded-md border px-4 py-3 text-sm leading-5"
          :class="
            diagnostic.severity === 'error'
              ? 'border-destructive/30 bg-destructive/5 dark:bg-destructive/10 text-destructive dark:text-destructive'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300'
          "
        >
          {{ diagnostic.message }}
          <span v-if="diagnostic.files?.length" class="mt-1 block font-mono text-xs opacity-80">
            {{ diagnostic.files.join(", ") }}
          </span>
        </p>
      </div>

      <div class="mt-2 flex flex-wrap items-center justify-between gap-4 pt-5">
        <div>
          <p class="text-sm font-medium">{{ m.settings_utilities_aria_colors() }}</p>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">
            {{ m.settings_utilities_aria_colors_description() }}
          </p>
        </div>
        <Button type="button" variant="outline" @click="openColors">
          {{ m.settings_utilities_manage_colors() }}
        </Button>
      </div>
    </section>

    <p
      v-if="error"
      class="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      role="alert"
    >
      {{ error }}
    </p>
  </div>

  <Dialog v-model:open="confirmDisable">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ m.settings_utilities_disable_title() }}</DialogTitle>
        <DialogDescription>
          {{
            library?.management === 'connected'
              ? m.settings_utilities_disconnect_description()
              : m.settings_utilities_disable_description()
          }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" @click="confirmDisable = false">
          {{ m.confirm_cancel() }}
        </Button>
        <Button type="button" variant="destructive" @click="disable">
          {{ disableLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
