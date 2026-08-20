<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  PageHeader,
  StudioLeftRailReveal,
  StudioPanelShell,
} from "@/workspace/studio/core"
import AppearanceSettingsView from "@/workspace/settings/AppearanceSettingsView.vue"
import AnalyticsSettingsView from "@/workspace/settings/AnalyticsSettingsView.vue"
import DiscoverySettingsView from "@/workspace/settings/DiscoverySettingsView.vue"
import GeneralSettingsView from "@/workspace/settings/GeneralSettingsView.vue"
import ImportExportSettingsView from "@/workspace/settings/ImportExportSettingsView.vue"
import LocalizationSettingsView from "@/workspace/settings/LocalizationSettingsView.vue"
import SEOSettingsView from "@/workspace/settings/SEOSettingsView.vue"
import SettingsOrganizerRail from "@/workspace/settings/SettingsOrganizerRail.vue"
import SnippetsSettingsView from "@/workspace/settings/SnippetsSettingsView.vue"
import HistorySurface from "@/workspace/history/HistorySurface.vue"
import AgentSettingsView from "@/workspace/agent/settings/AgentSettingsView.vue"
import { useAgentPanel } from "@/workspace/agent"
import type { SettingsTabId, SiteSettings } from "@/workspace/settings/types"
import { m } from "@/paraglide/messages.js"
import {
  guardDirtyNavigation,
  registerDirtyState,
} from "@/workspace/dirtyState"

const props = defineProps<{
  projectRoot: string
  settings: SiteSettings
  settingsError?: string | null
}>()

const emit = defineEmits<{
  saved: [settings: SiteSettings]
}>()

const agentPanel = useAgentPanel()
const currentSection = ref<SettingsTabId>(
  agentPanel.requestedSettingsTab.value ?? "general",
)

async function consumeAgentSettingsRequest() {
  const tab = agentPanel.consumeRequestedSettingsTab()
  if (tab && (tab === currentSection.value || await guardDirtyNavigation(props.projectRoot))) {
    currentSection.value = tab
  }
}

onMounted(() => {
  void consumeAgentSettingsRequest()
})

watch(
  () => agentPanel.requestedSettingsTab.value,
  () => {
    void consumeAgentSettingsRequest()
  },
)

const saving = ref(false)

const generalRef = ref<{
  save: () => Promise<boolean>
  reset: () => void
  saving: boolean
  isDirty: () => boolean
} | null>(null)

const localizationRef = ref<{
  save: () => Promise<boolean>
  reset: () => void
  saving: boolean
  isDirty: () => boolean
} | null>(null)

const snippetsRef = ref<{
  save: () => Promise<boolean>
  reset: () => void
  saving: boolean
  addSnippet: () => void
  isDirty: () => boolean
} | null>(null)

const seoRef = ref<{
  save: () => Promise<boolean>
  reset: () => void
  saving: boolean
  isDirty: () => boolean
} | null>(null)

const discoveryRef = ref<{
  save: () => Promise<boolean>
  reset: () => void
  saving: boolean
  isDirty: () => boolean
} | null>(null)

const headerTitle = computed((): string => {
  switch (currentSection.value) {
    case "general":
      return m.settings_meta_general_title()
    case "localization":
      return m.settings_meta_localization_title()
    case "appearance":
      return m.settings_meta_appearance_title()
    case "snippets":
      return m.settings_meta_snippets_title()
    case "analytics":
      return m.settings_meta_analytics_title()
    case "seo":
      return m.settings_meta_seo_title()
    case "discovery":
      return m.settings_meta_discovery_title()
    case "agent":
      return m.settings_meta_agent_title()
    case "import-export":
      return m.settings_meta_import_export_title()
    case "history":
      return m.history_title()
    default: {
      const _exhaustive: never = currentSection.value
      return _exhaustive
    }
  }
})

const headerDescription = computed((): string => {
  switch (currentSection.value) {
    case "general":
      return m.settings_meta_general_description()
    case "localization":
      return m.settings_meta_localization_description()
    case "appearance":
      return m.settings_meta_appearance_description()
    case "snippets":
      return m.settings_meta_snippets_description()
    case "analytics":
      return m.settings_meta_analytics_description()
    case "seo":
      return m.settings_meta_seo_description()
    case "discovery":
      return m.settings_meta_discovery_description()
    case "agent":
      return m.settings_meta_agent_description()
    case "import-export":
      return m.settings_meta_import_export_description()
    case "history":
      return m.history_description()
    default: {
      const _exhaustive: never = currentSection.value
      return _exhaustive
    }
  }
})

const showSave = computed(
  () =>
    currentSection.value === "general" ||
    currentSection.value === "localization" ||
    currentSection.value === "snippets" ||
    currentSection.value === "seo" ||
    currentSection.value === "discovery",
)

const showAddSnippet = computed(() => currentSection.value === "snippets")
const showAnalyticsActions = computed(
  () => currentSection.value === "analytics",
)
const showAgentActions = computed(() => currentSection.value === "agent")
const showImportExportActions = computed(
  () => currentSection.value === "import-export",
)
const showLocalizationActions = computed(
  () => currentSection.value === "localization",
)
const showHeaderActions = computed(
  () =>
    showSave.value ||
    showAddSnippet.value ||
    showAnalyticsActions.value ||
    showAgentActions.value ||
    showImportExportActions.value,
)

function activeEditor() {
  return currentSection.value === "general"
    ? generalRef.value
    : currentSection.value === "localization"
      ? localizationRef.value
    : currentSection.value === "snippets"
      ? snippetsRef.value
      : currentSection.value === "seo"
        ? seoRef.value
        : currentSection.value === "discovery"
          ? discoveryRef.value
          : null
}

watch(
  () => props.projectRoot,
  (projectRoot, _previous, onCleanup) => {
    const unregister = registerDirtyState(projectRoot, "settings", {
      label: m.settings_dirty_label(),
      isDirty: () => activeEditor()?.isDirty() ?? false,
      save: () => activeEditor()?.save() ?? true,
      discard: () => activeEditor()?.reset(),
    })
    onCleanup(unregister)
  },
  { immediate: true },
)

async function onSelectSection(section: SettingsTabId) {
  if (section === currentSection.value || await guardDirtyNavigation(props.projectRoot)) {
    currentSection.value = section
  }
}

function onAddSnippet() {
  snippetsRef.value?.addSnippet()
}

async function onSave() {
  if (saving.value || props.settingsError) return
  const active = activeEditor()
  if (!active?.save) return
  saving.value = true
  try {
    await active.save()
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <StudioPanelShell variant="rail" content-class="bg-background">
    <template #rail>
      <StudioLeftRailReveal>
        <SettingsOrganizerRail
          :active-section="currentSection"
          @select-section="onSelectSection"
        />
      </StudioLeftRailReveal>
    </template>

    <HistorySurface
      v-if="currentSection === 'history'"
      :project-root="projectRoot"
    />

    <div v-else class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        :title="headerTitle"
        :description="headerDescription"
        hide-search
        hide-create
      >
        <template v-if="showHeaderActions" #actions>
          <div class="flex items-center gap-2">
            <div
              v-if="
                showAnalyticsActions ||
                showAgentActions ||
                showImportExportActions ||
                showLocalizationActions
              "
              id="settings-tab-actions"
              class="flex items-center gap-2"
            />
            <Button
              v-if="showAddSnippet"
              type="button"
              variant="outline"
              size="md"
              :disabled="saving || Boolean(settingsError)"
              @click="onAddSnippet"
            >
              <AppIcon name="plus" :size="14" />
              {{ m.settings_snippets_add() }}
            </Button>
            <Button
              v-if="showSave"
              type="button"
              variant="default"
              size="md"
              :disabled="saving || Boolean(settingsError)"
              @click="onSave"
            >
              {{ saving ? m.settings_saving() : m.settings_done() }}
            </Button>
          </div>
        </template>
      </PageHeader>

      <div
        class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
        :class="
          currentSection === 'discovery' ||
          currentSection === 'agent' ||
          currentSection === 'import-export'
            ? 'pb-0'
            : 'px-7 pb-7 pt-2'
        "
      >
        <p
          v-if="settingsError"
          class="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          :class="currentSection === 'discovery' ? 'mx-7 mt-2' : ''"
        >
          Settings could not be read. Retry the project load before saving.
          <span class="mt-1 block wrap-break-word text-xs text-muted-foreground">
            {{ settingsError }}
          </span>
        </p>

        <div
          v-if="
            currentSection !== 'discovery' &&
            currentSection !== 'agent' &&
            currentSection !== 'import-export'
          "
          class="mx-auto w-full max-w-4xl"
        >
          <GeneralSettingsView
            v-if="currentSection === 'general'"
            ref="generalRef"
            :project-root="projectRoot"
            :settings="settings"
            @saved="emit('saved', $event)"
          />

          <AppearanceSettingsView
            v-else-if="currentSection === 'appearance'"
          />

          <LocalizationSettingsView
            v-else-if="currentSection === 'localization'"
            ref="localizationRef"
            :project-root="projectRoot"
            :settings="settings"
            @saved="emit('saved', $event)"
          />

          <SnippetsSettingsView
            v-else-if="currentSection === 'snippets'"
            ref="snippetsRef"
            :project-root="projectRoot"
            :settings="settings"
            @saved="emit('saved', $event)"
          />

          <AnalyticsSettingsView
            v-else-if="currentSection === 'analytics'"
            :project-root="projectRoot"
            :settings="settings"
            @saved="emit('saved', $event)"
          />

          <SEOSettingsView
            v-else-if="currentSection === 'seo'"
            ref="seoRef"
            :project-root="projectRoot"
            :settings="settings"
            @saved="emit('saved', $event)"
          />
        </div>

        <DiscoverySettingsView
          v-else-if="currentSection === 'discovery'"
          ref="discoveryRef"
          :project-root="projectRoot"
          :settings="settings"
          @saved="emit('saved', $event)"
        />

        <AgentSettingsView
          v-else-if="currentSection === 'agent'"
          :project-path="projectRoot"
        />

        <ImportExportSettingsView
          v-else-if="currentSection === 'import-export'"
          :project-root="projectRoot"
        />
      </div>
    </div>
  </StudioPanelShell>
</template>
