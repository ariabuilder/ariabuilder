<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { scanInjections, updateAnalytics, updateSourceInjection } from "@/lib/workspace"
import {
  ANALYTICS_PROVIDERS,
  isSourceExpression,
  type AnalyticsProviderField,
  type AnalyticsProviderId,
} from "../../../shared/analytics"
import type { InjectionScanResult } from "../../../shared/injections"
import type { AnalyticsSettings, SiteSettings } from "../../../shared/types"
import { m } from "@/paraglide/messages.js"
import { toast } from "vue-sonner"

const props = defineProps<{
  projectRoot: string
  settings: SiteSettings
}>()

const emit = defineEmits<{
  saved: [settings: SiteSettings]
}>()

type AnalyticsCard = {
  key: string
  origin: "source" | "aria"
  providerId: AnalyticsProviderId
  findingId?: string
  file?: string
  enabled: boolean
}

const EMPTY_ANALYTICS: AnalyticsSettings = {
  version: 1,
  activeProviders: [],
  providers: {},
}

const analytics = ref<AnalyticsSettings>({ ...EMPTY_ANALYTICS, providers: {} })
const cards = ref<AnalyticsCard[]>([])
const isSaving = ref(false)
const scanning = ref(false)
const selectedProviderId = ref<AnalyticsProviderId | "">("")
const fieldDrafts = reactive<Record<string, Record<string, string>>>({})
const targetLayout = ref<string | null>(null)

function cloneAnalytics(value: AnalyticsSettings | undefined): AnalyticsSettings {
  const source = value ?? EMPTY_ANALYTICS
  const providers: AnalyticsSettings["providers"] = {}
  for (const [id, fields] of Object.entries(source.providers ?? {})) {
    providers[id as AnalyticsProviderId] = { ...(fields ?? {}) }
  }
  return {
    version: 1,
    activeProviders: [...(source.activeProviders ?? [])],
    providers,
  }
}

function applySettings(next: SiteSettings) {
  analytics.value = cloneAnalytics(next.analytics)
}

function applyScan(scan: InjectionScanResult, settings: SiteSettings) {
  targetLayout.value = scan.targetLayout
  applySettings(settings)
  const sourceCards: AnalyticsCard[] = scan.analytics.map((finding) => ({
    key: finding.id,
    origin: "source" as const,
    providerId: finding.providerId!,
    findingId: finding.id,
    file: finding.file,
    enabled: finding.enabled,
  }))
  const sourceProviderIds = new Set(sourceCards.map((card) => card.providerId))
  const ariaCards: AnalyticsCard[] = Object.keys(settings.analytics?.providers ?? {})
    .map((id) => id as AnalyticsProviderId)
    .filter((id) => !sourceProviderIds.has(id))
    .map((providerId) => ({
      key: `aria:${providerId}`,
      origin: "aria" as const,
      providerId,
      enabled: Boolean(settings.analytics?.activeProviders.includes(providerId)),
    }))

  cards.value = [...sourceCards, ...ariaCards]

  for (const finding of scan.analytics) {
    if (!finding.providerId) continue
    fieldDrafts[finding.id] = { ...(finding.fields ?? {}) }
  }
  for (const card of ariaCards) {
    fieldDrafts[card.key] = {
      ...(settings.analytics?.providers[card.providerId] ?? {}),
    }
  }
  for (const key of Object.keys(fieldDrafts)) {
    if (!cards.value.some((card) => card.key === key)) {
      delete fieldDrafts[key]
    }
  }
}

async function refreshScan(settingsOverride?: SiteSettings): Promise<void> {
  if (!props.projectRoot) return
  scanning.value = true
  try {
    const scan = await scanInjections(props.projectRoot)
    applyScan(scan, settingsOverride ?? props.settings)
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : m.settings_injections_scan_failed(),
    )
  } finally {
    scanning.value = false
  }
}

onMounted(() => {
  void refreshScan()
})

watch(
  () => props.projectRoot,
  () => {
    void refreshScan()
  },
)

watch(
  () => props.settings,
  (next) => {
    if (isSaving.value) return
    applySettings(next)
  },
  { deep: true },
)

const sortedProviders = computed(() =>
  [...ANALYTICS_PROVIDERS].sort((a, b) => a.label.localeCompare(b.label)),
)

const listedProviderIds = computed<AnalyticsProviderId[]>(() =>
  cards.value.map((card) => card.providerId),
)

const listedCards = computed(() =>
  cards.value
    .map((card) => {
      const provider = sortedProviders.value.find((item) => item.id === card.providerId)
      if (!provider) return null
      return { card, provider }
    })
    .filter((item) => item !== null),
)

const availableProviders = computed(() =>
  sortedProviders.value.filter(
    (provider) => !listedProviderIds.value.includes(provider.id),
  ),
)

const hasAvailableProviders = computed(
  () => availableProviders.value.length > 0,
)
const hasListedProviders = computed(() => listedCards.value.length > 0)

function providerFieldLabel(
  providerId: AnalyticsProviderId,
  field: AnalyticsProviderField,
): string {
  const key = `${providerId}.${field.key}`
  const labels: Record<string, string> = {
    domain: m.settings_analytics_field_domain(),
    scriptSrc: m.settings_analytics_field_script_url(),
    siteId: m.settings_analytics_field_site_id(),
    "matomo.baseUrl": m.settings_analytics_field_matomo_url(),
    websiteId: m.settings_analytics_field_website_id(),
    hostUrl: m.settings_analytics_field_host_url(),
    pixelId: m.settings_analytics_field_pixel_id(),
    partnerId: m.settings_analytics_field_partner_id(),
    measurementId: m.settings_analytics_field_measurement_id(),
    containerId: m.settings_analytics_field_container_id(),
    token: m.settings_analytics_field_token(),
  }

  return labels[key] ?? labels[field.key] ?? field.label
}

function validateField(field: AnalyticsProviderField, value: string): boolean {
  if (field.required && value.trim().length === 0) {
    return false
  }

  if (!value.trim()) {
    return true
  }

  if (isSourceExpression(value)) {
    return true
  }

  if (field.type === "url") {
    try {
      new URL(value)
    } catch {
      return false
    }
  }

  if (field.key === "domain") {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.trim())) {
      return false
    }
  }

  if (field.pattern) {
    const regex = new RegExp(field.pattern)
    if (!regex.test(value)) {
      return false
    }
  }

  return true
}

async function persistAria(next: AnalyticsSettings): Promise<SiteSettings> {
  isSaving.value = true
  try {
    const saved = await updateAnalytics(props.projectRoot, next)
    analytics.value = cloneAnalytics(saved.analytics)
    emit("saved", saved)
    return saved
  } finally {
    isSaving.value = false
  }
}

async function onActivateSelectedProvider(): Promise<void> {
  if (!selectedProviderId.value) return
  const providerId = selectedProviderId.value
  selectedProviderId.value = ""
  isSaving.value = true
  try {
    const result = await updateSourceInjection(props.projectRoot, {
      op: "addAnalytics",
      providerId,
      fields: {},
    })
    if (result.usedMiddleware && result.settings) {
      emit("saved", result.settings)
      applyScan(result.scan, result.settings)
    } else {
      applyScan(result.scan, props.settings)
    }
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : m.settings_analytics_activate_failed(),
    )
  } finally {
    isSaving.value = false
  }
}

async function onSelectProvider(value: unknown): Promise<void> {
  if (typeof value !== "string" || !value) {
    selectedProviderId.value = ""
    return
  }

  selectedProviderId.value = value as AnalyticsProviderId
  await onActivateSelectedProvider()
}

async function onDeactivateProvider(card: AnalyticsCard): Promise<void> {
  if (card.origin === "source" && card.findingId) {
    isSaving.value = true
    try {
      const result = await updateSourceInjection(props.projectRoot, {
        op: "setEnabled",
        id: card.findingId,
        enabled: false,
      })
      applyScan(result.scan, props.settings)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : m.settings_analytics_deactivate_failed(),
      )
    } finally {
      isSaving.value = false
    }
    return
  }
  try {
    await persistAria({
      ...analytics.value,
      activeProviders: analytics.value.activeProviders.filter(
        (id) => id !== card.providerId,
      ),
    })
    const match = cards.value.find((item) => item.key === card.key)
    if (match) match.enabled = false
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : m.settings_analytics_deactivate_failed(),
    )
  }
}

async function onActivateProvider(card: AnalyticsCard): Promise<void> {
  if (card.origin === "source" && card.findingId) {
    isSaving.value = true
    try {
      const result = await updateSourceInjection(props.projectRoot, {
        op: "setEnabled",
        id: card.findingId,
        enabled: true,
      })
      applyScan(result.scan, props.settings)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : m.settings_analytics_activate_failed(),
      )
    } finally {
      isSaving.value = false
    }
    return
  }
  try {
    const saved = await persistAria({
      ...analytics.value,
      activeProviders: analytics.value.activeProviders.includes(card.providerId)
        ? analytics.value.activeProviders
        : [...analytics.value.activeProviders, card.providerId],
      providers: {
        ...analytics.value.providers,
        [card.providerId]: analytics.value.providers[card.providerId] ?? {},
      },
    })
    await refreshScan(saved)
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : m.settings_analytics_activate_failed(),
    )
  }
}

async function onRemoveProvider(card: AnalyticsCard): Promise<void> {
  if (card.origin === "source" && card.findingId) {
    isSaving.value = true
    try {
      const result = await updateSourceInjection(props.projectRoot, {
        op: "delete",
        id: card.findingId,
      })
      applyScan(result.scan, props.settings)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : m.settings_analytics_remove_failed(),
      )
    } finally {
      isSaving.value = false
    }
    return
  }
  const nextProviders = { ...analytics.value.providers }
  delete nextProviders[card.providerId]
  try {
    const saved = await persistAria({
      ...analytics.value,
      activeProviders: analytics.value.activeProviders.filter(
        (id) => id !== card.providerId,
      ),
      providers: nextProviders,
    })
    await refreshScan(saved)
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : m.settings_analytics_remove_failed(),
    )
  }
}

async function onFieldBlur(
  card: AnalyticsCard,
  field: AnalyticsProviderField,
): Promise<void> {
  const value = fieldDrafts[card.key]?.[field.key] ?? ""

  if (!validateField(field, value)) {
    toast.error(
      m.settings_analytics_invalid_field({
        field: providerFieldLabel(card.providerId, field),
      }),
    )
    return
  }

  if (card.origin === "source" && card.findingId) {
    isSaving.value = true
    try {
      const result = await updateSourceInjection(props.projectRoot, {
        op: "edit",
        id: card.findingId,
        fields: { [field.key]: value },
      })
      applyScan(result.scan, props.settings)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : m.settings_analytics_save_field_failed(),
      )
    } finally {
      isSaving.value = false
    }
    return
  }

  const current = analytics.value.providers[card.providerId] ?? {}
  if ((current[field.key] ?? "") === value) return

  try {
    const saved = await persistAria({
      ...analytics.value,
      providers: {
        ...analytics.value.providers,
        [card.providerId]: {
          ...current,
          [field.key]: value,
        },
      },
    })
    await refreshScan(saved)
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : m.settings_analytics_save_field_failed(),
    )
  }
}

defineExpose({
  saving: isSaving,
})
</script>

<template>
  <Teleport defer to="#settings-tab-actions">
    <Select
      :model-value="selectedProviderId"
      :disabled="isSaving || !hasAvailableProviders"
      @update:model-value="onSelectProvider"
    >
      <SelectTrigger hide-icon>
        <SelectValue
          :placeholder="
            hasAvailableProviders
              ? m.settings_analytics_add_provider()
              : m.settings_analytics_all_providers_added()
          "
        />
      </SelectTrigger>
      <SelectContent side="left">
        <SelectItem
          v-for="provider in availableProviders"
          :key="provider.id"
          :value="provider.id"
        >
          {{ provider.label }}
        </SelectItem>
      </SelectContent>
    </Select>
  </Teleport>

  <div
    class="space-y-4"
    role="form"
    :aria-label="m.settings_analytics_form_label()"
  >
    <div
      v-if="!hasListedProviders && !scanning"
      class="mx-auto w-1/2 rounded-md border border-dashed p-4 text-center text-sm font-medium text-muted-foreground"
      style="border-color: var(--border); background-color: var(--input)"
    >
      {{ m.settings_analytics_empty() }}
    </div>

    <div
      v-for="item in listedCards"
      :key="item.card.key"
      class="space-y-3 rounded-sm border border-solid border-border bg-input/50 px-5 py-2"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-3">
            <span
              class="inline-block h-4 w-1.5 rounded-[1px]"
              :style="{
                backgroundColor: item.card.enabled
                  ? 'var(--primary)'
                  : 'var(--muted-foreground)',
              }"
            />
            <h4 class="text-lg font-sans font-medium leading-none text-foreground">
              {{ item.provider.label }}
            </h4>
          </div>
          <p
            v-if="item.card.origin === 'source' && item.card.file"
            class="mt-2 truncate pl-5 text-xs text-muted-foreground"
          >
            {{ m.settings_analytics_origin_source({ file: item.card.file }) }}
          </p>
        </div>
        <div class="mt-2 flex shrink-0 items-center gap-2">
          <Button
            v-if="item.card.enabled"
            variant="outline"
            size="sm"
            class="h-9.5!"
            :disabled="isSaving"
            :aria-label="
              m.settings_analytics_deactivate_aria({
                provider: item.provider.label,
              })
            "
            @click="onDeactivateProvider(item.card)"
          >
            {{ m.settings_analytics_deactivate() }}
          </Button>
          <Button
            v-else
            variant="outline"
            size="sm"
            class="h-9.5!"
            :disabled="isSaving"
            :aria-label="
              m.settings_analytics_activate_aria({
                provider: item.provider.label,
              })
            "
            @click="onActivateProvider(item.card)"
          >
            {{ m.settings_analytics_activate() }}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            class="h-9.5!"
            :disabled="isSaving"
            :aria-label="
              m.settings_analytics_remove_aria({ provider: item.provider.label })
            "
            @click="onRemoveProvider(item.card)"
          >
            {{ m.settings_analytics_remove() }}
          </Button>
        </div>
      </div>

      <div v-if="fieldDrafts[item.card.key]" class="space-y-7">
        <div
          v-for="field in item.provider.fields"
          :key="field.key"
          class="space-y-3"
        >
          <label class="text-sm font-medium text-foreground">
            {{ providerFieldLabel(item.card.providerId, field) }}
          </label>
          <Input
            v-model="fieldDrafts[item.card.key][field.key]"
            :type="field.type === 'url' ? 'url' : 'text'"
            :placeholder="field.placeholder"
            class="h-9.5! border-border/50 bg-input! font-mono text-sm hover:bg-background!"
            :disabled="isSaving || !item.card.enabled"
            @blur="onFieldBlur(item.card, field)"
          />
          <p
            v-if="
              !validateField(field, fieldDrafts[item.card.key][field.key] || '')
            "
            class="text-xs text-destructive"
          >
            {{
              m.settings_analytics_invalid_field({
                field: providerFieldLabel(item.card.providerId, field),
              })
            }}
          </p>
        </div>
      </div>

      <div v-if="item.provider.docsUrl" class="pb-2 pt-4 text-right">
        <a
          :href="item.provider.docsUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="group inline-flex items-center gap-2 text-xs text-muted-foreground hover:underline"
        >
          <AppIcon
            name="info"
            :size="14"
            class="text-muted-foreground/70 group-hover:text-primary"
          />
          <span>{{ m.settings_analytics_provider_docs() }}</span>
        </a>
      </div>
    </div>
  </div>
</template>
