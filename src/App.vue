<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import type { AppMenuCommand } from "../shared/appMenu"
import ConfirmDialogHost from "@/components/confirm/ConfirmDialogHost.vue"
import { confirm } from "@/composables/useConfirm"
import ErrorBoundary from "@/components/ErrorBoundary.vue"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import WelcomeScreen from "@/components/welcome/WelcomeScreen.vue"
import WorkspaceDirtyDialog from "@/workspace/WorkspaceDirtyDialog.vue"
import { openProjectWindow } from "@/lib/project"
import {
  closeSession,
  confirmTrustAndOpen,
  onSessionUpdate,
  openSession,
  startSessionRuntime,
  type ProjectRuntimeSession,
} from "@/lib/sessions"
import ProjectWorkspace from "@/workspace/ProjectWorkspace.vue"
import { guardDirtyNavigation } from "@/workspace/dirtyState"
import { m } from "@/paraglide/messages.js"

function initialProjectFromQuery(): string | null {
  try {
    const value = new URLSearchParams(window.location.search).get("project")
    return value && value.trim() ? value : null
  } catch {
    return null
  }
}

const bootProject = initialProjectFromQuery()
const activePath = ref<string | null>(null)
const openPaths = ref<string[]>([])
const booting = ref(Boolean(bootProject))
const bootError = ref<string | null>(null)
const runtimeSessions = ref<Record<string, ProjectRuntimeSession>>({})
const opening = new Map<string, Promise<void>>()
let stopSessionUpdates: (() => void) | undefined
let stopMenuCommands: (() => void) | undefined
let disposed = false
let menuCommandId = 0
let menuReturnPath: string | null = null
const menuCommand = ref<{ id: number; command: AppMenuCommand } | null>(null)

const openSessions = computed(() => Object.values(runtimeSessions.value))

async function activateProject(projectPath: string) {
  const existing = opening.get(projectPath)
  if (existing) return existing
  const activation = (async () => {
    let result = await openSession(projectPath)
    if (result.status === "trust_required") {
      const trusted = await confirm({
        title: `Trust and open ${result.challenge.projectName}?`,
        description: `Aria will run this project's local Astro configuration and dependencies with your file and network permissions. Only continue if you trust the files in ${result.challenge.projectPath}.`,
        confirmLabel: "Trust and open",
        cancelLabel: "Cancel",
        destructive: false,
      })
      if (!trusted) return
      result = await confirmTrustAndOpen(result.challenge.id)
    }
    if (result.status !== "opened") return
    const session = result.session
    if (disposed) return
    if (!runtimeSessions.value[session.path]) {
      runtimeSessions.value[session.path] = session
    }
    if (!openPaths.value.includes(session.path)) {
      openPaths.value = [...openPaths.value, session.path]
    }
    activePath.value = session.path
    if (session.status === "stopped") {
      void startSessionRuntime(session.path).catch((error: unknown) => {
        if (disposed) return
        console.error("Failed to start Astro preview:", error)
      })
    }
  })().finally(() => {
    opening.delete(projectPath)
  })
  opening.set(projectPath, activation)
  return activation
}

/** Hide the workspace; keep the session + Astro preview running. */
function goHome() {
  activePath.value = null
}

function openProjectInNewWindow(projectPath: string) {
  void openProjectWindow(projectPath).catch((error: unknown) => {
    console.error("Failed to open project window:", error)
  })
}

function reloadApp() {
  window.location.reload()
}

async function dismissSession(projectPath: string) {
  await closeSession(projectPath)
  openPaths.value = openPaths.value.filter((p) => p !== projectPath)
  delete runtimeSessions.value[projectPath]
  if (activePath.value === projectPath) activePath.value = null
}

function projectName(projectPath: string) {
  return projectPath.split(/[/\\]/).filter(Boolean).pop() ?? projectPath
}

async function closeProjectOrWindow() {
  const projectPath = activePath.value
  if (projectPath) {
    const shouldClose = await confirm({
      title: m.app_close_project_title({ name: projectName(projectPath) }),
      description: m.app_close_project_description(),
      confirmLabel: m.app_close_project_confirm(),
      destructive: false,
    })
    if (!shouldClose || !(await guardDirtyNavigation(projectPath))) return
    await dismissSession(projectPath)
    return
  }

  const shouldClose = await confirm({
    title: m.app_close_window_title(),
    description: m.app_close_window_description(),
    confirmLabel: m.app_close_window_confirm(),
    destructive: false,
  })
  if (!shouldClose) return
  for (const openPath of openPaths.value) {
    if (!(await guardDirtyNavigation(openPath))) return
  }
  await window.aria?.window.close()
}

onMounted(() => {
  stopMenuCommands = window.aria?.window.onMenuCommand((command) => {
    if (command.type === "close-context") {
      void closeProjectOrWindow()
      return
    }
    menuReturnPath = activePath.value
    activePath.value = null
    menuCommand.value = { id: ++menuCommandId, command }
  })
  stopSessionUpdates = onSessionUpdate((session) => {
    runtimeSessions.value[session.path] = session
  })
  if (!bootProject) {
    booting.value = false
    return
  }
  void activateProject(bootProject)
    .catch((err: unknown) => {
      console.error("Failed to open boot project:", err)
      bootError.value = err instanceof Error ? err.message : String(err)
    })
    .finally(() => {
      booting.value = false
    })
})

onUnmounted(() => {
  disposed = true
  stopSessionUpdates?.()
  stopMenuCommands?.()
})
</script>

<template>
  <TooltipProvider>
    <template v-if="!booting">
      <div
        v-for="projectPath in openPaths"
        :key="projectPath"
        v-show="projectPath === activePath"
        class="h-svh max-h-svh overflow-hidden"
      >
        <ErrorBoundary>
          <ProjectWorkspace
            :project-path="projectPath"
            :active="projectPath === activePath"
            :runtime="runtimeSessions[projectPath] ?? null"
            :open-paths="openPaths"
            :sessions="openSessions"
            :on-home="goHome"
            :on-select-project="activateProject"
            :on-open-project-window="openProjectInNewWindow"
          />
        </ErrorBoundary>
      </div>

      <ErrorBoundary
        v-if="activePath === null"
        :on-reset="reloadApp"
      >
        <WelcomeScreen
          :on-open="activateProject"
          :on-dismiss-session="dismissSession"
          :sessions="openSessions"
          :initial-error="bootError"
          :menu-command="menuCommand"
          @menu-command-finished="(result) => {
            menuCommand = null
            if (result === 'canceled' && activePath === null && menuReturnPath) {
              activePath = menuReturnPath
            }
            menuReturnPath = null
          }"
        />
      </ErrorBoundary>
    </template>
    <ConfirmDialogHost />
    <WorkspaceDirtyDialog />
    <Toaster class="pointer-events-auto" />
  </TooltipProvider>
</template>
