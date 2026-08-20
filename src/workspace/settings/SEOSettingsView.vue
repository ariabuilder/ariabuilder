<script setup lang="ts">
import { ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { updateSeoDefaults } from "@/lib/workspace"
import SettingsRow from "@/workspace/settings/SettingsRow.vue"
import SeoTakeoverBanner from "@/workspace/settings/SeoTakeoverBanner.vue"
import type { SiteSettings } from "@/workspace/settings/types"
import { m } from "@/paraglide/messages.js"

const props = defineProps<{
  projectRoot: string
  settings: SiteSettings
}>()

const emit = defineEmits<{
  saved: [settings: SiteSettings]
}>()

const metaTitle = ref("")
const metaDescription = ref("")
const ogImage = ref("")
const saving = ref(false)
const error = ref<string | null>(null)
const dirty = ref(false)

function applySettings(next: SiteSettings) {
  metaTitle.value = next.seoTitle ?? ""
  metaDescription.value = next.seoDescription ?? ""
  ogImage.value = next.ogImage ?? ""
  error.value = null
  dirty.value = false
}

function reset() {
  applySettings(props.settings)
}

function markDirty() {
  dirty.value = true
}

watch(
  () => props.settings,
  (next) => {
    if (saving.value || dirty.value) return
    applySettings(next)
  },
  { immediate: true, deep: true },
)

async function save(): Promise<boolean> {
  error.value = null
  saving.value = true
  try {
    const next = await updateSeoDefaults(props.projectRoot, {
      seoTitle: metaTitle.value.trim(),
      seoDescription: metaDescription.value.trim(),
      ogImage: ogImage.value.trim(),
    })
    dirty.value = false
    emit("saved", next)
    return true
  } catch (err: unknown) {
    error.value =
      err instanceof Error ? err.message : m.settings_seo_save_failed()
    return false
  } finally {
    saving.value = false
  }
}

function clearOgImage() {
  ogImage.value = ""
  markDirty()
}

function onTakeoverManaged(next: SiteSettings) {
  // Takeover / scan updates management metadata — keep draft SEO fields.
  emit("saved", next)
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
    :aria-label="m.settings_seo_form_label()"
  >
    <SeoTakeoverBanner
      :project-root="projectRoot"
      :settings="settings"
      @managed="onTakeoverManaged"
    />

    <SettingsRow
      :label="m.settings_seo_title()"
      :description="m.settings_seo_title_description()"
      full-width
      input-id="seo-title"
    >
      <Input
        id="seo-title"
        v-model="metaTitle"
        type="text"
        aria-describedby="seo-title-description"
        :placeholder="m.settings_seo_title_placeholder()"
        :disabled="saving"
        @update:model-value="markDirty"
      />
    </SettingsRow>

    <SettingsRow
      :label="m.settings_seo_description()"
      :description="m.settings_seo_description_description()"
      full-width
      input-id="seo-description"
    >
      <Textarea
        id="seo-description"
        v-model="metaDescription"
        rows="3"
        aria-describedby="seo-description-description"
        :placeholder="m.settings_seo_description_placeholder()"
        :disabled="saving"
        class="resize-none"
        @update:model-value="markDirty"
      />
    </SettingsRow>

    <SettingsRow
      :label="m.settings_seo_open_graph_image()"
      :description="m.settings_seo_open_graph_image_description()"
      full-width
      input-id="seo-og-image"
    >
      <div class="space-y-3">
        <div
          class="flex aspect-video w-full max-w-md items-center justify-center overflow-hidden rounded-md border border-border bg-input"
          :class="ogImage ? 'border-solid' : 'border-dashed'"
        >
          <img
            v-if="ogImage"
            :src="ogImage"
            :alt="m.settings_seo_image_preview()"
            class="size-full object-cover"
          />
          <AppIcon
            v-else
            name="image"
            :size="20"
            class="text-muted-foreground/50"
          />
        </div>
        <div class="flex items-center gap-2">
          <Input
            id="seo-og-image"
            v-model="ogImage"
            type="url"
            :placeholder="m.settings_seo_og_image_placeholder()"
            :disabled="saving"
            class="flex-1"
            @update:model-value="markDirty"
          />
          <Button
            v-if="ogImage"
            type="button"
            variant="ghost"
            size="xs"
            :disabled="saving"
            :aria-label="m.settings_seo_clear_image()"
            @click="clearOgImage"
          >
            {{ m.settings_seo_clear_image() }}
          </Button>
        </div>
      </div>
    </SettingsRow>

    <p v-if="error" class="text-xs text-destructive" role="alert">
      {{ error }}
    </p>
  </div>
</template>
