<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import {
  applyComposerProjectDataCutover,
  assessComposerProjectDataAdoption,
  createComposerProjectDataDraft,
  editComposerProjectData,
  inspectComposerProjectData,
  revealComposerProjectData,
} from "@/lib/composer"
import { m } from "@/paraglide/messages.js"
import {
  nodeAtMarkerPath,
  parentPathOf,
  serializeAstro,
  type ComposerDataBinding,
  type ProjectDataAdoptionAssessment,
  type ProjectDataAdoptionResult,
  type ProjectDataAdoptionInput,
} from "../../../../shared/composer"
import { tryUseComposerBeacon } from "../selection/useComposerBeacon"
import { tryUseComposerDocument } from "../useComposerDocumentSession"

const beacon = tryUseComposerBeacon()
const doc = tryUseComposerDocument()
const binding = ref<ComposerDataBinding | null>(null)
const loading = ref(false)
const error = ref("")
const status = ref("")
const draftValue = ref("")
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
let generation = 0

const source = computed(() => doc?.model.value ? serializeAstro(doc.model.value) : "")
const relativeFile = computed(() => doc?.editFile.value ?? "")
const selectedPath = computed(() => beacon?.selectedPath.value ?? "")
const selectedOccurrence = computed(() => beacon?.selectedOccurrence.value ?? 0)

const expression = computed(() => {
  const nodes = doc?.model.value?.nodes
  let path = selectedPath.value
  if (!nodes || !path) return ""
  while (path) {
    const node = nodeAtMarkerPath(nodes, path)
    if (node?.kind === "map") return node.head
    if (path === selectedPath.value && node?.kind === "expr") return node.value.replace(/^\{|\}$/g, "")
    if (
      path === selectedPath.value &&
      node && "props" in node
    ) {
      const dynamic = Object.values(node.props).filter((value) => value.type === "expr")
      if (dynamic.length === 1 && dynamic[0]?.type === "expr") return dynamic[0].value
    }
    path = parentPathOf(path) ?? ""
  }
  return ""
})

function selectedMapNode() {
  const nodes = doc?.model.value?.nodes
  let path = selectedPath.value
  if (!nodes) return null
  while (path) {
    const node = nodeAtMarkerPath(nodes, path)
    if (node?.kind === "map") return node
    path = parentPathOf(path) ?? ""
  }
  return null
}

const ownershipLabel = computed(() => {
  if (binding.value?.ownership === "project") return m.composer_data_project()
  if (binding.value?.ownership === "cms") return m.composer_data_cms()
  return m.composer_data_computed()
})

const selectedValue = computed(() => {
  const value = binding.value?.value
  if (Array.isArray(value)) return value[selectedOccurrence.value]
  return value
})

const canEditValue = computed(() =>
  binding.value?.ownership === "project" &&
  binding.value.writable &&
  (selectedValue.value === null || ["string", "number", "boolean"].includes(typeof selectedValue.value)),
)

const displayPath = computed(() => binding.value?.valuePath.join(".") || "—")

async function inspect() {
  const projectPath = doc?.projectPath.value
  if (!projectPath || !relativeFile.value || !source.value || !expression.value) {
    binding.value = null
    return
  }
  const current = ++generation
  loading.value = true
  error.value = ""
  try {
    const result = await inspectComposerProjectData(projectPath, {
      relativeFile: relativeFile.value,
      source: source.value,
      expression: expression.value,
    })
    if (current !== generation) return
    binding.value = result.binding
    const map = selectedMapNode()
    if (map) {
      map.dataBinding = {
        ownership: result.binding.ownership,
        label: result.binding.displayName,
        ...(result.binding.itemCount == null ? {} : { itemCount: result.binding.itemCount }),
      }
    }
    draftValue.value = selectedValue.value == null ? "" : String(selectedValue.value)
  } catch (cause) {
    if (current === generation) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (current === generation) loading.value = false
  }
}

watch(
  () => [relativeFile.value, source.value, expression.value, selectedOccurrence.value] as const,
  () => void inspect(),
  { immediate: true },
)

watch(selectedValue, (value) => {
  draftValue.value = value == null ? "" : String(value)
})

function inputValue(): string | number | boolean | null {
  const current = selectedValue.value
  if (current === null) return draftValue.value || null
  if (typeof current === "number") return Number(draftValue.value)
  if (typeof current === "boolean") return draftValue.value === "true"
  return draftValue.value
}

async function saveValue() {
  const projectPath = doc?.projectPath.value
  const current = binding.value
  if (!projectPath || !current?.sourceHash) return
  error.value = ""
  status.value = ""
  const valuePath = Array.isArray(current.value)
    ? [...current.valuePath, String(selectedOccurrence.value)]
    : current.valuePath
  try {
    await editComposerProjectData(projectPath, {
      relativeFile: relativeFile.value,
      source: source.value,
      expression: expression.value,
      expectedSourceHash: current.sourceHash,
      valuePath,
      value: inputValue(),
    })
    status.value = m.composer_data_value_saved()
    await inspect()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function revealSource() {
  if (doc?.projectPath.value && binding.value?.sourceFile) {
    await revealComposerProjectData(doc.projectPath.value, binding.value.sourceFile)
  }
}

function adoptionInput(overrides = true): ProjectDataAdoptionInput {
  return {
    relativeFile: relativeFile.value,
    source: source.value,
    expression: expression.value,
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
  selectedFields.value = checked
    ? [...new Set([...selectedFields.value, key])]
    : selectedFields.value.filter((item) => item !== key)
}

async function createDraft() {
  const projectPath = doc?.projectPath.value
  if (!projectPath) return
  adoptionBusy.value = true
  error.value = ""
  try {
    const reviewed = await assessComposerProjectDataAdoption(projectPath, adoptionInput())
    assessment.value = reviewed
    adopted.value = await createComposerProjectDataDraft(projectPath, {
      ...adoptionInput(),
      expectedPreviewHash: reviewed.previewHash,
    })
    status.value = m.composer_data_draft_created()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    adoptionBusy.value = false
  }
}

function toggleConsumer(id: string, checked: boolean) {
  selectedConsumers.value = checked
    ? [...new Set([...selectedConsumers.value, id])]
    : selectedConsumers.value.filter((item) => item !== id)
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
  <section v-if="expression" class="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3" aria-labelledby="composer-data-heading">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 id="composer-data-heading" class="text-[11px] font-medium">{{ m.composer_data_title() }}</h3>
        <p v-if="binding" class="mt-0.5 truncate text-[10px] text-muted-foreground">{{ displayPath }}</p>
      </div>
      <Badge variant="outline" class="shrink-0 text-[9px]">{{ ownershipLabel }}</Badge>
    </div>

    <div v-if="loading" class="flex items-center gap-2 text-[11px] text-muted-foreground">
      <Spinner class="size-3" /> {{ m.composer_data_loading() }}
    </div>
    <template v-else-if="binding">
      <dl v-if="binding.sourceFile" class="space-y-1 text-[10px]">
        <div class="flex gap-2"><dt class="text-muted-foreground">Source</dt><dd class="min-w-0 truncate font-mono">{{ binding.sourceFile }}</dd></div>
        <div v-if="binding.itemCount != null" class="flex gap-2"><dt class="text-muted-foreground">Items</dt><dd>{{ binding.itemCount }}</dd></div>
        <div v-if="Array.isArray(binding.value)" class="flex gap-2"><dt class="text-muted-foreground">Selected</dt><dd>{{ selectedOccurrence + 1 }} of {{ binding.value.length }}</dd></div>
      </dl>

      <div v-if="canEditValue" class="space-y-1.5">
        <Label for="composer-project-data-value" class="text-[10px] text-muted-foreground">Value</Label>
        <Input id="composer-project-data-value" v-model="draftValue" class="h-8 text-xs" @keydown.enter.prevent="saveValue" />
        <Button type="button" size="sm" class="w-full active:scale-[0.96] transition-transform" @click="saveValue">{{ m.composer_data_save_value() }}</Button>
      </div>

      <p v-if="binding.reason" class="text-[10px] leading-relaxed text-muted-foreground">{{ binding.reason }}</p>

      <div v-if="binding.ownership === 'project'" class="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" size="sm" :disabled="!binding.sourceFile" @click="revealSource">{{ m.composer_data_open_source() }}</Button>
        <Button type="button" size="sm" :disabled="!binding.rootValue" @click="openAdoption">{{ m.composer_data_adopt() }}</Button>
      </div>

      <details class="rounded-sm border border-border/60">
        <summary class="cursor-pointer px-2 py-1.5 text-[10px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">{{ m.composer_data_advanced() }}</summary>
        <pre class="overflow-x-auto border-t border-border/60 p-2 text-[10px] whitespace-pre-wrap">{{ expression }}</pre>
      </details>
    </template>

    <div class="min-h-4" role="status" aria-live="polite">
      <p v-if="status" class="text-[10px] text-muted-foreground">{{ status }}</p>
    </div>
    <p v-if="error" role="alert" class="text-[10px] text-destructive">{{ error }}</p>
  </section>

  <Dialog v-model:open="dialogOpen">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{{ m.composer_data_adopt_title() }}</DialogTitle>
        <DialogDescription>{{ m.composer_data_adopt_description() }}</DialogDescription>
      </DialogHeader>

      <div v-if="adoptionBusy && !assessment" class="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
        <Spinner class="size-4" /> {{ m.composer_data_loading() }}
      </div>
      <div v-else-if="assessment" class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <label class="space-y-1"><Label for="data-collection-name">Collection name</Label><Input id="data-collection-name" v-model="collectionName" /></label>
          <label class="space-y-1"><Label for="data-collection-label">Collection label</Label><Input id="data-collection-label" v-model="collectionLabel" /></label>
          <label class="space-y-1"><Label for="data-entry-title">Entry title</Label><Input id="data-entry-title" v-model="entryTitle" /></label>
          <label class="space-y-1"><Label for="data-entry-slug">Entry slug</Label><Input id="data-entry-slug" v-model="entrySlug" /></label>
        </div>

        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">{{ m.composer_data_review_fields() }}</legend>
          <label v-for="item in assessment.fields" :key="item.field.key" class="flex min-h-9 items-start gap-2 rounded-sm border border-border/60 px-2 py-2 text-sm">
            <Checkbox :checked="selectedFields.includes(item.field.key)" @update:checked="toggleField(item.field.key, $event === true)" />
            <span class="min-w-0"><span class="block">{{ item.field.label }}</span><span class="block font-mono text-[10px] text-muted-foreground">{{ item.field.key }} · {{ item.field.type }}</span></span>
          </label>
        </fieldset>

        <section class="space-y-2" aria-labelledby="data-consumers-heading">
          <h3 id="data-consumers-heading" class="text-sm font-medium">{{ m.composer_data_consumers() }}</h3>
          <p v-if="!assessment.consumers.length" class="text-xs text-muted-foreground">{{ m.composer_data_no_consumers() }}</p>
          <ul v-else class="max-h-36 space-y-1 overflow-y-auto rounded-sm border border-border/60 p-2 text-xs">
            <li v-for="consumer in assessment.consumers" :key="consumer.id" class="flex min-h-8 items-center gap-2">
              <Checkbox
                v-if="adopted && consumer.status === 'safe'"
                :checked="selectedConsumers.includes(consumer.id)"
                :aria-label="`Cut over ${consumer.file}`"
                @update:checked="toggleConsumer(consumer.id, $event === true)"
              />
              <span class="min-w-0 flex-1 truncate font-mono">{{ consumer.file }}</span>
              <Badge variant="outline" class="shrink-0 text-[9px]">{{ consumer.status }}</Badge>
            </li>
          </ul>
        </section>

        <p class="rounded-sm bg-muted/50 p-2 text-xs text-muted-foreground">
          {{ adopted ? m.composer_data_review_cutover() : m.composer_data_source_unchanged() }}
        </p>
        <ul v-if="assessment.warnings.length" class="list-disc space-y-1 ps-5 text-xs text-muted-foreground">
          <li v-for="warning in assessment.warnings" :key="warning">{{ warning }}</li>
        </ul>
      </div>

      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <DialogFooter>
        <Button type="button" variant="outline" @click="dialogOpen = false">Cancel</Button>
        <Button
          v-if="!adopted"
          type="button"
          :disabled="adoptionBusy || !assessment || selectedFields.length === 0"
          @click="createDraft"
        >
          <Spinner v-if="adoptionBusy" class="mr-2 size-4" />{{ m.composer_data_create_draft() }}
        </Button>
        <Button
          v-else
          type="button"
          :disabled="adoptionBusy || selectedConsumers.length === 0"
          @click="applyCutover"
        >
          <Spinner v-if="adoptionBusy" class="mr-2 size-4" />{{ m.composer_data_apply_cutover() }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
