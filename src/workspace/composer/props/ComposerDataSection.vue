<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  applyComposerProjectDataCutover,
  assessComposerProjectDataAdoption,
  createComposerProjectDataDraft,
  editComposerProjectDataCatalogValue,
  inspectComposerProjectData,
  listComposerProjectData,
  revealComposerProjectData,
} from "@/lib/composer"
import { m } from "@/paraglide/messages.js"
import {
  bindProjectDataMapAtPath,
  bindProjectDataPropAtPath,
  bindProjectDataTextAtPath,
  describeComposerCmsSelection,
  nodeAtMarkerPath,
  serializeAstro,
  unbindProjectDataMapAtPath,
  unbindProjectDataPropAtPath,
  unbindProjectDataTextAtPath,
  type ComposerDataBinding,
  type ProjectDataAdoptionAssessment,
  type ProjectDataAdoptionInput,
  type ProjectDataAdoptionResult,
  type ProjectDataCatalogField,
  type ProjectDataCatalogResult,
  type ProjectDataCatalogTarget,
} from "../../../../shared/composer"
import { tryUseComposerBeacon } from "../selection/useComposerBeacon"
import { tryUseComposerDocument } from "../useComposerDocumentSession"

const beacon = tryUseComposerBeacon()
const doc = tryUseComposerDocument()
const catalog = ref<ProjectDataCatalogResult | null>(null)
const selectedFieldId = ref("")
const pickerOpen = ref(false)
const query = ref("")
const loading = ref(false)
const busy = ref(false)
const error = ref("")
const status = ref("")
const draftValue = ref("")
const valueError = ref("")
const selectedTargetKey = ref("")
const adoptionBinding = ref<ComposerDataBinding | null>(null)
let generation = 0

const dialogOpen = ref(false)
const assessment = ref<ProjectDataAdoptionAssessment | null>(null)
const adoptionBusy = ref(false)
const adopted = ref<ProjectDataAdoptionResult | null>(null)
const selectedFields = ref<string[]>([])
const selectedConsumers = ref<string[]>([])
const collectionName = ref("")
const collectionLabel = ref("")
const entryTitle = ref("")
const entrySlug = ref("")

const selectionSource = computed(() => doc?.model.value ? serializeAstro(doc.model.value) : "")
const source = computed(() => doc?.exactSource.value ?? selectionSource.value)
const relativeFile = computed(() => doc?.editFile.value ?? "")
const selectedPath = computed(() => beacon?.selectedPath.value ?? "")
const selectedOccurrence = computed(() => beacon?.selectedOccurrence.value ?? 0)
const selectedNode = computed(() => doc?.model.value && selectedPath.value
  ? nodeAtMarkerPath(doc.model.value.nodes, selectedPath.value)
  : null)

type BindingTargetOption = { key: string; label: string; target: ProjectDataCatalogTarget }

function propertyLabel(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase())
}

const bindingTargetOptions = computed<BindingTargetOption[]>(() => {
  const model = doc?.model.value
  const path = selectedPath.value
  const node = selectedNode.value
  if (!model || !path || !node) return []
  if (node.kind === "map") return [{ key: "collection", label: m.composer_data_dataset(), target: { kind: "collection" } }]
  const options: BindingTargetOption[] = []
  if (describeComposerCmsSelection(model, path).textTargetPath) {
    options.push({ key: "text", label: m.composer_data_text_content(), target: { kind: "text" } })
  }
  if ("props" in node) {
    const common: Record<string, string[]> = {
      a: ["href"],
      button: ["disabled"],
      details: ["open"],
      img: ["src"],
      input: ["checked", "disabled"],
      option: ["selected", "disabled"],
      source: ["src"],
      video: ["src", "poster"],
    }
    const names = new Set([
      ...(node.kind === "element" ? common[node.name] ?? [] : []),
      ...Object.entries(node.props).filter(([, value]) => value.type !== "spread").map(([name]) => name),
    ])
    for (const name of names) {
      options.push({
        key: `prop:${name}`,
        label: m.composer_data_property_target({ property: propertyLabel(name) }),
        target: { kind: "prop", propName: name },
      })
    }
  }
  return options.length ? options : [{ key: "text", label: m.composer_data_text_content(), target: { kind: "text" } }]
})

watch(
  () => [selectedPath.value, bindingTargetOptions.value.map((option) => option.key).join("|")] as const,
  ([path], previous) => {
    const options = bindingTargetOptions.value
    const pathChanged = previous?.[0] !== path
    if (!pathChanged && options.some((option) => option.key === selectedTargetKey.value)) return
    selectedTargetKey.value = options.find((option) => option.key === "text")?.key
      ?? options.find((option) => option.key === "prop:src")?.key
      ?? options[0]?.key
      ?? ""
  },
  { immediate: true },
)

const target = computed<ProjectDataCatalogTarget>(() =>
  bindingTargetOptions.value.find((option) => option.key === selectedTargetKey.value)?.target ?? { kind: "text" },
)

const groups = computed(() => catalog.value?.groups.filter((group) => group.fields.length) ?? [])
const fields = computed(() => groups.value.flatMap((group) => group.fields))
const selectedField = computed(() => fields.value.find((field) => field.id === selectedFieldId.value) ?? null)
const hasBinding = computed(() => Boolean(catalog.value?.expression))
const managedBinding = computed(() => catalog.value?.managed ?? false)
const canEditValue = computed(() => {
  const field = selectedField.value
  return Boolean(field?.writable && field.sourceHash && field.sourceRange &&
    (field.value === null || ["string", "number", "boolean"].includes(typeof field.value)))
})
function fieldSearchText(field: ProjectDataCatalogField): string {
  return `${fieldPath(field)} ${preview(field.value)} ${field.sourceFile ?? ""} ${field.bindable ? "" : m.composer_data_read_only()}`.toLocaleLowerCase()
}

const filteredFieldCount = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  return search ? fields.value.filter((field) => fieldSearchText(field).includes(search)).length : fields.value.length
})
const resultAnnouncement = computed(() => m.composer_data_results({ count: filteredFieldCount.value }))

function preview(value: unknown): string {
  if (value == null) return value === null ? "null" : m.composer_data_no_preview()
  if (Array.isArray(value)) return m.composer_data_item_count({ count: value.length })
  if (typeof value === "object") return m.composer_data_object_preview()
  return String(value)
}

function groupName(group: ProjectDataCatalogField["group"]): string {
  if (group === "current-item") return m.composer_data_group_current()
  if (group === "page") return m.composer_data_group_page()
  return m.composer_data_group_project()
}

function fieldPath(field: ProjectDataCatalogField): string {
  const segments = field.pathLabel.split(" · ")
  return [groupName(field.group), ...segments.slice(1)].join(" · ")
}

async function loadCatalog(refresh = false) {
  const projectPath = doc?.projectPath.value
  if (!projectPath || !relativeFile.value || !source.value || !selectedPath.value) {
    catalog.value = null
    return
  }
  const current = ++generation
  loading.value = true
  error.value = ""
  try {
    const result = await listComposerProjectData(projectPath, {
      relativeFile: relativeFile.value,
      source: source.value,
      selectionSource: selectionSource.value,
      selectionPath: selectedPath.value,
      occurrence: selectedOccurrence.value,
      target: target.value,
      instanceChain: [...(doc.instanceChain?.value ?? [])],
      refresh,
    })
    if (current !== generation) return
    catalog.value = result
    const retained = result.groups.flatMap((group) => group.fields).some((field) => field.id === selectedFieldId.value)
    selectedFieldId.value = retained ? selectedFieldId.value : result.selectedFieldId ?? result.groups.flatMap((group) => group.fields)[0]?.id ?? ""
    adoptionBinding.value = null
    if (result.expression) {
      try {
        adoptionBinding.value = (await inspectComposerProjectData(projectPath, {
          relativeFile: relativeFile.value,
          source: source.value,
          expression: result.expression,
        })).binding
      } catch {
        // A loop item can be a valid binding without being a standalone root.
      }
    }
  } catch (cause) {
    if (current === generation) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (current === generation) loading.value = false
  }
}

watch(
  () => [relativeFile.value, source.value, selectionSource.value, selectedPath.value, selectedOccurrence.value, target.value.kind, target.value.propName] as const,
  () => void loadCatalog(),
  { immediate: true },
)

watch(selectedField, (field) => {
  draftValue.value = field?.value == null ? "" : String(field.value)
  valueError.value = ""
})

function chooseField(field: ProjectDataCatalogField) {
  selectedFieldId.value = field.id
  pickerOpen.value = false
  query.value = ""
  status.value = m.composer_data_field_selected({ field: fieldPath(field) })
}

function commitBinding() {
  const field = selectedField.value
  const result = catalog.value
  if (!doc || !field || !result) return
  error.value = ""
  status.value = ""
  const updating = hasBinding.value
  const ok = doc.commitInspectorMutation(updating ? "Update project data binding" : "Bind project data field", (model) => result.target.kind === "collection"
    ? bindProjectDataMapAtPath(model, result.targetPath, field)
    : result.target.kind === "prop" && result.target.propName
      ? bindProjectDataPropAtPath(model, result.targetPath, result.target.propName, field)
      : bindProjectDataTextAtPath(model, result.targetPath, field),
  { immediate: true, coalesceKey: null })
  if (ok) status.value = updating ? m.composer_data_binding_updated() : m.composer_data_binding_created()
  else error.value = m.composer_data_binding_failed()
}

function clearBinding() {
  const result = catalog.value
  if (!doc || !result) return
  error.value = ""
  const ok = doc.commitInspectorMutation("Clear project data binding", (model) => result.target.kind === "collection"
    ? unbindProjectDataMapAtPath(model, result.targetPath)
    : result.target.kind === "prop" && result.target.propName
      ? unbindProjectDataPropAtPath(model, result.targetPath, result.target.propName)
      : unbindProjectDataTextAtPath(model, result.targetPath),
  { immediate: true, coalesceKey: null })
  if (ok) status.value = m.composer_data_binding_cleared()
  else error.value = m.composer_data_binding_failed()
}

function editValue(): { ok: true; value: string | number | boolean | null } | { ok: false; message: string } {
  const value = selectedField.value?.value
  if (value === null) return { ok: true, value: draftValue.value || null }
  if (typeof value === "number") {
    const parsed = Number(draftValue.value)
    return draftValue.value.trim() && Number.isFinite(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, message: m.composer_data_invalid_number() }
  }
  if (typeof value === "boolean") return { ok: true, value: draftValue.value === "true" }
  return { ok: true, value: draftValue.value }
}

async function saveValue() {
  const projectPath = doc?.projectPath.value
  const field = selectedField.value
  if (!projectPath || !doc || !field?.sourceFile || !field.sourceHash || !field.sourceRange) return
  const edited = editValue()
  if (!edited.ok) {
    valueError.value = edited.message
    return
  }
  busy.value = true
  error.value = ""
  valueError.value = ""
  status.value = ""
  try {
    await doc.flushSave()
    await editComposerProjectDataCatalogValue(projectPath, {
      sourceFile: field.sourceFile,
      expectedSourceHash: field.sourceHash,
      sourceRange: field.sourceRange,
      value: edited.value,
    })
    if (field.sourceFile === relativeFile.value) await doc.reloadDocument()
    else await loadCatalog(true)
    doc.reloadPreview()
    status.value = m.composer_data_value_saved()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

async function revealSource() {
  const field = selectedField.value
  if (doc?.projectPath.value && field?.sourceFile) await revealComposerProjectData(doc.projectPath.value, field.sourceFile)
}

function adoptionInput(overrides = true): ProjectDataAdoptionInput {
  return {
    relativeFile: relativeFile.value,
    source: source.value,
    expression: catalog.value?.expression ?? "",
    ...(overrides && collectionName.value ? { collectionName: collectionName.value } : {}),
    ...(overrides && collectionLabel.value ? { collectionLabel: collectionLabel.value } : {}),
    ...(overrides && entryTitle.value ? { entryTitle: entryTitle.value } : {}),
    ...(overrides && entrySlug.value ? { entrySlug: entrySlug.value } : {}),
    ...(overrides && selectedFields.value.length ? { selectedFields: selectedFields.value } : {}),
  }
}

async function openAdoption() {
  const projectPath = doc?.projectPath.value
  if (!projectPath) return
  dialogOpen.value = true
  adoptionBusy.value = true
  error.value = ""
  try {
    const next = await assessComposerProjectDataAdoption(projectPath, adoptionInput(false))
    assessment.value = next
    selectedFields.value = next.fields.filter((item) => item.selected).map((item) => item.field.key)
    selectedConsumers.value = next.consumers.filter((item) => item.status === "safe").map((item) => item.id)
    adopted.value = null
    collectionName.value = next.collectionName
    collectionLabel.value = next.collectionLabel
    entryTitle.value = next.entryTitle
    entrySlug.value = next.entrySlug
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    adoptionBusy.value = false
  }
}

function toggleField(key: string, checked: boolean) {
  selectedFields.value = checked ? [...new Set([...selectedFields.value, key])] : selectedFields.value.filter((item) => item !== key)
}

async function createDraft() {
  const projectPath = doc?.projectPath.value
  if (!projectPath) return
  adoptionBusy.value = true
  error.value = ""
  try {
    const reviewed = await assessComposerProjectDataAdoption(projectPath, adoptionInput())
    assessment.value = reviewed
    adopted.value = await createComposerProjectDataDraft(projectPath, { ...adoptionInput(), expectedPreviewHash: reviewed.previewHash })
    status.value = m.composer_data_draft_created()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    adoptionBusy.value = false
  }
}

function toggleConsumer(id: string, checked: boolean) {
  selectedConsumers.value = checked ? [...new Set([...selectedConsumers.value, id])] : selectedConsumers.value.filter((item) => item !== id)
}

async function applyCutover() {
  const projectPath = doc?.projectPath.value
  if (!projectPath || !assessment.value || !adopted.value || !selectedConsumers.value.length) return
  adoptionBusy.value = true
  error.value = ""
  try {
    await applyComposerProjectDataCutover(projectPath, {
      ...adoptionInput(),
      expectedPreviewHash: assessment.value.previewHash,
      collectionId: adopted.value.collectionId,
      entrySlug: adopted.value.entrySlug,
      consumerIds: selectedConsumers.value,
    })
    dialogOpen.value = false
    status.value = m.composer_data_cutover_complete()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    adoptionBusy.value = false
  }
}
</script>

<template>
  <section class="space-y-3" aria-labelledby="composer-data-heading">
    <h3 id="composer-data-heading" class="sr-only">{{ m.composer_data_title() }}</h3>
    <div v-if="loading" class="flex items-center gap-2 py-2 text-[11px] text-muted-foreground" role="status"><Spinner class="size-3" /> {{ m.composer_data_loading() }}</div>
    <template v-else>
      <div v-if="bindingTargetOptions.length > 1 || target.kind === 'prop'" class="space-y-1.5">
        <Label id="composer-project-data-target-label" class="text-[10px] text-muted-foreground">{{ m.composer_data_bind_to() }}</Label>
        <Select v-model="selectedTargetKey">
          <SelectTrigger class="h-8 px-2 text-xs" aria-labelledby="composer-project-data-target-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in bindingTargetOptions" :key="option.key" :value="option.key">{{ option.label }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1.5">
        <Label id="composer-project-data-field-label" class="text-[10px] text-muted-foreground">{{ target.kind === 'collection' ? m.composer_data_dataset() : m.composer_data_field() }}</Label>
        <Popover v-model:open="pickerOpen">
          <PopoverTrigger as-child>
            <Button type="button" variant="outline" role="combobox" aria-labelledby="composer-project-data-field-label" :aria-expanded="pickerOpen" class="h-auto min-h-8 w-full justify-between gap-2 px-2 py-1.5 text-left text-xs font-normal">
              <span class="min-w-0 flex-1 truncate">{{ selectedField ? fieldPath(selectedField) : m.composer_data_choose_field() }}</span>
              <AppIcon name="chevronDown" :size="12" class="shrink-0 opacity-60" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" class="w-80 p-1">
            <Command>
              <CommandInput v-model="query" :placeholder="m.composer_data_search_fields()" class="text-xs" />
              <p class="sr-only" role="status" aria-live="polite">{{ resultAnnouncement }}</p>
              <CommandList class="max-h-72">
                <CommandEmpty class="px-3 py-5 text-center text-xs text-muted-foreground">{{ m.composer_data_empty() }}</CommandEmpty>
                <CommandGroup v-for="group in groups" :key="group.id" :heading="groupName(group.id)">
                  <CommandItem v-for="field in group.fields" :key="field.id" :value="field.id" class="min-h-10 cursor-pointer" @select="chooseField(field)">
                    <span class="min-w-0 flex-1"><span class="block truncate text-xs">{{ field.label }}</span><span class="block truncate font-mono text-[10px] text-muted-foreground">{{ preview(field.value) }}</span></span>
                    <span class="sr-only">{{ fieldPath(field) }} {{ field.sourceFile }}</span>
                    <Badge v-if="!field.bindable" variant="outline" class="shrink-0 text-[9px]">{{ m.composer_data_read_only() }}</Badge>
                    <AppIcon v-if="field.id === selectedFieldId" name="checkLinear" :size="13" class="text-primary" aria-hidden="true" />
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div v-if="selectedField" class="space-y-2 rounded-sm border border-border/60 bg-muted/20 p-2">
        <div class="flex items-start justify-between gap-2"><div class="min-w-0"><p class="break-words text-xs font-medium">{{ fieldPath(selectedField) }}</p><p class="mt-0.5 break-words text-[10px] text-muted-foreground">{{ preview(selectedField.value) }}</p></div><Badge variant="outline" class="shrink-0 text-[9px]">{{ selectedField.shape }}</Badge></div>
        <dl class="space-y-1 text-[10px]"><div v-if="selectedField.sourceFile" class="flex gap-2"><dt class="shrink-0 text-muted-foreground">{{ m.composer_data_source() }}</dt><dd class="min-w-0 break-all font-mono">{{ selectedField.sourceFile }}</dd></div><div v-if="selectedField.selectedItem != null" class="flex gap-2"><dt class="text-muted-foreground">{{ m.composer_data_item() }}</dt><dd>{{ selectedField.selectedItem + 1 }} / {{ selectedField.itemCount }}</dd></div></dl>
        <p v-if="selectedField.reason" class="text-[10px] leading-relaxed text-muted-foreground">{{ selectedField.reason }}</p>
      </div>
      <p v-else class="rounded-sm border border-dashed border-border/70 px-2 py-3 text-[11px] text-muted-foreground">{{ m.composer_data_empty() }}</p>

      <div class="grid grid-cols-2 gap-2"><Button type="button" size="sm" :disabled="!selectedField?.bindable" @click="commitBinding">{{ hasBinding ? m.composer_data_update_binding() : m.composer_data_bind_field() }}</Button><Button type="button" variant="outline" size="sm" :disabled="!managedBinding" @click="clearBinding">{{ m.composer_data_clear_binding() }}</Button></div>

      <div v-if="canEditValue" class="space-y-1.5">
        <Label id="composer-project-data-value-label" for="composer-project-data-value" class="text-[10px] text-muted-foreground">{{ m.composer_data_value() }}</Label>
        <Select v-if="typeof selectedField?.value === 'boolean'" v-model="draftValue">
          <SelectTrigger id="composer-project-data-value" class="h-8 px-2 text-xs" aria-labelledby="composer-project-data-value-label" :aria-invalid="Boolean(valueError)" :aria-describedby="valueError ? 'composer-project-data-value-error' : undefined">
            <SelectValue />
          </SelectTrigger>
          <SelectContent><SelectItem value="true">{{ m.composer_data_boolean_true() }}</SelectItem><SelectItem value="false">{{ m.composer_data_boolean_false() }}</SelectItem></SelectContent>
        </Select>
        <Input v-else id="composer-project-data-value" v-model="draftValue" :type="typeof selectedField?.value === 'number' ? 'number' : 'text'" :inputmode="typeof selectedField?.value === 'number' ? 'decimal' : undefined" :step="typeof selectedField?.value === 'number' ? 'any' : undefined" class="h-8 text-xs" :aria-invalid="Boolean(valueError)" :aria-describedby="valueError ? 'composer-project-data-value-error' : undefined" @keydown.enter.prevent="saveValue" />
        <p v-if="valueError" id="composer-project-data-value-error" role="alert" class="text-[10px] text-destructive">{{ valueError }}</p>
        <Button type="button" variant="outline" size="sm" class="w-full" :disabled="busy" @click="saveValue"><Spinner v-if="busy" class="mr-1 size-3" />{{ m.composer_data_save_value() }}</Button>
      </div>
      <Button type="button" variant="ghost" size="sm" class="w-full" :disabled="!selectedField?.sourceFile" @click="revealSource">{{ m.composer_data_open_source() }}</Button>

      <details class="rounded-sm border border-border/60"><summary class="cursor-pointer px-2 py-1.5 text-[10px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">{{ m.composer_data_advanced_source() }}</summary><div class="space-y-2 border-t border-border/60 p-2"><pre v-if="catalog?.expression" class="overflow-x-auto text-[10px] whitespace-pre-wrap">{{ catalog.expression }}</pre><p v-else class="text-[10px] text-muted-foreground">{{ m.composer_data_no_expression() }}</p><Button type="button" variant="outline" size="sm" class="w-full" :disabled="!adoptionBinding?.rootValue" @click="openAdoption">{{ m.composer_data_adopt() }}</Button></div></details>
    </template>
    <div class="min-h-4" role="status" aria-live="polite"><p v-if="status" class="text-[10px] text-muted-foreground">{{ status }}</p></div>
    <p v-if="error" role="alert" aria-live="assertive" class="text-[10px] text-destructive">{{ error }}</p>
  </section>

  <Dialog v-model:open="dialogOpen">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{{ m.composer_data_adopt_title() }}</DialogTitle><DialogDescription>{{ m.composer_data_adopt_description() }}</DialogDescription></DialogHeader>
      <div v-if="adoptionBusy && !assessment" class="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status"><Spinner class="size-4" /> {{ m.composer_data_loading() }}</div>
      <div v-else-if="assessment" class="space-y-4">
        <div class="grid grid-cols-2 gap-3"><label class="space-y-1"><Label for="data-collection-name">Collection name</Label><Input id="data-collection-name" v-model="collectionName" /></label><label class="space-y-1"><Label for="data-collection-label">Collection label</Label><Input id="data-collection-label" v-model="collectionLabel" /></label><label class="space-y-1"><Label for="data-entry-title">Entry title</Label><Input id="data-entry-title" v-model="entryTitle" /></label><label class="space-y-1"><Label for="data-entry-slug">Entry slug</Label><Input id="data-entry-slug" v-model="entrySlug" /></label></div>
        <fieldset class="space-y-2"><legend class="text-sm font-medium">{{ m.composer_data_review_fields() }}</legend><label v-for="item in assessment.fields" :key="item.field.key" class="flex min-h-9 items-start gap-2 rounded-sm border border-border/60 px-2 py-2 text-sm"><Checkbox :checked="selectedFields.includes(item.field.key)" @update:checked="toggleField(item.field.key, $event === true)" /><span class="min-w-0"><span class="block">{{ item.field.label }}</span><span class="block font-mono text-[10px] text-muted-foreground">{{ item.field.key }} · {{ item.field.type }}</span></span></label></fieldset>
        <section class="space-y-2" aria-labelledby="data-consumers-heading"><h3 id="data-consumers-heading" class="text-sm font-medium">{{ m.composer_data_consumers() }}</h3><p v-if="!assessment.consumers.length" class="text-xs text-muted-foreground">{{ m.composer_data_no_consumers() }}</p><ul v-else class="max-h-36 space-y-1 overflow-y-auto rounded-sm border border-border/60 p-2 text-xs"><li v-for="consumer in assessment.consumers" :key="consumer.id" class="flex min-h-8 items-center gap-2"><Checkbox v-if="adopted && consumer.status === 'safe'" :checked="selectedConsumers.includes(consumer.id)" :aria-label="`Cut over ${consumer.file}`" @update:checked="toggleConsumer(consumer.id, $event === true)" /><span class="min-w-0 flex-1 truncate font-mono">{{ consumer.file }}</span><Badge variant="outline" class="shrink-0 text-[9px]">{{ consumer.status }}</Badge></li></ul></section>
        <p class="rounded-sm bg-muted/50 p-2 text-xs text-muted-foreground">{{ adopted ? m.composer_data_review_cutover() : m.composer_data_source_unchanged() }}</p><ul v-if="assessment.warnings.length" class="list-disc space-y-1 ps-5 text-xs text-muted-foreground"><li v-for="warning in assessment.warnings" :key="warning">{{ warning }}</li></ul>
      </div>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <DialogFooter><Button type="button" variant="outline" @click="dialogOpen = false">Cancel</Button><Button v-if="!adopted" type="button" :disabled="adoptionBusy || !assessment || selectedFields.length === 0" @click="createDraft"><Spinner v-if="adoptionBusy" class="mr-2 size-4" />{{ m.composer_data_create_draft() }}</Button><Button v-else type="button" :disabled="adoptionBusy || selectedConsumers.length === 0" @click="applyCutover"><Spinner v-if="adoptionBusy" class="mr-2 size-4" />{{ m.composer_data_apply_cutover() }}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
