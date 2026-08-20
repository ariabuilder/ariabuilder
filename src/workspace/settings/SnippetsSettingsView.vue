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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { confirm } from "@/composables/useConfirm"
import { scanInjections, setSiteSettings, updateSourceInjection } from "@/lib/workspace"
import SnippetCodeEditor from "@/workspace/settings/SnippetCodeEditor.vue"
import type {
  CodeSnippet,
  CodeSnippetPlacement,
  SiteSettings,
} from "@/workspace/settings/types"
import type { InjectionScanResult, SourceInjectionFinding } from "../../../shared/injections"
import { m } from "@/paraglide/messages.js"
import { toast } from "vue-sonner"

const props = defineProps<{
  projectRoot: string
  settings: SiteSettings
}>()

const emit = defineEmits<{
  saved: [settings: SiteSettings]
}>()

type SnippetOrigin = "source" | "aria" | "draft"

type SnippetRow = {
  origin: SnippetOrigin
  id: string
  name: string
  placement: CodeSnippetPlacement
  code: string
  enabled: boolean
  file?: string
}

const PLACEMENTS: readonly CodeSnippetPlacement[] = [
  "header",
  "body",
  "footer",
]

const snippets = ref<SnippetRow[]>([])
const openSnippetIds = ref<string[]>([])
const saving = ref(false)
const scanning = ref(false)
const error = ref<string | null>(null)
const cleanSnapshot = ref("")
const targetLayout = ref<string | null>(null)

function snippetsSnapshot() {
  return JSON.stringify(snippets.value)
}

function patchSnapshotEnabled(id: string, enabled: boolean): string {
  if (!cleanSnapshot.value) return snippetsSnapshot()
  const parsed = JSON.parse(cleanSnapshot.value) as SnippetRow[]
  const match = parsed.find((item) => item.id === id)
  if (match) match.enabled = enabled
  return JSON.stringify(parsed)
}

const dirty = computed(
  () => Boolean(cleanSnapshot.value) && snippetsSnapshot() !== cleanSnapshot.value,
)

function normalizeHtml(html: string): string {
  return html.replace(/\s+/g, " ").trim()
}

function findingToRow(finding: SourceInjectionFinding): SnippetRow {
  return {
    origin: "source",
    id: finding.id,
    name: finding.name,
    placement: finding.placement,
    code: finding.rawHtml,
    enabled: finding.enabled,
    file: finding.file,
  }
}

function ariaToRow(snippet: CodeSnippet): SnippetRow {
  return {
    origin: "aria",
    id: snippet.id,
    name: snippet.name,
    placement: snippet.placement,
    code: snippet.code,
    enabled: snippet.enabled,
  }
}

function ariaRemnants(
  list: CodeSnippet[] | undefined,
  scan: InjectionScanResult,
): CodeSnippet[] {
  const sourceHtml = new Set(
    scan.snippets.map((item) => normalizeHtml(item.rawHtml)).filter(Boolean),
  )
  return (list ?? []).filter((snippet) => {
    const html = normalizeHtml(snippet.code)
    return !html || !sourceHtml.has(html)
  })
}

function applyRows(next: SnippetRow[]) {
  snippets.value = next
  const alive = new Set(next.map((snippet) => snippet.id))
  openSnippetIds.value = openSnippetIds.value.filter((id) => alive.has(id))
  error.value = null
  cleanSnapshot.value = JSON.stringify(next)
}

function mergeScan(
  scan: InjectionScanResult,
  settings: SiteSettings,
  drafts: SnippetRow[] = [],
) {
  targetLayout.value = scan.targetLayout
  applyRows([
    ...scan.snippets.map(findingToRow),
    ...ariaRemnants(settings.snippets, scan).map(ariaToRow),
    ...drafts,
  ])
}

async function refreshScan(
  drafts: SnippetRow[] = [],
  settingsOverride?: SiteSettings,
): Promise<void> {
  if (!props.projectRoot) return
  scanning.value = true
  try {
    const scan = await scanInjections(props.projectRoot)
    mergeScan(scan, settingsOverride ?? props.settings, drafts)
  } catch (err: unknown) {
    error.value =
      err instanceof Error ? err.message : m.settings_injections_scan_failed()
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

function reset() {
  void refreshScan()
}

function placementLabel(placement: CodeSnippetPlacement): string {
  switch (placement) {
    case "header":
      return m.settings_snippets_placement_header()
    case "body":
      return m.settings_snippets_placement_body()
    case "footer":
      return m.settings_snippets_placement_footer()
  }
}

function snippetTitle(snippet: SnippetRow): string {
  const name = snippet.name.trim()
  if (name) return name
  return m.settings_snippets_name_placeholder()
}

function originLabel(snippet: SnippetRow): string {
  if (snippet.origin === "source" && snippet.file) {
    return m.settings_snippets_origin_source({ file: snippet.file })
  }
  return m.settings_snippets_origin_aria()
}

function createSnippetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function addSnippet() {
  const id = createSnippetId()
  snippets.value.push({
    origin: "draft",
    id,
    name: "",
    placement: "header",
    code: "",
    enabled: true,
  })
  if (!openSnippetIds.value.includes(id)) {
    openSnippetIds.value = [...openSnippetIds.value, id]
  }
}

async function persistAriaSnippets(nextAria: CodeSnippet[]): Promise<SiteSettings> {
  const saved = await setSiteSettings(props.projectRoot, {
    siteName: props.settings.siteName,
    siteDescription: props.settings.siteDescription,
    siteUrl: props.settings.siteUrl,
    timeZone: props.settings.timeZone,
    favicon: props.settings.favicon,
    snippets: nextAria,
  })
  emit("saved", saved)
  return saved
}

async function removeSnippet(id: string) {
  const snippet = snippets.value.find((item) => item.id === id)
  if (!snippet) return
  const name =
    snippet.name.trim() || m.settings_snippets_delete_confirm_unnamed()
  const description =
    snippet.origin === "source" && snippet.file
      ? m.settings_snippets_delete_confirm_description_source({
          name,
          file: snippet.file,
        })
      : m.settings_snippets_delete_confirm_description({ name })
  const ok = await confirm({
    title: m.settings_snippets_delete_confirm_title(),
    description,
    confirmLabel: m.settings_snippets_delete_confirm(),
    cancelLabel: m.settings_cancel(),
    destructive: true,
  })
  if (!ok) return

  if (snippet.origin === "source") {
    saving.value = true
    try {
      await updateSourceInjection(props.projectRoot, { op: "delete", id: snippet.id })
      await refreshScan(snippets.value.filter((item) => item.origin === "draft" && item.id !== id))
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : m.settings_snippets_save_failed()
      error.value = message
      toast.error(m.settings_snippets_save_failed(), { description: message })
    } finally {
      saving.value = false
    }
    return
  }

  snippets.value = snippets.value.filter((item) => item.id !== id)
  openSnippetIds.value = openSnippetIds.value.filter((openId) => openId !== id)
}

function onPlacementChange(id: string, value: unknown) {
  if (typeof value !== "string") return
  if (value !== "header" && value !== "body" && value !== "footer") return
  const snippet = snippets.value.find((item) => item.id === id)
  if (!snippet) return
  snippet.placement = value
}

async function onEnabledChange(id: string, checked: boolean) {
  const snippet = snippets.value.find((item) => item.id === id)
  if (!snippet) return
  if (snippet.origin !== "source") {
    snippet.enabled = checked
    return
  }
  const previous = snippet.enabled
  snippet.enabled = checked
  saving.value = true
  try {
    await updateSourceInjection(props.projectRoot, {
      op: "setEnabled",
      id: snippet.id,
      enabled: checked,
    })
    cleanSnapshot.value = patchSnapshotEnabled(snippet.id, checked)
  } catch (err: unknown) {
    snippet.enabled = previous
    const message =
      err instanceof Error ? err.message : m.settings_snippets_save_failed()
    toast.error(m.settings_snippets_save_failed(), { description: message })
  } finally {
    saving.value = false
  }
}

function onOpenChange(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    openSnippetIds.value = value
    return
  }
  openSnippetIds.value = typeof value === "string" && value ? [value] : []
}

function ariaPayload(rows: SnippetRow[]): CodeSnippet[] {
  return rows
    .filter((row) => row.origin === "aria" || row.origin === "draft")
    .map((snippet) => ({
      id: snippet.id,
      name: snippet.name.trim(),
      placement: snippet.placement,
      code: snippet.code,
      enabled: snippet.enabled,
    }))
}

/** Persist the draft. Returns true when written successfully. */
async function save(): Promise<boolean> {
  error.value = null
  saving.value = true
  try {
    const drafts = snippets.value.filter((row) => row.origin === "draft" && row.code.trim())
    const sourceEdits = snippets.value.filter((row) => row.origin === "source")
    const writeToLayout = Boolean(targetLayout.value)

    for (const row of sourceEdits) {
      await updateSourceInjection(props.projectRoot, {
        op: "edit",
        id: row.id,
        code: row.code,
        name: row.name,
        placement: row.placement,
      })
    }

    if (writeToLayout) {
      for (const draft of drafts) {
        await updateSourceInjection(props.projectRoot, {
          op: "addSnippet",
          name: draft.name,
          placement: draft.placement,
          code: draft.code,
        })
      }
      const saved = await persistAriaSnippets(
        ariaPayload(snippets.value.filter((row) => row.origin === "aria")),
      )
      await refreshScan([], saved)
    } else {
      const saved = await persistAriaSnippets(
        ariaPayload(snippets.value.filter((row) => row.origin !== "source")),
      )
      await refreshScan([], saved)
    }

    toast.success(m.settings_snippets_save_success())
    return true
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : m.settings_snippets_save_failed()
    error.value = message
    toast.error(m.settings_snippets_save_failed(), { description: message })
    return false
  } finally {
    saving.value = false
  }
}

defineExpose({
  save,
  reset,
  saving,
  addSnippet,
  isDirty: () => dirty.value,
})
</script>

<template>
  <div
    class="mx-auto max-w-4xl space-y-8"
    role="form"
    :aria-label="m.settings_snippets_form_label()"
  >
    <div
      v-if="snippets.length === 0 && !scanning"
      class="rounded-lg border border-dashed border-border px-5 py-10 text-center"
    >
      <p class="text-sm text-muted-foreground">
        {{ m.settings_snippets_empty() }}
      </p>
    </div>

    <Accordion
      v-else-if="snippets.length > 0"
      type="multiple"
      :model-value="openSnippetIds"
      :unmount-on-hide="false"
      class="rounded-md border border-border px-4"
      @update:model-value="onOpenChange"
    >
      <AccordionItem
        v-for="(snippet, index) in snippets"
        :key="snippet.id"
        :value="snippet.id"
        class="border-border"
      >
          <div class="flex w-full items-center gap-3">
            <AccordionTrigger
              class="min-w-0 flex-1 justify-start gap-2 hover:no-underline"
            >
              <span class="truncate font-medium text-foreground">
                {{ snippetTitle(snippet) }}
              </span>
            </AccordionTrigger>

            <div
              class="ml-auto flex shrink-0 items-center gap-2"
              @click.stop
              @pointerdown.stop
            >
            <span
              class="max-w-40 truncate rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              :title="originLabel(snippet)"
            >
              {{ originLabel(snippet) }}
            </span>
            <span
              class="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {{ placementLabel(snippet.placement) }}
            </span>
            <Switch
              :id="`snippet-enabled-${snippet.id}`"
              :model-value="snippet.enabled"
              :disabled="saving"
              :aria-label="m.settings_snippets_enabled()"
              @update:model-value="onEnabledChange(snippet.id, $event)"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :disabled="saving"
              :aria-label="m.settings_snippets_delete()"
              @click="removeSnippet(snippet.id)"
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
                  :for="`snippet-name-${snippet.id}`"
                  class="block text-xs font-medium text-muted-foreground"
                >
                  {{ m.settings_snippets_name() }}
                </label>
                <Input
                  :id="`snippet-name-${snippet.id}`"
                  v-model="snippet.name"
                  type="text"
                  :placeholder="m.settings_snippets_name_placeholder()"
                  :disabled="saving"
                />
              </div>

              <div class="min-w-0 space-y-1.5">
                <label
                  :for="`snippet-placement-${snippet.id}`"
                  class="block text-xs font-medium text-muted-foreground"
                >
                  {{ m.settings_snippets_placement() }}
                </label>
                <Select
                  :model-value="snippet.placement"
                  :disabled="saving"
                  @update:model-value="onPlacementChange(snippet.id, $event)"
                >
                  <SelectTrigger :id="`snippet-placement-${snippet.id}`">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="placement in PLACEMENTS"
                      :key="placement"
                      :value="placement"
                    >
                      {{ placementLabel(placement) }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div class="space-y-1.5">
              <label
                :for="`snippet-code-${snippet.id}`"
                class="block text-xs font-medium text-muted-foreground"
              >
                {{ m.settings_snippets_code() }}
              </label>
              <SnippetCodeEditor
                v-model="snippet.code"
                :input-id="`snippet-code-${snippet.id}`"
                :placeholder="m.settings_snippets_code_placeholder()"
                :disabled="saving"
                :aria-label="`${m.settings_snippets_code()} ${index + 1}`"
              />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>

    <p v-if="error" class="text-xs text-destructive" role="alert">
      {{ error }}
    </p>
  </div>
</template>
