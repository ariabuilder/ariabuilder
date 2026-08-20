<script setup lang="ts">
import { computed, nextTick, ref, type ComponentPublicInstance } from "vue"
import type {
  ComposerLayerRow,
  ComposerLayerTreeProjection,
} from "../../../../shared/composer/layers"
import type { ScanComponent } from "@/workspace/types"
import type { AgentShellContext } from "../../../../shared/agent"
import AgentComposerDock from "@/workspace/agent/components/AgentComposerDock.vue"
import { useAriaAgent } from "@/workspace/agent/composables/useAriaAgent"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { AppIconName } from "@/icons/registry"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import ComposerLayersTree from "../structure/ComposerLayersTree.vue"
import ComposerPaletteHost from "./ComposerPaletteHost.vue"
import {
  composerLibraryPanelState,
  type ComposerLeftTab,
  type ComposerLibraryPanelState,
  type ComposerLibraryTab,
} from "./libraryDragPanel"

type LeftTabId = ComposerLeftTab

const props = withDefaults(
  defineProps<{
    tree: ComposerLayerTreeProjection
    components?: ScanComponent[]
    loading?: boolean
    error?: string | null
    bailReason?: string | null
    designActive?: boolean
    editable?: boolean
    canMoveUp?: boolean
    canMoveDown?: boolean
    editFile?: string | null
    projectPath: string
    agentShellContext?: AgentShellContext
  }>(),
  {
    components: () => [],
    designActive: true,
    editable: false,
    canMoveUp: false,
    canMoveDown: false,
    editFile: null,
  },
)

const emit = defineEmits<{
  "structure-action": [id: string]
  "structure-open": [row: ComposerLayerRow]
  "structure-navigate": [
    row: ComposerLayerRow,
    open: boolean,
  ]
}>()

const activeTab = ref<LeftTabId>("layers")
const libraryDragSource = ref<ComposerLibraryTab | null>(null)
const layersQuery = ref("")
const layersRef = ref<InstanceType<typeof ComposerLayersTree> | null>(null)
const tabButtons = ref<Partial<Record<LeftTabId, HTMLButtonElement>>>({})
const agent = useAriaAgent(() => props.projectPath)
const agentWorkingInBackground = computed(
  () => agent.isStreaming.value && activeTab.value !== "agent",
)

const tabs: Array<{ id: LeftTabId; label: () => string; icon: AppIconName }> = [
  {
    id: "layers",
    label: () => m.composer_left_layers(),
    icon: "layers",
  },
  {
    id: "add-elements",
    label: () => m.composer_left_add_elements(),
    icon: "addCircle",
  },
  {
    id: "agent",
    label: () => m.composer_left_agent(),
    icon: "sparkles",
  },
]

function activateTab(tab: LeftTabId, focus = false) {
  activeTab.value = tab
  if (focus) void nextTick(() => tabButtons.value[tab]?.focus())
}

function setTabButton(
  tab: LeftTabId,
  element: Element | ComponentPublicInstance | null,
) {
  if (element instanceof HTMLButtonElement) tabButtons.value[tab] = element
  else delete tabButtons.value[tab]
}

function onTabKeydown(event: KeyboardEvent, current: LeftTabId) {
  const index = tabs.findIndex((tab) => tab.id === current)
  if (index < 0) return
  let next = index
  if (event.key === "ArrowRight") next = (index + 1) % tabs.length
  else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length
  else if (event.key === "Home") next = 0
  else if (event.key === "End") next = tabs.length - 1
  else return
  event.preventDefault()
  activateTab(tabs[next]!.id, true)
}

function onLibraryDragBegin() {
  // Do not switch panels during a native drag. Chromium can cancel the drag
  // when the rendered source subtree is hidden, moved, or restyled.
  if (activeTab.value === "agent") return
  libraryDragSource.value = activeTab.value
}

function onLibraryDragEnd() {
  libraryDragSource.value = null
}

function libraryPanelState(tab: ComposerLibraryTab): ComposerLibraryPanelState {
  return composerLibraryPanelState(
    tab,
    activeTab.value,
    libraryDragSource.value,
  )
}

function libraryPanelClass(tab: ComposerLibraryTab): string {
  const state = libraryPanelState(tab)
  return cn(
    "flex min-h-0 flex-1 flex-col",
    state === "drag-source" &&
      "pointer-events-none absolute inset-0 opacity-0",
    state === "hidden" && "hidden",
  )
}
</script>

<template>
  <aside
    class="flex h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden border-r border-dashed border-border bg-background"
    data-aria-composer-left
    :data-design-active="props.designActive !== false ? '1' : '0'"
  >
    <TooltipProvider :delay-duration="0" :skip-delay-duration="0">
      <div
        class="grid h-12 shrink-0 grid-cols-3 border-b border-dashed border-border bg-background dark:bg-sidebar"
        role="tablist"
        aria-label="Composer panels"
      >
        <Tooltip v-for="tab in tabs" :key="tab.id">
          <TooltipTrigger as-child>
            <button
              :id="`composer-${tab.id}-tab`"
              :ref="(element) => setTabButton(tab.id, element)"
              type="button"
              role="tab"
              :tabindex="activeTab === tab.id ? 0 : -1"
              :aria-label="tab.label()"
              :aria-selected="activeTab === tab.id"
              :aria-controls="`composer-${tab.id}-panel`"
              :class="
                cn(
                  'relative flex min-w-0 items-center justify-center overflow-hidden px-1 transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
                  activeTab === tab.id
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )
              "
              @click="activateTab(tab.id)"
              @keydown="onTabKeydown($event, tab.id)"
            >
              <AppIcon
                :name="tab.icon"
                :size="18"
                aria-hidden="true"
                :class="
                  tab.id === 'agent' && agentWorkingInBackground
                    ? 'text-primary animate-pulse motion-reduce:animate-none'
                    : undefined
                "
              />
              <span
                aria-hidden="true"
                :class="
                  cn(
                    'pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary transition-transform duration-150 motion-reduce:transition-none',
                    activeTab === tab.id ? 'scale-x-100' : 'scale-x-0',
                  )
                "
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" :side-offset="6">
            {{ tab.label() }}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>

    <div
      v-if="activeTab === 'layers'"
      class="flex h-12 shrink-0 items-center gap-1 border-b border-dashed border-border bg-background/50 px-2 py-2 dark:bg-sidebar/50"
    >
      <div class="relative min-w-0 flex-1">
        <AppIcon
          name="search"
          :size="13"
          class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          v-model="layersQuery"
          type="search"
          :placeholder="m.composer_layers_search()"
          class="h-8! rounded-md border-[0.5px] border-border/60 bg-card/30 pl-7 pr-2 text-xs ring-0 focus:border-border focus:ring-0 focus-visible:border-border focus-visible:ring-[0.5px] focus-visible:ring-ring/70"
          spellcheck="false"
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        class="size-8! rounded-md border-[0.5px] border-transparent ring-0 shadow-none focus-visible:border-border focus-visible:ring-[0.5px] focus-visible:ring-ring/70"
        :aria-label="layersRef?.allExpanded ? m.composer_layers_collapse_all() : m.composer_layers_expand_all()"
        @click="layersRef?.toggleAll()"
      >
        <AppIcon
          :name="layersRef?.allExpanded ? 'chevronDown' : 'chevronUp'"
          :size="13"
          aria-hidden="true"
        />
      </Button>
    </div>

    <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <section
        id="composer-add-elements-panel"
        role="tabpanel"
        aria-labelledby="composer-add-elements-tab"
        :aria-hidden="libraryPanelState('add-elements') === 'hidden' || undefined"
        :data-panel-state="libraryPanelState('add-elements')"
        :class="libraryPanelClass('add-elements')"
      >
        <ComposerPaletteHost
          mode="elements"
          :components="components"
          :editable="editable"
          :design-active="designActive !== false"
          @drag-begin="onLibraryDragBegin"
          @drag-end="onLibraryDragEnd"
        />
      </section>

      <section
        id="composer-layers-panel"
        role="tabpanel"
        aria-labelledby="composer-layers-tab"
        :aria-hidden="libraryPanelState('layers') === 'hidden' || undefined"
        :data-panel-state="libraryPanelState('layers')"
        :class="libraryPanelClass('layers')"
      >
        <ComposerLayersTree
          :key="editFile ?? 'empty-document'"
          ref="layersRef"
          embedded
          :tree="tree"
          :loading="loading"
          :error="error"
          :bail-reason="bailReason"
          :editable="editable && designActive !== false"
          :can-move-up="canMoveUp"
          :can-move-down="canMoveDown"
          :persist-key="editFile"
          :search-query="layersQuery"
          @action="emit('structure-action', $event)"
          @open="emit('structure-open', $event)"
          @navigate="(row, open) => emit('structure-navigate', row, open)"
        />
      </section>

      <section
        id="composer-agent-panel"
        v-show="activeTab === 'agent'"
        role="tabpanel"
        aria-labelledby="composer-agent-tab"
        :aria-hidden="activeTab !== 'agent' || undefined"
        class="flex min-h-0 flex-1 flex-col"
      >
        <AgentComposerDock
          :project-path="projectPath"
          :shell-context="agentShellContext"
        />
      </section>
    </div>
  </aside>
</template>
