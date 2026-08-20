<script setup lang="ts">
import { computed, ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { confirm } from "@/composables/useConfirm"
import { writeClipboardText } from "@/lib/clipboard"
import { deleteWorkspaceStudioDocument, duplicateWorkspaceStudioDocument, resolveWorkspaceStudioDocument, revealWorkspaceStudioDocument } from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"
import { HeaderActionDropdownTooltip, StudioDocumentInspectorPanel, StudioNameCreateDialog, type StudioDocumentInspectorTab } from "@/workspace/studio/core"
import type { LayoutPreviewManifest, ScanComponent, StudioDocumentUsage } from "../../../../../shared/types"
import LayoutGridCard from "../LayoutGridCard.vue"

const props = defineProps<{
  manifest: LayoutPreviewManifest
  projectRoot: string
  onRefresh: () => Promise<void> | void
  onOpenComposer: (layout: Pick<ScanComponent, "name" | "file">) => void
  onOpenUsage: (usage: StudioDocumentUsage) => void
}>()
const emit = defineEmits<{ close: []; duplicated: [layout: ScanComponent] }>()

type TabId = "slots" | "usage"
const activeTab = ref<TabId>("slots")
const error = ref<string | null>(null)
const status = ref("")
const duplicateOpen = ref(false)
const duplicateBusy = ref(false)
const duplicateError = ref<string | null>(null)
const tabs = computed<StudioDocumentInspectorTab[]>(() => [
  { id: "slots", label: m.layouts_detail_slots() },
  { id: "usage", label: m.studio_document_usage() },
])
const usages = computed<StudioDocumentUsage[]>(() => props.manifest.consumers.map((consumer) => ({
  kind: "page",
  file: consumer.file,
  label: consumer.title || consumer.route,
  route: consumer.route,
  referenceCount: 1,
})))
const deleteDisabled = computed(() => usages.value.length > 0)
const suggestedCopyName = computed(() => `${props.manifest.layout.name.replace(/\.astro$/i, "")}Copy`)

async function revealDocument() {
  try { await revealWorkspaceStudioDocument(props.projectRoot, { kind: "layout", file: props.manifest.layout.file }) }
  catch (err: unknown) { error.value = err instanceof Error ? err.message : String(err) }
}
async function copyPath() {
  try {
    const result = await resolveWorkspaceStudioDocument(props.projectRoot, { kind: "layout", file: props.manifest.layout.file })
    await writeClipboardText(result.path)
    status.value = m.studio_document_copy_path()
  } catch (err: unknown) { error.value = err instanceof Error ? err.message : String(err) }
}
async function submitDuplicate(name: string) {
  duplicateBusy.value = true
  duplicateError.value = null
  try {
    const duplicated = await duplicateWorkspaceStudioDocument(props.projectRoot, { kind: "layout", file: props.manifest.layout.file, name })
    duplicateOpen.value = false
    await props.onRefresh()
    emit("duplicated", duplicated)
  } catch (err: unknown) { duplicateError.value = err instanceof Error ? err.message : String(err) }
  finally { duplicateBusy.value = false }
}
async function deleteDocument() {
  if (deleteDisabled.value) { activeTab.value = "usage"; return }
  if (!(await confirm({ title: m.studio_document_delete_title({ name: props.manifest.layout.name }), description: m.studio_document_delete_description(), confirmLabel: m.studio_document_delete(), destructive: true }))) return
  try {
    const result = await deleteWorkspaceStudioDocument(props.projectRoot, { kind: "layout", file: props.manifest.layout.file })
    if (!result.ok) { error.value = m.studio_document_delete_blocked({ count: result.usages.length }); activeTab.value = "usage"; return }
    await props.onRefresh()
    emit("close")
  } catch (err: unknown) { error.value = err instanceof Error ? err.message : String(err) }
}
</script>

<template>
  <StudioDocumentInspectorPanel
    :title="manifest.layout.name"
    :description="manifest.layout.file"
    :close-label="m.studio_document_close_inspector()"
    :tabs="tabs"
    :active-tab="activeTab"
    @close="emit('close')"
    @update:active-tab="activeTab = $event as TabId"
  >
    <template #actions>
      <Button type="button" size="sm" class="h-8" @click="onOpenComposer(manifest.layout)"><AppIcon name="edit" class="me-1.5 size-3.5" aria-hidden="true" />{{ m.studio_document_edit_composer() }}</Button>
      <HeaderActionDropdownTooltip :label="m.studio_document_actions()">
        <DropdownMenu>
          <DropdownMenuTrigger as-child><Button type="button" variant="ghost" size="icon-sm" class="size-8" :aria-label="m.studio_document_actions()"><AppIcon name="moreHorizontal" :size="14" aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuItem class="cursor-pointer text-xs" @select="revealDocument"><AppIcon name="folder" :size="14" aria-hidden="true" />{{ m.studio_document_reveal() }}</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer text-xs" @select="copyPath"><AppIcon name="copy" :size="14" aria-hidden="true" />{{ m.studio_document_copy_path() }}</DropdownMenuItem>
            <DropdownMenuItem class="cursor-pointer text-xs" @select="duplicateOpen = true"><AppIcon name="duplicate" :size="14" aria-hidden="true" />{{ m.studio_document_duplicate() }}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="cursor-pointer text-xs text-destructive focus:text-destructive" :disabled="deleteDisabled" @select="deleteDocument"><AppIcon name="trash" :size="14" aria-hidden="true" />{{ m.studio_document_delete() }}</DropdownMenuItem>
            <p v-if="deleteDisabled" class="px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">{{ m.studio_document_delete_blocked({ count: usages.length }) }}</p>
          </DropdownMenuContent>
        </DropdownMenu>
      </HeaderActionDropdownTooltip>
    </template>

    <template #preview>
      <LayoutGridCard :manifest="manifest" :project-path="projectRoot" preview-only :show-details-action="false" :show-composer-action="false" />
    </template>

    <p v-if="error" class="mb-4 rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{{ error }}</p>

    <section v-if="activeTab === 'slots'">
      <ul v-if="manifest.slots.length" class="divide-y divide-dashed divide-border" role="list">
        <li v-for="slot in manifest.slots" :key="slot.id" class="py-3 first:pt-0">
          <div class="flex items-center justify-between gap-3"><p class="font-mono text-xs font-medium">{{ slot.name || m.layouts_detail_default_slot() }}</p><Badge variant="outline">{{ slot.hasFallback ? m.layouts_detail_slot_fallback() : m.layouts_detail_slot_empty() }}</Badge></div>
          <p class="mt-1 text-xs text-muted-foreground">{{ slot.label }}</p>
          <p class="mt-1 text-[10px] text-muted-foreground">{{ slot.mutable ? m.layouts_detail_slot_mutable() : m.layouts_detail_slot_read_only() }}</p>
        </li>
      </ul>
      <p v-else class="text-xs text-muted-foreground">{{ m.layouts_detail_no_slots() }}</p>
    </section>

    <section v-else>
      <ul v-if="usages.length" class="divide-y divide-dashed divide-border" role="list">
        <li v-for="usage in usages" :key="usage.file" class="flex min-w-0 items-center gap-3 py-3 first:pt-0">
          <div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{{ usage.label }}</p><p class="mt-1 truncate font-mono text-[10px] text-muted-foreground">{{ usage.file }}</p></div>
          <Button type="button" variant="ghost" size="icon-sm" :aria-label="m.studio_document_open_usage({ name: usage.label })" @click="onOpenUsage(usage)"><AppIcon name="arrowRight" :size="14" aria-hidden="true" /></Button>
        </li>
      </ul>
      <p v-else class="text-xs text-muted-foreground">{{ m.layouts_detail_no_usage() }}</p>
    </section>

    <template #status>{{ status }}</template>
  </StudioDocumentInspectorPanel>

  <StudioNameCreateDialog v-model:open="duplicateOpen" :busy="duplicateBusy" :error="duplicateError" :initial-value="suggestedCopyName" :title="m.studio_document_duplicate_title({ name: manifest.layout.name })" :description="m.studio_document_duplicate_description()" :placeholder="m.studio_document_duplicate_placeholder({ name: manifest.layout.name })" :cancel-label="m.confirm_cancel()" :submit-label="m.studio_document_duplicate_submit()" :creating-label="m.studio_document_duplicating()" @submit="submitDuplicate" />
</template>
