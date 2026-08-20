<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import SnippetCodeEditor from "@/workspace/settings/SnippetCodeEditor.vue"
import type { MediaAsset } from "@/lib/media"
import { getPlayableMediaUrl } from "@/lib/media"
import MediaPickerDialog from "@/workspace/studio/media/components/MediaPickerDialog.vue"
import { addNavigationItemAtPath, allocNodeId, containsDynamicAstroContent, nodeAtMarkerPath, parseSanitizedSvg, replaceSvgElementAtPath, setPropAtPath, stringFieldDisplay } from "../../../../shared/composer"
import type { ElementNode } from "../../../../shared/composer/types"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import InspectorPropertySection from "./InspectorPropertySection.vue"

const props = defineProps<{ node: ElementNode; openSection?: string | null; disabled?: boolean }>()
const emit = defineEmits<{ "update:openSection": [value: string | null] }>()
const inspector = tryUseInspectorContext()
const svgPickerOpen = ref(false)
const svgError = ref("")
const tag = computed(() => props.node.name.toLowerCase())
const isCode = computed(() => tag.value === "pre" || tag.value === "code")
const isSvg = computed(() => tag.value === "svg" && stringFieldDisplay(props.node.props["data-aria-type"]).text.toLowerCase() !== "icon")
const isNavigation = computed(() => tag.value === "nav")
const codeNode = computed(() => tag.value === "code" ? props.node : (props.node.children ?? []).find((child): child is ElementNode => child.kind === "element" && child.name.toLowerCase() === "code") ?? null)
const codeText = computed(() => (codeNode.value?.children ?? []).find((child) => child.kind === "text") ?? null)
const codeDraft = ref("")
watch(codeText, (node) => { codeDraft.value = node?.kind === "text" ? node.value : "" }, { immediate: true })
const language = computed(() => stringFieldDisplay(codeNode.value?.props.class).text.replace(/^language-/, ""))
const codeClassDynamic = computed(() => Boolean(codeNode.value?.props.class && codeNode.value.props.class.type !== "string"))
const codeHasDynamicContent = computed(() => containsDynamicAstroContent(codeNode.value?.children))
const codeHasChanges = computed(() => Boolean(codeDraft.value || language.value || codeHasDynamicContent.value))
const codeResetDisabled = computed(() => props.disabled || codeHasDynamicContent.value || codeClassDynamic.value)
const svgEditableProps = ["viewBox", "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"] as const
const svgOwnedProps = ["width", "height", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "role", "aria-label", "aria-hidden"] as const
const svgHasChanges = computed(() => [...svgEditableProps, "role", "aria-label", "aria-hidden"].some((name) => props.node.props[name] != null))
const svgHasResettableChanges = computed(() => svgOwnedProps.some((name) => props.node.props[name] != null))
const svgResetDisabled = computed(() => props.disabled || svgOwnedProps.some((name) => {
  const value = props.node.props[name]
  return value != null && value.type !== "string" && value.type !== "bare"
}))
const svgImportDisabled = computed(() => props.disabled
  || Object.values(props.node.props).some((value) => value.type !== "string" && value.type !== "bare")
  || containsDynamicAstroContent(props.node.children))
const navigationHasChanges = computed(() => props.node.props["aria-label"] != null)
const navigationResetDisabled = computed(() => props.disabled || Boolean(props.node.props["aria-label"] && props.node.props["aria-label"]?.type !== "string"))

function commitCode() {
  const path = inspector?.selectedPath.value
  if (!path || props.disabled || codeHasDynamicContent.value) return
  inspector.document.commitInspectorMutation("Edit code block", (model) => {
    const selected = nodeAtMarkerPath(model.nodes, path)
    if (selected?.kind !== "element") return { ok: false, selectPath: path, reason: "Code block is unavailable" }
    const code = selected.name.toLowerCase() === "code" ? selected : (selected.children ?? []).find((child) => child.kind === "element" && child.name.toLowerCase() === "code")
    if (code?.kind !== "element") return { ok: false, selectPath: path, reason: "Code child is unavailable" }
    if (containsDynamicAstroContent(code.children)) return { ok: false, selectPath: path, reason: "Expression-bound code must be detached before editing" }
    const text = (code.children ?? []).find((child) => child.kind === "text")
    if (text?.kind === "text") text.value = codeDraft.value
    else code.children = [{ id: allocNodeId(), kind: "text", value: codeDraft.value }]
    return { ok: true, selectPath: path }
  }, { immediate: false, coalesceKey: `code:${path}` })
}
function setCodeLanguage(value: unknown) {
  const path = inspector?.selectedPath.value
  if (!path || props.disabled || codeClassDynamic.value) return
  inspector.document.commitInspectorMutation("Change code language", (model) => {
    const selected = nodeAtMarkerPath(model.nodes, path)
    const code = selected?.kind === "element" && selected.name.toLowerCase() === "code" ? selected : selected?.kind === "element" ? (selected.children ?? []).find((child) => child.kind === "element" && child.name.toLowerCase() === "code") : null
    if (code?.kind !== "element") return { ok: false, selectPath: path, reason: "Code child is unavailable" }
    if (code.props.class && code.props.class.type !== "string") return { ok: false, selectPath: path, reason: "Code language is expression-bound" }
    const next = String(value).trim()
    if (next) code.props.class = { type: "string", value: `language-${next}` }
    else delete code.props.class
    return { ok: true, selectPath: path }
  }, { immediate: true, coalesceKey: null })
}
function resetCode() {
  const path = inspector?.selectedPath.value
  if (!path || codeResetDisabled.value) return
  inspector.document.commitInspectorMutation("Reset code", (model) => {
    const selected = nodeAtMarkerPath(model.nodes, path)
    const code = selected?.kind === "element" && selected.name.toLowerCase() === "code" ? selected : selected?.kind === "element" ? (selected.children ?? []).find((child) => child.kind === "element" && child.name.toLowerCase() === "code") : null
    if (code?.kind !== "element") return { ok: false, selectPath: path, reason: "Code child is unavailable" }
    if (containsDynamicAstroContent(code.children)) return { ok: false, selectPath: path, reason: "Expression-bound code must be detached before reset" }
    delete code.props.class
    const text = (code.children ?? []).find((child) => child.kind === "text")
    if (text?.kind === "text") text.value = ""
    else code.children = []
    return { ok: true, selectPath: path }
  }, { immediate: true, coalesceKey: null })
}
function setSvgProp(name: string, value: unknown) {
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || props.disabled) return
  const next = String(value)
  inspector.document.commitInspectorMutation(`Edit ${isNavigation.value ? "navigation" : "SVG"} ${name}`, (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    const current = node?.kind === "element" ? node.props[name] : undefined
    if (node?.kind !== "element" || node.id !== nodeId) return { ok: false, selectPath: path, reason: "Element selection changed" }
    if (current && current.type !== "string") return { ok: false, selectPath: path, reason: `${name} is expression-bound` }
    return setPropAtPath(model, path, name, next ? { type: "string", value: next } : undefined)
  }, { immediate: true, coalesceKey: null })
}
function resetSvg() {
  const path = inspector?.selectedPath.value
  if (!path || svgResetDisabled.value) return
  inspector.document.commitInspectorMutation("Reset SVG presentation", (model) => {
    const selected = nodeAtMarkerPath(model.nodes, path)
    if (selected?.kind !== "element" || selected.name.toLowerCase() !== "svg") return { ok: false, selectPath: path, reason: "SVG is unavailable" }
    for (const name of svgOwnedProps) delete selected.props[name]
    return { ok: true, selectPath: path }
  }, { immediate: true, coalesceKey: null })
}
function resetNavigation() {
  const path = inspector?.selectedPath.value
  if (!path || navigationResetDisabled.value) return
  inspector.document.commitInspectorMutation("Reset navigation", (model) => setPropAtPath(model, path, "aria-label", undefined), { immediate: true, coalesceKey: null })
}
async function importSvg(asset: MediaAsset) {
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || svgImportDisabled.value) return
  svgError.value = ""
  try {
    const playable = await getPlayableMediaUrl(inspector?.projectPath.value ?? "", asset.id)
    const source = await (await fetch(playable.url)).text()
    const parsed = parseSanitizedSvg(source)
    if (!parsed.ok) throw new Error(parsed.error)
    if (inspector?.selectedPath.value !== path) return
    inspector?.document.commitInspectorMutation("Import SVG", (model) => {
      const current = nodeAtMarkerPath(model.nodes, path)
      if (current?.kind !== "element" || current.id !== nodeId || current.name.toLowerCase() !== "svg"
        || Object.values(current.props).some((value) => value.type !== "string" && value.type !== "bare")
        || containsDynamicAstroContent(current.children)) {
        return { ok: false, selectPath: path, reason: "SVG selection changed" }
      }
      return replaceSvgElementAtPath(model, path, parsed.node)
    }, { immediate: true, coalesceKey: null })
  } catch (cause) {
    svgError.value = cause instanceof Error ? cause.message : String(cause)
  }
}
function addNavItem() {
  const path = inspector?.selectedPath.value
  if (!path || props.disabled) return
  inspector.document.commitInspectorMutation("Add navigation item", (model) => addNavigationItemAtPath(model, path), { immediate: true, coalesceKey: null })
}
</script>

<template>
  <InspectorPropertySection v-if="isCode" title="Code" :open="openSection === 'code'" :has-changes="codeHasChanges" :show-reset="openSection === 'code' && codeHasChanges" :reset-disabled="codeResetDisabled" reset-label="Reset Code" @update:open="emit('update:openSection', $event ? 'code' : openSection === 'code' ? null : openSection ?? null)" @reset="resetCode">
    <div class="space-y-3"><label class="space-y-1"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Language</span><Input :model-value="language" class="h-8 text-xs" placeholder="javascript" :disabled="disabled || codeClassDynamic" :title="codeClassDynamic ? 'Detach or rebind this expression in Props before editing.' : undefined" @change="setCodeLanguage(($event.target as HTMLInputElement).value)" /></label><div class="space-y-1"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Content</span><SnippetCodeEditor v-model="codeDraft" input-id="composer-code-content" aria-label="Code content" :disabled="disabled || codeHasDynamicContent" @update:model-value="commitCode" /></div><p class="text-[10px] text-muted-foreground">{{ codeHasDynamicContent ? 'Detach or rebind this expression in Props before editing code content.' : 'Code is displayed as text. Composer does not execute it as markup.' }}</p></div>
  </InspectorPropertySection>
  <InspectorPropertySection v-if="isSvg" title="SVG" :open="openSection === 'svg'" :has-changes="svgHasChanges" :show-reset="openSection === 'svg' && svgHasResettableChanges" :reset-disabled="svgResetDisabled" reset-label="Reset SVG" @update:open="emit('update:openSection', $event ? 'svg' : openSection === 'svg' ? null : openSection ?? null)" @reset="resetSvg">
    <div class="space-y-2"><Button type="button" size="sm" variant="outline" class="h-8 w-full" :disabled="svgImportDisabled" @click="svgPickerOpen = true">Import SVG from Media</Button><label v-for="name in svgEditableProps" :key="name" class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{{ name }}</span><Input :model-value="stringFieldDisplay(node.props[name]).text" class="h-8 text-xs" :disabled="disabled || Boolean(node.props[name] && node.props[name]?.type !== 'string')" @change="setSvgProp(name, ($event.target as HTMLInputElement).value)" /></label><p v-if="svgError" role="alert" class="text-[10px] text-destructive">{{ svgError }}</p></div>
    <MediaPickerDialog v-model:open="svgPickerOpen" :project-root="inspector?.projectPath.value ?? ''" :media-types="['image']" require-svg @select="importSvg" />
  </InspectorPropertySection>
  <InspectorPropertySection v-if="isNavigation" title="Navigation" :open="openSection === 'navigation'" :has-changes="navigationHasChanges" :show-reset="openSection === 'navigation' && navigationHasChanges" :reset-disabled="navigationResetDisabled" reset-label="Reset Navigation" @update:open="emit('update:openSection', $event ? 'navigation' : openSection === 'navigation' ? null : openSection ?? null)" @reset="resetNavigation">
    <div class="space-y-3"><label class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">ARIA label</span><Input :model-value="stringFieldDisplay(node.props['aria-label']).text" class="h-8 text-xs" :disabled="disabled || Boolean(node.props['aria-label'] && node.props['aria-label']?.type !== 'string')" @change="setSvgProp('aria-label', ($event.target as HTMLInputElement).value)" /></label><Button type="button" size="sm" variant="outline" class="h-8 w-full" :disabled="disabled" @click="addNavItem">Add navigation item</Button><p class="text-[10px] leading-relaxed text-muted-foreground">Select an item link to edit its destination or bind its text and href from Props → CMS.</p></div>
  </InspectorPropertySection>
</template>
