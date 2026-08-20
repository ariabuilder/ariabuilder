<script setup lang="ts">
import { computed, toRef, type ComponentPublicInstance } from "vue"
import AriaBadgeMark from "@/components/brand/AriaBadgeMark.vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import ShortcutHint from "@/components/ui/ShortcutHint.vue"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { AppIconName } from "@/icons/registry"
import { useKeyboardShortcut } from "@/composables/useKeyboardShortcut"
import {
  AppShortcuts,
  ariaKeyShortcuts,
  formatShortcut,
  type ShortcutDefinition,
} from "@/lib/keyboardShortcuts"
import type { ProjectRuntimeSession } from "@/lib/sessions"
import {
  SlidingNavIndicator,
  resolveButtonEl,
  useSlidingNavIndicator,
} from "@/workspace/studio/core"
import WorkspaceGitControl from "@/workspace/WorkspaceGitControl.vue"
import WorkspaceServerControl from "@/workspace/WorkspaceServerControl.vue"
import WorkspaceTerminalControl from "@/workspace/WorkspaceTerminalControl.vue"
import type { WorkspaceRailId } from "@/workspace/types"
import { m } from "@/paraglide/messages.js"

const props = defineProps<{
  active: WorkspaceRailId
  projectPath: string
  runtime: ProjectRuntimeSession | null
  shortcutActive?: boolean
  onSelect: (id: WorkspaceRailId) => Promise<void> | void
  onHome: () => void
}>()

type RailItem = {
  id: WorkspaceRailId
  icon: AppIconName
  label: () => string
  shortcut: ShortcutDefinition
}

const items: RailItem[] = [
  {
    id: "composer",
    icon: "composer",
    label: () => m.rail_composer(),
    shortcut: AppShortcuts.railComposer,
  },
  {
    id: "pages",
    icon: "pages",
    label: () => m.rail_pages(),
    shortcut: AppShortcuts.railPages,
  },
  {
    id: "components",
    icon: "components",
    label: () => m.rail_components(),
    shortcut: AppShortcuts.railComponents,
  },
  {
    id: "layouts",
    icon: "layouts",
    label: () => m.rail_layouts(),
    shortcut: AppShortcuts.railLayouts,
  },
  {
    id: "collections",
    icon: "collections",
    label: () => m.rail_collections(),
    shortcut: AppShortcuts.railCollections,
  },
  {
    id: "media",
    icon: "media",
    label: () => m.rail_media(),
    shortcut: AppShortcuts.railMedia,
  },
  {
    id: "design",
    icon: "design",
    label: () => m.rail_design(),
    shortcut: AppShortcuts.railDesign,
  },
]

const settingsItem: RailItem = {
  id: "settings",
  icon: "settings",
  label: () => m.rail_settings(),
  shortcut: AppShortcuts.settings,
}

for (const item of [...items, settingsItem]) {
  useKeyboardShortcut(item.shortcut, () => props.onSelect(item.id), {
    enabled: computed(() => props.shortcutActive !== false),
  })
}

const {
  navRef,
  indicator,
  indicatorAnimated,
  registerButton,
  onItemEnter,
  onNavLeave,
} = useSlidingNavIndicator({
  enabled: true,
  activeKey: toRef(props, "active"),
})

function bindNavRef(el: unknown) {
  navRef.value = el instanceof HTMLElement ? el : null
}

function bindButtonRef(id: WorkspaceRailId) {
  return (el: Element | ComponentPublicInstance | null) => {
    registerButton(id, resolveButtonEl(el))
  }
}
</script>

<template>
  <aside class="flex h-full w-12 shrink-0 flex-col border-r border-border border-dashed bg-sidebar text-foreground">
    <div class="flex shrink-0 justify-center pt-2.5">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            :aria-label="m.workspace_nav_home()"
            class="text-foreground hover:bg-transparent! bg-transparent cursor-pointer"
            @click="onHome"
          >
            <AriaBadgeMark class="w-auto select-none" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="8">
          {{ m.workspace_nav_home() }}
        </TooltipContent>
      </Tooltip>
    </div>

    <nav
      :ref="bindNavRef"
      class="relative flex min-h-0 flex-1 flex-col items-center"
      :aria-label="m.rail_nav_label()"
      @mouseleave="onNavLeave"
    >
      <SlidingNavIndicator
        :visible="indicator.visible"
        :top="indicator.top"
        :height="indicator.height"
        :animated="indicatorAnimated"
      />

      <div
        class="flex flex-1 flex-col items-center justify-center gap-1 self-stretch"
      >
        <Tooltip v-for="item in items" :key="item.id">
          <TooltipTrigger as-child>
            <Button
              :ref="bindButtonRef(item.id)"
              type="button"
              :variant="item.id === active ? 'nav-active' : 'nav'"
              size="icon-lg"
              :aria-label="item.label()"
              :aria-keyshortcuts="ariaKeyShortcuts(item.shortcut)"
              :aria-current="item.id === active ? 'page' : undefined"
              class="relative w-full overflow-visible rounded-none cursor-pointer"
              @click="onSelect(item.id)"
              @mouseenter="onItemEnter(item.id)"
            >
              <AppIcon :name="item.icon" :size="18" />
              <ShortcutHint
                class="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap border-border bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow-md"
              >
                {{ formatShortcut(item.shortcut) }}
              </ShortcutHint>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" :side-offset="8">
            {{ item.label() }}
          </TooltipContent>
        </Tooltip>
      </div>

    </nav>

    <div class="flex shrink-0 flex-col items-center gap-1 pb-2.5 pt-1">
      <WorkspaceTerminalControl
        :project-path="projectPath"
        :shortcut-active="shortcutActive"
      />
      <WorkspaceGitControl
        :project-path="projectPath"
        :shortcut-active="shortcutActive"
      />
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            type="button"
            :variant="active === settingsItem.id ? 'nav-active' : 'nav'"
            size="icon-lg"
            :aria-label="settingsItem.label()"
            :aria-keyshortcuts="ariaKeyShortcuts(settingsItem.shortcut)"
            :aria-current="active === settingsItem.id ? 'page' : undefined"
            class="relative w-full overflow-visible rounded-none cursor-pointer"
            @click="onSelect(settingsItem.id)"
          >
            <AppIcon :name="settingsItem.icon" :size="18" />
            <ShortcutHint
              class="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap border-border bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow-md"
            >
              {{ formatShortcut(settingsItem.shortcut) }}
            </ShortcutHint>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="8">
          {{ settingsItem.label() }}
        </TooltipContent>
      </Tooltip>
      <WorkspaceServerControl
        :project-path="projectPath"
        :runtime="runtime"
      />
    </div>
  </aside>
</template>
