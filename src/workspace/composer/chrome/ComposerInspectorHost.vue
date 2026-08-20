<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { AppIconName } from "@/icons/registry"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import ComposerDesignPanel from "../design/ComposerDesignPanel.vue"
import ComposerDesignToolsDialog from "../design/ComposerDesignToolsDialog.vue"
import ComposerMotionPanel from "../motion/ComposerMotionPanel.vue"
import ComposerPropsPanel from "../props/ComposerPropsPanel.vue"
import ComposerInspectorHeader from "./ComposerInspectorHeader.vue"
import { provideInspectorContext } from "../inspector/useInspectorContext"
import { tryUseComposerBeacon } from "../selection/useComposerBeacon"

type InspectorTabId = "design" | "motion" | "props"

const beacon = tryUseComposerBeacon()
const inspector = provideInspectorContext()
const activeTab = ref<InspectorTabId>("design")
const designToolsOpen = ref(false)
const tabButtons = ref<Partial<Record<InspectorTabId, HTMLButtonElement>>>({})
const isContextSelection = computed(() => Boolean(inspector?.isContextSelection.value))
const isLayoutSelection = computed(
  () =>
    inspector?.selectedNode.value?.id === "layout" ||
    inspector?.selectedPath.value === "@layout",
)
const isPropsOnlySelection = computed(
  () => isContextSelection.value || isLayoutSelection.value,
)

watch(
  () => [
    inspector?.selectedNode.value?.kind,
    isPropsOnlySelection.value,
  ] as const,
  ([kind, propsOnly]) => {
    if (kind === "comment" || propsOnly) activeTab.value = "props"
  },
  { immediate: true },
)

const tabs: Array<{ id: InspectorTabId; label: () => string; icon: AppIconName }> =
  [
    {
      id: "design",
      label: () => m.composer_inspector_tab_design(),
      icon: "design",
    },
    {
      id: "props",
      label: () => m.composer_inspector_tab_props(),
      icon: "inspectorTabProps",
    },
    {
      id: "motion",
      label: () => m.composer_inspector_tab_motion(),
      icon: "lightning",
    },
  ]

const hasSelection = computed(() => Boolean(beacon?.hasSelection.value))

function openDesignTools() {
  designToolsOpen.value = true
}

function setTabButton(id: InspectorTabId, element: unknown) {
  if (element instanceof HTMLButtonElement) tabButtons.value[id] = element
}

async function activateTab(id: InspectorTabId, focus = false) {
  if (isPropsOnlySelection.value && id !== "props") return
  activeTab.value = id
  if (focus) {
    await nextTick()
    tabButtons.value[id]?.focus()
  }
}

defineExpose({ activateTab, openDesignTools })

function onTabKeydown(event: KeyboardEvent, index: number) {
  if (isPropsOnlySelection.value) return
  let next = index
  if (event.key === "ArrowRight") next = (index + 1) % tabs.length
  else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length
  else if (event.key === "Home") next = 0
  else if (event.key === "End") next = tabs.length - 1
  else return
  event.preventDefault()
  void activateTab(tabs[next]!.id, true)
}
</script>

<template>
  <aside
    class="flex h-full min-h-0 w-70 min-w-70 max-w-70 shrink-0 flex-col overflow-hidden border-l border-dashed border-border/70 bg-background dark:bg-sidebar"
    data-aria-composer-inspector
  >
    <TooltipProvider :delay-duration="0" :skip-delay-duration="0">
      <div class="flex min-h-0 flex-1 flex-col">
        <div
          class="grid h-12 shrink-0 grid-cols-3 border-b border-dashed border-border bg-background dark:bg-sidebar"
          role="tablist"
          :aria-label="m.composer_inspector_title()"
          data-aria-composer-inspector-tabs
        >
          <Tooltip v-for="(tab, index) in tabs" :key="tab.id">
            <TooltipTrigger as-child>
              <button
                :ref="(element) => setTabButton(tab.id, element)"
                type="button"
                role="tab"
                :id="`composer-inspector-tab-${tab.id}`"
                :aria-label="tab.label()"
                :aria-controls="`composer-inspector-panel-${tab.id}`"
                :aria-selected="activeTab === tab.id"
                :disabled="isPropsOnlySelection && tab.id !== 'props'"
                :tabindex="activeTab === tab.id ? 0 : -1"
                :class="
                  cn(
                    'relative flex min-w-0 items-center justify-center overflow-hidden px-1 transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
                    activeTab === tab.id
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                    isPropsOnlySelection && tab.id !== 'props' && 'cursor-not-allowed opacity-35 hover:text-muted-foreground',
                  )
                "
                @click="activateTab(tab.id)"
                @keydown="onTabKeydown($event, index)"
              >
                <AppIcon :name="tab.icon" :size="18" aria-hidden="true" />
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
        <ComposerInspectorHeader />

        <div class="min-h-0 flex-1 overflow-hidden">
          <div
            v-if="!hasSelection"
            class="flex flex-col items-center justify-center gap-3 px-2 py-10 text-center"
          >
            <div
              class="flex size-11 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/30"
            >
              <AppIcon name="cursor" :size="20" class="text-muted-foreground" />
            </div>
            <div class="space-y-1">
              <p class="text-sm font-medium text-foreground">
                {{ m.composer_inspector_empty_title() }}
              </p>
              <p class="text-xs leading-relaxed text-muted-foreground">
                {{ m.composer_inspector_empty_body() }}
              </p>
            </div>
          </div>

          <template v-else>
            <section
              id="composer-inspector-panel-design"
              v-show="activeTab === 'design'"
              role="tabpanel"
              aria-labelledby="composer-inspector-tab-design"
              class="h-full min-h-0"
              :tabindex="activeTab === 'design' ? 0 : -1"
            >
              <ComposerDesignPanel />
            </section>
            <section
              id="composer-inspector-panel-motion"
              v-show="activeTab === 'motion'"
              role="tabpanel"
              aria-labelledby="composer-inspector-tab-motion"
              class="h-full min-h-0 overflow-y-auto px-3 py-4"
              :tabindex="activeTab === 'motion' ? 0 : -1"
            >
              <ComposerMotionPanel />
            </section>
            <section
              id="composer-inspector-panel-props"
              v-show="activeTab === 'props'"
              role="tabpanel"
              aria-labelledby="composer-inspector-tab-props"
              class="h-full min-h-0 overflow-y-auto"
              :tabindex="activeTab === 'props' ? 0 : -1"
            >
              <ComposerPropsPanel />
            </section>
          </template>
        </div>
      </div>
    </TooltipProvider>
    <ComposerDesignToolsDialog v-model:open="designToolsOpen" />
  </aside>
</template>
