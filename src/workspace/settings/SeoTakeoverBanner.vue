<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { confirmSeoTakeover, scanSeoSources } from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"
import type { SiteSettings } from "@/workspace/settings/types"

const props = defineProps<{
  projectRoot: string
  settings: SiteSettings
}>()

const emit = defineEmits<{
  managed: [settings: SiteSettings]
}>()

const confirming = ref(false)
const scanning = ref(false)
const error = ref<string | null>(null)

const seoManagement = computed(() => props.settings.seoManagement)
const isManaged = computed(() => seoManagement.value?.status === "managed")
const lastScan = computed(() => seoManagement.value?.lastScan)

const findingsSummary = computed(() => {
  const scan = lastScan.value
  if (!scan) return []
  const items: string[] = []
  if (scan.plugins.length > 0) {
    items.push(
      m.settings_seo_takeover_findings_plugins({
        count: String(scan.plugins.length),
      }),
    )
  }
  if (scan.manualTags.length > 0) {
    items.push(
      m.settings_seo_takeover_findings_tags({
        count: String(scan.manualTags.length),
      }),
    )
  }
  if (scan.staticArtifacts.length > 0) {
    items.push(
      m.settings_seo_takeover_findings_static({
        count: String(scan.staticArtifacts.length),
      }),
    )
  }
  return items
})

const checklist = computed(() => {
  const scan = lastScan.value
  if (!scan) return []
  const items: string[] = []
  for (const plugin of scan.plugins) {
    if (plugin.source === "package.json") {
      items.push(
        m.settings_seo_takeover_checklist_npm({ name: plugin.name }),
      )
    } else if (plugin.source === "astro.config") {
      items.push(
        m.settings_seo_takeover_checklist_config({
          name: plugin.name,
          detail: plugin.detail ?? "astro.config",
        }),
      )
    }
  }
  return items
})

const hasConflicts = computed(
  () => Boolean(lastScan.value?.hasConflicts) || findingsSummary.value.length > 0,
)

const description = computed(() =>
  hasConflicts.value
    ? m.settings_seo_takeover_description()
    : m.settings_seo_takeover_clean_description(),
)

async function refreshScan(): Promise<void> {
  if (!props.projectRoot || scanning.value) return
  scanning.value = true
  error.value = null
  try {
    const next = await scanSeoSources(props.projectRoot)
    emit("managed", next)
  } catch (err: unknown) {
    error.value =
      err instanceof Error
        ? err.message
        : m.settings_seo_takeover_scan_failed()
  } finally {
    scanning.value = false
  }
}

async function onConfirmTakeover(): Promise<void> {
  if (confirming.value || !props.projectRoot) return
  confirming.value = true
  error.value = null
  try {
    const next = await confirmSeoTakeover(props.projectRoot)
    emit("managed", next)
  } catch (err: unknown) {
    error.value =
      err instanceof Error
        ? err.message
        : m.settings_seo_takeover_failed()
  } finally {
    confirming.value = false
  }
}

onMounted(() => {
  if (!isManaged.value && !lastScan.value) {
    void refreshScan()
  }
})

watch(
  () => props.projectRoot,
  () => {
    if (!isManaged.value && !lastScan.value) {
      void refreshScan()
    }
  },
)
</script>

<template>
  <div
    v-if="!isManaged"
    class="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-3"
  >
    <div class="flex items-start gap-3">
      <AppIcon
        name="warning"
        :size="16"
        class="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
      />
      <div class="min-w-0 flex-1 space-y-1">
        <p class="text-sm font-medium text-foreground">
          {{ m.settings_seo_takeover_title() }}
        </p>
        <p class="text-xs text-muted-foreground">
          {{ description }}
        </p>
        <ul
          v-if="findingsSummary.length > 0"
          class="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground"
        >
          <li v-for="item in findingsSummary" :key="item">{{ item }}</li>
        </ul>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        :disabled="confirming || scanning"
        @click="onConfirmTakeover"
      >
        {{
          confirming
            ? m.settings_seo_takeover_confirming()
            : m.settings_seo_takeover_confirm()
        }}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        :disabled="scanning || confirming"
        @click="refreshScan"
      >
        {{
          scanning
            ? m.settings_seo_takeover_scanning()
            : m.settings_seo_takeover_scan()
        }}
      </Button>
    </div>
    <p v-if="error" class="text-xs text-destructive" role="alert">
      {{ error }}
    </p>
  </div>

  <div
    v-else
    class="rounded-md border border-border/50 bg-muted/20 px-4 py-3 space-y-2"
  >
    <p class="text-sm font-medium text-foreground">
      {{ m.settings_seo_takeover_managed() }}
    </p>
    <template v-if="checklist.length > 0">
      <p class="text-xs text-muted-foreground">
        {{ m.settings_seo_takeover_checklist_title() }}
      </p>
      <ul class="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
        <li v-for="item in checklist" :key="item">{{ item }}</li>
      </ul>
    </template>
  </div>
</template>
