<script setup lang="ts">
import { computed } from "vue"
import {
  FlickeringNavItem,
  StudioSectionNavRail,
} from "@/workspace/studio/core"
import { m } from "@/paraglide/messages.js"
import {
  SETTINGS_TAB_ORDER,
  SETTINGS_WORKSPACE_TAB_ORDER,
  type SettingsTabId,
} from "./types"

const props = defineProps<{
  activeSection: SettingsTabId
}>()

const emit = defineEmits<{
  selectSection: [section: SettingsTabId]
}>()

function labelFor(id: SettingsTabId): string {
  switch (id) {
    case "general":
      return m.settings_tab_general()
    case "localization":
      return m.settings_tab_localization()
    case "appearance":
      return m.settings_tab_appearance()
    case "snippets":
      return m.settings_tab_snippets()
    case "analytics":
      return m.settings_tab_analytics()
    case "seo":
      return m.settings_tab_seo()
    case "discovery":
      return m.settings_tab_discovery()
    case "agent":
      return m.settings_tab_agent()
    case "import-export":
      return m.settings_tab_import_export()
    case "history":
      return m.history_title()
    default: {
      const _exhaustive: never = id
      return _exhaustive
    }
  }
}

const items = computed(() =>
  SETTINGS_TAB_ORDER.map((id) => ({
    id,
    label: labelFor(id),
  })),
)

const workspaceItems = computed(() =>
  SETTINGS_WORKSPACE_TAB_ORDER.map((id) => ({
    id,
    label: labelFor(id),
  })),
)

const GROUP_HEADING_CLASS =
  "flex h-10 shrink-0 items-center bg-primary/10 px-5 text-[10.5px] font-medium uppercase tracking-wide text-primary inset-shadow-xs"

function onSelect(id: string) {
  emit("selectSection", id as SettingsTabId)
}
</script>

<template>
  <StudioSectionNavRail
    :title="m.settings_dialog_title()"
    :active-key="props.activeSection"
    :nav-aria-label="m.settings_nav_label()"
  >
    <template #default="{ bindItemRef, onItemEnter, activeKey }">
      <div class="flex min-h-full flex-col">
        <p :class="GROUP_HEADING_CLASS">
          {{ m.settings_group_site() }}
        </p>
        <FlickeringNavItem
          v-for="(item, index) in items"
          :key="item.id"
          :ref="bindItemRef(item.id)"
          :active="activeKey === item.id"
          :class="['py-4.5', index === 0 && 'border-t']"
          @mouseenter="onItemEnter(item.id)"
          @click="onSelect(item.id)"
        >
          <span class="min-w-0 truncate text-sm font-regular">
            {{ item.label }}
          </span>
        </FlickeringNavItem>

        <div class="pb-2">
          <p :class="GROUP_HEADING_CLASS">
            {{ m.settings_group_workspace() }}
          </p>
          <FlickeringNavItem
            v-for="(item, index) in workspaceItems"
            :key="item.id"
            :ref="bindItemRef(item.id)"
            :active="activeKey === item.id"
            :class="['py-4.5', index === 0 && 'border-t']"
            @mouseenter="onItemEnter(item.id)"
            @click="onSelect(item.id)"
          >
            <span class="min-w-0 truncate text-sm font-regular">
              {{ item.label }}
            </span>
          </FlickeringNavItem>
        </div>
      </div>
    </template>
  </StudioSectionNavRail>
</template>
