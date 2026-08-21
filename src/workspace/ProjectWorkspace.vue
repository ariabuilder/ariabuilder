<script setup lang="ts">
import { onUnmounted, reactive, watch } from "vue"
import {
  onProjectChange,
  type ProjectRuntimeSession,
} from "@/lib/sessions"
import { getSiteSettings, scanWorkspace } from "@/lib/workspace"
import { DEFAULT_SITE_TIME_ZONE } from "@/workspace/settings/timeZone"
import type { SiteSettings } from "@/workspace/settings/types"
import WorkspaceShell from "@/workspace/WorkspaceShell.vue"
import type {
  DevicePreview,
  ProjectSession,
  ScanResult,
  WorkspaceRailId,
} from "@/workspace/types"
import { guardDirtyNavigation, hasDirtyState } from "@/workspace/dirtyState"

const props = defineProps<{
  projectPath: string
  /** True while this workspace is the foreground project (not just kept alive). */
  active: boolean
  runtime: ProjectRuntimeSession | null
  openPaths: string[]
  sessions: ProjectRuntimeSession[]
  onHome: () => void
  onSelectProject: (projectPath: string) => void
  onOpenProjectWindow: (projectPath: string) => void
}>()

function sessionName(root: string): string {
  return root.split(/[/\\]/).filter(Boolean).pop() ?? root
}

function emptySiteSettings(): SiteSettings {
  return {
    siteName: "",
    siteDescription: "",
    siteUrl: "",
    timeZone: DEFAULT_SITE_TIME_ZONE,
    favicon: "",
  }
}

function pickDefaultRoute(scan: ScanResult): string | null {
  const home = scan.pages.find((p) => p.route === "/")
  return home?.route ?? scan.pages[0]?.route ?? null
}

function applyDisplayName() {
  const siteName = session.siteSettings.siteName.trim()
  session.name = siteName || session.scan?.name || sessionName(session.root)
}

const session = reactive<ProjectSession>({
  root: props.projectPath,
  name: sessionName(props.projectPath),
  rail: "composer",
  selectedRoute: null,
  device: "desktop",
  scan: null,
  scanError: null,
  scanLoading: false,
  settingsError: null,
  siteSettings: emptySiteSettings(),
})

let scanRequestId = 0
let stopProjectChanges: (() => void) | undefined
let dirtyWhileLoading = false
let disposed = false

async function loadProject(
  projectPath: string,
  options?: { preserveSession?: boolean },
) {
  const startedAt = performance.now()
  const requestId = ++scanRequestId
  const preserveSession = options?.preserveSession ?? false
  const previousRoute = session.selectedRoute

  session.root = projectPath
  if (!preserveSession) {
    session.rail = "composer"
    session.selectedRoute = null
    session.device = "desktop"
    session.scan = null
    session.siteSettings = emptySiteSettings()
    session.name = sessionName(projectPath)
  }
  session.scanError = null
  session.settingsError = null
  session.scanLoading = true

  try {
    const [scanResult, settingsResult] = await Promise.allSettled([
      scanWorkspace(projectPath),
      getSiteSettings(projectPath),
    ])
    if (disposed || requestId !== scanRequestId) return

    if (settingsResult.status === "fulfilled") {
      session.siteSettings = settingsResult.value
    } else {
      session.settingsError = settingsResult.reason instanceof Error
        ? settingsResult.reason.message
        : String(settingsResult.reason)
    }

    if (scanResult.status === "fulfilled") {
      const scan = scanResult.value
      session.scan = scan
      session.selectedRoute =
        preserveSession && previousRoute && scan.pages.some((p) => p.route === previousRoute)
          ? previousRoute
          : pickDefaultRoute(scan)
    } else {
      if (!preserveSession) session.scan = null
      const err = scanResult.reason
      session.scanError = err instanceof Error ? err.message : String(err)
    }
  } finally {
    if (!disposed && requestId === scanRequestId) {
      session.scanLoading = false
      if (dirtyWhileLoading) {
        dirtyWhileLoading = false
        setTimeout(() => {
          if (!disposed) void loadProject(session.root, { preserveSession: true })
        }, 0)
      }
    }
  }

  applyDisplayName()
  console.info(`[aria:perf] Workspace scan completed in ${Math.round(performance.now() - startedAt)}ms.`)
}

async function onRefreshScan() {
  await loadProject(session.root, { preserveSession: true })
}

function onSiteSettingsSaved(settings: SiteSettings) {
  session.siteSettings = settings
  applyDisplayName()
}

watch(
  () => props.projectPath,
  (path) => {
    void loadProject(path)
  },
  { immediate: true },
)

// Workspaces stay mounted after Home (v-show). Re-entering always lands in
// Composer — the main project entry — not the last rail.
watch(
  () => props.active,
  (active, wasActive) => {
    if (active && wasActive === false) {
      session.rail = "composer"
    }
  },
)

stopProjectChanges = onProjectChange((projectPath, change) => {
  if (projectPath !== session.root || disposed) return
  if (
    change.path &&
    change.category &&
    change.category !== "structure" &&
    change.category !== "config"
  ) return
  if (session.scanLoading) {
    dirtyWhileLoading = true
    return
  }
  void loadProject(session.root, { preserveSession: true })
})

onUnmounted(() => {
  disposed = true
  scanRequestId += 1
  stopProjectChanges?.()
})

async function onSelectRoute(route: string) {
  if (!(await guardDirtyNavigation(session.root))) return
  session.selectedRoute = route
  session.rail = "composer"
}

async function onSelectRail(id: WorkspaceRailId) {
  if (id === session.rail) return
  if (!(await guardDirtyNavigation(session.root))) return
  session.rail = id
}

async function onHome() {
  if (await guardDirtyNavigation(session.root)) props.onHome()
}

async function onSelectProject(projectPath: string) {
  if (projectPath === session.root || await guardDirtyNavigation(session.root)) {
    props.onSelectProject(projectPath)
  }
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasDirtyState(session.root)) return
  event.preventDefault()
  event.returnValue = ""
}

window.addEventListener("beforeunload", onBeforeUnload)
onUnmounted(() => window.removeEventListener("beforeunload", onBeforeUnload))

function onDeviceChange(device: DevicePreview) {
  session.device = device
}
</script>

<template>
  <WorkspaceShell
    :session="session"
    :runtime="runtime"
    :open-paths="openPaths"
    :sessions="sessions"
    :active="active"
    :on-home="onHome"
    :on-select-route="onSelectRoute"
    :on-select-project="onSelectProject"
    :on-open-project-window="onOpenProjectWindow"
    :on-select-rail="onSelectRail"
    :on-device-change="onDeviceChange"
    :on-refresh-scan="onRefreshScan"
    :on-site-settings-saved="onSiteSettingsSaved"
  />
</template>
