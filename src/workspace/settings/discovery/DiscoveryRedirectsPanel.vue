<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import {
  createRedirect,
  deleteRedirect,
  flattenRedirectChain,
  importRedirectsCsv,
  listRedirects,
  listRedirectTargets,
  updateRedirect,
} from "@/lib/workspace"
import { redirectsRevision } from "@/workspace/settings/composables/useSlugChangeRedirect"
import {
  normalizeRedirectPath,
  validateRedirectRule,
  type RedirectRule,
  type RedirectTarget,
  type RedirectValidationError,
} from "../../../../shared/redirects"
import { m } from "@/paraglide/messages.js"
import { toast } from "vue-sonner"

const props = defineProps<{
  projectRoot: string
}>()

const isLoading = ref(false)
const isLoadingTargets = ref(false)
const redirects = ref<RedirectRule[]>([])
const redirectTargets = ref<RedirectTarget[]>([])
const showForm = ref(false)
const showImport = ref(false)
const targetPickerOpen = ref(false)
const editingId = ref<string | null>(null)
const fromPath = ref("")
const toPath = ref("")
const statusCode = ref<301 | 302>(301)
const enabled = ref(true)
const csvImport = ref("")
const togglingId = ref<string | null>(null)
const formServerErrors = ref<{
  fromPath?: string
  toPath?: string
  general?: string
}>({})

const livePaths = computed(() => {
  const paths = new Set<string>(["/"])
  for (const target of redirectTargets.value) {
    paths.add(normalizeRedirectPath(target.path))
  }
  return paths
})

const normalizedToPath = computed(() =>
  toPath.value.trim() ? normalizeRedirectPath(toPath.value) : "",
)

const clientFormErrors = computed(() => {
  const errors: {
    fromPath?: string
    toPath?: string
    general?: string
  } = {}
  if (!showForm.value) return errors
  if (!fromPath.value.trim() || !toPath.value.trim()) return errors

  const validation = validateRedirectRule(
    {
      fromPath: fromPath.value,
      toPath: toPath.value,
      statusCode: statusCode.value,
      enabled: enabled.value,
    },
    {
      existingRules: redirects.value,
      livePaths: livePaths.value,
    },
    { excludeId: editingId.value ?? undefined },
  )
  for (const error of validation) {
    const field = error.field as RedirectValidationError["field"]
    if (!errors[field]) errors[field] = error.message
  }
  return errors
})

const visibleFormErrors = computed(() => ({
  fromPath: formServerErrors.value.fromPath ?? clientFormErrors.value.fromPath,
  toPath: formServerErrors.value.toPath ?? clientFormErrors.value.toPath,
  general: formServerErrors.value.general ?? clientFormErrors.value.general,
}))

const canSaveRule = computed(() => {
  if (!fromPath.value.trim() || !toPath.value.trim()) return false
  return (
    !visibleFormErrors.value.fromPath &&
    !visibleFormErrors.value.toPath &&
    !visibleFormErrors.value.general
  )
})

function clearFormServerErrors() {
  formServerErrors.value = {}
}

function applyServerValidationError(message: string): boolean {
  const lower = message.toLowerCase()
  if (lower.includes("source") || lower.includes("from") || lower.includes("live page")) {
    formServerErrors.value = { fromPath: message }
    return true
  }
  if (lower.includes("destination") || lower.includes("to path") || lower.includes("unsafe") || lower.includes("external")) {
    formServerErrors.value = { toPath: message }
    return true
  }
  if (lower.includes("loop") || lower.includes("already exists")) {
    formServerErrors.value = { general: message }
    return true
  }
  return false
}

function resetForm() {
  showForm.value = false
  editingId.value = null
  fromPath.value = ""
  toPath.value = ""
  statusCode.value = 301
  enabled.value = true
  clearFormServerErrors()
}

function openAddForm() {
  showImport.value = false
  editingId.value = null
  fromPath.value = ""
  toPath.value = ""
  statusCode.value = 301
  enabled.value = true
  clearFormServerErrors()
  showForm.value = true
}

function toggleImport() {
  showForm.value = false
  resetForm()
  showImport.value = !showImport.value
}

function editRule(rule: RedirectRule) {
  showImport.value = false
  editingId.value = rule.id
  fromPath.value = rule.fromPath
  toPath.value = rule.toPath
  statusCode.value = rule.statusCode
  enabled.value = rule.enabled
  clearFormServerErrors()
  showForm.value = true
}

function selectRedirectTarget(target: RedirectTarget) {
  toPath.value = target.path
  targetPickerOpen.value = false
}

async function loadRedirects() {
  const { redirects: next } = await listRedirects(props.projectRoot, {
    includeDisabled: true,
  })
  redirects.value = next
}

async function loadRedirectTargets() {
  isLoadingTargets.value = true
  try {
    const { targets } = await listRedirectTargets(props.projectRoot)
    redirectTargets.value = targets
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : m.settings_discovery_redirects_load_targets_failed(),
    )
  } finally {
    isLoadingTargets.value = false
  }
}

async function hydrateRedirects() {
  isLoading.value = true
  try {
    await loadRedirects()
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : m.settings_discovery_redirects_load_failed(),
    )
  } finally {
    isLoading.value = false
  }
}

async function setRuleEnabled(rule: RedirectRule, nextEnabled: boolean) {
  togglingId.value = rule.id
  const previous = rule.enabled
  redirects.value = redirects.value.map((item: RedirectRule) =>
    item.id === rule.id ? { ...item, enabled: nextEnabled } : item,
  )
  try {
    await updateRedirect(props.projectRoot, {
      id: rule.id,
      enabled: nextEnabled,
    })
    await loadRedirects()
  } catch (error) {
    redirects.value = redirects.value.map((item: RedirectRule) =>
      item.id === rule.id ? { ...item, enabled: previous } : item,
    )
    toast.error(
      error instanceof Error
        ? error.message
        : m.settings_discovery_redirects_update_failed(),
    )
  } finally {
    togglingId.value = null
  }
}

async function saveRule() {
  clearFormServerErrors()
  if (!canSaveRule.value) return
  try {
    if (editingId.value) {
      await updateRedirect(props.projectRoot, {
        id: editingId.value,
        fromPath: fromPath.value,
        toPath: toPath.value,
        statusCode: statusCode.value,
        enabled: enabled.value,
      })
    } else {
      await createRedirect(props.projectRoot, {
        fromPath: fromPath.value,
        toPath: toPath.value,
        statusCode: statusCode.value,
        enabled: true,
      })
    }
    resetForm()
    await loadRedirects()
    toast.success(m.settings_discovery_redirects_saved())
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : m.settings_discovery_redirects_save_failed()
    if (!applyServerValidationError(message)) {
      toast.error(message)
    }
  }
}

async function deleteRule(id: string) {
  try {
    await deleteRedirect(props.projectRoot, id)
    await loadRedirects()
    toast.success(m.settings_discovery_redirects_deleted())
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : m.settings_discovery_redirects_delete_failed(),
    )
  }
}

async function flattenRule(id: string) {
  try {
    await flattenRedirectChain(props.projectRoot, id)
    await loadRedirects()
    toast.success(m.settings_discovery_redirects_flattened())
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : m.settings_discovery_redirects_flatten_failed(),
    )
  }
}

async function importCsvRules() {
  if (!csvImport.value.trim()) return
  try {
    const result = await importRedirectsCsv(props.projectRoot, {
      csv: csvImport.value,
      replaceExisting: false,
    })
    csvImport.value = ""
    showImport.value = false
    await loadRedirects()
    toast.success(
      m.settings_discovery_redirects_imported({
        count: String(result.imported),
      }),
    )
    if (result.errors.length > 0) {
      toast.error(result.errors.slice(0, 3).join(" · "))
    }
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : m.settings_discovery_redirects_import_failed(),
    )
  }
}

onMounted(() => {
  void hydrateRedirects()
  void loadRedirectTargets()
})

watch(
  () => props.projectRoot,
  () => {
    void hydrateRedirects()
    void loadRedirectTargets()
  },
)

watch(redirectsRevision, () => {
  void hydrateRedirects()
})

watch([fromPath, toPath, statusCode, enabled], () => {
  clearFormServerErrors()
})
</script>

<template>
  <div
    class="space-y-7"
    role="region"
    :aria-label="m.settings_discovery_redirects_form_label()"
  >
    <div class="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        :disabled="isLoading"
        @click="toggleImport"
      >
        <AppIcon name="upload" :size="14" class="mr-1.5" />
        {{ m.settings_discovery_redirects_import_csv() }}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        :disabled="isLoading"
        @click="openAddForm"
      >
        <AppIcon name="plus" :size="14" class="mr-1.5" />
        {{ m.settings_discovery_redirects_add() }}
      </Button>
    </div>

    <section v-if="showImport" class="space-y-2 pb-2">
      <div class="flex items-center justify-between gap-3">
        <h4
          class="m-0 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
        >
          {{ m.settings_discovery_redirects_import_csv() }}
        </h4>
        <Button type="button" size="sm" variant="ghost" @click="showImport = false">
          {{ m.settings_cancel() }}
        </Button>
      </div>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
        <textarea
          v-model="csvImport"
          rows="4"
          class="min-h-[6.5rem] flex-1 rounded-md border border-input bg-input px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring"
          placeholder="/old-page,/new-page,301"
        />
        <div class="flex shrink-0 flex-col gap-2 sm:w-32">
          <Button
            size="sm"
            :disabled="isLoading || csvImport.trim().length === 0"
            @click="importCsvRules"
          >
            {{ m.settings_discovery_redirects_import() }}
          </Button>
          <p class="m-0 text-[10px] leading-relaxed text-muted-foreground/70">
            {{ m.settings_discovery_redirects_csv_hint() }}
          </p>
        </div>
      </div>
    </section>

    <section
      v-if="showForm"
      class="space-y-5 border-y border-border/70 py-5"
    >
      <h4
        class="m-0 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
      >
        {{
          editingId
            ? m.settings_discovery_redirects_edit()
            : m.settings_discovery_redirects_add()
        }}
      </h4>
      <p
        v-if="visibleFormErrors.general"
        class="m-0 text-xs text-destructive"
      >
        {{ visibleFormErrors.general }}
      </p>
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="min-w-0 space-y-2">
          <Label for="redirect-from-path" class="text-xs text-muted-foreground">
            {{ m.settings_discovery_redirects_source() }}
          </Label>
          <Input
            id="redirect-from-path"
            v-model="fromPath"
            placeholder="/from"
            class="h-9 min-w-0 bg-input font-mono text-xs"
            :class="visibleFormErrors.fromPath ? 'border-destructive' : ''"
            :aria-invalid="Boolean(visibleFormErrors.fromPath)"
          />
          <p
            v-if="visibleFormErrors.fromPath"
            class="m-0 text-[10px] leading-relaxed text-destructive"
          >
            {{ visibleFormErrors.fromPath }}
          </p>
        </div>
        <div class="min-w-0 space-y-2">
          <Label for="redirect-to-path" class="text-xs text-muted-foreground">
            {{ m.settings_discovery_redirects_destination() }}
          </Label>
          <div class="flex min-w-0 gap-2">
            <Input
              id="redirect-to-path"
              v-model="toPath"
              placeholder="/to"
              class="h-9 min-w-0 flex-1 bg-input font-mono text-xs"
              :class="visibleFormErrors.toPath ? 'border-destructive' : ''"
              :aria-invalid="Boolean(visibleFormErrors.toPath)"
            />
            <Popover v-model:open="targetPickerOpen">
              <PopoverTrigger as-child>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="h-9 shrink-0"
                  :disabled="isLoadingTargets"
                >
                  <AppIcon name="link" :size="14" class="mr-1.5" />
                  {{ m.settings_discovery_redirects_browse() }}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" class="w-80 p-0">
                <Command>
                  <CommandInput
                    :placeholder="m.settings_discovery_redirects_search_targets()"
                  />
                  <CommandList class="max-h-72">
                    <CommandEmpty>
                      {{ m.settings_discovery_redirects_no_targets() }}
                    </CommandEmpty>
                    <CommandGroup
                      :heading="m.settings_discovery_redirects_pages()"
                    >
                      <CommandItem
                        v-for="target in redirectTargets"
                        :key="target.id"
                        :value="`${target.title} ${target.path}`"
                        class="flex items-center gap-2"
                        @select="selectRedirectTarget(target)"
                      >
                        <span class="min-w-0 flex-1 truncate text-xs">
                          {{ target.title }}
                        </span>
                        <span
                          class="shrink-0 font-mono text-[10px] text-muted-foreground/70"
                        >
                          {{ target.path }}
                        </span>
                        <AppIcon
                          v-if="target.path === normalizedToPath"
                          name="check"
                          :size="14"
                          class="text-primary"
                        />
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <p
            v-if="visibleFormErrors.toPath"
            class="m-0 text-[10px] leading-relaxed text-destructive"
          >
            {{ visibleFormErrors.toPath }}
          </p>
        </div>
      </div>

      <div
        class="flex flex-col gap-4 border-t border-border/70 pt-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div class="space-y-2">
          <Label class="text-xs text-muted-foreground">
            {{ m.settings_discovery_redirects_status() }}
          </Label>
          <div
            class="inline-flex h-9 overflow-hidden rounded-md border border-border/70 bg-input/30"
            role="radiogroup"
            :aria-label="m.settings_discovery_redirects_status_aria()"
          >
            <button
              type="button"
              class="h-9 px-3 text-xs font-medium transition-colors hover:text-foreground"
              :class="
                statusCode === 301
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground'
              "
              role="radio"
              :aria-checked="statusCode === 301"
              @click="statusCode = 301"
            >
              {{ m.settings_discovery_redirects_permanent() }}
            </button>
            <button
              type="button"
              class="h-9 border-l border-border/70 px-3 text-xs font-medium transition-colors hover:text-foreground"
              :class="
                statusCode === 302
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground'
              "
              role="radio"
              :aria-checked="statusCode === 302"
              @click="statusCode = 302"
            >
              {{ m.settings_discovery_redirects_temporary() }}
            </button>
          </div>
        </div>
        <div class="flex items-center gap-2 sm:justify-end">
          <Button type="button" size="sm" variant="ghost" @click="resetForm">
            {{ m.settings_cancel() }}
          </Button>
          <Button
            size="sm"
            :disabled="isLoading || !canSaveRule"
            @click="saveRule"
          >
            {{ m.settings_done() }}
          </Button>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <h4
        class="m-0 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
      >
        {{ m.settings_discovery_redirects_rules() }}
      </h4>
      <div class="border-y border-border/70">
        <div
          class="hidden grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_4.5rem_5rem_minmax(11rem,auto)] gap-4 border-b border-border/70 py-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground lg:grid"
        >
          <span>{{ m.settings_discovery_redirects_from() }}</span>
          <span>{{ m.settings_discovery_redirects_to() }}</span>
          <span>{{ m.settings_discovery_redirects_code() }}</span>
          <span>{{ m.settings_discovery_redirects_active() }}</span>
          <span class="text-right">
            {{ m.settings_discovery_redirects_actions() }}
          </span>
        </div>

        <div
          v-if="isLoading && redirects.length === 0"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          {{ m.settings_discovery_redirects_loading() }}
        </div>
        <div
          v-else-if="redirects.length === 0"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          {{ m.settings_discovery_redirects_empty() }}
        </div>

        <div v-else class="divide-y divide-border/70">
          <article
            v-for="rule in redirects"
            :key="rule.id"
            class="grid gap-3 py-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_4.5rem_5rem_minmax(11rem,auto)] lg:items-center lg:gap-4"
          >
            <div class="min-w-0">
              <p class="m-0 truncate font-mono text-xs text-foreground">
                {{ rule.fromPath }}
              </p>
            </div>
            <div class="min-w-0">
              <p class="m-0 truncate font-mono text-xs text-foreground">
                {{ rule.toPath }}
              </p>
            </div>
            <div>
              <p class="m-0 text-xs tabular-nums text-muted-foreground">
                {{ rule.statusCode }}
              </p>
            </div>
            <div>
              <Switch
                :model-value="rule.enabled"
                :disabled="togglingId === rule.id"
                @update:model-value="
                  (value: boolean) => setRuleEnabled(rule, value)
                "
              />
            </div>
            <div class="flex flex-wrap items-center gap-1.5 lg:justify-end">
              <Button
                variant="ghost"
                size="sm"
                class="h-8 px-2"
                :aria-label="
                  m.settings_discovery_redirects_edit_aria({
                    path: rule.fromPath,
                  })
                "
                @click="editRule(rule)"
              >
                <AppIcon name="edit" :size="14" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-8"
                @click="flattenRule(rule.id)"
              >
                {{ m.settings_discovery_redirects_flatten() }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-8 w-8 p-0!"
                :aria-label="
                  m.settings_discovery_redirects_delete_aria({
                    path: rule.fromPath,
                  })
                "
                @click="deleteRule(rule.id)"
              >
                <AppIcon name="trash" :size="14" />
              </Button>
            </div>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>
