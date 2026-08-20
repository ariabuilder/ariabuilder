<script setup lang="ts">
import { computed, ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useWindowFullscreen } from "@/composables/useWindowFullscreen"
import { isMacPlatform } from "@/lib/keyboardShortcuts"
import { cn } from "@/lib/utils"
import type { ProjectRuntimeSession } from "@/lib/sessions"
import { openExternalUrl } from "@/lib/project"
import { previewPageUrl } from "@/lib/preview"
import PageSwitcher from "@/workspace/PageSwitcher.vue"
import ProjectSwitcher from "@/workspace/ProjectSwitcher.vue"
import ViewportControls from "@/workspace/ViewportControls.vue"
import type {
  DevicePreview,
  ProjectSession,
  WorkspaceActiveDocument,
  WorkspaceRailId,
} from "@/workspace/types"
import { m } from "@/paraglide/messages.js"

const props = defineProps<{
  session: ProjectSession
  runtime: ProjectRuntimeSession | null
  openPaths: string[]
  sessions: ProjectRuntimeSession[]
  active?: boolean
  activeComposerDocument?: WorkspaceActiveDocument | null
  showComposerViewportControls?: boolean
  previewIsolatedDevice?: DevicePreview | null
  onSelectRoute: (route: string) => void
  onSelectRail: (rail: WorkspaceRailId) => void
  onSelectProject: (projectPath: string) => void
  onOpenProjectWindow: (projectPath: string) => void
  onOpenComposerDesignTools: () => void
  onToggleAgent: () => void
  agentOpen: boolean
  onDeviceChange: (device: DevicePreview) => void
  onPreviewIsolateChange?: (device: DevicePreview | null) => void
  onRefreshScan: () => Promise<void> | void
}>()

const { fullscreen } = useWindowFullscreen()
const status = computed(() => props.runtime?.status ?? "stopped")

const canOpenPreview = computed(
  () => status.value === "live" && Boolean(props.runtime?.previewUrl),
)

function openPreview() {
  if (!canOpenPreview.value || !props.runtime?.previewUrl) return
  const url = previewPageUrl(props.runtime.previewUrl, props.session.selectedRoute)
  if (url) void openExternalUrl(url).catch((error: unknown) => console.error(error))
}

type SwitcherHandle = { close: () => void }
const projectSwitcherRef = ref<SwitcherHandle | null>(null)
const pageSwitcherRef = ref<SwitcherHandle | null>(null)

function closePageSwitcher() {
  pageSwitcherRef.value?.close()
}

function closeProjectSwitcher() {
  projectSwitcherRef.value?.close()
}
</script>

<template>
  <header
    :class="cn(
      'app-region-drag grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 overflow-visible border-b border-border border-dashed bg-sidebar pr-3 pt-0.5',
      // Reserve space for macOS traffic lights; drop it in native fullscreen.
      // Linux/Windows use a normal title bar — no inset.
      fullscreen || !isMacPlatform() ? 'pl-3' : 'pl-22',
    )"
  >
    <div class="flex min-w-0 items-center gap-2.5 justify-middle">
      <div class="app-region-no-drag min-w-0">
        <ProjectSwitcher
          ref="projectSwitcherRef"
          :label="session.name"
          :current-path="session.root"
          :open-paths="openPaths"
          :sessions="sessions"
          :active="active"
          :on-select="onSelectProject"
          :on-open-in-new-window="onOpenProjectWindow"
          :on-will-open="closePageSwitcher"
        />
      </div>
      <div class="app-region-no-drag">
        <PageSwitcher
          ref="pageSwitcherRef"
          :project-path="session.root"
          :pages="session.scan?.pages ?? []"
          :components="session.scan?.components ?? []"
          :layouts="session.scan?.layouts ?? []"
          :selected-route="session.selectedRoute"
          :current-rail="session.rail"
          :active-document="activeComposerDocument"
          :on-select="onSelectRoute"
          :on-select-rail="onSelectRail"
          :on-refresh="onRefreshScan"
          :disabled="!session.scan"
          :on-will-open="closeProjectSwitcher"
        />
      </div>
    </div>

    <div
      v-if="showComposerViewportControls"
      class="app-region-no-drag flex items-center gap-1.5 justify-self-center overflow-visible"
    >
      <ViewportControls
        :device="previewIsolatedDevice ?? null"
        allow-deselect
        @change="onPreviewIsolateChange?.($event)"
      />
    </div>
    <div v-else aria-hidden class="justify-self-center" />

    <div
      class="app-region-no-drag flex items-center gap-0.5 justify-self-end"
    >
      <Tooltip v-if="session.rail === 'composer'">
        <TooltipTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground/80 hover:text-foreground"
            :aria-label="m.composer_design_tools_title()"
            :title="m.composer_design_tools_title()"
            data-aria-composer-design-tools
            @click="onOpenComposerDesignTools"
          >
            <AppIcon name="design" :size="16" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {{ m.composer_design_tools_title() }}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <!-- Span keeps hover/tooltip working when the button is disabled. -->
          <span
            class="inline-flex shrink-0 text-muted-foreground/80 "
            :class="canOpenPreview ? undefined : 'text-muted-foreground/70 cursor-pointer'"
            tabindex="-1"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :disabled="!canOpenPreview"
              :aria-label="
                canOpenPreview
                  ? m.workspace_open_external()
                  : m.workspace_preview_offline()
              "
              @click="openPreview"
            >
              <AppIcon name="externalLink" :size="16" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {{
            canOpenPreview
              ? m.workspace_open_external()
              : m.workspace_preview_offline()
          }}
        </TooltipContent>
      </Tooltip>
      <Tooltip v-if="session.rail !== 'composer'">
        <TooltipTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground/80 hover:text-foreground"
            :aria-label="`${agentOpen ? 'Close' : 'Open'} ${m.settings_meta_agent_title()}`"
            :aria-pressed="agentOpen"
            data-aria-agent-activation
            @click="onToggleAgent"
          >
            <AppIcon name="sparkles" :size="16" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {{ agentOpen ? "Close" : "Open" }} {{ m.settings_meta_agent_title() }}
        </TooltipContent>
      </Tooltip>
    </div>
  </header>
</template>
