<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { setSiteSettings } from "@/lib/workspace"
import SettingsRow from "@/workspace/settings/SettingsRow.vue"
import ProjectImagePickerField from "@/workspace/studio/media/components/ProjectImagePickerField.vue"
import {
  DEFAULT_SITE_TIME_ZONE,
  SITE_TIME_ZONE_OPTIONS,
  isValidTimeZone,
} from "@/workspace/settings/timeZone"
import type { SiteSettings } from "@/workspace/settings/types"
import { m } from "@/paraglide/messages.js"

const props = defineProps<{
  projectRoot: string
  settings: SiteSettings
}>()

const emit = defineEmits<{
  saved: [settings: SiteSettings]
}>()

const siteName = ref("")
const siteDescription = ref("")
const siteUrl = ref("")
const timeZone = ref(DEFAULT_SITE_TIME_ZONE)
const favicon = ref("")
const saving = ref(false)
const error = ref<string | null>(null)
const cleanSnapshot = ref("")

function draftSnapshot() {
  return JSON.stringify({
    siteName: siteName.value,
    siteDescription: siteDescription.value,
    siteUrl: siteUrl.value,
    timeZone: timeZone.value,
    favicon: favicon.value,
  })
}

const dirty = computed(() => Boolean(cleanSnapshot.value) && draftSnapshot() !== cleanSnapshot.value)

function applySettings(next: SiteSettings) {
  siteName.value = next.siteName
  siteDescription.value = next.siteDescription
  siteUrl.value = next.siteUrl
  timeZone.value = next.timeZone || DEFAULT_SITE_TIME_ZONE
  favicon.value = next.favicon
  error.value = null
  cleanSnapshot.value = draftSnapshot()
}

function reset() {
  applySettings(props.settings)
}

watch(
  () => props.settings,
  (next) => {
    if (saving.value) return
    applySettings(next)
  },
  { immediate: true, deep: true },
)

/** Persist the draft. Returns true when written successfully. */
async function save(): Promise<boolean> {
  error.value = null
  if (!isValidTimeZone(timeZone.value)) {
    error.value = m.settings_general_invalid_timezone()
    return false
  }
  const url = siteUrl.value.trim()
  if (url) {
    try {
      void new URL(url)
    } catch {
      error.value = m.settings_general_invalid_url()
      return false
    }
  }

  saving.value = true
  try {
    const next = await setSiteSettings(props.projectRoot, {
      siteName: siteName.value.trim(),
      siteDescription: siteDescription.value.trim(),
      siteUrl: url,
      timeZone: timeZone.value.trim() || DEFAULT_SITE_TIME_ZONE,
      favicon: favicon.value.trim(),
    })
    cleanSnapshot.value = draftSnapshot()
    emit("saved", next)
    return true
  } catch (err: unknown) {
    error.value =
      err instanceof Error ? err.message : m.settings_general_save_failed()
    return false
  } finally {
    saving.value = false
  }
}

function onTimeZoneChange(value: unknown) {
  if (typeof value !== "string") return
  timeZone.value = value
}

defineExpose({
  save,
  reset,
  saving,
  isDirty: () => dirty.value,
})
</script>

<template>
  <div
    class="space-y-10"
    role="form"
    :aria-label="m.settings_general_form_label()"
  >
    <SettingsRow
      :label="m.settings_general_site_name()"
      :description="m.settings_general_site_name_description()"
      full-width
      input-id="site-name"
    >
      <Input
        id="site-name"
        v-model="siteName"
        type="text"
        aria-describedby="site-name-description"
        :placeholder="m.settings_general_site_name()"
        :disabled="saving"
      />
    </SettingsRow>

    <SettingsRow
      :label="m.settings_general_site_description()"
      :description="m.settings_general_site_description_description()"
      full-width
      input-id="site-description"
    >
      <Textarea
        id="site-description"
        v-model="siteDescription"
        rows="1"
        aria-describedby="site-description-description"
        :placeholder="m.settings_general_site_description_placeholder()"
        :disabled="saving"
      />
    </SettingsRow>

    <SettingsRow
      :label="m.settings_general_site_url()"
      :description="m.settings_general_site_url_description()"
      full-width
      input-id="site-url"
    >
      <Input
        id="site-url"
        v-model="siteUrl"
        type="url"
        aria-describedby="site-url-description"
        placeholder="https://example.com"
        :disabled="saving"
      />
    </SettingsRow>

    <SettingsRow
      :label="m.settings_general_timezone()"
      :description="m.settings_general_timezone_description()"
      full-width
      input-id="site-time-zone"
    >
      <Select
        :model-value="timeZone"
        :disabled="saving"
        @update:model-value="onTimeZoneChange"
      >
        <SelectTrigger
          id="site-time-zone"
          aria-describedby="site-time-zone-description"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent class="max-h-80">
          <SelectItem
            v-for="option in SITE_TIME_ZONE_OPTIONS"
            :key="option"
            :value="option"
          >
            {{ option }}
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingsRow>

    <SettingsRow
      :label="m.settings_general_favicon()"
      :description="m.settings_general_favicon_description()"
      full-width
      input-id="site-favicon"
    >
      <ProjectImagePickerField
        v-model="favicon"
        input-id="site-favicon"
        :project-root="projectRoot"
        :preview-alt="m.settings_general_favicon_preview()"
        :disabled="saving"
      />
    </SettingsRow>

    <p v-if="error" class="text-xs text-destructive" role="alert">
      {{ error }}
    </p>
  </div>
</template>
