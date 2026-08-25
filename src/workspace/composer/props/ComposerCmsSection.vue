<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { getCollections, listExternalEntries } from "@/lib/workspace"
import { listCmsEntries } from "@/lib/cms"
import { m } from "@/paraglide/messages.js"
import type { AriaCollectionDef } from "../../../../shared/types"
import {
  adoptCmsLoop,
  bindCmsPropAtPath,
  bindCmsTextAtPath,
  describeComposerCmsSelection,
  mapSuggestedCmsFieldsAtPath,
  detectCmsContext,
  detectAstroCollectionsAtPath,
  getElementPropsSchema,
  nodeAtMarkerPath,
  parseCmsContentExposure,
  resolveDirectCmsTextBinding,
  setCmsContentExposureAtPath,
  unwrapCmsLoop,
  unbindCmsPropAtPath,
  unbindCmsTextAtPath,
  upsertCmsCollectionQuery,
  wrapNodeInCmsLoop,
  type CmsBindingFormat,
  type CmsContentExposure,
  type CmsFilterOperator,
} from "../../../../shared/composer"
import { tryUseComposerBeacon } from "../selection/useComposerBeacon"
import { tryUseComposerModeNavigation } from "../useComposerModeNavigation"
import { tryUseComposerDocument } from "../useComposerDocumentSession"

type Mode = "context" | "entry" | "loop"
const props = withDefaults(defineProps<{
  embedded?: boolean
  active?: boolean
  initialMode?: Mode
  initialTargetProp?: string
}>(), {
  embedded: false,
  active: false,
  initialMode: "context",
})
const beacon = tryUseComposerBeacon()
const doc = tryUseComposerDocument()
const modeNavigation = tryUseComposerModeNavigation()
const mode = ref<Mode>(props.initialMode)
const collections = ref<AriaCollectionDef[]>([])
const entries = ref<Array<{
  id: string
  slug: string
  title: string
  values: Record<string, unknown>
}>>([])
const discoveredFields = ref<Array<{ key: string; label: string; type: string }>>([])
const loading = ref(false)
const error = ref("")
const notice = ref("")
const initialized = ref(false)
let initializationGeneration = 0
let entryLoadGeneration = 0
const collectionId = ref("")
const entrySlug = ref("")
const contextVariable = ref("")
const field = ref("")
const targetProp = ref("")
const format = ref<CmsBindingFormat>("plain")
const filterField = ref("")
const filterOperator = ref<CmsFilterOperator>("equals")
const filterValue = ref("")
const sortField = ref("")
const sortDirection = ref<"asc" | "desc">("desc")
const limit = ref("10")
const offset = ref("0")
const status = ref("")
const locale = ref("")
const archiveMode = ref<"" | "relation" | "reference">("")
const archiveField = ref("")
const archiveContext = ref("")
const extraFilters = ref<Array<{ id: number; field: string; operator: CmsFilterOperator; value: string }>>([])
let nextFilterId = 1

const selectedPath = computed(() => beacon?.selectedPath.value ?? null)
const selectedNode = computed(() => selectedPath.value && doc?.model.value ? nodeAtMarkerPath(doc.model.value.nodes, selectedPath.value) : null)
const selection = computed(() => doc?.model.value && selectedPath.value
  ? describeComposerCmsSelection(doc.model.value, selectedPath.value)
  : null)
const directTextBinding = computed(() => doc?.model.value && selectedPath.value
  ? resolveDirectCmsTextBinding(doc.model.value, selectedPath.value)
  : null)
const bindingTargetPath = computed(() => directTextBinding.value?.path ?? selection.value?.textTargetPath ?? selectedPath.value)
const collection = computed(() => collections.value.find((item) => item.id === collectionId.value || item.name === collectionId.value) ?? null)
const detectedCollections = computed(() =>
  doc?.model.value && selectedPath.value
    ? detectAstroCollectionsAtPath(doc.model.value, selectedPath.value)
    : [],
)
const detectedCollectionLabel = computed(() => {
  if (detectedCollections.value.length !== 1) return ""
  const match = collections.value.find((item) => item.name === detectedCollections.value[0])
  return match?.label ?? detectedCollections.value[0]!.replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase())
})
function flattenSchemaFields(
  items: ReadonlyArray<{ key: string; label: string; type: string; fields?: unknown[] }>,
  prefix = "",
): Array<{ key: string; label: string; type: string }> {
  return items.flatMap((item) => {
    const key = prefix ? `${prefix}.${item.key}` : item.key
    const current = { key, label: prefix ? `${prefix} · ${item.label}` : item.label, type: item.type }
    const nested = Array.isArray(item.fields)
      ? flattenSchemaFields(item.fields as Array<{ key: string; label: string; type: string; fields?: unknown[] }>, key)
      : []
    return [current, ...nested]
  })
}
const fields = computed(() => {
  const list = [...flattenSchemaFields(collection.value?.schema?.fields ?? []), ...discoveredFields.value]
  return [
    { key: "id", label: "Entry ID", type: "string" },
    { key: "slug", label: "Slug", type: "slug" },
    { key: "title", label: "Title", type: "string" },
    { key: "body", label: "Body", type: "rich-text" },
    ...list.filter((item, index) => list.findIndex((candidate) => candidate.key === item.key) === index),
  ]
})
const contexts = computed(() => selection.value?.contexts ?? (doc?.model.value && selectedPath.value ? detectCmsContext(doc.model.value, selectedPath.value) : []))
const selectedEntry = computed(() => entries.value.find((entry) => entry.slug === entrySlug.value || entry.id === entrySlug.value) ?? null)
function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((current, segment) =>
    current && typeof current === "object" ? (current as Record<string, unknown>)[segment] : undefined,
  value)
}
const previewValue = computed(() => valueAtPath(selectedEntry.value?.values, field.value))
const previewText = computed(() => {
  const value = previewValue.value
  if (value == null || value === "") return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
})
const filterFieldType = computed(() => fields.value.find((item) => item.key === filterField.value)?.type ?? "string")
const filterOperatorOptions = computed(() => {
  const numeric = ["number", "date", "datetime"].includes(filterFieldType.value)
  const text = ["string", "text", "slug", "url", "email"].includes(filterFieldType.value)
  return [
    { value: "equals" as const, label: m.composer_cms_equals() },
    { value: "notEquals" as const, label: m.composer_cms_not_equal() },
    ...(text ? [{ value: "contains" as const, label: m.composer_cms_contains() }] : []),
    ...(numeric ? [
      { value: "greaterThan" as const, label: m.composer_cms_greater() },
      { value: "lessThan" as const, label: m.composer_cms_less() },
    ] : []),
    { value: "exists" as const, label: m.composer_cms_exists() },
  ]
})
const isTextTarget = computed(() => !props.initialTargetProp && Boolean(selection.value?.textTargetPath))
const isLoop = computed(() => selectedNode.value?.kind === "map")
const propTargets = computed(() => {
  const node = selectedNode.value
  if (!node || !(node.kind === "element" || node.kind === "component" || node.kind === "slot" || node.kind === "raw")) return []
  const schemaFields = node.kind === "element"
    ? getElementPropsSchema(node.name.toLowerCase()).map((item) => item.name)
    : []
  return [...new Set([...Object.keys(node.props), ...schemaFields])].sort()
})
const inheritedSource = computed(() => mode.value === "context" && contexts.value.length > 0)
const sourceSummary = computed(() => {
  if (isLoop.value) return selection.value?.summary ?? "Collection loop"
  const source = detectedCollectionLabel.value || collection.value?.label || collectionId.value
  const detail = directTextBinding.value?.field || selection.value?.field || field.value
  return [source, detail].filter(Boolean).join(" · ")
})
const compatibleFields = computed(() => {
  const target = targetProp.value.toLowerCase()
  const accepted = target === "src" || target === "poster"
    ? new Set(["image", "file", "url", "string", "slug"])
    : target === "href" || target === "url"
      ? new Set(["url", "slug", "string", "reference"])
      : target.startsWith("aria-") || target === "disabled" || target === "checked"
        ? new Set(["boolean", "string"])
        : new Set(["string", "text", "slug", "url", "email", "date", "datetime", "number", "boolean", "rich-text"])
  const matches = fields.value.filter((item) => accepted.has(item.type) || ["id", "slug", "title", "body"].includes(item.key))
  return matches.length ? matches : fields.value
})
const relationFields = computed(() => fields.value.filter((item) => item.type === "relation" || item.type === "reference"))
const formatOptions = computed(() => {
  const type = compatibleFields.value.find((item) => item.key === field.value)?.type
  if (type === "date" || type === "datetime") return ["plain", "date-short", "date-long"] as CmsBindingFormat[]
  if (type === "number") return ["plain", "number"] as CmsBindingFormat[]
  if (["url", "slug", "image", "file"].includes(type ?? "")) return ["plain", "url"] as CmsBindingFormat[]
  return ["plain"] as CmsBindingFormat[]
})
const boundExpression = computed(() => {
  const model = doc?.model.value
  const path = bindingTargetPath.value
  if (!model || !path) return ""
  const target = nodeAtMarkerPath(model.nodes, path)
  if (isTextTarget.value && target?.kind === "expr") return target.value
  if (target && "props" in target && targetProp.value) {
    const value = target.props[targetProp.value]
    return value?.type === "expr" ? value.value : ""
  }
  return ""
})
const hasManagedBinding = computed(() => boundExpression.value.includes("@aria-cms-fallback"))
const contentExposure = computed(() => parseCmsContentExposure(boundExpression.value))

watch(collection, (next) => {
  if (!next) return
  entryLoadGeneration += 1
  entries.value = []
  discoveredFields.value = []
  entrySlug.value = directTextBinding.value?.entrySlug ?? ""
  error.value = ""
  if (!field.value || !fields.value.some((item) => item.key === field.value)) field.value = fields.value[0]?.key ?? ""
  if (!filterField.value) filterField.value = fields.value[0]?.key ?? ""
  if (!sortField.value) sortField.value = fields.value[0]?.key ?? ""
  if (mode.value === "entry") void loadEntries()
})
watch(detectedCollections, (next) => {
  const detected = next
    .map((name) => collections.value.find((item) => item.name === name))
    .find(Boolean)
  if (detected) collectionId.value = detected.id
})
watch(mode, (next) => {
  if (next === "entry") void loadEntries()
})
watch(() => props.initialMode, (next) => { mode.value = next })
watch([selectedPath, directTextBinding], () => {
  const binding = directTextBinding.value
  mode.value = binding
    ? "entry"
    : selectedNode.value?.kind === "map"
    ? "loop"
    : contexts.value.length
      ? "context"
      : props.initialMode === "context"
      ? "entry"
        : props.initialMode
  if (binding) {
    collectionId.value = binding.collection
    entrySlug.value = binding.entrySlug
    field.value = binding.field
  }
  targetProp.value = props.initialTargetProp ?? propTargets.value[0] ?? ""
}, { immediate: true })
watch(() => props.active, (active) => {
  if (active) void initializeBindingUi()
}, { immediate: true })
watch(selectedPath, () => {
  if (!props.embedded) void initializeBindingUi()
}, { immediate: true })
watch(contexts, (next) => {
  if (!contextVariable.value && next.length) contextVariable.value = next[0]!
  if (!archiveContext.value && next.length) archiveContext.value = next[0]!
}, { immediate: true })
watch(relationFields, (next) => {
  if (!next.some((item) => item.key === archiveField.value)) archiveField.value = next[0]?.key ?? ""
})
watch(propTargets, (next) => {
  if (props.initialTargetProp) targetProp.value = props.initialTargetProp
  else if (!next.includes(targetProp.value)) targetProp.value = next[0] ?? ""
}, { immediate: true })
watch(() => props.initialTargetProp, (next) => {
  if (next) targetProp.value = next
})
watch(filterOperatorOptions, (next) => {
  if (!next.some((item) => item.value === filterOperator.value)) {
    filterOperator.value = next[0]?.value ?? "equals"
  }
})
watch(compatibleFields, (next) => {
  if (!next.some((item) => item.key === field.value)) field.value = next[0]?.key ?? ""
})
watch(formatOptions, (next) => {
  if (!next.includes(format.value)) format.value = next[0] ?? "plain"
})

watch(() => doc?.projectPath.value ?? "", () => {
  initializationGeneration += 1
  entryLoadGeneration += 1
  loading.value = false
  initialized.value = false
  collections.value = []
  entries.value = []
  discoveredFields.value = []
  collectionId.value = ""
  entrySlug.value = ""
  if (!props.embedded || props.active) void initializeBindingUi()
})

async function initializeBindingUi() {
  const projectPath = doc?.projectPath.value
  if (initialized.value || loading.value || !projectPath) return
  const generation = initializationGeneration
  loading.value = true
  error.value = ""
  try {
    const result = await getCollections(projectPath)
    if (generation !== initializationGeneration || projectPath !== doc?.projectPath.value) return
    collections.value = result.collections
    const detected = detectedCollections.value
      .map((name) => collections.value.find((item) => item.name === name))
      .find(Boolean)
    collectionId.value ||= directTextBinding.value?.collection ?? detected?.id ?? collections.value[0]?.id ?? ""
    initialized.value = true
  } catch (cause) {
    if (generation === initializationGeneration) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  } finally {
    if (generation === initializationGeneration) loading.value = false
  }
}

async function loadEntries() {
  if (!doc?.projectPath.value || !collection.value) return
  const generation = ++entryLoadGeneration
  const projectPath = doc.projectPath.value
  const selectedCollection = collection.value
  const source = selectedCollection.source
  error.value = ""
  if (source && source.kind !== "aria-managed") {
    try {
      const result = await listExternalEntries(projectPath, {
        collectionId: selectedCollection.id,
        limit: 50,
      })
      if (generation !== entryLoadGeneration || collection.value?.id !== selectedCollection.id) return
      discoveredFields.value = result.fields
      entries.value = result.items.map((entry) => ({
        id: entry.id,
        slug: typeof entry.data.slug === "string" ? entry.data.slug : entry.id,
        title: typeof entry.data.title === "string" ? entry.data.title : entry.id,
        values: { ...entry.data, id: entry.id, body: entry.body },
      }))
      entrySlug.value ||= entries.value[0]?.slug ?? entries.value[0]?.id ?? ""
    } catch (cause) {
      if (generation !== entryLoadGeneration) return
      entries.value = []
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
    return
  }
  try {
    const result = await listCmsEntries(projectPath, { collectionId: selectedCollection.id, limit: 50 })
    if (generation !== entryLoadGeneration || collection.value?.id !== selectedCollection.id) return
    entries.value = result.items.map((record) => {
      const locale = record.locales.find((item) => item.isSource) ?? record.locales[0]!
      return {
        id: record.entry.id,
        slug: locale.slug ?? record.entry.id,
        title: locale.title ?? record.entry.id,
        values: {
          id: record.entry.id,
          slug: locale.slug,
          title: locale.title,
          body: locale.body,
          ...locale.frontmatter,
        },
      }
    })
    entrySlug.value ||= entries.value[0]?.slug ?? entries.value[0]?.id ?? ""
  } catch (cause) {
    if (generation !== entryLoadGeneration) return
    entries.value = []
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function queryId(suffix: string) {
  return `${selectedNode.value?.id ?? "node"}-${collection.value?.name ?? "collection"}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-")
}

function bindValue() {
  const path = bindingTargetPath.value
  const selectedCollection = collection.value
  if (!path || !selectedCollection || !field.value || !doc) return
  error.value = ""
  const ok = doc.commitInspectorMutation("Bind CMS field", (model) => {
    let variable = contextVariable.value.trim()
    if (mode.value === "entry") {
      if (!entrySlug.value) return { ok: false, reason: "Choose an entry." }
      const query = upsertCmsCollectionQuery(model, {
        id: queryId("entry"),
        collection: selectedCollection.name,
        entrySlug: entrySlug.value,
      })
      variable = query.variable
    }
    if (!variable) return { ok: false, reason: "Choose a template context." }
    const binding = { contextVariable: variable, field: field.value, format: format.value }
    return isTextTarget.value
      ? bindCmsTextAtPath(model, path, binding)
      : targetProp.value
        ? bindCmsPropAtPath(model, path, targetProp.value, binding)
        : { ok: false, reason: "Choose a target prop." }
  })
  if (!ok) error.value = "The CMS binding could not be applied to this selection."
}

function unbindValue() {
  const path = bindingTargetPath.value
  if (!path || !doc) return
  const id = mode.value === "entry" ? queryId("entry") : undefined
  const ok = doc.commitInspectorMutation("Unbind CMS field", (model) => isTextTarget.value
    ? unbindCmsTextAtPath(model, path, id)
    : targetProp.value
      ? unbindCmsPropAtPath(model, path, targetProp.value, id)
      : { ok: false, reason: "Choose a target prop." })
  if (!ok) error.value = "No restorable CMS fallback was found on this target."
}

function wrapLoop() {
  const path = selectedPath.value
  const selectedCollection = collection.value
  if (!path || !selectedCollection || !doc) return
  const numericLimit = Math.max(1, Math.floor(Number(limit.value) || 10))
  const ok = doc.commitInspectorMutation("Create CMS collection loop", (model) => wrapNodeInCmsLoop(model, path, {
    id: queryId("loop"),
    collection: selectedCollection.name,
    entryVariable: "entry",
    filters: [
      ...(filterField.value && (filterValue.value || filterOperator.value === "exists")
        ? [{ field: filterField.value, operator: filterOperator.value, ...(filterOperator.value === "exists" ? {} : { value: filterValue.value }) }]
        : []),
      ...extraFilters.value
        .filter((item) => item.field && (item.value || item.operator === "exists"))
        .map((item) => ({ field: item.field, operator: item.operator, ...(item.operator === "exists" ? {} : { value: item.value }) })),
    ],
    sort: sortField.value ? { field: sortField.value, direction: sortDirection.value } : undefined,
    limit: numericLimit,
    offset: Math.max(0, Math.floor(Number(offset.value) || 0)),
    status: status.value || undefined,
    locale: locale.value.trim() || undefined,
    archiveFilter: archiveMode.value && archiveField.value && archiveContext.value
      ? { mode: archiveMode.value, field: archiveField.value, contextVariable: archiveContext.value }
      : undefined,
  }))
  if (!ok) error.value = "This node cannot be wrapped in a collection loop."
}

function addFilter() {
  extraFilters.value.push({
    id: nextFilterId++,
    field: fields.value[0]?.key ?? "",
    operator: "equals",
    value: "",
  })
}

function removeFilter(id: number) {
  extraFilters.value = extraFilters.value.filter((item) => item.id !== id)
}

function unwrapLoopNode() {
  const path = selectedPath.value
  if (!path || !doc) return
  if (!doc.commitInspectorMutation("Remove CMS collection loop", (model) => unwrapCmsLoop(model, path))) {
    error.value = "Only managed single-template loops can be unwrapped here."
  }
}

function adoptLoopNode() {
  const path = selectedPath.value
  if (!path || !doc) return
  error.value = ""
  const ok = doc.commitInspectorMutation("Manage CMS collection loop", (model) => adoptCmsLoop(model, path))
  if (!ok) error.value = "This custom loop cannot be managed without changing its source."
}

function openCode() {
  modeNavigation?.openCode()
}

function setContentExposure(value: unknown) {
  const exposure = String(value) as CmsContentExposure
  if (!(["editable", "locked", "hidden"] as const).includes(exposure)) return
  const path = bindingTargetPath.value
  if (!path || !doc) return
  const ok = doc.commitInspectorMutation("Set content detail access", (model) =>
    setCmsContentExposureAtPath(model, path, exposure, isTextTarget.value ? undefined : targetProp.value),
  )
  if (!ok) error.value = "Bind this target to a CMS field before changing content-detail access."
}

function mapMatchingFields() {
  const path = selectedPath.value
  const context = contextVariable.value.trim()
  if (!path || !context || !doc) return
  error.value = ""
  notice.value = ""
  let mapped = 0
  const ok = doc.commitInspectorMutation("Map matching CMS fields", (model) => {
    const result = mapSuggestedCmsFieldsAtPath(model, path, context, fields.value.map((item) => item.key))
    mapped = result.count
    return result
  })
  if (ok) notice.value = `${mapped} matching field${mapped === 1 ? "" : "s"} mapped.`
  else error.value = "No compatible fields matched this structure."
}
</script>

<template>
  <div
    :class="embedded ? 'rounded-md bg-background' : 'group border-b border-dashed border-border/70 pb-2'"
  >
    <div
      v-if="!embedded"
      class="flex items-center justify-between gap-2 py-2 text-[11px] font-medium text-muted-foreground"
    >
      <span>CMS binding</span>
      <span v-if="sourceSummary" class="max-w-[60%] truncate text-[10px] font-normal text-muted-foreground/75">{{ sourceSummary }}</span>
    </div>
    <div class="space-y-4" :class="embedded ? 'p-2.5' : 'pb-4 pt-2'">
      <p v-if="embedded && sourceSummary" class="truncate text-[10px] text-muted-foreground">{{ sourceSummary }}</p>
      <div v-if="loading" class="flex items-center gap-2 text-[11px] text-muted-foreground"><Spinner class="size-3" /> {{ m.composer_cms_loading() }}</div>
      <p v-else-if="!collections.length" class="text-[11px] text-muted-foreground">{{ m.composer_cms_empty() }}</p>
      <template v-else>
        <label class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">Source</Label><Select v-model="mode"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="context" :disabled="!contexts.length">Current loop item</SelectItem><SelectItem value="entry">Single entry</SelectItem><SelectItem value="loop">Collection loop</SelectItem></SelectContent></Select></label>
        <div v-if="inheritedSource" class="flex min-h-8 items-center justify-between gap-3 rounded-md bg-muted/35 px-2.5 text-[10px]">
          <span class="text-muted-foreground">Inherited from loop</span>
          <span class="truncate font-medium text-foreground">{{ detectedCollectionLabel || collection?.label }} · {{ contextVariable || contexts[0] }}</span>
        </div>
        <label v-else class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">{{ m.composer_cms_collection() }}</Label><Select v-model="collectionId"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in collections" :key="item.id" :value="item.id">{{ item.label }}</SelectItem></SelectContent></Select></label>

        <template v-if="mode !== 'loop'">
          <label v-if="mode === 'context' && contexts.length > 1" class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">{{ m.composer_cms_context() }}</Label><Select v-model="contextVariable"><SelectTrigger class="h-8 text-xs"><SelectValue :placeholder="m.composer_cms_no_context()" /></SelectTrigger><SelectContent><SelectItem v-for="item in contexts" :key="item" :value="item">{{ item }}</SelectItem></SelectContent></Select></label>
          <label v-else-if="mode === 'entry'" class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">{{ m.composer_cms_entry() }}</Label><Select v-model="entrySlug"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="entry in entries" :key="entry.id" :value="entry.slug || entry.id">{{ entry.title || entry.slug }}</SelectItem></SelectContent></Select></label>
          <div class="grid gap-3" :class="formatOptions.length > 1 ? 'grid-cols-2' : 'grid-cols-1'"><label class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">{{ m.composer_cms_field() }}</Label><Select v-model="field"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in compatibleFields" :key="item.key" :value="item.key">{{ item.label }}</SelectItem></SelectContent></Select></label><label v-if="formatOptions.length > 1" class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">{{ m.composer_cms_format() }}</Label><Select v-model="format"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in formatOptions" :key="item" :value="item">{{ item === 'plain' ? m.composer_cms_format_plain() : item === 'date-short' ? m.composer_cms_format_date_short() : item === 'date-long' ? m.composer_cms_format_date_long() : item === 'number' ? m.composer_cms_format_number() : 'URL' }}</SelectItem></SelectContent></Select></label></div>
          <div v-if="mode === 'entry'" class="rounded-md border border-dashed border-border/60 bg-background/40 px-2 py-1.5">
            <span class="block text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Preview</span>
            <span class="mt-0.5 block max-h-16 overflow-hidden break-words text-[10px] text-foreground">{{ previewText }}</span>
          </div>
          <label v-if="!isTextTarget && propTargets.length" class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">{{ m.composer_cms_target_prop() }}</Label><Select v-model="targetProp"><SelectTrigger class="h-8 font-mono text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in propTargets" :key="item" :value="item">{{ item }}</SelectItem></SelectContent></Select></label>
          <div :class="hasManagedBinding ? 'grid grid-cols-2 gap-2' : ''"><Button type="button" size="sm" class="w-full" :disabled="(mode === 'context' && !contextVariable) || (!isTextTarget && !targetProp)" @click="bindValue">{{ hasManagedBinding ? 'Update binding' : m.composer_cms_bind() }}</Button><Button v-if="hasManagedBinding" type="button" variant="outline" size="sm" @click="unbindValue">Clear</Button></div>
          <Button
            v-if="mode === 'context' && contextVariable && !isTextTarget && !isLoop"
            type="button"
            variant="ghost"
            size="sm"
            class="h-7 w-full justify-start px-1.5 text-[10px] text-muted-foreground"
            @click="mapMatchingFields"
          >
            <AppIcon name="sparkles" :size="13" aria-hidden="true" />
            Map matching fields
          </Button>
          <div v-if="hasManagedBinding" class="flex items-center justify-between gap-3 rounded-md border border-dashed border-border/70 bg-background/50 px-2.5 py-2">
            <div class="min-w-0">
              <span class="block text-[10px] font-medium text-foreground">Content details</span>
              <span class="block text-[9px] text-muted-foreground">Control editing outside Composer</span>
            </div>
            <Select :model-value="contentExposure" @update:model-value="setContentExposure">
              <SelectTrigger class="h-7 w-24 text-[10px]" aria-label="Content detail access"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="editable">Editable</SelectItem>
                <SelectItem value="locked">Locked</SelectItem>
                <SelectItem value="hidden">Hidden</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </template>

        <template v-else>
          <div v-if="isLoop" class="space-y-3">
            <p class="text-[11px] text-muted-foreground">{{ m.composer_cms_existing_loop() }}</p>
            <Button v-if="selection?.ownership === 'adoptable'" type="button" size="sm" class="w-full" @click="adoptLoopNode">Manage with Aria</Button>
            <Button v-else-if="selection?.ownership === 'managed'" type="button" variant="outline" size="sm" class="w-full" @click="unwrapLoopNode">{{ m.composer_cms_unwrap() }}</Button>
            <Button v-else type="button" variant="outline" size="sm" class="w-full" @click="openCode">Open in Code</Button>
          </div>
          <template v-else>
            <div class="grid grid-cols-2 gap-3"><label class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">{{ m.composer_cms_filter_field() }}</Label><Select v-model="filterField"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in fields" :key="item.key" :value="item.key">{{ item.label }}</SelectItem></SelectContent></Select></label><label class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">{{ m.composer_cms_operator() }}</Label><Select v-model="filterOperator"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="operator in filterOperatorOptions" :key="operator.value" :value="operator.value">{{ operator.label }}</SelectItem></SelectContent></Select></label></div>
            <label v-if="filterOperator !== 'exists'" class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">{{ m.composer_cms_filter_value() }}</Label><Input v-model="filterValue" class="h-8 text-xs" /></label>
            <div v-for="item in extraFilters" :key="item.id" class="grid grid-cols-[1fr_1fr_auto] gap-1.5 rounded-md border border-dashed border-border/70 p-2">
              <Select v-model="item.field"><SelectTrigger class="h-8 text-xs" aria-label="Filter field"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="option in fields" :key="option.key" :value="option.key">{{ option.label }}</SelectItem></SelectContent></Select>
              <Select v-model="item.operator"><SelectTrigger class="h-8 text-xs" aria-label="Filter operator"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="equals">Equals</SelectItem><SelectItem value="notEquals">Not equal</SelectItem><SelectItem value="contains">Contains</SelectItem><SelectItem value="greaterThan">Greater than</SelectItem><SelectItem value="lessThan">Less than</SelectItem><SelectItem value="exists">Exists</SelectItem></SelectContent></Select>
              <Button type="button" variant="ghost" size="icon-sm" class="size-8" aria-label="Remove filter" @click="removeFilter(item.id)"><AppIcon name="trash" :size="13" aria-hidden="true" /></Button>
              <Input v-if="item.operator !== 'exists'" v-model="item.value" class="col-span-2 h-8 text-xs" aria-label="Filter value" />
            </div>
            <Button type="button" variant="ghost" size="sm" class="w-full border border-dashed border-border/70 text-[10px]" @click="addFilter">Add filter</Button>
            <div class="grid grid-cols-3 gap-3"><label class="col-span-2 block space-y-1.5"><Label class="text-[10px] text-muted-foreground">{{ m.composer_cms_sort() }}</Label><Select v-model="sortField"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in fields" :key="item.key" :value="item.key">{{ item.label }}</SelectItem></SelectContent></Select></label><label class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">{{ m.composer_cms_order() }}</Label><Select v-model="sortDirection"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="asc">{{ m.composer_cms_ascending() }}</SelectItem><SelectItem value="desc">{{ m.composer_cms_descending() }}</SelectItem></SelectContent></Select></label></div>
            <div class="grid grid-cols-2 gap-3"><label class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">{{ m.composer_cms_limit() }}</Label><Input v-model="limit" type="number" min="1" class="h-8 text-xs" /></label><label class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">Offset</Label><Input v-model="offset" type="number" min="0" class="h-8 text-xs" /></label></div>
            <div class="grid grid-cols-2 gap-3"><label class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">Status</Label><Select v-model="status"><SelectTrigger class="h-8 text-xs"><SelectValue placeholder="Published" /></SelectTrigger><SelectContent><SelectItem value="published">Published</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="scheduled">Scheduled</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent></Select></label><label class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">Locale</Label><Input v-model="locale" class="h-8 text-xs" placeholder="Page locale" /></label></div>
            <div v-if="relationFields.length && contexts.length" class="space-y-2 rounded-md border border-dashed border-border/70 p-2">
              <div class="flex items-center justify-between gap-2">
                <div><span class="block text-[10px] font-medium">Relation archive filter</span><span class="block text-[9px] text-muted-foreground">Limit related entries to the current archive item.</span></div>
                <Select v-model="archiveMode"><SelectTrigger class="h-7 w-24 text-[10px]" aria-label="Relation archive filter mode"><SelectValue placeholder="Off" /></SelectTrigger><SelectContent><SelectItem value="relation">Relation</SelectItem><SelectItem value="reference">Reference</SelectItem></SelectContent></Select>
              </div>
              <div v-if="archiveMode" class="grid grid-cols-2 gap-2">
                <Select v-model="archiveField"><SelectTrigger class="h-8 text-xs" aria-label="Relation field"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in relationFields" :key="item.key" :value="item.key">{{ item.label }}</SelectItem></SelectContent></Select>
                <Select v-model="archiveContext"><SelectTrigger class="h-8 text-xs" aria-label="Archive context"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in contexts" :key="item" :value="item">{{ item }}</SelectItem></SelectContent></Select>
              </div>
            </div>
            <Button type="button" size="sm" class="w-full" @click="wrapLoop">{{ m.composer_cms_wrap() }}</Button>
          </template>
        </template>
      </template>
      <p v-if="error" role="alert" class="text-[11px] text-destructive">{{ error }}</p>
      <p class="sr-only" role="status" aria-live="polite">{{ notice }}</p>
      <details v-if="selection && (selectedNode?.kind === 'expr' || selectedNode?.kind === 'map')" class="rounded-md border border-dashed border-border/70">
        <summary class="cursor-pointer list-none px-2.5 py-2 text-[10px] font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary">Advanced source</summary>
        <div class="space-y-2 border-t border-dashed border-border/70 p-2.5">
          <pre class="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground">{{ selectedNode.kind === 'map' ? selectedNode.head : selectedNode.value }}</pre>
          <Button type="button" variant="outline" size="sm" class="w-full" @click="openCode">Open in Code</Button>
        </div>
      </details>
    </div>
  </div>
</template>
