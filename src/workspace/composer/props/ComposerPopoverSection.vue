<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  clearNativeButtonPopover,
  composerPopoverTargetAtPath,
  insertComposerPopoverCloseButton,
  insertComposerPopoverTrigger,
  listNativePopoverButtons,
  renameComposerPopoverId,
  setComposerPopoverMode,
  setNativeButtonPopover,
  setNativeButtonPopoverAction,
  type ComposerPopoverAction,
  type ComposerPopoverMode,
} from "../../../../shared/composer"
import type { ElementNode } from "../../../../shared/composer/types"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import { tryUseComposerDocument } from "../useComposerDocumentSession"

const props = defineProps<{ node: ElementNode; path?: string; disabled?: boolean }>()
const inspector = tryUseInspectorContext()
const doc = inspector?.document ?? tryUseComposerDocument()
const selectedPath = computed(() => props.path ?? inspector?.selectedPath.value ?? null)
const target = computed(() => {
  const model = doc?.model.value
  const path = selectedPath.value
  return model && path ? composerPopoverTargetAtPath(model, path) : null
})
const previewOpen = computed({
  get: () => Boolean(target.value?.id && doc?.popoverPreviewTargetId.value === target.value.id),
  set: (open) => doc?.previewPopover(target.value?.id ?? null, open),
})
const idDraft = ref("")
const idError = ref("")
const addTriggerPath = ref("")

watch(target, (value) => {
  idDraft.value = value?.id ?? ""
  idError.value = ""
  addTriggerPath.value = ""
}, { immediate: true })

const eligibleButtons = computed(() => {
  const model = doc?.model.value
  if (!model) return []
  return listNativePopoverButtons(model).filter((button) => button.targetId !== target.value?.id)
})
const hasHideTrigger = computed(() => target.value?.triggers.some((trigger) => trigger.action === "hide") ?? false)
const warnings = computed(() => {
  const value = target.value
  if (!value) return []
  const result: string[] = []
  if (value.idState === "missing") result.push("Add a static ID before connecting a trigger.")
  if (value.idState === "dynamic") result.push("This Popover ID is expression-bound. Edit the relationship in Code.")
  if (value.idState === "duplicate") result.push("This ID is used more than once. Give the Popover a unique ID.")
  if (value.mode === "dynamic") result.push("Popover behavior is expression-bound and read-only here.")
  if (value.mode === "manual" && !hasHideTrigger.value) result.push("Manual popovers need an explicit Hide trigger.")
  return result
})

function commit(label: string, mutate: Parameters<NonNullable<typeof doc>["commitInspectorMutation"]>[1]) {
  doc?.commitInspectorMutation(label, mutate, { immediate: true, coalesceKey: null })
}

function setMode(value: unknown) {
  const path = selectedPath.value
  if (!path || props.disabled) return
  commit("Change popover behavior", (model) => setComposerPopoverMode(model, path, String(value) as ComposerPopoverMode))
}

function renameId() {
  const path = selectedPath.value
  if (!path || props.disabled || idDraft.value === target.value?.id) return
  const model = doc?.model.value
  if (!model) return
  const probe = structuredClone(model)
  const result = renameComposerPopoverId(probe, path, idDraft.value)
  idError.value = result.ok ? "" : result.reason ?? "Unable to rename ID"
  if (!result.ok) return
  const wasOpen = previewOpen.value
  commit("Rename popover ID", (next) => renameComposerPopoverId(next, path, idDraft.value))
  if (wasOpen) doc?.previewPopover(idDraft.value, true)
}

function updateTriggerAction(path: string, value: unknown) {
  commit("Change popover trigger action", (model) => setNativeButtonPopoverAction(model, path, String(value) as ComposerPopoverAction))
}

function reveal(path: string) {
  inspector?.selection.illuminate(path, { source: "api" })
}

function removeTrigger(path: string) {
  commit("Remove popover trigger", (model) => clearNativeButtonPopover(model, path))
}

function connectExisting(value: unknown) {
  const buttonPath = String(value)
  const targetPath = selectedPath.value
  if (!buttonPath || !targetPath) return
  commit("Connect popover trigger", (model) => setNativeButtonPopover(model, buttonPath, targetPath, "toggle"))
  addTriggerPath.value = ""
}

function createTrigger() {
  const path = selectedPath.value
  if (!path) return
  commit("Create popover trigger", (model) => insertComposerPopoverTrigger(model, path))
}

function addCloseButton() {
  const path = selectedPath.value
  if (!path) return
  commit("Add popover close button", (model) => insertComposerPopoverCloseButton(model, path))
}
</script>

<template>
  <section class="space-y-3 rounded-md border border-dashed border-border/70 p-3" aria-labelledby="composer-popover-heading">
    <div class="space-y-0.5">
      <h4 id="composer-popover-heading" class="text-xs font-medium text-foreground">Popover</h4>
      <p class="text-[11px] leading-relaxed text-muted-foreground">Control native behavior and every button connected to this content.</p>
    </div>

    <label class="grid grid-cols-[68px_1fr] items-center gap-2">
      <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Behavior</span>
      <Select :model-value="target?.mode === 'dynamic' ? 'auto' : target?.mode ?? 'auto'" :disabled="disabled || target?.mode === 'dynamic'" @update:model-value="setMode">
        <SelectTrigger class="h-8 text-xs" aria-label="Popover behavior"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Auto</SelectItem>
          <SelectItem value="hint">Hint</SelectItem>
          <SelectItem value="manual">Manual</SelectItem>
        </SelectContent>
      </Select>
    </label>

    <Label class="flex items-center justify-between gap-2 text-xs">
      Show on canvas
      <Switch :model-value="previewOpen" :disabled="disabled || !target?.id || target.idState !== 'static'" @update:model-value="previewOpen = Boolean($event)" />
    </Label>

    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Triggers</span>
        <span class="text-[10px] tabular-nums text-muted-foreground">{{ target?.triggers.length ?? 0 }}</span>
      </div>
      <div v-if="target?.triggers.length" class="space-y-2">
        <div v-for="trigger in target.triggers" :key="trigger.path" class="rounded-md border border-dashed border-border/60 p-2">
          <div class="mb-2 flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-xs">{{ trigger.label }}</span>
            <Button type="button" size="sm" variant="ghost" class="h-7 px-2 text-[10px]" @click="reveal(trigger.path)">Reveal</Button>
          </div>
          <div class="grid grid-cols-[1fr_auto] gap-1.5">
            <Select :model-value="trigger.action" :disabled="disabled" @update:model-value="updateTriggerAction(trigger.path, $event)">
              <SelectTrigger class="h-7 text-[11px]" :aria-label="`Action for ${trigger.label}`"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="toggle">Toggle</SelectItem>
                <SelectItem value="show">Show</SelectItem>
                <SelectItem value="hide">Hide</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" size="sm" variant="ghost" class="h-7 px-2 text-[10px]" :disabled="disabled" @click="removeTrigger(trigger.path)">Remove</Button>
          </div>
        </div>
      </div>
      <p v-else class="text-[11px] text-muted-foreground">No buttons are connected yet.</p>
    </div>

    <Select v-if="eligibleButtons.length" v-model="addTriggerPath" :disabled="disabled" @update:model-value="connectExisting">
      <SelectTrigger class="h-8 text-xs" aria-label="Add an existing button as a popover trigger"><SelectValue placeholder="Set a button as trigger…" /></SelectTrigger>
      <SelectContent>
        <SelectItem v-for="button in eligibleButtons" :key="button.path" :value="button.path">{{ button.label }} · {{ button.path }}</SelectItem>
      </SelectContent>
    </Select>

    <div class="grid grid-cols-2 gap-2">
      <Button type="button" size="sm" variant="outline" class="h-8 text-[11px]" :disabled="disabled" @click="createTrigger">Create trigger</Button>
      <Button type="button" size="sm" variant="outline" class="h-8 text-[11px]" :disabled="disabled || hasHideTrigger" @click="addCloseButton">Add close button</Button>
    </div>

    <div v-if="warnings.length" role="status" class="space-y-1 rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
      <p v-for="warning in warnings" :key="warning">{{ warning }}</p>
    </div>

    <details class="group rounded-md border border-dashed border-border/70">
      <summary class="cursor-pointer list-none px-2.5 py-2 text-[11px] font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">Advanced</summary>
      <div class="space-y-1.5 border-t border-dashed border-border/70 px-2.5 py-3">
        <Label for="composer-popover-id" class="text-[10px] text-muted-foreground">Target ID</Label>
        <Input id="composer-popover-id" v-model="idDraft" class="h-8 font-mono text-xs" :disabled="disabled || target?.idState === 'dynamic'" :aria-invalid="Boolean(idError)" @change="renameId" />
        <p v-if="idError" role="alert" class="text-[10px] text-destructive">{{ idError }}</p>
      </div>
    </details>
  </section>
</template>
