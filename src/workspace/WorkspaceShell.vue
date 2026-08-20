<script setup lang="ts">
import { onUnmounted, ref, watch, computed, toRef } from "vue"
import PagesSurface from "@/workspace/studio/pages/PagesSurface.vue"
import ComposerSurface from "@/workspace/composer/ComposerSurface.vue"
import RailPlaceholder, {
  type PlaceholderRailId,
} from "@/workspace/RailPlaceholder.vue"
import SettingsSurface from "@/workspace/settings/SettingsSurface.vue"
import type { SiteSettings } from "@/workspace/settings/types"
import type { ProjectRuntimeSession } from "@/lib/sessions"
import {
  cancelWarmPageThumbs,
  warmComponentThumbs,
  warmLayoutThumbs,
  warmPageThumbs,
} from "@/lib/thumbs"
import WorkspaceChrome from "@/workspace/WorkspaceChrome.vue"
import WorkspaceHeader from "@/workspace/WorkspaceHeader.vue"
import WorkspaceRail from "@/workspace/WorkspaceRail.vue"
import ComponentsSurface from "@/workspace/studio/components/ComponentsSurface.vue"
import LayoutsSurface from "@/workspace/studio/layouts/LayoutsSurface.vue"
import CollectionsSurface from "@/workspace/studio/collections/CollectionsSurface.vue"
import MediaSurface from "@/workspace/studio/media/MediaSurface.vue"
import DesignSurface from "@/workspace/design/DesignSurface.vue"
import {
  AgentDockedPanel,
  AgentFloatingSheet,
  useAgentPanel,
} from "@/workspace/agent"
import type {
  DevicePreview,
  ProjectSession,
  ScanComponent,
  WorkspaceActiveDocument,
  WorkspaceRailId,
} from "@/workspace/types"
import {
  openDesignSectionViaStorage,
  provideWorkspaceNavigate,
} from "@/workspace/useWorkspaceNavigate"
import type { DesignSectionId } from "@/workspace/design/types"
import { useAgentSurfaceContext } from "@/workspace/agent/surfaceContext"
import { useAgentWorkspaceHost } from "@/workspace/agent/useAgentWorkspaceHost"
import { requestComposerDocumentLaunch } from "@/workspace/composer/composerDocumentLaunchRequest"
import { agentToolFail, agentToolOk, type AgentToolResult } from "../../shared/agent"
import type { StudioDocumentUsage } from "../../shared/types"

const props = defineProps<{
  session: ProjectSession
  runtime: ProjectRuntimeSession | null
  openPaths: string[]
  sessions: ProjectRuntimeSession[]
  /** Foreground workspace only — background keep-alives must not steal the warmer. */
  active?: boolean
  onHome: () => void
  onSelectRoute: (route: string) => void
  onSelectProject: (projectPath: string) => void
  onOpenProjectWindow: (projectPath: string) => void
  onSelectRail: (id: WorkspaceRailId) => void
  onDeviceChange: (device: DevicePreview) => void
  onRefreshScan: () => Promise<void> | void
  onSiteSettingsSaved: (settings: SiteSettings) => void
}>()

provideWorkspaceNavigate({
  selectRail: (rail) => props.onSelectRail(rail),
  openDesignSection: (section: DesignSectionId) =>
    openDesignSectionViaStorage(section, props.onSelectRail),
})

const activeComposerDocument = ref<WorkspaceActiveDocument | null>(null)
const composerSurfaceRef = ref<InstanceType<typeof ComposerSurface> | null>(null)
const composerPreviewImmersive = ref(false)
const previewIsolatedDevice = ref<DevicePreview | null>(null)

watch(composerPreviewImmersive, (immersive) => {
  if (!immersive) previewIsolatedDevice.value = null
})

function onPreviewIsolateChange(device: DevicePreview | null) {
  previewIsolatedDevice.value = device
}

function openComposerDesignTools() {
  composerSurfaceRef.value?.openDesignTools()
}

const {
  open: agentOpen,
  docked: agentDocked,
  requestedSettingsTab,
  togglePanel: toggleAgentPanel,
} = useAgentPanel()

watch(requestedSettingsTab, (tab) => {
  if (!tab) return
  props.onSelectRail("settings")
})
const agentSurfaceContext = useAgentSurfaceContext(() => props.session.root)
const agentShellContext = computed(() => {
  const surface = agentSurfaceContext.value
  const canClientInsert = Boolean(
    props.session.rail === "composer" && surface?.documentContext?.editable,
  )
  return {
    mode: (props.session.rail === "composer" ? "composer" : "studio") as
      | "composer"
      | "studio",
    workspace: (props.session.rail === "design"
      ? "design"
      : props.session.rail === "composer"
        ? "composer"
        : props.session.rail === "collections"
          ? "collections"
          : "studio") as "studio" | "composer" | "design" | "collections",
    itemType: null,
    itemSlug: props.session.selectedRoute,
    itemTitle: props.session.selectedRoute,
    pageId: props.session.selectedRoute,
    selectedBlockId: surface?.documentContext?.selectedNodePath ?? null,
    blockCount: surface?.documentContext?.outline?.length ?? 0,
    canClientInsert,
    canClientNavigate: true,
    siteContext: {
      siteName: props.session.siteSettings.siteName || undefined,
      siteUrl: props.session.siteSettings.siteUrl || undefined,
    },
    routeContext: props.session.selectedRoute
      ? { path: props.session.selectedRoute }
      : undefined,
    ...surface,
    capabilityFamilies: {
      main: ["cms", "site", "pages", "media", "design", "seo", "redirects"],
      renderer: canClientInsert
        ? ["composer"]
        : props.session.rail === "composer"
          ? ["composer"]
          : [],
    },
  }
})
let lastPageWarmKey = ""
let lastComponentWarmKey = ""
let pageWarmTimer: ReturnType<typeof setTimeout> | null = null
let componentWarmTimer: ReturnType<typeof setTimeout> | null = null

const PAGE_WARM_DELAY_MS = 3_000
const COMPONENT_WARM_DELAY_MS = 300

function openComponentInComposer(component: { name: string; file: string }) {
  activeComposerDocument.value = {
    kind: "component",
    name: component.name,
    file: component.file,
  }
  requestComposerDocumentLaunch({
    mode: "standalone-component",
    kind: "component",
    name: component.name,
    file: component.file,
  }, props.session.root)
  props.onSelectRail("composer")
}

function openStudioUsageInComposer(usage: StudioDocumentUsage) {
  if (usage.kind === "page" && usage.route) {
    props.onSelectRoute(usage.route)
    return
  }

  const scan = props.session.scan
  const document = usage.kind === "layout"
    ? scan?.layouts.find((item) => item.file === usage.file)
    : scan?.components.find((item) => item.file === usage.file)
  if (!document) return

  const kind = usage.kind === "layout" ? "layout" as const : "component" as const
  activeComposerDocument.value = {
    kind,
    name: document.name,
    file: document.file,
  }
  requestComposerDocumentLaunch({
    mode: "standalone-component",
    kind,
    name: document.name,
    file: document.file,
  }, props.session.root)
  props.onSelectRail("composer")
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function waitForActiveComposerFile(file: string, timeoutMs = 5_000): Promise<boolean> {
  if (
    props.session.rail === "composer" &&
    activeComposerDocument.value?.file === file
  ) return Promise.resolve(true)
  return new Promise((resolve) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (
        props.session.rail === "composer" &&
        activeComposerDocument.value?.file === file
      ) {
        clearInterval(timer)
        resolve(true)
        return
      }
      if (Date.now() - started >= timeoutMs) {
        clearInterval(timer)
        resolve(false)
      }
    }, 50)
  })
}

async function openAgentComposerDocument(argsRaw: unknown): Promise<AgentToolResult> {
  const args = asRecord(argsRaw)
  const scan = props.session.scan
  if (!scan) {
    return agentToolFail("NO_OPEN_DOCUMENT", "The project inventory is not ready yet.", {
      suggestedFix: "Wait for the project scan to finish, then retry.",
    })
  }

  const requestedFile = typeof args.file === "string" ? args.file.trim() : ""
  const requestedRoute = typeof args.route === "string" ? args.route.trim() : ""
  if (!requestedFile && !requestedRoute && activeComposerDocument.value) {
    props.onSelectRail("composer")
    return agentToolOk({
      file: activeComposerDocument.value.file,
      alreadyOpen: true,
    })
  }

  const page = requestedRoute
    ? scan.pages.find((entry) => entry.route === requestedRoute)
    : requestedFile
      ? scan.pages.find((entry) => entry.file === requestedFile)
      : scan.pages.find((entry) => entry.route === props.session.selectedRoute)
  const component: ScanComponent | undefined = !page && requestedFile
    ? scan.components.find((entry) => entry.file === requestedFile)
    : undefined
  const layout: ScanComponent | undefined = !page && !component && requestedFile
    ? scan.layouts.find((entry) => entry.file === requestedFile)
    : undefined
  const target = page ?? component ?? layout
  if (!target) {
    return agentToolFail(
      "NOT_FOUND",
      `Composer document not found: ${requestedFile || requestedRoute || "current page"}.`,
      { suggestedFix: "Use a file or route from the current project inventory." },
    )
  }

  const alreadyOpen =
    props.session.rail === "composer" &&
    activeComposerDocument.value?.file === target.file
  if (alreadyOpen) {
    return agentToolOk({ file: target.file, alreadyOpen: true })
  }

  if (page) {
    props.onSelectRoute(page.route)
  } else {
    const document = component ?? layout
    if (!document) {
      return agentToolFail("NOT_FOUND", "Composer document is no longer available.")
    }
    const kind = component ? "component" as const : "layout" as const
    activeComposerDocument.value = {
      kind,
      name: document.name,
      file: document.file,
    }
    requestComposerDocumentLaunch({
      mode: "standalone-component",
      kind,
      name: document.name,
      file: document.file,
    }, props.session.root)
    props.onSelectRail("composer")
  }

  if (!(await waitForActiveComposerFile(target.file))) {
    return agentToolFail(
      "NO_OPEN_DOCUMENT",
      `Could not open ${target.file} in Composer.`,
      { suggestedFix: "Resolve any dirty-navigation prompt, then retry." },
    )
  }
  return agentToolOk({
    opened: true,
    alreadyOpen: false,
    file: target.file,
  })
}

useAgentWorkspaceHost({
  projectPath: toRef(props.session, "root"),
  openInComposer: openAgentComposerDocument,
})

function clearPageWarmTimer() {
  if (pageWarmTimer) {
    clearTimeout(pageWarmTimer)
    pageWarmTimer = null
  }
}

function clearComponentWarmTimer() {
  if (componentWarmTimer) {
    clearTimeout(componentWarmTimer)
    componentWarmTimer = null
  }
}

function schedulePageThumbWarm() {
  clearPageWarmTimer()
  const runtime = props.runtime
  const pages = props.session.scan?.pages
  const isForeground = props.active !== false
  if (!isForeground) return
  if (!runtime?.previewUrl || runtime.status !== "live") {
    lastPageWarmKey = ""
    // Only cancel when this surface owns warm eligibility — avoid killing
    // an in-flight component warm while on the components rail.
    if (
      props.session.rail === "composer" ||
      props.session.rail === "pages" ||
      props.session.rail === "layouts"
    ) {
      void cancelWarmPageThumbs().catch(() => undefined)
    }
    return
  }
  // Warm once Composer is the active surface (or Pages — user often jumps
  // straight there). Preview must be live either way.
  if (
    props.session.rail !== "composer" &&
    props.session.rail !== "pages" &&
    props.session.rail !== "layouts"
  ) {
    return
  }
  const layouts = props.session.scan?.layouts ?? []
  if (props.session.rail === "layouts") {
    if (!layouts.length) return
  } else if (!pages?.length) {
    return
  }

  const layoutsKey = props.session.rail === "layouts"
    ? `|${(props.session.scan?.layouts ?? [])
        .map((layout) => `${layout.id}:${layout.mtimeMs}`)
        .join(",")}`
    : ""
  const key = `${props.session.root}|${runtime.previewUrl}|${props.session.rail}|${(pages ?? [])
    .map((p) => `${p.route}:${p.mtimeMs}`)
    .join(",")}${layoutsKey}`
  if (key === lastPageWarmKey) return

  // Let the Composer iframe settle before a hidden window starts walking routes.
  const projectPath = props.session.root
  const baseUrl = runtime.previewUrl
  const pageList = (pages ?? []).map((p) => ({ route: p.route, mtimeMs: p.mtimeMs }))
  pageWarmTimer = setTimeout(() => {
    pageWarmTimer = null
    if (props.active === false) return
    if (props.runtime?.status !== "live") return
    if (props.runtime.previewUrl !== baseUrl) return
    if (
      props.session.rail !== "composer" &&
      props.session.rail !== "pages" &&
      props.session.rail !== "layouts"
    ) {
      return
    }
    lastPageWarmKey = key
    if (props.session.rail === "layouts") {
      void warmLayoutThumbs({
        projectPath,
        baseUrl,
        pages: pageList,
        layouts: (props.session.scan?.layouts ?? []).map((layout) => ({
          id: layout.id,
          mtimeMs: layout.mtimeMs,
        })),
      }).catch(() => undefined)
    } else {
      void warmPageThumbs({
        projectPath,
        baseUrl,
        pages: pageList,
      }).catch(() => undefined)
    }
  }, PAGE_WARM_DELAY_MS)
}

function scheduleComponentThumbWarm() {
  clearComponentWarmTimer()
  const runtime = props.runtime
  const components = props.session.scan?.components
  const isForeground = props.active !== false
  if (!isForeground) return
  if (!runtime?.previewUrl || runtime.status !== "live") {
    lastComponentWarmKey = ""
    if (props.session.rail === "components") {
      void cancelWarmPageThumbs().catch(() => undefined)
    }
    return
  }
  if (props.session.rail !== "components") {
    return
  }
  if (!components?.length) return

  const key = `${props.session.root}|${runtime.previewUrl}|${components
    .map((c) => `${c.id}:${c.mtimeMs}`)
    .join(",")}`
  if (key === lastComponentWarmKey) return

  const projectPath = props.session.root
  const baseUrl = runtime.previewUrl
  const componentList = components.map((c) => ({
    id: c.id,
    mtimeMs: c.mtimeMs,
  }))
  componentWarmTimer = setTimeout(() => {
    componentWarmTimer = null
    if (props.active === false) return
    if (props.runtime?.status !== "live") return
    if (props.runtime.previewUrl !== baseUrl) return
    if (props.session.rail !== "components") return
    lastComponentWarmKey = key
    void warmComponentThumbs({
      projectPath,
      baseUrl,
      components: componentList,
    }).catch(() => undefined)
  }, COMPONENT_WARM_DELAY_MS)
}

watch(
  () =>
    [
      props.active !== false,
      props.runtime?.status ?? "",
      props.runtime?.previewUrl ?? "",
      props.session.rail,
      props.session.root,
      props.session.scan?.pages
        ?.map((p) => `${p.route}:${p.mtimeMs}`)
        .join("|") ?? "",
      props.session.scan?.layouts
        ?.map((layout) => `${layout.id}:${layout.mtimeMs}`)
        .join("|") ?? "",
    ] as const,
  () => {
    schedulePageThumbWarm()
  },
  { immediate: true },
)

watch(
  () =>
    [
      props.active !== false,
      props.runtime?.status ?? "",
      props.runtime?.previewUrl ?? "",
      props.session.rail,
      props.session.root,
      props.session.scan?.components
        ?.map((c) => `${c.id}:${c.mtimeMs}`)
        .join("|") ?? "",
    ] as const,
  () => {
    scheduleComponentThumbWarm()
  },
  { immediate: true },
)

onUnmounted(() => {
  clearPageWarmTimer()
  clearComponentWarmTimer()
  lastPageWarmKey = ""
  lastComponentWarmKey = ""
  void cancelWarmPageThumbs().catch(() => undefined)
})
</script>

<template>
  <WorkspaceChrome>
    <template #header>
      <WorkspaceHeader
        :session="session"
        :runtime="runtime"
        :open-paths="openPaths"
        :sessions="sessions"
        :active="active"
        :on-select-route="onSelectRoute"
        :on-select-rail="onSelectRail"
        :on-select-project="onSelectProject"
        :on-open-project-window="onOpenProjectWindow"
        :on-open-composer-design-tools="openComposerDesignTools"
        :on-toggle-agent="toggleAgentPanel"
        :agent-open="agentOpen"
        :show-composer-viewport-controls="session.rail === 'composer' && composerPreviewImmersive"
        :preview-isolated-device="previewIsolatedDevice"
        :on-device-change="onDeviceChange"
        :on-preview-isolate-change="onPreviewIsolateChange"
        :on-refresh-scan="onRefreshScan"
        :active-composer-document="session.rail === 'composer' ? activeComposerDocument : null"
      />
    </template>
    <template #rail>
      <WorkspaceRail
        :active="session.rail"
        :project-path="session.root"
        :runtime="runtime"
        :shortcut-active="active !== false"
        :on-select="onSelectRail"
        :on-home="onHome"
      />
    </template>
    <template #main>
      <div class="flex h-full min-h-0 min-w-0 flex-1">
        <!-- Must be a flex column with definite height so surfaces (Stage/iframe) can flex-1 stretch. -->
        <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ComposerSurface
            v-if="session.rail === 'composer'"
            ref="composerSurfaceRef"
            :project-path="session.root"
            :selected-route="session.selectedRoute"
            :pages="session.scan?.pages ?? []"
            :components="session.scan?.components ?? []"
            :layouts="session.scan?.layouts ?? []"
            :device="session.device"
            :runtime="runtime"
            :active="active"
            :preview-isolated-device="previewIsolatedDevice"
            :agent-shell-context="agentShellContext"
            @device-change="onDeviceChange"
            @preview-immersive-change="composerPreviewImmersive = $event"
            @exit-standalone="onSelectRail('components')"
            @active-document-change="activeComposerDocument = $event"
          />
          <PagesSurface
            v-else-if="session.rail === 'pages'"
            :pages="session.scan?.pages ?? []"
            :layouts="session.scan?.layouts ?? []"
            :loading="session.scanLoading"
            :error="session.scanError"
            :selected-route="session.selectedRoute"
            :project-root="session.root"
            :preview-url="runtime?.status === 'live' ? runtime.previewUrl : null"
            :on-select-route="onSelectRoute"
            :on-refresh="onRefreshScan"
          />
          <ComponentsSurface
            v-else-if="session.rail === 'components'"
            :key="session.root"
            :components="session.scan?.components ?? []"
            :loading="session.scanLoading"
            :error="session.scanError"
            :project-root="session.root"
            :on-refresh="onRefreshScan"
            :on-open-composer="openComponentInComposer"
            :on-open-usage="openStudioUsageInComposer"
          />
          <LayoutsSurface
            v-else-if="session.rail === 'layouts'"
            :key="`layouts:${session.root}`"
            :layouts="session.scan?.layouts ?? []"
            :loading="session.scanLoading"
            :error="session.scanError"
            :project-root="session.root"
            :on-refresh="onRefreshScan"
            :on-open-composer="() => onSelectRail('composer')"
            :on-open-usage="openStudioUsageInComposer"
          />
      <MediaSurface
        v-else-if="session.rail === 'media'"
        :key="`media:${session.root}`"
        :project-root="session.root"
      />
      <CollectionsSurface
        v-else-if="session.rail === 'collections'"
        :key="`collections:${session.root}`"
        :project-root="session.root"
      />
      <DesignSurface
        v-else-if="session.rail === 'design'"
        :key="`design:${session.root}`"
        :project-root="session.root"
      />
      <SettingsSurface
        v-else-if="session.rail === 'settings'"
        :key="`settings:${session.root}`"
        :project-root="session.root"
        :settings="session.siteSettings"
        :settings-error="session.settingsError"
        @saved="onSiteSettingsSaved"
      />
      <RailPlaceholder
        v-else
        :rail="(session.rail as PlaceholderRailId)"
      />
        </div>
        <AgentDockedPanel
          v-if="agentOpen && agentDocked && session.rail !== 'composer'"
          :project-path="session.root"
          :shell-context="agentShellContext"
        />
      </div>
      <AgentFloatingSheet
        v-if="!agentDocked && session.rail !== 'composer'"
        :project-path="session.root"
        :shell-context="agentShellContext"
      />
    </template>
  </WorkspaceChrome>
</template>
