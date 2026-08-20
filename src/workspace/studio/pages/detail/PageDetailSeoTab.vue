<script setup lang="ts">
import { computed } from "vue"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { m } from "@/paraglide/messages.js"
import SettingsRow from "@/workspace/settings/SettingsRow.vue"
import type { PageSeoMeta } from "@/types/aria"

const seo = defineModel<PageSeoMeta>("seo", { required: true })

const props = defineProps<{
  route: string
  fallbackTitle: string
  fallbackDescription: string
}>()

const searchTitle = computed({
  get: () => seo.value.title ?? "",
  set: (value: string) => {
    seo.value = { ...seo.value, title: value }
  },
})

const searchDescription = computed({
  get: () => seo.value.description ?? "",
  set: (value: string) => {
    seo.value = { ...seo.value, description: value }
  },
})

const ogTitle = computed({
  get: () => seo.value.ogTitle ?? "",
  set: (value: string) => {
    seo.value = { ...seo.value, ogTitle: value }
  },
})

const ogDescription = computed({
  get: () => seo.value.ogDescription ?? "",
  set: (value: string) => {
    seo.value = { ...seo.value, ogDescription: value }
  },
})

const ogImage = computed({
  get: () => seo.value.ogImage ?? "",
  set: (value: string) => {
    seo.value = { ...seo.value, ogImage: value }
  },
})

const canonical = computed({
  get: () => seo.value.canonical ?? "",
  set: (value: string) => {
    seo.value = { ...seo.value, canonical: value }
  },
})

const noindex = computed({
  get: () => Boolean(seo.value.noindex),
  set: (value: boolean) => {
    seo.value = { ...seo.value, noindex: value }
  },
})

const nofollow = computed({
  get: () => Boolean(seo.value.nofollow),
  set: (value: boolean) => {
    seo.value = { ...seo.value, nofollow: value }
  },
})

const previewTitle = computed(
  () =>
    searchTitle.value.trim() ||
    props.fallbackTitle.trim() ||
    props.route,
)

const previewDescription = computed(
  () =>
    searchDescription.value.trim() ||
    props.fallbackDescription.trim() ||
    "",
)

const previewUrl = computed(() => canonical.value.trim() || props.route)
</script>

<template>
  <div class="grid w-full gap-6">
    <div class="grid min-w-0 content-start gap-6">
      <section class="space-y-5">
        <SettingsRow
          :label="m.pages_seo_search_title()"
          :description="m.pages_seo_char_hint({ count: String(searchTitle.length) })"
          full-width
          input-id="page-seo-title"
        >
          <Input
            id="page-seo-title"
            v-model="searchTitle"
            :spellcheck="false"
            class="rounded-sm!"
          />
        </SettingsRow>

        <SettingsRow
          :label="m.pages_seo_search_description()"
          :description="
            m.pages_seo_char_hint({ count: String(searchDescription.length) })
          "
          full-width
          input-id="page-seo-description"
        >
          <Textarea
            id="page-seo-description"
            v-model="searchDescription"
            :rows="3"
            class="min-h-20 rounded-sm!"
          />
        </SettingsRow>
      </section>

      <section class="space-y-5">
        <SettingsRow
          :label="m.pages_seo_og_title()"
          full-width
          input-id="page-seo-og-title"
        >
          <Input
            id="page-seo-og-title"
            v-model="ogTitle"
            :spellcheck="false"
            class="rounded-sm!"
          />
        </SettingsRow>

        <SettingsRow
          :label="m.pages_seo_og_description()"
          full-width
          input-id="page-seo-og-description"
        >
          <Textarea
            id="page-seo-og-description"
            v-model="ogDescription"
            :rows="3"
            class="min-h-20 rounded-sm!"
          />
        </SettingsRow>

        <SettingsRow
          :label="m.pages_seo_og_image()"
          :description="m.pages_seo_og_image_hint()"
          full-width
          input-id="page-seo-og-image"
        >
          <Input
            id="page-seo-og-image"
            v-model="ogImage"
            :spellcheck="false"
            class="rounded-sm!"
          />
        </SettingsRow>
      </section>

      <section class="space-y-5">
        <SettingsRow
          :label="m.pages_seo_canonical()"
          full-width
          input-id="page-seo-canonical"
        >
          <Input
            id="page-seo-canonical"
            v-model="canonical"
            :spellcheck="false"
            class="rounded-sm!"
          />
        </SettingsRow>

        <label class="flex items-center gap-2 text-sm">
          <input
            v-model="noindex"
            type="checkbox"
            class="size-3.5 rounded border-border"
          />
          {{ m.pages_seo_noindex() }}
        </label>

        <label class="flex items-center gap-2 text-sm">
          <input
            v-model="nofollow"
            type="checkbox"
            class="size-3.5 rounded border-border"
          />
          {{ m.pages_seo_nofollow() }}
        </label>
      </section>
    </div>

    <aside class="min-w-0">
      <div class="space-y-2 rounded-sm border border-dashed border-border p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {{ m.pages_seo_preview() }}
        </p>
        <p class="truncate text-xs text-emerald-700 dark:text-emerald-400">
          {{ previewUrl }}
        </p>
        <p class="line-clamp-2 text-base font-medium text-blue-700 dark:text-blue-400">
          {{ previewTitle }}
        </p>
        <p
          v-if="previewDescription"
          class="line-clamp-3 text-xs text-muted-foreground"
        >
          {{ previewDescription }}
        </p>
      </div>
    </aside>
  </div>
</template>
