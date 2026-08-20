<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { confirm } from "@/composables/useConfirm"
import { getReactiveLocale } from "@/lib/locale"
import { scanWorkspace, updateContentLocalization } from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"
import SettingsRow from "@/workspace/settings/SettingsRow.vue"
import {
  SUGGESTED_CONTENT_LOCALE_CODES,
  contentLocaleDisplayName,
} from "@/workspace/settings/lib/contentLocaleCatalog"
import type { SiteSettings } from "@/workspace/settings/types"
import {
  LocaleCodeSchema,
  localeCodesEqual,
  type LocaleCode,
} from "../../../shared/cms"
import {
  DEFAULT_CONTENT_LOCALIZATION,
  cloneContentLocalization,
  inferContentDirection,
  validateContentLocalization,
  type ContentDirection,
  type ContentLocaleDefinition,
  type ContentLocalizationSettings,
} from "../../../shared/localization"

const props = defineProps<{ projectRoot: string; settings: SiteSettings }>()
const emit = defineEmits<{ saved: [settings: SiteSettings] }>()

const draft = ref<ContentLocalizationSettings>(
  cloneContentLocalization(DEFAULT_CONTENT_LOCALIZATION),
)
const cleanSnapshot = ref("")
const saving = ref(false)
const error = ref<string | null>(null)
const existingRoutes = ref<string[]>([])
const persistedLocaleCodes = ref(new Set<string>())
const localeKeys = ref<string[]>([])
const openLocaleIds = ref<string[]>([])
const addLocaleOpen = ref(false)
const addLocaleQuery = ref("")

function createLocaleKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `locale-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function snapshot(value = draft.value) {
  return JSON.stringify(value)
}
const dirty = computed(
  () => Boolean(cleanSnapshot.value) && snapshot() !== cleanSnapshot.value,
)
const issues = computed(() => validateContentLocalization(draft.value))
const issueMessages = computed(() => [
  ...new Set(issues.value.map((issue) => issue.message)),
])
const uiLocale = computed(() => getReactiveLocale())
const resolverKind = computed(
  () => draft.value.resolver?.kind ?? "path-prefix",
)
const usesPathPrefix = computed(() => resolverKind.value === "path-prefix")
const routeConflicts = computed(() =>
  draft.value.locales.flatMap((locale) => {
    if (!usesPathPrefix.value) return []
    if (!locale.enabled || locale.code === draft.value.defaultLocale) return []
    if (locale.pathPrefix?.trim()) return []
    const route = `/${locale.pathPrefix || locale.code}`
    return existingRoutes.value.some((item) => item === route)
      ? [`${locale.label}: ${route}`]
      : []
  }),
)

const usedLocaleCodes = computed(
  () => draft.value.locales.map((locale) => locale.code),
)

const availableSuggestedLocales = computed(() =>
  SUGGESTED_CONTENT_LOCALE_CODES.filter(
    (code) =>
      !usedLocaleCodes.value.some((used) => localeCodesEqual(used, code)),
  )
    .map((code) => ({
      code,
      label: contentLocaleDisplayName(code, uiLocale.value),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, uiLocale.value)),
)

const searchAsLocaleCode = computed(() => {
  const raw = addLocaleQuery.value.trim()
  if (!raw) return null
  const parsed = LocaleCodeSchema.safeParse(raw)
  if (!parsed.success) return null
  const code = parsed.data
  if (usedLocaleCodes.value.some((used) => localeCodesEqual(used, code))) {
    return null
  }
  if (
    availableSuggestedLocales.value.some((item) =>
      localeCodesEqual(item.code, code),
    )
  ) {
    return null
  }
  return code
})

function applySettings(settings: SiteSettings) {
  draft.value = cloneContentLocalization(
    settings.localization?.content ?? DEFAULT_CONTENT_LOCALIZATION,
  )
  persistedLocaleCodes.value = new Set(
    draft.value.locales.map((locale) => locale.code),
  )
  localeKeys.value = draft.value.locales.map(() => createLocaleKey())
  openLocaleIds.value = []
  error.value = null
  cleanSnapshot.value = snapshot()
}

function reset() {
  applySettings(props.settings)
}

watch(
  () => props.settings,
  (settings) => {
    if (!saving.value) applySettings(settings)
  },
  { immediate: true, deep: true },
)

async function scanRoutes() {
  try {
    existingRoutes.value = (await scanWorkspace(props.projectRoot)).pages.map(
      (page) => page.route,
    )
  } catch {
    existingRoutes.value = []
  }
}

onMounted(scanRoutes)
watch(() => props.projectRoot, scanRoutes)

function localeTitle(locale: ContentLocaleDefinition) {
  const label = locale.label.trim()
  if (label) return label
  if (locale.code) return contentLocaleDisplayName(locale.code, uiLocale.value)
  return m.settings_localization_unnamed_locale()
}

function localeUrlPreview(locale: ContentLocaleDefinition) {
  if (!usesPathPrefix.value) {
    const parameter =
      draft.value.resolver?.kind === "query-param"
        ? draft.value.resolver.parameter || "lang"
        : "lang"
    return `?${parameter}=${locale.pathPrefix || locale.code}`
  }
  if (locale.code === draft.value.defaultLocale) {
    return m.settings_localization_url_none()
  }
  return `/${locale.pathPrefix || locale.code}`
}

function fallbackCandidates(locale: ContentLocaleDefinition) {
  return draft.value.locales.filter(
    (candidate) =>
      candidate.enabled &&
      candidate.code !== locale.code &&
      candidate.code.trim().length > 0,
  )
}

function nextPrivateUseCode(): LocaleCode {
  const used = new Set(
    usedLocaleCodes.value.map((code) => code.toLowerCase()),
  )
  for (let index = 0; index < 20 * 26; index += 1) {
    const second = String.fromCharCode(97 + Math.floor(index / 26))
    const third = String.fromCharCode(97 + (index % 26))
    const code = `q${second}${third}`
    if (!used.has(code)) return code as LocaleCode
  }
  return "qaa"
}

function addLocale(code: string, label?: string) {
  const parsed = LocaleCodeSchema.safeParse(code)
  if (!parsed.success) return
  const nextCode = parsed.data
  if (usedLocaleCodes.value.some((used) => localeCodesEqual(used, nextCode))) {
    return
  }
  const resolvedLabel = (
    label === undefined
      ? contentLocaleDisplayName(nextCode, uiLocale.value)
      : label.trim()
  ).slice(0, 80)
  draft.value.locales.push({
    code: nextCode,
    label: resolvedLabel,
    enabled: true,
    direction: inferContentDirection(nextCode),
    fallbacks: draft.value.locales.some((item) =>
      localeCodesEqual(item.code, draft.value.defaultLocale),
    )
      ? [draft.value.defaultLocale]
      : [],
  })
  const key = createLocaleKey()
  localeKeys.value = [...localeKeys.value, key]
  if (!openLocaleIds.value.includes(key)) {
    openLocaleIds.value = [...openLocaleIds.value, key]
  }
  addLocaleOpen.value = false
  addLocaleQuery.value = ""
}

function addCustomLocale() {
  addLocale(nextPrivateUseCode(), m.settings_localization_custom())
}

function updateCode(locale: ContentLocaleDefinition, value: string) {
  const previous = locale.code
  const parsed = LocaleCodeSchema.safeParse(value)
  locale.code = (parsed.success ? parsed.data : value) as LocaleCode
  locale.direction = inferContentDirection(locale.code)
  if (draft.value.defaultLocale === previous) {
    draft.value.defaultLocale = locale.code
  }
  for (const candidate of draft.value.locales) {
    candidate.fallbacks = candidate.fallbacks.map((fallback) =>
      fallback === previous ? locale.code : fallback,
    )
  }
}

function toggleFallback(locale: ContentLocaleDefinition, code: LocaleCode) {
  if (locale.fallbacks.includes(code)) {
    locale.fallbacks = locale.fallbacks.filter((fallback) => fallback !== code)
    return
  }
  locale.fallbacks = [...locale.fallbacks, code]
}

function setDefaultLocale(locale: ContentLocaleDefinition) {
  if (!locale.code.trim()) return
  draft.value.defaultLocale = locale.code
  locale.enabled = true
}

function onEnabledChange(locale: ContentLocaleDefinition, enabled: boolean) {
  if (locale.code === draft.value.defaultLocale) return
  locale.enabled = enabled
}

async function requestRemoval(locale: ContentLocaleDefinition) {
  if (locale.code === draft.value.defaultLocale) {
    error.value = m.settings_localization_default_remove_error()
    return
  }
  const persisted = persistedLocaleCodes.value.has(locale.code)
  if (persisted && locale.enabled) {
    error.value = m.settings_localization_disable_before_remove()
    return
  }
  const ok = await confirm({
    title: m.settings_localization_remove_title({
      locale: localeTitle(locale),
    }),
    description: m.settings_localization_remove_description(),
    confirmLabel: m.settings_localization_remove(),
    cancelLabel: m.settings_cancel(),
    destructive: true,
  })
  if (!ok) return
  const index = draft.value.locales.indexOf(locale)
  if (index < 0) return
  const removedKey = localeKeys.value[index]
  const removedCode = locale.code
  error.value = null
  draft.value.locales.splice(index, 1)
  localeKeys.value.splice(index, 1)
  openLocaleIds.value = openLocaleIds.value.filter((id) => id !== removedKey)
  for (const item of draft.value.locales) {
    item.fallbacks = item.fallbacks.filter(
      (fallback) => fallback !== removedCode,
    )
  }
}

function onResolver(value: unknown) {
  draft.value.resolver =
    value === "query-param"
      ? {
          kind: "query-param",
          parameter:
            draft.value.resolver?.kind === "query-param"
              ? draft.value.resolver.parameter
              : "lang",
        }
      : { kind: "path-prefix" }
}

function onDirection(locale: ContentLocaleDefinition, value: ContentDirection) {
  locale.direction = value
}

function onOpenChange(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    openLocaleIds.value = value
    return
  }
  openLocaleIds.value = typeof value === "string" && value ? [value] : []
}

async function save(): Promise<boolean> {
  error.value = null
  if (issues.value.length) {
    error.value = issueMessages.value.join(" ")
    return false
  }
  if (routeConflicts.value.length) {
    error.value = m.settings_localization_route_conflict({
      routes: routeConflicts.value.join(", "),
    })
    return false
  }
  saving.value = true
  try {
    const next = await updateContentLocalization(
      props.projectRoot,
      cloneContentLocalization(draft.value),
    )
    cleanSnapshot.value = snapshot(next.localization?.content)
    persistedLocaleCodes.value = new Set(
      draft.value.locales.map((locale) => locale.code),
    )
    emit("saved", next)
    return true
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? cause.message
        : m.settings_localization_save_failed()
    return false
  } finally {
    saving.value = false
  }
}

defineExpose({ save, reset, saving, isDirty: () => dirty.value })
</script>

<template>
  <div
    class="space-y-10"
    role="form"
    :aria-label="m.settings_localization_form_label()"
  >
    <Teleport defer to="#settings-tab-actions">
      <Popover v-model:open="addLocaleOpen">
        <PopoverTrigger as-child>
          <Button
            type="button"
            variant="outline"
            size="md"
            :disabled="saving"
          >
            <AppIcon name="plus" :size="14" />
            {{ m.settings_localization_add_locale() }}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" class="w-80 p-0" :side-offset="8">
          <Command>
            <CommandInput
              v-model="addLocaleQuery"
              :placeholder="m.settings_localization_search()"
            />
            <CommandList class="max-h-72">
              <CommandEmpty>
                {{ m.settings_localization_no_matches() }}
              </CommandEmpty>
              <CommandGroup>
                <CommandItem
                  v-for="option in availableSuggestedLocales"
                  :key="option.code"
                  :value="`${option.label} ${option.code}`"
                  class="justify-between gap-3"
                  @select="addLocale(option.code, option.label)"
                >
                  <span class="min-w-0 truncate">{{ option.label }}</span>
                  <span class="shrink-0 font-mono text-xs text-muted-foreground">
                    {{ option.code }}
                  </span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator v-if="availableSuggestedLocales.length > 0" />
              <CommandGroup>
                <CommandItem
                  v-if="searchAsLocaleCode"
                  :value="`add ${searchAsLocaleCode}`"
                  @select="
                    searchAsLocaleCode && addLocale(searchAsLocaleCode)
                  "
                >
                  {{
                    m.settings_localization_add_code({
                      code: searchAsLocaleCode,
                    })
                  }}
                </CommandItem>
                <CommandItem
                  :value="m.settings_localization_custom()"
                  @select="addCustomLocale"
                >
                  {{ m.settings_localization_custom() }}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Teleport>

    <SettingsRow
      :label="m.settings_localization_url_strategy()"
      :description="m.settings_localization_url_strategy_description()"
      input-id="content-locale-resolver"
    >
      <Select
        :model-value="resolverKind"
        :disabled="saving"
        @update:model-value="onResolver"
      >
        <SelectTrigger id="content-locale-resolver" class="w-74! bg-input">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="path-prefix">
            {{ m.settings_localization_url_strategy_path() }}
          </SelectItem>
          <SelectItem value="query-param">
            {{ m.settings_localization_url_strategy_query() }}
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingsRow>

    <SettingsRow
      v-if="draft.resolver?.kind === 'query-param'"
      :label="m.settings_localization_query_parameter()"
      :description="m.settings_localization_query_parameter_hint()"
      input-id="content-locale-parameter"
    >
      <Input
        id="content-locale-parameter"
        v-model="draft.resolver.parameter"
        class="w-74!"
        autocomplete="off"
        spellcheck="false"
        placeholder="lang"
        :disabled="saving"
      />
    </SettingsRow>

    <Accordion
      type="multiple"
      :model-value="openLocaleIds"
      :unmount-on-hide="false"
      class="rounded-md border border-border px-4"
      @update:model-value="onOpenChange"
    >
      <AccordionItem
        v-for="(locale, index) in draft.locales"
        :key="localeKeys[index]"
        :value="localeKeys[index]"
        class="border-border"
      >
        <div class="flex w-full items-center gap-3">
          <AccordionTrigger
            class="min-w-0 flex-1 justify-start gap-2 hover:no-underline"
          >
            <span class="flex min-w-0 items-center gap-2">
              <span class="truncate font-medium text-foreground">
                {{ localeTitle(locale) }}
              </span>
              <span
                class="hidden shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline"
              >
                {{ locale.code }}
              </span>
              <span
                class="hidden truncate text-xs text-muted-foreground sm:inline"
              >
                {{ localeUrlPreview(locale) }}
              </span>
              <span
                v-if="locale.code === draft.defaultLocale"
                class="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
              >
                {{ m.settings_localization_source_badge() }}
              </span>
            </span>
          </AccordionTrigger>

          <div
            class="ml-auto flex shrink-0 items-center gap-2"
            @click.stop
            @pointerdown.stop
          >
            <Switch
              :id="`locale-enabled-${localeKeys[index]}`"
              :model-value="locale.enabled"
              :disabled="saving || locale.code === draft.defaultLocale"
              :aria-label="m.settings_localization_enabled()"
              @update:model-value="onEnabledChange(locale, $event)"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :disabled="saving"
              :aria-label="m.settings_localization_remove()"
              @click="requestRemoval(locale)"
            >
              <AppIcon name="trash" :size="14" />
            </Button>
          </div>
        </div>

        <AccordionContent>
          <div class="space-y-4 pt-1">
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="min-w-0 space-y-1.5">
                <label
                  :for="`locale-label-${localeKeys[index]}`"
                  class="block text-xs font-medium text-muted-foreground"
                >
                  {{ m.settings_localization_label() }}
                </label>
                <Input
                  :id="`locale-label-${localeKeys[index]}`"
                  v-model="locale.label"
                  :disabled="saving"
                />
              </div>

              <div class="min-w-0 space-y-1.5">
                <label
                  :for="`locale-code-${localeKeys[index]}`"
                  class="block text-xs font-medium text-muted-foreground"
                >
                  {{ m.settings_localization_code() }}
                </label>
                <Input
                  :id="`locale-code-${localeKeys[index]}`"
                  :model-value="locale.code"
                  class="font-mono"
                  autocomplete="off"
                  spellcheck="false"
                  :disabled="saving || persistedLocaleCodes.has(locale.code)"
                  @update:model-value="updateCode(locale, String($event))"
                />
                <p
                  v-if="!persistedLocaleCodes.has(locale.code)"
                  class="text-xs text-muted-foreground"
                >
                  {{ m.settings_localization_code_hint() }}
                </p>
              </div>

              <div class="min-w-0 space-y-1.5">
                <span
                  :id="`locale-direction-${localeKeys[index]}`"
                  class="block text-xs font-medium text-muted-foreground"
                >
                  {{ m.settings_localization_direction() }}
                </span>
                <div
                  class="grid grid-cols-2 gap-2"
                  role="radiogroup"
                  :aria-labelledby="`locale-direction-${localeKeys[index]}`"
                >
                  <button
                    v-for="direction in (['ltr', 'rtl'] as const)"
                    :key="direction"
                    type="button"
                    role="radio"
                    class="flex h-9 cursor-pointer select-none items-center justify-center rounded-sm border text-xs font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                    :class="
                      locale.direction === direction
                        ? 'border-solid border-primary/80 bg-background text-foreground'
                        : 'border-dashed border-border/50 bg-input text-muted-foreground hover:border-solid hover:border-border hover:bg-background hover:text-foreground'
                    "
                    :aria-checked="locale.direction === direction"
                    :aria-label="
                      direction === 'ltr'
                        ? m.settings_localization_ltr()
                        : m.settings_localization_rtl()
                    "
                    :disabled="saving"
                    @click="onDirection(locale, direction)"
                  >
                    {{
                      direction === "ltr"
                        ? m.settings_localization_ltr_short()
                        : m.settings_localization_rtl_short()
                    }}
                  </button>
                </div>
              </div>

              <div
                v-if="usesPathPrefix && locale.code === draft.defaultLocale"
                class="min-w-0 space-y-1.5"
              >
                <span class="block text-xs font-medium text-muted-foreground">
                  {{ m.settings_localization_url_prefix() }}
                </span>
                <p class="pt-2 text-xs leading-relaxed text-muted-foreground">
                  {{ m.settings_localization_default_prefix_hint() }}
                </p>
              </div>

              <div
                v-else-if="usesPathPrefix"
                class="min-w-0 space-y-1.5"
              >
                <label
                  :for="`locale-prefix-${localeKeys[index]}`"
                  class="block text-xs font-medium text-muted-foreground"
                >
                  {{ m.settings_localization_url_prefix() }}
                </label>
                <div class="relative">
                  <span
                    class="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-4 font-mono text-sm text-muted-foreground"
                    aria-hidden="true"
                  >
                    /
                  </span>
                  <Input
                    :id="`locale-prefix-${localeKeys[index]}`"
                    v-model="locale.pathPrefix"
                    class="ps-8 font-mono"
                    autocomplete="off"
                    spellcheck="false"
                    :placeholder="locale.code"
                    :disabled="saving"
                  />
                </div>
              </div>
            </div>

            <div class="space-y-1.5">
              <span class="block text-xs font-medium text-muted-foreground">
                {{ m.settings_localization_fallbacks() }}
              </span>
              <p class="text-xs text-muted-foreground">
                {{ m.settings_localization_fallbacks_description() }}
              </p>
              <p
                v-if="fallbackCandidates(locale).length === 0"
                class="text-xs text-muted-foreground"
              >
                {{ m.settings_localization_fallbacks_empty() }}
              </p>
              <div v-else class="flex flex-wrap gap-2">
                <button
                  v-for="candidate in fallbackCandidates(locale)"
                  :key="candidate.code"
                  type="button"
                  class="inline-flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-sm border px-2.5 text-xs font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                  :class="
                    locale.fallbacks.includes(candidate.code)
                      ? 'border-solid border-primary/80 bg-primary/10 text-foreground'
                      : 'border-dashed border-border/50 bg-input text-muted-foreground hover:border-solid hover:border-border hover:bg-background hover:text-foreground'
                  "
                  :aria-pressed="locale.fallbacks.includes(candidate.code)"
                  :disabled="saving"
                  @click="toggleFallback(locale, candidate.code)"
                >
                  <span
                    v-if="locale.fallbacks.includes(candidate.code)"
                    class="tabular-nums text-[10px] text-primary"
                  >
                    {{ locale.fallbacks.indexOf(candidate.code) + 1 }}
                  </span>
                  {{ localeTitle(candidate) }}
                </button>
              </div>
            </div>

            <div
              v-if="locale.code !== draft.defaultLocale"
              class="flex justify-start"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                :disabled="saving || !locale.enabled"
                @click="setDefaultLocale(locale)"
              >
                {{ m.settings_localization_set_default() }}
              </Button>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>

    <div
      v-if="routeConflicts.length"
      role="alert"
      class="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm"
    >
      {{
        m.settings_localization_route_conflict({
          routes: routeConflicts.join(", "),
        })
      }}
    </div>
    <ul
      v-if="issueMessages.length"
      role="alert"
      class="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <li v-for="message in issueMessages" :key="message">{{ message }}</li>
    </ul>
    <p
      v-if="error"
      role="alert"
      class="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {{ error }}
    </p>
  </div>
</template>
