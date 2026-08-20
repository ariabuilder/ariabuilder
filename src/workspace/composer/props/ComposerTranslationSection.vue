<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  applyComposerTranslationCutover,
  assessComposerTranslationAdoption,
  createComposerTranslationDrafts,
  editComposerTranslationValue,
} from "@/lib/composer"
import { getSiteSettings, updateContentLocalization } from "@/lib/workspace"
import {
  bindTranslationPropAtPath,
  bindTranslationTextAtPath,
  describeComposerCmsSelection,
  detectTranslationContexts,
  ensureTranslationContext,
  getElementPropsSchema,
  nodeAtMarkerPath,
  unbindTranslationPropAtPath,
  unbindTranslationTextAtPath,
  type ProjectTranslationScalar,
} from "../../../../shared/composer"
import { inferContentDirection } from "../../../../shared/localization"
import { tryUseComposerBeacon } from "../selection/useComposerBeacon"
import { tryUseComposerDocument } from "../useComposerDocumentSession"
import { tryUseComposerTranslations } from "../useComposerTranslations"

const doc = tryUseComposerDocument()
const beacon = tryUseComposerBeacon()
const translations = tryUseComposerTranslations()
const catalogId = ref("")
const namespaceName = ref("")
const keyName = ref("")
const keySearch = ref("")
const targetProp = ref("")
const editingValue = ref("")
const busy = ref(false)
const error = ref("")
const notice = ref("")
const adoptionOpen = ref(false)
const adoptionPreview = ref<Awaited<ReturnType<typeof assessComposerTranslationAdoption>> | null>(null)
const adoptionResult = ref<Awaited<ReturnType<typeof createComposerTranslationDrafts>> | null>(null)
const cutoverPreview = ref<Awaited<ReturnType<typeof assessComposerTranslationAdoption>> | null>(null)

const catalogs = computed(() => translations?.result.value.catalogs ?? [])
const catalog = computed(() => catalogs.value.find((item) => item.id === catalogId.value) ?? catalogs.value[0] ?? null)
const namespace = computed(() => catalog.value?.namespaces.find((item) => item.name === namespaceName.value) ?? catalog.value?.namespaces[0] ?? null)
const filteredKeys = computed(() => {
  const query = keySearch.value.trim().toLowerCase()
  return (namespace.value?.keys ?? []).filter((key) => !query || key.path.join(".").toLowerCase().includes(query) || key.label.toLowerCase().includes(query))
})
const key = computed(() => namespace.value?.keys.find((item) => item.path.join(".") === keyName.value) ?? filteredKeys.value[0] ?? null)
const activeLocale = computed(() => {
  const selected = translations?.activeLocale.value
  return selected && catalog.value?.locales.includes(selected) ? selected : catalog.value?.defaultLocale ?? ""
})
const selectedPath = computed(() => beacon?.selectedPath.value ?? null)
const selection = computed(() => doc?.model.value && selectedPath.value ? describeComposerCmsSelection(doc.model.value, selectedPath.value) : null)
const bindingTargetPath = computed(() => selection.value?.textTargetPath ?? selectedPath.value)
const targetNode = computed(() => doc?.model.value && bindingTargetPath.value ? nodeAtMarkerPath(doc.model.value.nodes, bindingTargetPath.value) : null)
const isTextTarget = computed(() => targetNode.value?.kind === "text" || targetNode.value?.kind === "expr")
const selectedNode = computed(() => doc?.model.value && selectedPath.value ? nodeAtMarkerPath(doc.model.value.nodes, selectedPath.value) : null)
const propTargets = computed(() => {
  const node = selectedNode.value
  if (!node || !(node.kind === "element" || node.kind === "component" || node.kind === "slot" || node.kind === "raw")) return []
  const schema = node.kind === "element" ? getElementPropsSchema(node.name.toLowerCase()).map((field) => field.name) : []
  return [...new Set([...Object.keys(node.props), ...schema])].sort()
})
const boundExpression = computed(() => {
  const node = targetNode.value
  if (isTextTarget.value && node?.kind === "expr") return node.value
  const selected = selectedNode.value
  if (selected && "props" in selected && targetProp.value) {
    const value = selected.props[targetProp.value]
    return value?.type === "expr" ? value.value : ""
  }
  return ""
})
const hasManagedBinding = computed(() => boundExpression.value.includes("@aria-translation-fallback"))
const settingsDiffer = ref(false)

function relativeImport(fromFile: string, toFile: string): string {
  const from = fromFile.split("/").slice(0, -1)
  const to = toFile.replace(/\.(?:ts|js|mjs|cjs|mts|cts|json)$/i, "").split("/")
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift() }
  const relative = [...from.map(() => ".."), ...to].join("/")
  return relative.startsWith(".") ? relative : `./${relative}`
}

function scalarDraft(value: ProjectTranslationScalar | undefined): string {
  return value == null ? "" : String(value)
}

function parsedDraft(value: string, current: ProjectTranslationScalar | undefined): ProjectTranslationScalar {
  if (typeof current === "number") return Number(value)
  if (typeof current === "boolean") return value === "true"
  if (current === null) return value || null
  return value
}

async function checkSettings() {
  const current = catalog.value
  if (!current || !doc) { settingsDiffer.value = false; return }
  try {
    const settings = await getSiteSettings(doc.projectPath.value)
    const localization = settings.localization?.content
    settingsDiffer.value = !localization
      || current.locales.some((locale) => !localization.locales.some((item) => item.code === locale && item.enabled))
      || JSON.stringify(localization.resolver ?? { kind: "path-prefix" }) !== JSON.stringify(current.resolver)
  } catch { settingsDiffer.value = true }
}

async function useDetectedLocalization() {
  const current = catalog.value
  if (!current || !doc) return
  busy.value = true; error.value = ""
  try {
    const settings = await getSiteSettings(doc.projectPath.value)
    const existing = settings.localization?.content.locales ?? []
    await updateContentLocalization(doc.projectPath.value, {
      defaultLocale: current.defaultLocale,
      resolver: current.resolver,
      locales: current.locales.map((code) => {
        const known = existing.find((locale) => locale.code === code)
        return known ? { ...known, enabled: true } : {
          code, label: code.toUpperCase(), enabled: true, direction: inferContentDirection(code),
          fallbacks: code === current.defaultLocale ? [] : [current.defaultLocale],
        }
      }),
    })
    settingsDiffer.value = false
    notice.value = "Detected localization is now active."
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

function bindValue() {
  const currentCatalog = catalog.value
  const currentNamespace = namespace.value
  const currentKey = key.value
  const path = bindingTargetPath.value
  const editFile = doc?.editFile.value
  if (!currentCatalog || !currentNamespace || !currentKey || !path || !editFile || !doc) return
  error.value = ""
  const ok = doc.commitInspectorMutation("Bind project translation", (model) => {
    const proven = currentCatalog.consumers.find((consumer) => consumer.file === editFile && consumer.namespace === currentNamespace.name)
      ?? detectTranslationContexts(model.extraFrontmatter).find((context) => context.namespace === currentNamespace.name)
    const context = proven ?? ensureTranslationContext(model, {
      catalogId: currentCatalog.id,
      catalogExportName: currentCatalog.exportName,
      importPath: relativeImport(editFile, currentCatalog.sourceFile),
      namespace: currentNamespace.name,
      locales: currentCatalog.locales,
      defaultLocale: currentCatalog.defaultLocale,
      resolver: currentCatalog.resolver,
    })
    const binding = { catalogId: currentCatalog.id, namespace: currentNamespace.name, keyPath: currentKey.path, contextVariable: context.contextVariable }
    return isTextTarget.value
      ? bindTranslationTextAtPath(model, path, binding)
      : targetProp.value
        ? bindTranslationPropAtPath(model, path, targetProp.value, binding)
        : { ok: false, reason: "Choose a target property." }
  })
  if (!ok) error.value = "The translation binding could not be applied to this selection."
}

function unbindValue() {
  const path = bindingTargetPath.value
  if (!path || !doc) return
  const ok = doc.commitInspectorMutation("Clear project translation", (model) => isTextTarget.value
    ? unbindTranslationTextAtPath(model, path)
    : targetProp.value ? unbindTranslationPropAtPath(model, path, targetProp.value) : { ok: false, reason: "Choose a target property." })
  if (!ok) error.value = "No restorable translation fallback was found."
}

async function saveValue() {
  const currentCatalog = catalog.value
  const currentNamespace = namespace.value
  const currentKey = key.value
  if (!currentCatalog || !currentNamespace || !currentKey || !activeLocale.value || !doc || !translations) return
  busy.value = true; error.value = ""
  try {
    await editComposerTranslationValue(doc.projectPath.value, {
      catalogId: currentCatalog.id, namespace: currentNamespace.name, keyPath: currentKey.path,
      locale: activeLocale.value, value: parsedDraft(editingValue.value, currentKey.values[activeLocale.value]),
      expectedSourceHash: currentCatalog.sourceHash,
    })
    await translations.refresh(true)
    notice.value = `${activeLocale.value} translation saved.`
  } catch (cause) {
    error.value = cause instanceof Error && cause.message.includes("TRANSLATION_CATALOG_CONFLICT")
      ? "The catalog changed on disk. It has been refreshed; review the value and try again."
      : cause instanceof Error ? cause.message : String(cause)
    await translations.refresh(true)
  } finally { busy.value = false }
}

async function reviewAdoption() {
  const currentCatalog = catalog.value
  const currentNamespace = namespace.value
  if (!currentCatalog || !currentNamespace || !doc) return
  busy.value = true; error.value = ""
  try {
    adoptionPreview.value = await assessComposerTranslationAdoption(doc.projectPath.value, {
      catalogId: currentCatalog.id, namespaces: [currentNamespace.name], expectedCatalogHash: currentCatalog.sourceHash,
    })
    adoptionOpen.value = true
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function createDrafts() {
  const preview = adoptionPreview.value
  if (!preview || !doc) return
  busy.value = true; error.value = ""
  try {
    adoptionResult.value = await createComposerTranslationDrafts(doc.projectPath.value, {
      catalogId: preview.catalogId, namespaces: preview.namespaces.map((item) => item.namespace),
      expectedCatalogHash: preview.catalogHash, expectedPreviewHash: preview.previewHash,
    })
    adoptionOpen.value = false
    notice.value = "Aria CMS translation drafts created. Project catalog and consumers were unchanged."
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function reviewCutover() {
  const currentCatalog = catalog.value
  const currentNamespace = namespace.value
  if (!currentCatalog || !currentNamespace || !adoptionResult.value || !doc) return
  busy.value = true; error.value = ""
  try {
    cutoverPreview.value = await assessComposerTranslationAdoption(doc.projectPath.value, {
      catalogId: currentCatalog.id,
      namespaces: [currentNamespace.name],
      expectedCatalogHash: currentCatalog.sourceHash,
    })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function applyCutover() {
  const currentCatalog = catalog.value
  const preview = cutoverPreview.value
  const targets = adoptionResult.value?.targets
  const consumers = preview?.namespaces.flatMap((item) => item.consumers) ?? []
  if (!currentCatalog || !preview || !targets || !consumers.length || !doc) return
  busy.value = true; error.value = ""
  try {
    await doc.flushSave()
    const result = await applyComposerTranslationCutover(doc.projectPath.value, {
      catalogId: currentCatalog.id,
      namespaces: preview.namespaces.map((item) => item.namespace),
      expectedCatalogHash: preview.catalogHash,
      expectedPreviewHash: preview.previewHash,
      consumerIds: consumers.map((consumer) => consumer.id),
      targets,
    })
    cutoverPreview.value = null
    adoptionResult.value = null
    await translations?.refresh(true)
    doc.reloadPreview()
    notice.value = `${result.cutoverConsumers.length} translation consumer${result.cutoverConsumers.length === 1 ? "" : "s"} cut over to Aria CMS. The project catalog remains in place.`
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

watch(catalogs, (items) => { if (!items.some((item) => item.id === catalogId.value)) catalogId.value = items[0]?.id ?? "" }, { immediate: true })
watch(catalog, (value) => { namespaceName.value = value?.namespaces[0]?.name ?? ""; void checkSettings() }, { immediate: true })
watch(namespace, (value) => { keyName.value = value?.keys[0]?.path.join(".") ?? "" }, { immediate: true })
watch(key, (value) => { editingValue.value = scalarDraft(value?.values[activeLocale.value]) }, { immediate: true })
watch(activeLocale, () => { editingValue.value = scalarDraft(key.value?.values[activeLocale.value]) })
</script>

<template>
  <div class="space-y-3">
    <div v-if="translations?.loading.value" class="flex items-center gap-2 text-[11px] text-muted-foreground"><Spinner class="size-3" /> Discovering project translations…</div>
    <p v-else-if="!catalogs.length" class="text-[11px] text-muted-foreground">No statically analyzable translation catalogs were found.</p>
    <template v-else>
      <div v-if="settingsDiffer" class="space-y-2 rounded-md border border-dashed border-primary/40 bg-primary/5 p-2.5">
        <p class="text-[10px] text-muted-foreground">Detected {{ catalog?.locales.join(', ') }} using {{ catalog?.resolver.kind === 'query-param' ? `?${catalog.resolver.parameter}=` : 'path prefixes' }}. Aria settings differ.</p>
        <Button type="button" variant="outline" size="sm" class="h-7 w-full text-[10px]" :disabled="busy" @click="useDetectedLocalization">Use detected localization</Button>
      </div>
      <label class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">Catalog</Label><Select v-model="catalogId"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in catalogs" :key="item.id" :value="item.id">{{ item.label }}</SelectItem></SelectContent></Select></label>
      <label class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">Namespace</Label><Select v-model="namespaceName"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in catalog?.namespaces ?? []" :key="item.id" :value="item.name">{{ item.label }}</SelectItem></SelectContent></Select></label>
      <label class="block space-y-1.5"><Label for="translation-key-search" class="text-[10px] text-muted-foreground">Search keys</Label><Input id="translation-key-search" v-model="keySearch" class="h-8 text-xs" placeholder="hero title…" /></label>
      <label class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">Key</Label><Select v-model="keyName"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in filteredKeys" :key="item.path.join('.')" :value="item.path.join('.')">{{ item.label }}</SelectItem></SelectContent></Select></label>

      <div v-if="key" class="space-y-1.5 rounded-md border border-dashed border-border/70 bg-background/40 p-2.5">
        <div v-for="locale in catalog?.locales ?? []" :key="locale" class="grid grid-cols-[2.5rem_1fr] gap-2 text-[10px]" :class="locale === activeLocale ? 'text-foreground' : 'text-muted-foreground'">
          <span class="font-medium uppercase">{{ locale }}</span><span class="break-words">{{ key.values[locale] ?? 'Missing' }}</span>
        </div>
        <p v-if="!key.complete" role="alert" class="text-[10px] text-warning">Missing in {{ catalog?.locales.filter(locale => key?.values[locale] === undefined).join(', ') }}. Automatic CMS cutover is blocked.</p>
      </div>

      <label v-if="!isTextTarget && propTargets.length" class="block space-y-1.5"><Label class="text-[10px] text-muted-foreground">Target property</Label><Select v-model="targetProp"><SelectTrigger class="h-8 font-mono text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in propTargets" :key="item" :value="item">{{ item }}</SelectItem></SelectContent></Select></label>
      <div :class="hasManagedBinding ? 'grid grid-cols-2 gap-2' : ''"><Button type="button" size="sm" class="w-full" :disabled="!key || (!isTextTarget && !targetProp)" @click="bindValue">{{ hasManagedBinding ? 'Update binding' : 'Bind translation' }}</Button><Button v-if="hasManagedBinding" type="button" variant="outline" size="sm" @click="unbindValue">Clear</Button></div>

      <div v-if="key?.editable" class="space-y-1.5 border-t border-dashed border-border/70 pt-3">
        <Label for="translation-active-value" class="text-[10px] text-muted-foreground">Edit {{ activeLocale.toUpperCase() }} value</Label>
        <Input id="translation-active-value" v-model="editingValue" class="h-8 text-xs" :disabled="busy" />
        <Button type="button" variant="outline" size="sm" class="h-7 w-full text-[10px]" :disabled="busy" @click="saveValue">Save catalog value</Button>
      </div>

      <Button type="button" variant="ghost" size="sm" class="h-7 w-full text-[10px] text-muted-foreground" :disabled="busy" @click="reviewAdoption">Review CMS adoption</Button>
      <div v-if="adoptionOpen && adoptionPreview" class="space-y-2 rounded-md border border-border bg-background p-2.5">
        <p class="text-[10px] font-medium">{{ adoptionPreview.namespaces[0]?.collectionName }}</p>
        <p class="text-[10px] text-muted-foreground">{{ adoptionPreview.namespaces[0]?.schema.length }} fields · {{ adoptionPreview.namespaces[0]?.locales.join(', ') }} · {{ adoptionPreview.namespaces[0]?.consumers.length }} consumers</p>
        <p v-if="adoptionPreview.namespaces[0]?.issues.length" class="text-[10px] text-warning">{{ adoptionPreview.namespaces[0]?.issues.length }} coverage issues will be retained as draft omissions.</p>
        <ul v-if="adoptionPreview.namespaces[0]?.consumers.length" class="space-y-1 text-[10px] text-muted-foreground">
          <li v-for="consumer in adoptionPreview.namespaces[0]?.consumers" :key="consumer.id" class="flex items-start justify-between gap-2"><code class="min-w-0 truncate">{{ consumer.expression }}</code><span :class="consumer.status === 'safe' ? 'text-primary' : 'text-warning'">{{ consumer.status }}</span></li>
        </ul>
        <p v-if="adoptionPreview.namespaces[0]?.conflict || !adoptionPreview.settingsCompatible" role="alert" class="text-[10px] text-destructive">{{ adoptionPreview.namespaces[0]?.conflict || adoptionPreview.settingsReason }}</p>
        <div class="grid grid-cols-2 gap-2"><Button type="button" variant="ghost" size="sm" @click="adoptionOpen = false">Cancel</Button><Button type="button" size="sm" :disabled="busy || !adoptionPreview.settingsCompatible || Boolean(adoptionPreview.namespaces[0]?.conflict)" @click="createDrafts">Create drafts</Button></div>
      </div>
      <div v-if="adoptionResult" class="space-y-2 rounded-md border border-dashed border-primary/40 bg-primary/5 p-2.5">
        <p class="text-[10px] font-medium">CMS drafts created</p>
        <p class="text-[10px] text-muted-foreground">The catalog and consumers are still project-owned. Cutover is a separate source rewrite.</p>
        <Button type="button" variant="outline" size="sm" class="h-7 w-full text-[10px]" :disabled="busy" @click="reviewCutover">Review consumer cutover</Button>
      </div>
      <div v-if="cutoverPreview" class="space-y-2 rounded-md border border-border bg-background p-2.5">
        <p class="text-[10px] font-medium">Consumer cutover</p>
        <p class="text-[10px] text-muted-foreground">Only the hash-matched consumers below will change. Their original project expressions remain as fallbacks.</p>
        <ul class="space-y-1 text-[10px]">
          <li v-for="consumer in cutoverPreview.namespaces.flatMap(item => item.consumers)" :key="consumer.id" class="grid grid-cols-[1fr_auto] gap-2"><span class="min-w-0 truncate">{{ consumer.file }} · {{ consumer.namespace }}.{{ consumer.keyPath.join('.') }}</span><span :class="consumer.status === 'safe' ? 'text-primary' : 'text-warning'">{{ consumer.status }}</span></li>
        </ul>
        <p class="text-[10px] text-muted-foreground">Fallback-chain coverage is revalidated atomically when cutover starts.</p>
        <div class="grid grid-cols-2 gap-2"><Button type="button" variant="ghost" size="sm" @click="cutoverPreview = null">Cancel</Button><Button type="button" size="sm" :disabled="busy || !cutoverPreview.namespaces.some(item => item.consumers.length)" @click="applyCutover">Apply cutover</Button></div>
      </div>
    </template>
    <p v-if="translations?.error.value" role="alert" class="text-[11px] text-destructive">{{ translations.error.value }}</p>
    <p v-if="error" role="alert" class="text-[11px] text-destructive">{{ error }}</p>
    <p class="sr-only" role="status" aria-live="polite">{{ notice }}</p>
  </div>
</template>
