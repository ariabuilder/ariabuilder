<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import type { AppMenuCommand } from "../../../shared/appMenu"
import FlickeringGrid from "@/components/welcome/FlickeringGrid.vue"
import NewProjectWizard from "@/components/welcome/NewProjectWizard.vue"
import WelcomeControlCenter from "@/components/welcome/WelcomeControlCenter.vue"
import { writeClipboardText } from "@/lib/clipboard"
import {
  getAppVersion,
  listRecents,
  openExternalUrl,
  openProjectDialog,
  openProjectWindow,
  pickNewProjectDir,
  removeRecent,
  type RecentProject,
} from "@/lib/project"
import { translateProjectError } from "@/lib/project-errors"
import type { ProjectRuntimeSession } from "@/lib/sessions"
import { revealPath } from "@/lib/shell"
import { m } from "@/paraglide/messages.js"

const BRAND_SITE_URL = "https://ariabuilder.io"

const props = defineProps<{
  onOpen: (projectPath: string) => void | Promise<void>
  onDismissSession: (projectPath: string) => void | Promise<void>
  /** Open project sessions (kept alive when returning to the control room). */
  sessions: ProjectRuntimeSession[]
  initialError?: string | null
  menuCommand?: { id: number; command: AppMenuCommand } | null
}>()

const emit = defineEmits<{
  menuCommandFinished: [result: "completed" | "canceled" | "error"]
}>()

const error = ref<string | null>(props.initialError ?? null)
const recents = ref<RecentProject[]>([])
const newProjectDir = ref<string | null>(null)
const version = ref<string | null>(null)

const continueProject = computed(() => recents.value[0] ?? null)
const otherRecents = computed(() => recents.value.slice(1, 4))

function refresh() {
  void listRecents()
    .then((list) => {
      recents.value = list
    })
    .catch(() => {
      recents.value = []
    })
  void getAppVersion()
    .then((v) => {
      version.value = v
    })
    .catch(() => {
      version.value = null
    })
}

onMounted(refresh)

function samePath(a: string, b: string) {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "")
  return norm(a) === norm(b)
}

function findSession(projectPath: string) {
  return props.sessions.find((s) => samePath(s.path, projectPath))
}

async function openPath(projectPath: string) {
  error.value = null
  try {
    await props.onOpen(projectPath)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function openExisting() {
  error.value = null
  try {
    const result = await openProjectDialog()
    if (result.canceled) return "canceled" as const
    if (result.error) {
      error.value = translateProjectError(result.error)
      return "error" as const
    }
    if (result.projectPath) await openPath(result.projectPath)
    return "completed" as const
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    return "error" as const
  }
}

async function createNew() {
  error.value = null
  try {
    const result = await pickNewProjectDir()
    if (result.canceled) return "canceled" as const
    if (result.error) {
      error.value = translateProjectError(result.error)
      return "error" as const
    }
    if (result.projectPath) newProjectDir.value = result.projectPath
    return "completed" as const
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    return "error" as const
  }
}

watch(
  () => props.menuCommand,
  async (request) => {
    if (!request) return
    if (request.command.type === "new-project") {
      emit("menuCommandFinished", await createNew())
    } else if (request.command.type === "open-project") {
      emit("menuCommandFinished", await openExisting())
    } else if (request.command.type === "open-recent") {
      await openPath(request.command.projectPath)
      emit("menuCommandFinished", "completed")
    }
  },
  { immediate: true },
)

function onRecentAction(id: string, recent: RecentProject) {
  const runtime = findSession(recent.path)
  if (id === "open") {
    void openPath(recent.path)
    return
  }
  if (id === "open-new-window") {
    error.value = null
    void openProjectWindow(recent.path).catch((err: unknown) => {
      error.value = err instanceof Error ? err.message : String(err)
    })
    return
  }
  if (id === "dismiss") {
    void Promise.resolve(
      props.onDismissSession(runtime?.path ?? recent.path),
    ).then(refresh)
    return
  }
  if (id === "reveal") {
    void revealPath(recent.path).catch((err: unknown) => {
      console.error(err)
    })
    return
  }
  if (id === "copy-path") {
    void writeClipboardText(recent.path).catch((err: unknown) => {
      console.error(err)
    })
    return
  }
  if (id === "copy-name") {
    void writeClipboardText(recent.name).catch((err: unknown) => {
      console.error(err)
    })
    return
  }
  if (id === "remove") {
    void removeRecent(recent.path).then(() => {
      recents.value = recents.value.filter((p) => p.path !== recent.path)
    })
  }
}
</script>

<template>
  <div class="relative flex h-svh min-h-0 flex-col overflow-hidden bg-white dark:bg-sidebar text-foreground">
    <FlickeringGrid />

    <div
      class="app-region-drag absolute inset-x-0 top-0 z-20 h-10"
      aria-hidden
    />

    <WelcomeControlCenter
      :continue-project="continueProject"
      :other-recents="otherRecents"
      :sessions="sessions"
      :error="error"
      @open="(path) => void openPath(path)"
      @create-new="void createNew()"
      @open-existing="void openExisting()"
      @recent-action="(id, recent) => onRecentAction(id, recent)"
    />

    <div class="relative z-10 flex shrink-0 flex-col gap-1.5 px-5 pb-4 select-none sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:pb-6">
      <div class="flex items-center gap-2 text-sm text-primary sm:justify-end">
        <button
          type="button"
          class="transition-opacity hover:text-primary/80 cursor-pointer"
          @click="void openExternalUrl(BRAND_SITE_URL)"
        >
          {{ m.brand_url() }}
        </button>
        <template v-if="version">
          <span class="text-muted-foreground/30 text-2xs" aria-hidden>//</span>
          <span class="tabular-nums font-mono text-3xs text-muted-foreground/50">
            v{{ version }}
          </span>
        </template>
      </div>
    </div>

    <NewProjectWizard
      v-if="newProjectDir"
      :dir="newProjectDir"
      @close="newProjectDir = null"
      @choose-another="() => {
        newProjectDir = null
        void createNew()
      }"
      @done="(dir) => {
        newProjectDir = null
        void openPath(dir)
      }"
    />
  </div>
</template>
