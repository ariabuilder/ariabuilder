<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  getDiscoveryArtifacts,
  getDiscoveryBaseline,
  getDiscoveryReport,
  updateDiscovery,
} from "@/lib/workspace"
import {
  DEFAULT_DISCOVERY_SETTINGS,
  type DiscoveryArtifacts,
  type DiscoveryReport,
  type DiscoverySettings,
} from "../../../shared/crawl"
import SettingsRow from "@/workspace/settings/SettingsRow.vue"
import SeoTakeoverBanner from "@/workspace/settings/SeoTakeoverBanner.vue"
import DiscoveryOverviewPanel from "@/workspace/settings/discovery/DiscoveryOverviewPanel.vue"
import DiscoveryArtifactPanel from "@/workspace/settings/discovery/DiscoveryArtifactPanel.vue"
import DiscoveryRedirectsPanel from "@/workspace/settings/discovery/DiscoveryRedirectsPanel.vue"
import SlugChangeRedirectPrompt from "@/workspace/settings/SlugChangeRedirectPrompt.vue"
import { resolveArtifactCustomSeed } from "@/workspace/settings/lib/discoveryArtifactSeed"
import {
  getArtifactUnavailableReason,
  type DiscoveryArtifactKind,
} from "@/workspace/settings/lib/discoveryArtifactUnavailable"
import {
  DISCOVERY_ARTIFACT_PANEL_CHROME_PX,
  discoveryArtifactEditorHeightPx,
} from "@/workspace/settings/lib/discoveryArtifactEditorLayout"
import { localizeDiscoveryHealthCheck } from "@/workspace/settings/lib/discoveryHealthI18n"
import type { SiteSettings } from "@/workspace/settings/types"
import { m } from "@/paraglide/messages.js"

type DiscoveryTab = "overview" | "files" | "search" | "redirects"

const props = defineProps<{
  projectRoot: string
  settings: SiteSettings
}>()

const emit = defineEmits<{
  saved: [settings: SiteSettings]
}>()

const isLoading = ref(true)
const isApplyingRemoteDiscovery = ref(false)
const isPingToggleSaving = ref(false)
const isSaving = ref(false)
const editingArtifact = ref<DiscoveryArtifactKind | null>(null)
const isArtifactActionLoading = ref(false)
const activeDiscoveryTab = ref<DiscoveryTab>("overview")
const activeArtifact = ref<DiscoveryArtifactKind>("robots")
const report = ref<DiscoveryReport | null>(null)
const artifacts = ref<DiscoveryArtifacts | null>(null)
const error = ref<string | null>(null)
const dirty = ref(false)
/** Distinguish first load / refresh from failed load (avoid infinite skeleton). */
const reportStatus = ref<"idle" | "loading" | "ready" | "error">("idle")

let saveTimer: ReturnType<typeof setTimeout> | null = null
let skipFormWatch = false
/** Serialize flushes so concurrent Done/debounce/unmount don't race. */
let flushChain: Promise<boolean> = Promise.resolve(true)

function normalizeDiscoveryForm(settings: DiscoverySettings): DiscoverySettings {
  return {
    ...settings,
    aiBotPolicy: settings.aiBotPolicy ?? "allow-all",
    sitemapPingOnPublish: settings.sitemapPingOnPublish ?? false,
  }
}

function discoveryFromSettings(source: SiteSettings): DiscoverySettings {
  return normalizeDiscoveryForm({
    ...DEFAULT_DISCOVERY_SETTINGS,
    ...(source.discovery ?? {}),
  })
}

const form = ref<DiscoverySettings>(discoveryFromSettings(props.settings))
const lastSavedForm = ref<DiscoverySettings>({ ...form.value })

function withFormWatchSkipped(run: () => void): void {
  skipFormWatch = true
  try {
    run()
  } finally {
    void nextTick(() => {
      skipFormWatch = false
    })
  }
}

function patchForm(patch: Partial<DiscoverySettings>): void {
  form.value = normalizeDiscoveryForm({
    ...form.value,
    ...patch,
  })
}

const discourageSearchEngines = computed({
  get: () => form.value.discourageSearchEngines,
  set: (value: boolean) => {
    patchForm({ discourageSearchEngines: value })
  },
})

const pingOnPublish = computed({
  get: () => Boolean(form.value.sitemapPingOnPublish),
  set: (next: boolean) => {
    void setSitemapPingOnPublish(next)
  },
})

function buildDiscoveryPatch(
  next: DiscoverySettings,
  previous: DiscoverySettings,
): Partial<DiscoverySettings> {
  return {
    ...(next.sitemapMode !== previous.sitemapMode
      ? { sitemapMode: next.sitemapMode }
      : {}),
    ...(next.sitemapCustom !== previous.sitemapCustom
      ? { sitemapCustom: next.sitemapCustom }
      : {}),
    ...(next.robotsMode !== previous.robotsMode
      ? { robotsMode: next.robotsMode }
      : {}),
    ...(next.robotsCustom !== previous.robotsCustom
      ? { robotsCustom: next.robotsCustom }
      : {}),
    ...(next.includeSitemapInRobots !== previous.includeSitemapInRobots
      ? { includeSitemapInRobots: next.includeSitemapInRobots }
      : {}),
    ...(next.llmsMode !== previous.llmsMode ? { llmsMode: next.llmsMode } : {}),
    ...(next.llmsCustom !== previous.llmsCustom
      ? { llmsCustom: next.llmsCustom }
      : {}),
    ...(next.discourageSearchEngines !== previous.discourageSearchEngines
      ? { discourageSearchEngines: next.discourageSearchEngines }
      : {}),
    ...(next.googleSiteVerification !== previous.googleSiteVerification
      ? { googleSiteVerification: next.googleSiteVerification }
      : {}),
    ...(next.bingSiteVerification !== previous.bingSiteVerification
      ? { bingSiteVerification: next.bingSiteVerification }
      : {}),
    ...(next.trailingSlashPolicy !== previous.trailingSlashPolicy
      ? { trailingSlashPolicy: next.trailingSlashPolicy }
      : {}),
    ...(next.llmsAiPolicy !== previous.llmsAiPolicy
      ? { llmsAiPolicy: next.llmsAiPolicy }
      : {}),
    ...(next.aiBotPolicy !== previous.aiBotPolicy
      ? { aiBotPolicy: next.aiBotPolicy }
      : {}),
    ...(next.sitemapPingOnPublish !== previous.sitemapPingOnPublish
      ? { sitemapPingOnPublish: next.sitemapPingOnPublish }
      : {}),
  }
}

function clearSaveTimer() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

function scheduleSave() {
  dirty.value = true
}

async function flushSave(): Promise<boolean> {
  clearSaveTimer()

  const run = async (): Promise<boolean> => {
    const patch = buildDiscoveryPatch(form.value, lastSavedForm.value)
    if (Object.keys(patch).length === 0) {
      dirty.value = false
      return true
    }

    isSaving.value = true
    error.value = null
    try {
      const next = await updateDiscovery(props.projectRoot, patch)
      const merged = discoveryFromSettings(next)
      lastSavedForm.value = { ...merged }

      // Keep local edits typed during the request; only adopt server form when clean.
      const stillDirty = buildDiscoveryPatch(form.value, merged)
      if (Object.keys(stillDirty).length === 0) {
        withFormWatchSkipped(() => {
          isApplyingRemoteDiscovery.value = true
          try {
            form.value = merged
            dirty.value = false
          } finally {
            isApplyingRemoteDiscovery.value = false
          }
        })
      } else {
        dirty.value = true
      }

      emit("saved", next)
      await refreshDiscoveryData()
      return Object.keys(stillDirty).length === 0
    } catch (err: unknown) {
      error.value =
        err instanceof Error ? err.message : m.settings_discovery_save_failed()
      return false
    } finally {
      isSaving.value = false
    }
  }

  flushChain = flushChain.then(run, run)
  return flushChain
}

async function setSitemapPingOnPublish(next: boolean): Promise<void> {
  if (isPingToggleSaving.value) return

  const previous = Boolean(form.value.sitemapPingOnPublish)
  if (previous === next) return

  clearSaveTimer()
  isPingToggleSaving.value = true
  isApplyingRemoteDiscovery.value = true
  withFormWatchSkipped(() => {
    patchForm({ sitemapPingOnPublish: next })
  })

  try {
    const saved = await updateDiscovery(props.projectRoot, {
      sitemapPingOnPublish: next,
    })
    const merged = discoveryFromSettings(saved)
    lastSavedForm.value = { ...merged }
    withFormWatchSkipped(() => {
      form.value = merged
      dirty.value = false
    })
    emit("saved", saved)
  } catch (err: unknown) {
    withFormWatchSkipped(() => {
      patchForm({ sitemapPingOnPublish: previous })
    })
    error.value =
      err instanceof Error
        ? err.message
        : m.settings_discovery_ping_save_failed()
  } finally {
    isApplyingRemoteDiscovery.value = false
    isPingToggleSaving.value = false
  }
}

function syncFormFromSettings(source: SiteSettings = props.settings): void {
  if (isPingToggleSaving.value || dirty.value || isSaving.value) {
    return
  }

  const normalized = discoveryFromSettings(source)
  withFormWatchSkipped(() => {
    isApplyingRemoteDiscovery.value = true
    try {
      lastSavedForm.value = { ...normalized }
      form.value = normalized
      dirty.value = false
    } finally {
      isApplyingRemoteDiscovery.value = false
    }
  })
}

async function loadReport(): Promise<void> {
  reportStatus.value = "loading"
  try {
    report.value = await getDiscoveryReport(props.projectRoot)
    reportStatus.value = "ready"
  } catch (err) {
    reportStatus.value = "error"
    throw err
  }
}

async function loadArtifacts(): Promise<void> {
  artifacts.value = await getDiscoveryArtifacts(props.projectRoot)
}

async function refreshDiscoveryData(): Promise<void> {
  try {
    await loadReport()
  } catch (err: unknown) {
    error.value =
      err instanceof Error
        ? err.message
        : m.settings_discovery_refresh_report_failed()
  }

  try {
    await loadArtifacts()
  } catch (err: unknown) {
    error.value =
      err instanceof Error
        ? err.message
        : m.settings_discovery_refresh_artifacts_failed()
  }
}

async function hydrateDiscoveryTab(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    syncFormFromSettings()
    await refreshDiscoveryData()
  } catch (err: unknown) {
    error.value =
      err instanceof Error ? err.message : m.settings_discovery_load_failed()
  } finally {
    isLoading.value = false
  }
}

watch(
  () => props.settings,
  (next) => {
    if (
      isApplyingRemoteDiscovery.value ||
      isPingToggleSaving.value ||
      dirty.value ||
      isSaving.value
    ) {
      return
    }
    syncFormFromSettings(next)
  },
  { deep: true },
)

watch(
  form,
  () => {
    if (
      skipFormWatch ||
      isApplyingRemoteDiscovery.value ||
      isLoading.value ||
      isPingToggleSaving.value ||
      isSaving.value
    ) {
      return
    }
    scheduleSave()
  },
  { deep: true },
)

onMounted(() => {
  void hydrateDiscoveryTab()
})

onUnmounted(() => {
  clearSaveTimer()
})

const siteUrlBase = computed(() =>
  (props.settings.siteUrl ?? "").replace(/\/+$/, ""),
)
const hasValidSiteUrl = computed(() => siteUrlBase.value.length > 0)

function buildLiveArtifactUrl(path: string): string | undefined {
  if (!siteUrlBase.value) return undefined
  const version = artifacts.value?.generatedAt
    ? `?v=${encodeURIComponent(artifacts.value.generatedAt)}`
    : ""
  return `${siteUrlBase.value}${path}${version}`
}

const healthChecks = computed(() => {
  const currentReport = report.value
  if (!currentReport) return []
  return currentReport.health.checks.map((check) =>
    localizeDiscoveryHealthCheck(check, {
      rows: currentReport.rows,
      audits: currentReport.audits,
    }),
  )
})

const isReportLoading = computed(() => reportStatus.value === "loading")

const indexabilityRows = computed(() => {
  const rows = report.value?.rows ?? []
  return [...rows].sort((a, b) => {
    const byTitle = a.title.localeCompare(b.title, undefined, {
      sensitivity: "base",
    })
    if (byTitle !== 0) return byTitle
    return a.publicPath.localeCompare(b.publicPath, undefined, {
      sensitivity: "base",
    })
  })
})

function artifactMode(kind: DiscoveryArtifactKind): "auto" | "custom" | "off" {
  if (kind === "robots") {
    return form.value.robotsMode === "custom" ? "custom" : "auto"
  }
  if (kind === "sitemap") {
    return form.value.sitemapMode
  }
  return form.value.llmsMode
}

function artifactCustomValue(kind: DiscoveryArtifactKind): string {
  if (kind === "robots") return form.value.robotsCustom ?? ""
  if (kind === "sitemap") return form.value.sitemapCustom ?? ""
  return form.value.llmsCustom ?? ""
}

function artifactPreview(kind: DiscoveryArtifactKind): string {
  if (kind === "robots") return artifacts.value?.robots ?? ""
  if (kind === "sitemap") return artifacts.value?.sitemap ?? ""
  return artifacts.value?.llms ?? ""
}

function artifactUnavailableReason(kind: DiscoveryArtifactKind): string | null {
  return getArtifactUnavailableReason({
    kind,
    mode: artifactMode(kind),
    preview: artifactPreview(kind),
    discourageSearchEngines: form.value.discourageSearchEngines,
    hasSiteUrl: hasValidSiteUrl.value,
  })
}

async function fetchGeneratedBaseline(
  kind: DiscoveryArtifactKind,
): Promise<string> {
  const baseline = await getDiscoveryBaseline(props.projectRoot, kind)
  return baseline.content ?? ""
}

async function customizeArtifact(kind: DiscoveryArtifactKind): Promise<void> {
  isArtifactActionLoading.value = true
  try {
    const existing = artifactCustomValue(kind)
    const baseline = existing.trim()
      ? null
      : await fetchGeneratedBaseline(kind)
    const seed = resolveArtifactCustomSeed(existing, baseline)

    if (kind === "robots") {
      patchForm({ robotsMode: "custom", robotsCustom: seed })
    } else if (kind === "sitemap") {
      patchForm({ sitemapMode: "custom", sitemapCustom: seed })
    } else {
      patchForm({ llmsMode: "custom", llmsCustom: seed })
    }

    editingArtifact.value = kind
  } catch (err: unknown) {
    error.value =
      err instanceof Error
        ? err.message
        : m.settings_discovery_start_override_failed()
  } finally {
    isArtifactActionLoading.value = false
  }
}

function updateArtifactCustomValue(
  kind: DiscoveryArtifactKind,
  value: string,
): void {
  if (kind === "robots") {
    patchForm({ robotsMode: "custom", robotsCustom: value })
    return
  }
  if (kind === "sitemap") {
    patchForm({ sitemapMode: "custom", sitemapCustom: value })
    return
  }
  patchForm({ llmsMode: "custom", llmsCustom: value })
}

function revertArtifact(kind: DiscoveryArtifactKind): void {
  if (kind === "robots") {
    patchForm({ robotsMode: "auto", robotsCustom: undefined })
  } else if (kind === "sitemap") {
    patchForm({ sitemapMode: "auto", sitemapCustom: undefined })
  } else {
    patchForm({ llmsMode: "auto", llmsCustom: undefined })
  }
  if (editingArtifact.value === kind) {
    editingArtifact.value = null
  }
}

function disableArtifact(kind: DiscoveryArtifactKind): void {
  if (kind === "robots") return
  if (kind === "sitemap") {
    patchForm({ sitemapMode: "off" })
  } else {
    patchForm({ llmsMode: "off" })
  }
  if (editingArtifact.value === kind) {
    editingArtifact.value = null
  }
}

function enableArtifact(kind: DiscoveryArtifactKind): void {
  if (kind === "robots") {
    patchForm({ robotsMode: "auto", robotsCustom: undefined })
    return
  }
  if (kind === "sitemap") {
    patchForm({ sitemapMode: "auto", sitemapCustom: undefined })
  } else {
    patchForm({ llmsMode: "auto", llmsCustom: undefined })
  }
}

const artifactTabs = computed(() => [
  {
    kind: "robots" as const,
    label: "robots.txt",
    path: "/robots.txt",
    language: "plain" as const,
    allowDisable: false,
    disabledMessage: undefined as string | undefined,
  },
  {
    kind: "sitemap" as const,
    label: "sitemap.xml",
    path: "/sitemap.xml",
    language: "xml" as const,
    allowDisable: true,
    disabledMessage: m.settings_discovery_artifact_sitemap_not_published(),
  },
  {
    kind: "llms" as const,
    label: "llms.txt",
    path: "/llms.txt",
    language: "plain" as const,
    allowDisable: true,
    disabledMessage: m.settings_discovery_artifact_llms_not_published(),
  },
])

function segmentedTabClass(kind: DiscoveryArtifactKind): string {
  const base =
    "w-full rounded-md px-3 py-2 text-xs font-medium transition-colors"
  return activeArtifact.value === kind
    ? `${base} bg-background text-foreground shadow-sm`
    : `${base} text-muted-foreground hover:text-foreground`
}

watch(activeArtifact, (next) => {
  if (editingArtifact.value && editingArtifact.value !== next) {
    editingArtifact.value = null
  }
})

function artifactEditorValue(kind: DiscoveryArtifactKind): string {
  if (editingArtifact.value === kind) {
    return artifactCustomValue(kind)
  }
  if (artifactMode(kind) === "custom") {
    return artifactCustomValue(kind) || artifactPreview(kind)
  }
  return artifactPreview(kind)
}

const discoverySlidePanelHeight = computed(() => {
  const kind = activeArtifact.value
  const mode = artifactMode(kind)

  if (mode === "off") {
    return "9.5rem"
  }

  const value = artifactEditorValue(kind)
  const hasContent = value.trim().length > 0
  const unavailable = artifactUnavailableReason(kind)

  if (!hasContent && !editingArtifact.value && unavailable) {
    return "9.5rem"
  }

  const lineCount = value.split("\n").length
  const editorHeight = discoveryArtifactEditorHeightPx(lineCount)
  return `${editorHeight + DISCOVERY_ARTIFACT_PANEL_CHROME_PX}px`
})

function onAiBotPolicyChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as NonNullable<
    DiscoverySettings["aiBotPolicy"]
  >
  patchForm({ aiBotPolicy: value })
}

function onTakeoverManaged(next: SiteSettings) {
  emit("saved", next)
}

async function save(): Promise<boolean> {
  return flushSave()
}

function reset() {
  clearSaveTimer()
  dirty.value = false
  syncFormFromSettings(props.settings)
}

defineExpose({
  save,
  reset,
  saving: isSaving,
  isDirty: () => dirty.value,
})
</script>

<template>
  <div class="min-w-0 space-y-0">
    <div
      class="sticky top-0 z-10 flex h-12 shrink-0 items-stretch gap-1 border-y border-dashed border-border bg-background px-7"
      role="tablist"
      :aria-label="m.settings_meta_discovery_title()"
    >
      <Button
        type="button"
        size="tab"
        role="tab"
        :aria-selected="activeDiscoveryTab === 'overview'"
        :variant="activeDiscoveryTab === 'overview' ? 'tab-active' : 'tab'"
        @click="activeDiscoveryTab = 'overview'"
      >
        {{ m.settings_discovery_tabs_overview() }}
      </Button>
      <Button
        type="button"
        size="tab"
        role="tab"
        :aria-selected="activeDiscoveryTab === 'files'"
        :variant="activeDiscoveryTab === 'files' ? 'tab-active' : 'tab'"
        @click="activeDiscoveryTab = 'files'"
      >
        {{ m.settings_discovery_tabs_files() }}
      </Button>
      <Button
        type="button"
        size="tab"
        role="tab"
        :aria-selected="activeDiscoveryTab === 'search'"
        :variant="activeDiscoveryTab === 'search' ? 'tab-active' : 'tab'"
        @click="activeDiscoveryTab = 'search'"
      >
        {{ m.settings_discovery_tabs_search() }}
      </Button>
      <Button
        type="button"
        size="tab"
        role="tab"
        :aria-selected="activeDiscoveryTab === 'redirects'"
        :variant="activeDiscoveryTab === 'redirects' ? 'tab-active' : 'tab'"
        @click="activeDiscoveryTab = 'redirects'"
      >
        {{ m.settings_discovery_tabs_redirects() }}
      </Button>
    </div>

    <div class="space-y-10 px-7 pt-6 pb-7">
      <div
        class="mx-auto max-w-4xl space-y-10"
        role="form"
        :aria-label="m.settings_discovery_form_label()"
      >
        <SeoTakeoverBanner
          v-if="activeDiscoveryTab !== 'redirects'"
          :project-root="projectRoot"
          :settings="settings"
          @managed="onTakeoverManaged"
        />

        <p
          v-if="activeDiscoveryTab !== 'redirects' && !hasValidSiteUrl"
          class="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"
        >
          {{ m.settings_discovery_site_url_required() }}
        </p>

        <DiscoveryRedirectsPanel
          v-if="activeDiscoveryTab === 'redirects'"
          :project-root="projectRoot"
        />

        <DiscoveryOverviewPanel
          v-if="activeDiscoveryTab === 'overview'"
          :score="report?.health.score ?? 0"
          :checks="healthChecks"
          :loading="isReportLoading"
          v-model:discourage-search-engines="discourageSearchEngines"
          :disabled="isLoading"
        />

        <SettingsRow
          v-if="activeDiscoveryTab === 'files'"
          :label="m.settings_discovery_ai_bot_policy()"
        >
          <select
            :value="form.aiBotPolicy"
            class="h-9 rounded-md border border-input bg-input px-3 text-sm"
            :disabled="isLoading"
            @change="onAiBotPolicyChange"
          >
            <option value="allow-all">
              {{ m.settings_discovery_ai_policy_allow_all() }}
            </option>
            <option value="block-training">
              {{ m.settings_discovery_ai_policy_block_training() }}
            </option>
          </select>
        </SettingsRow>

        <section
          v-if="activeDiscoveryTab === 'files'"
          class="overflow-hidden rounded-sm bg-background"
        >
          <div
            class="grid grid-cols-3 gap-1 border-b border-dashed border-border/50 p-2"
          >
            <button
              v-for="tab in artifactTabs"
              :key="tab.kind"
              type="button"
              :class="segmentedTabClass(tab.kind)"
              @click="activeArtifact = tab.kind"
            >
              {{ tab.label }}
            </button>
          </div>

          <div :style="{ minHeight: discoverySlidePanelHeight }">
            <DiscoveryArtifactPanel
              v-for="tab in artifactTabs"
              v-show="activeArtifact === tab.kind"
              :key="tab.kind"
              :mode="artifactMode(tab.kind)"
              :custom-value="artifactCustomValue(tab.kind)"
              :preview="artifactPreview(tab.kind)"
              :unavailable-reason="artifactUnavailableReason(tab.kind)"
              :live-url="buildLiveArtifactUrl(tab.path)"
              :can-edit="true"
              :allow-disable="tab.allowDisable"
              :is-editing="editingArtifact === tab.kind"
              :is-loading="isLoading || isArtifactActionLoading"
              :language="tab.language"
              :disabled-message="tab.disabledMessage"
              @customize="void customizeArtifact(tab.kind)"
              @revert="revertArtifact(tab.kind)"
              @disable="disableArtifact(tab.kind)"
              @enable="enableArtifact(tab.kind)"
              @done="editingArtifact = null"
              @update:custom-value="updateArtifactCustomValue(tab.kind, $event)"
            />
          </div>
        </section>

        <SettingsRow
          v-if="activeDiscoveryTab === 'search'"
          :label="m.settings_discovery_ping_on_publish()"
          :description="m.settings_discovery_ping_on_publish_description()"
        >
          <Switch
            id="discovery-ping-toggle"
            :model-value="pingOnPublish"
            :disabled="isLoading || isPingToggleSaving"
            @update:model-value="pingOnPublish = Boolean($event)"
          />
        </SettingsRow>

        <SettingsRow
          v-if="activeDiscoveryTab === 'search'"
          :label="m.settings_discovery_google_verification()"
          :description="m.settings_discovery_search_console_token()"
        >
          <Input
            :model-value="form.googleSiteVerification ?? ''"
            :disabled="isLoading"
            @update:model-value="
              patchForm({ googleSiteVerification: String($event) })
            "
          />
        </SettingsRow>

        <SettingsRow
          v-if="
            activeDiscoveryTab === 'search' &&
            form.googleSiteVerification?.trim()
          "
          :label="m.settings_discovery_google_search_console()"
          :description="m.settings_discovery_search_console_link_description()"
        >
          <a
            class="text-sm text-primary underline-offset-4 hover:underline"
            href="https://search.google.com/search-console"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ m.settings_discovery_open_search_console() }}
          </a>
        </SettingsRow>

        <SettingsRow
          v-if="activeDiscoveryTab === 'search'"
          :label="m.settings_discovery_bing_verification()"
          :description="m.settings_discovery_webmaster_tools_token()"
        >
          <Input
            :model-value="form.bingSiteVerification ?? ''"
            :disabled="isLoading"
            @update:model-value="
              patchForm({ bingSiteVerification: String($event) })
            "
          />
        </SettingsRow>

        <div
          v-if="activeDiscoveryTab === 'overview'"
          class="space-y-3"
          :aria-busy="isReportLoading"
        >
          <div class="space-y-1">
            <h3 class="text-md font-medium text-foreground">
              {{ m.settings_discovery_indexability() }}
            </h3>
            <p class="pb-6 text-sm leading-relaxed text-muted-foreground/50">
              {{ m.settings_discovery_indexability_description() }}
            </p>
          </div>
          <div
            class="overflow-hidden rounded-md border border-solid border-border/50 bg-background"
          >
            <div class="overflow-x-auto">
              <Table class="w-full table-auto border-collapse">
                <TableHeader
                  class="border-b border-dashed border-border bg-card/50!"
                >
                  <TableRow>
                    <TableHead
                      class="w-full text-xs font-medium text-muted-foreground"
                    >
                      {{ m.settings_discovery_column_page() }}
                    </TableHead>
                    <TableHead
                      class="whitespace-nowrap text-xs font-medium text-muted-foreground"
                    >
                      {{ m.settings_discovery_column_url() }}
                    </TableHead>
                    <TableHead
                      class="whitespace-nowrap text-xs font-medium text-muted-foreground"
                    >
                      {{ m.settings_discovery_column_sitemap() }}
                    </TableHead>
                    <TableHead
                      class="whitespace-nowrap text-xs font-medium text-muted-foreground"
                    >
                      {{ m.settings_discovery_column_reason() }}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <template v-if="isReportLoading">
                    <TableRow
                      v-for="row in 4"
                      :key="`indexability-skeleton-${row}`"
                      class="border-b border-border last:border-0"
                    >
                      <TableCell class="py-3">
                        <div
                          class="h-3.5 w-28 animate-pulse rounded bg-muted/40"
                        />
                      </TableCell>
                      <TableCell class="py-3">
                        <div
                          class="h-3 w-24 animate-pulse rounded bg-muted/30"
                        />
                      </TableCell>
                      <TableCell class="py-3">
                        <div class="h-3 w-8 animate-pulse rounded bg-muted/30" />
                      </TableCell>
                      <TableCell class="py-3">
                        <div
                          class="h-5 w-20 animate-pulse rounded-full bg-muted/30"
                        />
                      </TableCell>
                    </TableRow>
                  </template>
                  <template v-else>
                    <TableRow
                      v-for="row in indexabilityRows"
                      :key="row.pageId"
                      class="border-b border-border last:border-0"
                    >
                      <TableCell class="min-w-0 py-3">
                        <span
                          class="block truncate text-sm font-medium text-foreground"
                        >
                          {{ row.title }}
                        </span>
                      </TableCell>
                      <TableCell
                        class="whitespace-nowrap py-3 text-xs text-muted-foreground"
                      >
                        {{ row.publicPath }}
                      </TableCell>
                      <TableCell
                        class="whitespace-nowrap py-3 text-xs text-foreground"
                      >
                        {{
                          row.inSitemap
                            ? m.settings_discovery_yes()
                            : m.settings_discovery_no()
                        }}
                      </TableCell>
                      <TableCell class="whitespace-nowrap py-3">
                        <Badge variant="outline" class="text-[10px]">
                          {{ row.exclusionReason }}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  </template>
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <p v-if="error" class="text-xs text-destructive" role="alert">
          {{ error }}
        </p>
      </div>
    </div>
    <SlugChangeRedirectPrompt />
  </div>
</template>
