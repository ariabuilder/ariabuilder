<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { getCollections, getExternalEntry, listExternalEntries } from "@/lib/workspace"
import { getCmsEntry, listCmsEntries } from "@/lib/cms"
import type { AriaCollectionDef } from "../../../../shared/types"
import type { AriaEntryRecord } from "../../../../shared/cms"
import {
  bindCmsPropAtPath,
  bindCmsTextAtPath,
  cmsBindingFieldFromExpression,
  createCmsBindingFieldOptionGroups,
  createCmsBindingFieldOptions,
  describeComposerCmsSelection,
  markerPathForNodeId,
  nodeAtMarkerPath,
  pruneUnusedCmsArtifacts,
  resolveDirectCmsPropBinding,
  resolveDirectCmsTextBinding,
  unbindCmsPropAtPath,
  unbindCmsTextAtPath,
  upsertCmsCollectionQuery,
  upsertCmsRelationLookup,
  wrapNodeInCmsLoop,
  type CmsBindingFieldOption,
  type CmsBindingFieldOptionGroup,
} from "../../../../shared/composer"
import { tryUseComposerDocument } from "../useComposerDocumentSession"
import {
  composerCmsQuickTargetExpression,
  composerCmsQuickTargets,
  type ComposerCmsQuickControl,
  type ComposerCmsQuickTarget,
} from "./composerCmsQuickTargets"
import ComposerCmsFieldSelect from "./ComposerCmsFieldSelect.vue"

const props = defineProps<{
  path: string
  control: ComposerCmsQuickControl
  icon: "databaseLine" | "image" | "link" | "collections"
  label: string
  active?: boolean
}>()

type Page = "collection" | "entry" | "mapping"
type QuickEntry = {
  id: string
  slug: string
  title: string
  status: string
  values: Record<string, unknown>
}

const doc = tryUseComposerDocument()
const open = ref(false)
const page = ref<Page>("collection")
const collections = ref<AriaCollectionDef[]>([])
const collectionId = ref("")
const entries = ref<QuickEntry[]>([])
const entryId = ref("")
const selectedPaths = ref<Record<string, string>>({})
const relatedPreviews = ref<Record<string, string>>({})
const loadingCollections = ref(false)
const loadingEntries = ref(false)
const applying = ref(false)
const error = ref("")
let collectionGeneration = 0
let entryGeneration = 0
let previewGeneration = 0

const model = computed(() => doc?.model.value ?? null)
const selection = computed(() => model.value
  ? describeComposerCmsSelection(model.value, props.path)
  : null)
const targets = computed(() => model.value
  ? composerCmsQuickTargets(model.value, props.path, props.control)
  : [])
const collection = computed(() => collections.value.find((item) => item.id === collectionId.value || item.name === collectionId.value) ?? null)
const fieldOptions = computed(() => collection.value
  ? createCmsBindingFieldOptions(collection.value, collections.value)
  : [])
const selectedEntry = computed(() => entries.value.find((entry) => entry.id === entryId.value || entry.slug === entryId.value) ?? entries.value[0] ?? null)

function currentField(target: ComposerCmsQuickTarget): string {
  if (!model.value) return ""
  const expression = composerCmsQuickTargetExpression(model.value, target)
  return expression ? cmsBindingFieldFromExpression(expression, selection.value?.contexts ?? []) ?? "" : ""
}

function optionForPath(path: string): CmsBindingFieldOption | null {
  return fieldOptions.value.find((option) => option.path === path) ?? null
}

function groupsFor(target: ComposerCmsQuickTarget): CmsBindingFieldOptionGroup[] {
  return createCmsBindingFieldOptionGroups(
    fieldOptions.value,
    target.targetKind,
    target.nodeLabel,
    currentField(target),
  )
}

function resetMappings() {
  selectedPaths.value = Object.fromEntries(targets.value.map((target) => {
    const current = currentField(target)
    const suggested = groupsFor(target)[0]?.options[0]?.path ?? ""
    return [target.id, current || suggested]
  }))
  void refreshRelatedPreviews()
}

function directBinding() {
  if (!model.value) return null
  for (const target of targets.value) {
    const binding = target.bindingKind === "text"
      ? resolveDirectCmsTextBinding(model.value, target.path)
      : target.propName
        ? resolveDirectCmsPropBinding(model.value, target.path, target.propName)
        : null
    if (binding) return binding
  }
  return null
}

async function loadCollections() {
  const projectPath = doc?.projectPath.value
  if (!projectPath || loadingCollections.value) return
  const generation = ++collectionGeneration
  loadingCollections.value = true
  error.value = ""
  try {
    const result = await getCollections(projectPath)
    if (generation !== collectionGeneration) return
    collections.value = result.collections.filter((item) => item.capabilities?.read !== false)
    const direct = directBinding()
    const detected = selection.value?.collection
    const preferred = direct?.collection ?? detected ?? ""
    collectionId.value = collections.value.find((item) => item.id === preferred || item.name === preferred)?.id
      ?? collections.value[0]?.id
      ?? ""
    entryId.value = direct?.entrySlug ?? ""
    if (collection.value) await loadEntries()
    resetMappings()
    page.value = props.control === "loop"
      ? selection.value?.contextVariable && selection.value.collection ? "mapping" : "collection"
      : direct || (selection.value?.contextVariable && selection.value.collection)
        ? "mapping"
        : "collection"
  } catch (cause) {
    if (generation === collectionGeneration) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (generation === collectionGeneration) loadingCollections.value = false
  }
}

function managedEntryValues(record: AriaEntryRecord, selectedCollection: AriaCollectionDef): Record<string, unknown> {
  const locale = record.locales.find((item) => item.isSource) ?? record.locales[0]
  const values: Record<string, unknown> = {
    id: record.entry.id,
    slug: locale?.slug ?? record.entry.id,
    title: locale?.title ?? record.entry.id,
    body: locale?.body,
    ...(locale?.frontmatter ?? {}),
  }
  for (const field of selectedCollection.schema?.fields ?? []) {
    if (field.type !== "relation") continue
    values[field.key] = (record.relations ?? [])
      .filter((relation) => relation.fieldKey === field.key)
      .sort((a, b) => a.position - b.position)
      .map((relation) => relation.targetEntryId)
  }
  return values
}

async function loadEntries() {
  const projectPath = doc?.projectPath.value
  const selectedCollection = collection.value
  if (!projectPath || !selectedCollection) return
  const generation = ++entryGeneration
  loadingEntries.value = true
  entries.value = []
  error.value = ""
  try {
    if (selectedCollection.source && selectedCollection.source.kind !== "aria-managed") {
      const result = await listExternalEntries(projectPath, { collectionId: selectedCollection.id, limit: 50 })
      if (generation !== entryGeneration) return
      entries.value = result.items.map((entry) => ({
        id: entry.id,
        slug: typeof entry.data.slug === "string" ? entry.data.slug : entry.id,
        title: typeof entry.data.title === "string" ? entry.data.title : entry.id,
        status: "Local",
        values: { ...entry.data, id: entry.id, body: entry.body },
      }))
    } else {
      const result = await listCmsEntries(projectPath, { collectionId: selectedCollection.id, limit: 50 })
      if (generation !== entryGeneration) return
      entries.value = result.items.map((record) => {
        const locale = record.locales.find((item) => item.isSource) ?? record.locales[0]
        return {
          id: record.entry.id,
          slug: locale?.slug ?? record.entry.id,
          title: locale?.title ?? record.entry.id,
          status: record.entry.status,
          values: managedEntryValues(record, selectedCollection),
        }
      })
    }
    if (!entries.value.some((entry) => entry.id === entryId.value || entry.slug === entryId.value)) {
      entryId.value = entries.value[0]?.id ?? ""
    }
    void refreshRelatedPreviews()
  } catch (cause) {
    if (generation === entryGeneration) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (generation === entryGeneration) loadingEntries.value = false
  }
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && /^\d+$/.test(segment)) return current[Number(segment)]
    return current && typeof current === "object" ? (current as Record<string, unknown>)[segment] : undefined
  }, value)
}

function formatPreview(value: unknown): string {
  if (value == null || value === "") return "No value"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    const serialized = JSON.stringify(value)
    return serialized.length > 80 ? `${serialized.slice(0, 77)}…` : serialized
  } catch {
    return "Preview unavailable"
  }
}

function relationPreviewKey(option: CmsBindingFieldOption, id: unknown): string {
  return `${option.path}:${String(relationIdentity(id) ?? "")}`
}

function relationIdentity(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  return record.id ?? record.slug ?? record.ariaEntryId ?? value
}

async function refreshRelatedPreviews() {
  const generation = ++previewGeneration
  const sample = selectedEntry.value
  const projectPath = doc?.projectPath.value
  if (!sample || !projectPath) {
    relatedPreviews.value = {}
    return
  }
  const next: Record<string, string> = {}
  await Promise.all(targets.value.map(async (target) => {
    const option = optionForPath(selectedPaths.value[target.id] ?? "")
    const relation = option?.relation
    if (!option || !relation) return
    const source = valueAtPath(sample.values, relation.sourceField)
    const related = relation.kind === "relation" && Array.isArray(source)
      ? source[Math.max(0, relation.index ?? 0)]
      : source
    const id = relationIdentity(related)
    const key = relationPreviewKey(option, id)
    if (id == null || id === "") {
      next[key] = "No related entry"
      return
    }
    const targetCollection = collections.value.find((item) => item.id === relation.targetCollection || item.name === relation.targetCollection)
    if (!targetCollection) {
      next[key] = "Collection unavailable"
      return
    }
    try {
      if (targetCollection.source && targetCollection.source.kind !== "aria-managed") {
        const result = await getExternalEntry(projectPath, targetCollection.id, String(id))
        next[key] = result
          ? formatPreview(valueAtPath({ ...result.entry.data, id: result.entry.id, body: result.entry.body }, relation.targetField))
          : "Related entry unavailable"
      } else {
        const record = await getCmsEntry(projectPath, targetCollection.id, String(id))
        next[key] = record
          ? formatPreview(valueAtPath(managedEntryValues(record, targetCollection), relation.targetField))
          : "Related entry unavailable"
      }
    } catch {
      next[key] = "Related entry unavailable"
    }
  }))
  if (generation === previewGeneration) relatedPreviews.value = next
}

function previewFor(target: ComposerCmsQuickTarget): string {
  const sample = selectedEntry.value
  const option = optionForPath(selectedPaths.value[target.id] ?? "")
  if (!sample || !option) return "Static content"
  if (!option.relation) return formatPreview(valueAtPath(sample.values, option.path))
  const source = valueAtPath(sample.values, option.relation.sourceField)
  const related = option.relation.kind === "relation" && Array.isArray(source)
    ? source[Math.max(0, option.relation.index ?? 0)]
    : source
  const id = relationIdentity(related)
  return relatedPreviews.value[relationPreviewKey(option, id)] ?? "Loading preview…"
}

async function selectCollection(id: string) {
  collectionId.value = id
  entryId.value = ""
  await loadEntries()
  resetMappings()
  page.value = props.control === "loop" ? "mapping" : "entry"
}

function selectEntry(id: string) {
  entryId.value = id
  page.value = "mapping"
  void refreshRelatedPreviews()
}

function setTargetPath(targetId: string, path: string) {
  selectedPaths.value = { ...selectedPaths.value, [targetId]: path }
  void refreshRelatedPreviews()
}

function queryId(suffix: string): string {
  return `${nodeAtMarkerPath(model.value?.nodes ?? [], props.path)?.id ?? "node"}-${collection.value?.name ?? "collection"}-${suffix}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
}

function mapReceiver(value: string): { variable: string; entryVariable: string } | null {
  const match = /^\s*([a-zA-Z_$][\w$]*)\.map\s*\(\s*\(?\s*([a-zA-Z_$][\w$]*)/.exec(value)
  return match?.[1] && match[2] ? { variable: match[1], entryVariable: match[2] } : null
}

async function applyMappings() {
  const selectedCollection = collection.value
  const planned = targets.value.map((target) => ({ target, fieldPath: selectedPaths.value[target.id] ?? "" }))
  const unbindOnly = planned.every((item) => !item.fieldPath)
  if (!doc || !model.value) return
  if (!unbindOnly && !selectedCollection) {
    error.value = "Choose a collection first."
    return
  }
  if (!unbindOnly && props.control !== "loop" && !selection.value?.contextVariable && !entryId.value) {
    error.value = "Choose an entry first."
    return
  }
  applying.value = true
  error.value = ""
  const ok = await doc.commitModelMutation((nextModel) => {
    if (unbindOnly) {
      for (const item of planned) {
        const targetPath = markerPathForNodeId(nextModel.nodes, item.target.nodeId)
        if (!targetPath) return { ok: false, reason: `${item.target.nodeLabel} is no longer available.` }
        const result = item.target.bindingKind === "text"
          ? nodeAtMarkerPath(nextModel.nodes, targetPath)?.kind === "expr"
            ? unbindCmsTextAtPath(nextModel, targetPath)
            : { ok: true }
          : item.target.propName && composerCmsQuickTargetExpression(nextModel, { ...item.target, path: targetPath })
            ? unbindCmsPropAtPath(nextModel, targetPath, item.target.propName)
            : { ok: true }
        if (!result.ok) return result
      }
      pruneUnusedCmsArtifacts(nextModel)
      return { ok: true, selectPath: props.path }
    }

    if (!selectedCollection) return { ok: false, reason: "Choose a collection first." }
    let contextVariable = ""
    if (props.control === "loop") {
      const selected = nodeAtMarkerPath(nextModel.nodes, props.path)
      if (selected?.kind === "map") {
        const receiver = mapReceiver(selected.head)
        const state = describeComposerCmsSelection(nextModel, props.path)
        if (!receiver || !state.contextVariable) return { ok: false, reason: "This loop does not expose a bindable item." }
        if (state.ownership === "managed" && state.managedQueryId) {
          upsertCmsCollectionQuery(nextModel, {
            id: state.managedQueryId,
            collection: selectedCollection.name,
            variable: receiver.variable,
            entryVariable: receiver.entryVariable,
          })
        } else if (state.collection && state.collection !== selectedCollection.name) {
          return { ok: false, reason: "Open Code to change the collection used by this custom loop." }
        }
        contextVariable = receiver.entryVariable
      } else {
        const wrapped = wrapNodeInCmsLoop(nextModel, props.path, {
          id: queryId("loop"),
          collection: selectedCollection.name,
          entryVariable: "entry",
        })
        if (!wrapped.ok) return wrapped
        contextVariable = "entry"
      }
    } else {
      const state = describeComposerCmsSelection(nextModel, props.path)
      if (state.contextVariable && (!state.collection || state.collection === selectedCollection.name)) {
        contextVariable = state.contextVariable
      } else {
        const entry = entries.value.find((item) => item.id === entryId.value || item.slug === entryId.value)
        if (!entry) return { ok: false, reason: "Choose an entry." }
        contextVariable = upsertCmsCollectionQuery(nextModel, {
          id: queryId("entry"),
          collection: selectedCollection.name,
          entrySlug: entry.slug || entry.id,
        }).variable
      }
    }

    for (const item of planned) {
      const targetPath = markerPathForNodeId(nextModel.nodes, item.target.nodeId)
      if (!targetPath) return { ok: false, reason: `${item.target.nodeLabel} is no longer available.` }
      if (!item.fieldPath) {
        const result = item.target.bindingKind === "text"
          ? nodeAtMarkerPath(nextModel.nodes, targetPath)?.kind === "expr"
            ? unbindCmsTextAtPath(nextModel, targetPath)
            : { ok: true }
          : item.target.propName && nodeAtMarkerPath(nextModel.nodes, targetPath) && composerCmsQuickTargetExpression(nextModel, { ...item.target, path: targetPath })
            ? unbindCmsPropAtPath(nextModel, targetPath, item.target.propName)
            : { ok: true }
        if (!result.ok) return result
        continue
      }
      const option = fieldOptions.value.find((candidate) => candidate.path === item.fieldPath)
      if (!option) return { ok: false, reason: `The field ${item.fieldPath} is unavailable.` }
      const relation = option.relation
        ? {
            ...option.relation,
            lookupVariable: upsertCmsRelationLookup(nextModel, option.relation.targetCollection),
          }
        : undefined
      const binding = { contextVariable, field: option.path, relation }
      const result = item.target.bindingKind === "text"
        ? bindCmsTextAtPath(nextModel, targetPath, binding)
        : item.target.propName
          ? bindCmsPropAtPath(nextModel, targetPath, item.target.propName, binding)
          : { ok: false, reason: "The target property is unavailable." }
      if (!result.ok) return result
    }
    pruneUnusedCmsArtifacts(nextModel)
    return { ok: true, selectPath: props.path }
  })
  applying.value = false
  if (!ok) {
    error.value = doc.saveError.value ?? "The CMS bindings could not be applied."
    return
  }
  open.value = false
}

function goBack() {
  if (page.value === "mapping" && props.control !== "loop" && !selection.value?.contextVariable) page.value = "entry"
  else page.value = "collection"
}

watch(open, async (next) => {
  if (!next) return
  await nextTick()
  await loadCollections()
})
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="h-6! w-6! shrink-0"
        :class="active ? 'border border-primary/45 bg-primary/10 text-primary' : ''"
        :aria-label="label"
        :title="label"
        :aria-pressed="Boolean(active)"
        :data-binding-active="active || undefined"
      >
        <AppIcon :name="icon" :size="14" aria-hidden="true" />
      </Button>
    </PopoverTrigger>

    <PopoverContent
      side="bottom"
      align="start"
      :side-offset="6"
      class="w-72 overflow-hidden p-0"
      @click.stop
    >
      <div class="flex min-h-9 items-center gap-1.5 border-b border-dashed border-border/60 px-2 text-xs font-medium">
        <Button
          v-if="page !== 'collection'"
          type="button"
          variant="ghost"
          size="icon-sm"
          class="size-6"
          aria-label="Back"
          @click="goBack"
        >
          <AppIcon name="chevronLeft" :size="13" aria-hidden="true" />
        </Button>
        <AppIcon v-else :name="icon" :size="14" class="text-primary" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ label }}</span>
        <span class="text-[9px] font-normal uppercase tracking-wide text-muted-foreground">{{ page }}</span>
      </div>

      <Transition name="cms-picker-page" mode="out-in">
        <section v-if="page === 'collection'" key="collection" aria-label="Choose a collection">
          <div v-if="loadingCollections" class="flex min-h-48 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Spinner class="size-3.5" /> Loading collections
          </div>
          <Command v-else>
            <CommandInput placeholder="Find a collection…" />
            <CommandList class="max-h-64">
              <CommandEmpty>No collections found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  v-for="item in collections"
                  :key="item.id"
                  :value="`${item.label} ${item.name}`"
                  class="gap-2"
                  @select="selectCollection(item.id)"
                >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-xs">{{ item.label }}</span>
                    <span class="block truncate text-[10px] text-muted-foreground">{{ item.name }}</span>
                  </span>
                  <AppIcon v-if="item.id === collectionId" name="checkLinear" :size="13" class="text-primary" aria-hidden="true" />
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </section>

        <section v-else-if="page === 'entry'" key="entry" aria-label="Choose an entry">
          <div v-if="loadingEntries" class="flex min-h-48 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Spinner class="size-3.5" /> Loading entries
          </div>
          <Command v-else>
            <CommandInput placeholder="Find an entry…" />
            <CommandList class="max-h-64">
              <CommandEmpty>No entries found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  v-for="entry in entries"
                  :key="entry.id"
                  :value="`${entry.title} ${entry.slug} ${entry.id}`"
                  class="gap-2"
                  @select="selectEntry(entry.id)"
                >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-xs">{{ entry.title }}</span>
                    <span class="block truncate text-[10px] capitalize text-muted-foreground">{{ entry.slug }} · {{ entry.status }}</span>
                  </span>
                  <AppIcon v-if="entry.id === entryId || entry.slug === entryId" name="checkLinear" :size="13" class="text-primary" aria-hidden="true" />
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </section>

        <section v-else key="mapping" aria-label="Map CMS fields">
          <div class="grid max-h-72 gap-1.5 overflow-y-auto p-1.5">
            <p v-if="!targets.length" class="px-2 py-8 text-center text-xs text-muted-foreground">No compatible targets found.</p>
            <div
              v-for="target in targets"
              v-else
              :key="target.id"
              class="grid gap-1 rounded-md border border-dashed border-border/60 p-2"
            >
              <span class="flex min-w-0 items-center justify-between gap-2">
                <span class="truncate text-xs font-medium">{{ target.nodeLabel }}</span>
                <span class="shrink-0 font-mono text-[9px] text-muted-foreground">{{ target.bindingKind === 'text' ? 'content' : target.propName }}</span>
              </span>
              <ComposerCmsFieldSelect
                :model-value="selectedPaths[target.id] ?? ''"
                :groups="groupsFor(target)"
                :label="`Field for ${target.nodeLabel}`"
                @update:model-value="setTargetPath(target.id, $event)"
              />
              <span class="line-clamp-2 min-h-4 text-[10px] leading-4 text-muted-foreground">{{ previewFor(target) }}</span>
            </div>
          </div>
          <div class="flex items-center justify-end gap-1.5 border-t border-dashed border-border/60 p-2">
            <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-[11px]" :disabled="applying" @click="open = false">Cancel</Button>
            <Button type="button" size="sm" class="h-7 px-2 text-[11px]" :disabled="applying" @click="applyMappings">
              <Spinner v-if="applying" class="size-3" />
              {{ applying ? 'Applying' : 'Apply' }}
            </Button>
          </div>
        </section>
      </Transition>

      <p v-if="error" role="alert" class="border-t border-dashed border-destructive/40 px-3 py-2 text-[10px] text-destructive">{{ error }}</p>
      <p class="sr-only" role="status" aria-live="polite">{{ applying ? 'Applying CMS bindings' : '' }}</p>
    </PopoverContent>
  </Popover>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .cms-picker-page-enter-active,
  .cms-picker-page-leave-active {
    transition-property: opacity, transform;
    transition-duration: 140ms;
    transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  }
  .cms-picker-page-enter-from {
    opacity: 0;
    transform: translateX(8px);
  }
  .cms-picker-page-leave-to {
    opacity: 0;
    transform: translateX(-4px);
  }
}
</style>
