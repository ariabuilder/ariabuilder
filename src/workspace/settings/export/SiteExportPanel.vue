<script setup lang="ts">
import { computed, toRef, watch } from "vue"
import { toast } from "vue-sonner"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { confirm } from "@/composables/useConfirm"
import {
  SITE_EXPORT_PRESETS,
  SITE_EXPORT_SECTIONS,
  resolveExportSelection,
} from "@/lib/siteExport"
import { m } from "@/paraglide/messages.js"
import SettingsRow from "@/workspace/settings/SettingsRow.vue"
import ExportArchiveCard from "./ExportArchiveCard.vue"
import {
  EXPORT_KEEP_TTL_MINUTES,
  useSiteExport,
  type SiteExportRecord,
} from "./useSiteExport"

const props = defineProps<{
  projectRoot: string
}>()

const KEEP_TTL = EXPORT_KEEP_TTL_MINUTES

const retentionOptions = [
  { label: "1D", value: 1_440, full: () => m.export_retention_1d() },
  { label: "3D", value: 4_320, full: () => m.export_retention_3d() },
  { label: "7D", value: 10_080, full: () => m.export_retention_7d() },
  { label: "30D", value: 43_200, full: () => m.export_retention_30d() },
  { label: "60D", value: 86_400, full: () => m.export_retention_60d() },
  { label: "Keep", value: KEEP_TTL, full: () => m.export_retention_forever() },
] as const

const {
  isLoadingExports,
  isCreatingExport,
  deletingExportId,
  revealingExportId,
  exportError,
  exportTtlMinutes,
  exportSelection,
  exports: siteExports,
  createSiteExport,
  setExportPreset,
  toggleExportSection,
  deleteExport,
  downloadExport,
  revealExport,
  formatDateTime,
  formatExportExpiry,
  formatBytes,
} = useSiteExport(toRef(props, "projectRoot"))

const resolvedExportSections = computed(
  () => resolveExportSelection(exportSelection.value).sections,
)

function presetLabel(id: string): string {
  switch (id) {
    case "full":
      return m.export_preset_full_site()
    case "dataOnly":
      return m.export_preset_data_only()
    case "codeOnly":
      return m.export_preset_code_only()
    case "mediaOnly":
      return m.export_preset_media_only()
    default:
      return id
  }
}

function presetDescription(id: string): string {
  switch (id) {
    case "full":
      return m.export_preset_full_site_description()
    case "dataOnly":
      return m.export_preset_data_only_description()
    case "codeOnly":
      return m.export_preset_code_only_description()
    case "mediaOnly":
      return m.export_preset_media_only_description()
    default:
      return ""
  }
}

function exportSectionLabel(id: string): string {
  switch (id) {
    case "pages":
      return m.export_section_pages()
    case "layouts":
      return m.export_section_layouts()
    case "components":
      return m.export_section_components()
    case "designSystem":
      return m.export_section_design_system()
    case "siteSettings":
      return m.export_section_site_settings()
    case "media":
      return m.export_section_media()
    case "cms":
      return m.export_section_cms()
    case "redirects":
      return m.export_section_redirects()
    case "discovery":
      return m.export_section_discovery()
    case "contentState":
      return m.export_section_content_state()
    case "pageMetadata":
      return m.export_section_page_metadata()
    default:
      return id
  }
}

const exportSectionOptions = SITE_EXPORT_SECTIONS.map((section) => ({
  id: section,
  label: exportSectionLabel(section),
}))

const selectedPresetDescription = computed(() => {
  const preset = SITE_EXPORT_PRESETS.find(
    (candidate) => candidate.id === exportSelection.value.preset,
  )
  return preset ? presetDescription(preset.id) : ""
})

if (
  !retentionOptions.some(
    (option) => option.value === exportTtlMinutes.value,
  )
) {
  exportTtlMinutes.value = 10_080
}

watch(exportError, (error) => {
  if (error) toast.error(error)
})

async function requestDeleteExport(id: string): Promise<void> {
  const record = siteExports.value.find((entry) => entry.id === id)
  if (!record) return
  const ok = await confirm({
    title: m.export_delete_title(),
    description: m.export_delete_description(),
    confirmLabel: m.export_delete(),
    destructive: true,
  })
  if (!ok) return
  await deleteExport(id)
}

async function onDownload(record: SiteExportRecord): Promise<void> {
  await downloadExport(record)
}

async function onReveal(record: SiteExportRecord): Promise<void> {
  await revealExport(record)
}
</script>

<template>
  <div class="space-y-8 px-12 py-7" role="region" :aria-label="m.export_aria()">
    <SettingsRow
      :label="m.export_title()"
      :description="m.export_description()"
      full-width
      class="text-balance"
    >
      <div class="mt-3 max-w-2xl space-y-5">
        <div class="space-y-2">
          <Label class="text-xs text-muted-foreground">{{
            m.export_preset()
          }}</Label>
          <div class="flex flex-wrap gap-2">
            <Button
              v-for="preset in SITE_EXPORT_PRESETS"
              :key="preset.id"
              type="button"
              size="sm"
              variant="outline"
              class="h-8"
              :class="
                exportSelection.preset === preset.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : ''
              "
              @click="setExportPreset(preset.id)"
            >
              {{ presetLabel(preset.id) }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ selectedPresetDescription }}
          </p>
        </div>

        <div class="space-y-2">
          <Label class="text-xs text-muted-foreground">{{
            m.export_sections()
          }}</Label>
          <div class="grid gap-2 sm:grid-cols-2">
            <label
              v-for="section in exportSectionOptions"
              :key="section.id"
              class="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
            >
              <Checkbox
                :model-value="resolvedExportSections[section.id]"
                @update:model-value="
                  (checked) => toggleExportSection(section.id, checked === true)
                "
              />
              <span>{{ section.label }}</span>
            </label>
          </div>
        </div>

        <div class="flex items-center gap-4">
          <Button
            variant="default"
            size="sm"
            class="h-9!"
            :disabled="isCreatingExport"
            @click="createSiteExport"
          >
            <AppIcon
              name="download"
              :size="16"
              class="mr-2 size-4"
              :class="isCreatingExport ? 'animate-pulse' : ''"
            />
            {{
              isCreatingExport ? m.export_generating() : m.export_generate()
            }}
          </Button>
        </div>
      </div>
    </SettingsRow>

    <SettingsRow
      :label="m.export_retention()"
      :description="m.export_retention_description()"
      full-width
    >
      <div
        class="flex w-full max-w-md flex-wrap gap-1.5"
        role="radiogroup"
        :aria-label="m.export_retention()"
      >
        <button
          v-for="option in retentionOptions"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="exportTtlMinutes === option.value"
          :aria-label="option.full()"
          class="select-none rounded-sm border border-solid px-3 py-1.5 text-center text-xs font-medium transition-all duration-150"
          :class="
            exportTtlMinutes === option.value
              ? 'border-primary/40 bg-primary/70 text-primary-foreground shadow-sm'
              : 'border-border/50 bg-card/50 text-muted-foreground hover:border-primary/80 hover:bg-card hover:text-primary-foreground'
          "
          @click="exportTtlMinutes = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </SettingsRow>

    <SettingsRow
      :label="m.export_archives()"
      :description="m.export_archives_description()"
      full-width
    >
      <div v-if="isLoadingExports" class="max-w-2xl">
        <div
          class="h-36 animate-pulse rounded-lg border border-border bg-muted/30"
        />
      </div>

      <div
        v-else-if="siteExports.length > 0"
        class="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <ExportArchiveCard
          v-for="record in siteExports"
          :key="record.id"
          :record="record"
          :is-deleting="deletingExportId === record.id"
          :is-revealing="revealingExportId === record.id"
          :format-date-time="formatDateTime"
          :format-export-expiry="formatExportExpiry"
          :format-bytes="formatBytes"
          @download="onDownload"
          @reveal="onReveal"
          @delete="requestDeleteExport"
        />
      </div>

      <div v-else class="w-full">
        <div class="bg-background px-6 py-8 text-center">
          <AppIcon
            name="archived"
            :size="32"
            class="mx-auto mb-4 block size-8 text-muted-foreground/40"
          />
          <p class="text-sm leading-2 font-medium text-muted-foreground">
            {{ m.export_empty() }}
          </p>
          <p class="mx-auto mt-1 text-balance text-xs text-muted-foreground/70">
            {{ m.export_empty_description() }}
          </p>
        </div>
      </div>
    </SettingsRow>
  </div>
</template>
