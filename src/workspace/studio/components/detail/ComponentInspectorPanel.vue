<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { confirm } from "@/composables/useConfirm"
import { writeClipboardText } from "@/lib/clipboard"
import {
  deleteWorkspaceStudioDocument,
  duplicateWorkspaceStudioDocument,
  inspectWorkspaceComponent,
  resolveWorkspaceStudioDocument,
  revealWorkspaceStudioDocument,
} from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"
import {
  HeaderActionDropdownTooltip,
  StudioDocumentInspectorPanel,
  StudioNameCreateDialog,
  type StudioDocumentInspectorTab,
} from "@/workspace/studio/core"
import type {
  ComponentDetailManifest,
  ScanComponent,
  StudioDocumentUsage,
} from "../../../../../shared/types"
import ComponentThumbnail from "../ComponentThumbnail.vue"

const props = defineProps<{
  component: ScanComponent
  projectRoot: string
  onRefresh: () => Promise<void> | void
  onOpenComposer: (component: { name: string; file: string }) => void
  onOpenUsage: (usage: StudioDocumentUsage) => void
}>()

const emit = defineEmits<{
  close: []
  duplicated: [component: ScanComponent]
}>()

type TabId = "contract" | "usage"
const activeTab = ref<TabId>("contract")
const manifest = ref<ComponentDetailManifest | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const status = ref("")
const duplicateOpen = ref(false)
const duplicateBusy = ref(false)
const duplicateError = ref<string | null>(null)

const tabs = computed<StudioDocumentInspectorTab[]>(() => [
  { id: "contract", label: m.components_inspector_contract() },
  { id: "usage", label: m.studio_document_usage() },
])
const deleteDisabled = computed(() => Boolean(manifest.value?.usages.length))
const suggestedCopyName = computed(() => {
  const base = props.component.name.replace(/\.[^.]+$/, "")
  const copy = `${base}Copy`
  return props.component.category ? `${props.component.category}/${copy}` : copy
})

watch(
  () => [props.projectRoot, props.component.file] as const,
  () => {
    activeTab.value = "contract"
    void loadManifest()
  },
  { immediate: true },
)

async function loadManifest() {
  loading.value = true
  error.value = null
  try {
    manifest.value = await inspectWorkspaceComponent(props.projectRoot, props.component.file)
  } catch (err: unknown) {
    manifest.value = null
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function openComposer() {
  props.onOpenComposer({ name: props.component.name, file: props.component.file })
}

async function revealDocument() {
  try {
    await revealWorkspaceStudioDocument(props.projectRoot, { kind: "component", file: props.component.file })
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function copyPath() {
  try {
    const result = await resolveWorkspaceStudioDocument(props.projectRoot, { kind: "component", file: props.component.file })
    await writeClipboardText(result.path)
    status.value = m.studio_document_copy_path()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function submitDuplicate(name: string) {
  duplicateBusy.value = true
  duplicateError.value = null
  try {
    const duplicated = await duplicateWorkspaceStudioDocument(props.projectRoot, {
      kind: "component",
      file: props.component.file,
      name,
    })
    duplicateOpen.value = false
    await props.onRefresh()
    emit("duplicated", duplicated)
  } catch (err: unknown) {
    duplicateError.value = err instanceof Error ? err.message : String(err)
  } finally {
    duplicateBusy.value = false
  }
}

async function deleteDocument() {
  if (deleteDisabled.value) {
    activeTab.value = "usage"
    return
  }
  if (!(await confirm({
    title: m.studio_document_delete_title({ name: props.component.name }),
    description: m.studio_document_delete_description(),
    confirmLabel: m.studio_document_delete(),
    destructive: true,
  }))) return
  try {
    const result = await deleteWorkspaceStudioDocument(props.projectRoot, { kind: "component", file: props.component.file })
    if (!result.ok) {
      if (manifest.value) manifest.value = { ...manifest.value, usages: result.usages }
      error.value = m.studio_document_delete_blocked({ count: result.usages.length })
      activeTab.value = "usage"
      return
    }
    await props.onRefresh()
    emit("close")
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function defaultValue(value: unknown): string {
  if (value === undefined) return "—"
  if (typeof value === "string") return value || '""'
  return String(value)
}
</script>

<template>
  <StudioDocumentInspectorPanel
    :title="component.name"
    :description="component.file"
    :close-label="m.studio_document_close_inspector()"
    :tabs="tabs"
    :active-tab="activeTab"
    @close="emit('close')"
    @update:active-tab="activeTab = $event as TabId"
  >
    <template #actions>
      <Button type="button" size="sm" class="h-8" @click="openComposer">
        <AppIcon name="edit" class="me-1.5 size-3.5" aria-hidden="true" />
        {{ m.studio_document_edit_composer() }}
      </Button>
      <HeaderActionDropdownTooltip :label="m.studio_document_actions()">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button type="button" variant="ghost" size="icon-sm" class="size-8" :aria-label="m.studio_document_actions()">
              <AppIcon name="moreHorizontal" :size="14" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuItem class="cursor-pointer text-xs" @select="revealDocument"><AppIcon name="folder" :size="14" aria-hidden="true" />{{ m.studio_document_reveal() }}</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer text-xs" @select="copyPath"><AppIcon name="copy" :size="14" aria-hidden="true" />{{ m.studio_document_copy_path() }}</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer text-xs" @select="duplicateOpen = true"><AppIcon name="duplicate" :size="14" aria-hidden="true" />{{ m.studio_document_duplicate() }}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="cursor-pointer text-xs text-destructive focus:text-destructive" :disabled="deleteDisabled" @select="deleteDocument"><AppIcon name="trash" :size="14" aria-hidden="true" />{{ m.studio_document_delete() }}</DropdownMenuItem>
            <p v-if="deleteDisabled" class="px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">{{ m.studio_document_delete_blocked({ count: manifest?.usages.length ?? 0 }) }}</p>
          </DropdownMenuContent>
        </DropdownMenu>
      </HeaderActionDropdownTooltip>
    </template>

    <template #preview>
      <div class="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-md bg-card shadow-[inset_0_0_0_1px_var(--border)]">
        <ComponentThumbnail :component="component" :project-path="projectRoot">
          <AppIcon name="components" :size="30" class="text-muted-foreground/60" aria-hidden="true" />
        </ComponentThumbnail>
      </div>
    </template>

    <div v-if="loading" class="grid min-h-32 place-items-center text-sm text-muted-foreground" role="status">{{ m.studio_document_loading() }}</div>
    <div v-else-if="error && !manifest" class="space-y-3 text-sm text-destructive" role="alert"><p>{{ error }}</p><Button variant="outline" size="sm" @click="loadManifest">{{ m.studio_document_retry() }}</Button></div>
    <div v-else-if="manifest" class="space-y-5">
      <p v-if="error" class="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{{ error }}</p>

      <template v-if="activeTab === 'contract'">
        <section>
          <div class="mb-2 flex items-center justify-between">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ m.components_detail_props() }}</h2>
            <span class="text-[10px] tabular-nums text-muted-foreground">{{ manifest.props.length }}</span>
          </div>
          <div v-if="manifest.props.length" class="divide-y divide-dashed divide-border rounded-md bg-muted/20">
            <div v-for="field in manifest.props" :key="field.name" class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5">
              <div class="min-w-0"><p class="truncate font-mono text-xs font-medium">{{ field.name }}</p><p class="mt-0.5 text-[10px] text-muted-foreground">{{ field.type }} · {{ field.optional ? m.components_detail_optional() : m.components_detail_required() }}</p></div>
              <code class="max-w-32 truncate text-[10px] text-muted-foreground">{{ defaultValue(field.default) }}</code>
            </div>
          </div>
          <p v-else class="text-xs text-muted-foreground">{{ m.components_detail_no_props() }}</p>
        </section>

        <section>
          <div class="mb-2 flex items-center justify-between"><h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ m.components_detail_slots() }}</h2><span class="text-[10px] tabular-nums text-muted-foreground">{{ manifest.slots.length }}</span></div>
          <div v-if="manifest.slots.length" class="flex flex-wrap gap-1.5"><Badge v-for="slot in manifest.slots" :key="slot" variant="secondary" class="font-mono">{{ slot }}</Badge></div>
          <p v-else class="text-xs text-muted-foreground">{{ m.components_detail_no_slots() }}</p>
        </section>

        <section v-if="manifest.diagnostics.length" class="rounded-md bg-amber-500/8 p-3">
          <h2 class="mb-1.5 text-xs font-medium">{{ m.components_detail_diagnostics() }}</h2>
          <p v-for="diagnostic in manifest.diagnostics" :key="diagnostic" class="text-xs leading-relaxed text-muted-foreground">{{ diagnostic }}</p>
        </section>
      </template>

      <section v-else>
        <ul v-if="manifest.usages.length" class="divide-y divide-dashed divide-border" role="list">
          <li v-for="usage in manifest.usages" :key="`${usage.kind}:${usage.file}`" class="flex min-w-0 items-center gap-3 py-3 first:pt-0">
            <div class="min-w-0 flex-1"><div class="flex items-center gap-2"><Badge variant="outline">{{ usage.kind }}</Badge><p class="truncate text-sm font-medium">{{ usage.label }}</p></div><p class="mt-1 truncate font-mono text-[10px] text-muted-foreground">{{ usage.file }}</p></div>
            <Button type="button" variant="ghost" size="icon-sm" :aria-label="m.studio_document_open_usage({ name: usage.label })" @click="onOpenUsage(usage)"><AppIcon name="arrowRight" :size="14" aria-hidden="true" /></Button>
          </li>
        </ul>
        <p v-else class="text-xs text-muted-foreground">{{ m.studio_document_no_usage() }}</p>
      </section>
    </div>

    <template #status>{{ status }}</template>
  </StudioDocumentInspectorPanel>

  <StudioNameCreateDialog
    v-model:open="duplicateOpen"
    :busy="duplicateBusy"
    :error="duplicateError"
    :initial-value="suggestedCopyName"
    :title="m.studio_document_duplicate_title({ name: component.name })"
    :description="m.studio_document_duplicate_description()"
    :placeholder="m.studio_document_duplicate_placeholder({ name: component.name })"
    :cancel-label="m.components_create_cancel()"
    :submit-label="m.studio_document_duplicate_submit()"
    :creating-label="m.studio_document_duplicating()"
    @submit="submitDuplicate"
  />
</template>
