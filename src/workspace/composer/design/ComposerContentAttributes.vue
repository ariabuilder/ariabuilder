<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/ui/app-icon"
import { IconPickerDialog } from "@/components/ui/icon-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { MediaAsset, MediaAssetType } from "@/lib/media"
import { getCmsEntry, updateCmsEntry } from "@/lib/cms"
import { getCollections } from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"
import MediaPickerDialog from "@/workspace/studio/media/components/MediaPickerDialog.vue"
import { containsDynamicAstroContent, applyComposerIconElement, isComposerAlertNode, isComposerBadgeNode, isComposerButtonNode, nodeAtMarkerPath, resolveComposerAvatarParts, resolveDirectCmsTextBinding, resolveElementInspectorTarget, stringFieldDisplay } from "../../../../shared/composer"
import type { AriaEntryRecord } from "../../../../shared/cms"
import type { EditableNode, PropValue } from "../../../../shared/composer/types"
import { isComposerRichTextHost } from "../../../../shared/composer/richText"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import { tryUseComposerModeNavigation } from "../useComposerModeNavigation"
import { tryUseComposerCanvasTextDraft } from "../useComposerCanvasTextDraft"
import InspectorPropertySection from "./InspectorPropertySection.vue"
import ComposerRichTextEditor from "./ComposerRichTextEditor.vue"
import ComposerButtonSection from "./ComposerButtonSection.vue"
import ComposerBemPresetSection from "./ComposerBemPresetSection.vue"
import ComposerLinkSection from "./ComposerLinkSection.vue"
import ComposerListSection from "./ComposerListSection.vue"
import ComposerMediaSection from "./ComposerMediaSection.vue"
import ComposerSpecialElementSections from "./ComposerSpecialElementSections.vue"

const props = defineProps<{
  node: EditableNode
  disabled?: boolean
  openSection?: string | null
  cluster?: "identity" | "attributes"
  styleText?: string
  inheritedStyleText?: string
}>()
const emit = defineEmits<{
  "update:openSection": [value: string | null]
  setStyle: [
    value: PropValue | undefined,
    immediate: boolean,
    options?: { historyBoundary?: boolean; preserveApply?: boolean; deletedKeys?: string[] },
  ]
}>()
const inspector = tryUseInspectorContext()
const modeNavigation = tryUseComposerModeNavigation()
const canvasTextDraft = tryUseComposerCanvasTextDraft()
const mediaPickerOpen = ref(false)
const iconPickerOpen = ref(false)
const pickerField = ref<TypeField | null>(null)

type TypeField = {
  name: string
  label: string
  options?: readonly string[]
  picker?: "media" | "icon"
  mediaTypes?: readonly MediaAssetType[]
}

const element = computed(() => props.node.kind === "element" ? props.node : null)
const buttonNode = computed(() => isComposerButtonNode(props.node) ? props.node : null)
const richTextElement = computed(() => isComposerRichTextHost(props.node) ? props.node : null)
const avatarParts = computed(() => {
  const path = inspector?.selectedPath.value
  return path ? resolveComposerAvatarParts(props.node, path) : null
})
const mediaTarget = computed(() => {
  if (element.value && ["img", "picture", "video"].includes(element.value.name.toLowerCase())) {
    return { node: element.value, path: inspector?.selectedPath.value ?? "" }
  }
  if (avatarParts.value?.image) {
    return { node: avatarParts.value.image.node, path: avatarParts.value.image.path }
  }
  return null
})
const isInlineIcon = computed(() =>
  element.value && stringFieldDisplay(element.value.props?.["data-aria-type"]).text === "Icon",
)
const firstText = computed(() => {
  const draft = canvasTextDraft?.session.value
  if (draft && draft.visibleOwnerPath === inspector?.selectedPath.value) return draft.draft
  const children = element.value?.children
  return Array.isArray(children) && children.length === 1 && children[0]?.kind === "text"
    ? children[0].value
    : null
})
const directCmsText = computed(() => {
  const model = inspector?.document.model.value
  const path = inspector?.selectedPath.value
  return model && path ? resolveDirectCmsTextBinding(model, path) : null
})
const cmsTextRecord = ref<AriaEntryRecord | null>(null)
const cmsTextLocale = ref("")
const cmsTextCollectionId = ref("")
const cmsTextDraft = ref("")
const cmsTextLoading = ref(false)
const cmsTextSaving = ref(false)
const cmsTextError = ref("")
const cmsTextNotice = ref("")
let cmsTextGeneration = 0

const cmsTextFieldLabel = computed(() => directCmsText.value?.field
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/[-_]+/g, " ")
  .replace(/^./, (letter) => letter.toUpperCase()) ?? "Content")
const cmsTextMultiline = computed(() => {
  const tag = element.value?.name.toLowerCase()
  return cmsTextDraft.value.length > 80 || ["p", "blockquote", "figcaption", "dd"].includes(tag ?? "")
})

function cmsLocale(record: AriaEntryRecord) {
  return record.locales.find((locale) => locale.isSource) ?? record.locales[0] ?? null
}

function cmsTextValue(record: AriaEntryRecord, field: string): unknown {
  const locale = cmsLocale(record)
  if (!locale) return undefined
  if (field === "title") return locale.title
  if (field === "slug") return locale.slug
  if (field === "body") return locale.body
  return locale.frontmatter[field]
}

async function loadCmsText() {
  const binding = directCmsText.value
  const projectPath = inspector?.projectPath.value
  const generation = ++cmsTextGeneration
  cmsTextRecord.value = null
  cmsTextLocale.value = ""
  cmsTextCollectionId.value = ""
  cmsTextDraft.value = ""
  cmsTextError.value = ""
  cmsTextNotice.value = ""
  if (!binding || !projectPath) return
  cmsTextLoading.value = true
  try {
    const registry = await getCollections(projectPath)
    const collection = registry.collections.find(
      (item) => item.id === binding.collection || item.name === binding.collection,
    )
    if (!collection || collection.source && collection.source.kind !== "aria-managed") {
      throw new Error("This value is not owned by Aria CMS.")
    }
    const record = await getCmsEntry(projectPath, collection.id, binding.entrySlug)
    if (generation !== cmsTextGeneration) return
    const locale = record && cmsLocale(record)
    const value = record ? cmsTextValue(record, binding.field) : undefined
    if (!record || !locale || typeof value !== "string") {
      throw new Error("The CMS text value could not be loaded.")
    }
    cmsTextRecord.value = record
    cmsTextLocale.value = locale.locale
    cmsTextCollectionId.value = collection.id
    cmsTextDraft.value = value
  } catch (cause) {
    if (generation === cmsTextGeneration) {
      cmsTextError.value = cause instanceof Error ? cause.message : String(cause)
    }
  } finally {
    if (generation === cmsTextGeneration) cmsTextLoading.value = false
  }
}

watch(
  () => [
    inspector?.projectPath.value ?? "",
    directCmsText.value?.collection ?? "",
    directCmsText.value?.entrySlug ?? "",
    directCmsText.value?.field ?? "",
  ] as const,
  () => void loadCmsText(),
  { immediate: true },
)

async function saveCmsText() {
  const binding = directCmsText.value
  const record = cmsTextRecord.value
  const locale = record && cmsLocale(record)
  const projectPath = inspector?.projectPath.value
  if (
    !binding || !record || !locale || !projectPath || !cmsTextCollectionId.value ||
    binding.contentExposure !== "editable" || cmsTextSaving.value
  ) return
  const previous = cmsTextValue(record, binding.field)
  if (cmsTextDraft.value === previous) return
  cmsTextSaving.value = true
  cmsTextError.value = ""
  cmsTextNotice.value = ""
  try {
    const next = await updateCmsEntry(projectPath, {
      collectionId: cmsTextCollectionId.value,
      id: record.entry.id,
      version: record.entry.version,
      patch: {
        upsertLocale: {
          locale: locale.locale,
          title: binding.field === "title" ? cmsTextDraft.value : locale.title,
          slug: binding.field === "slug" ? cmsTextDraft.value : locale.slug,
          frontmatter: binding.field === "title" || binding.field === "slug" || binding.field === "body"
            ? locale.frontmatter
            : { ...locale.frontmatter, [binding.field]: cmsTextDraft.value },
          body: binding.field === "body" ? cmsTextDraft.value : locale.body,
          isSource: locale.isSource,
          status: locale.status,
          publishedAt: locale.publishedAt,
        },
      },
    })
    cmsTextRecord.value = next
    cmsTextLocale.value = cmsLocale(next)?.locale ?? cmsTextLocale.value
    cmsTextNotice.value = "Saved to CMS"
    inspector.document.reloadPreview()
  } catch (cause) {
    cmsTextError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    cmsTextSaving.value = false
  }
}
const fallbackText = computed(() => {
  const children = avatarParts.value?.fallback?.node.children
  return Array.isArray(children) && children.length === 1 && children[0]?.kind === "text"
    ? children[0].value
    : null
})
const contentHasChanges = computed(() => richTextElement.value
  ? Boolean(richTextElement.value.children?.length)
  : Boolean(firstText.value))
const initialsHasChanges = computed(() => Boolean(fallbackText.value))
const contentResetDisabled = computed(() => props.disabled || Boolean(
  containsDynamicAstroContent(richTextElement.value?.children),
))
const initialsResetDisabled = computed(() => props.disabled || Boolean(
  containsDynamicAstroContent(avatarParts.value?.fallback?.node.children),
))
const contentDraft = ref(firstText.value ?? "")
watch(firstText, (value) => { contentDraft.value = value ?? "" })
const initialsDraft = ref(fallbackText.value ?? "")
watch(fallbackText, (value) => { initialsDraft.value = value ?? "" })

const commonTags = ["div", "section", "article", "aside", "header", "footer", "main", "nav", "p", "span", "h1", "h2", "h3", "h4", "h5", "h6"]
const propNames = ["id", "title", "aria-label", "role"] as const
const typeFields = computed<{ title: string; fields: TypeField[] } | null>(() => {
  if (isInlineIcon.value) {
    return { title: "Icon", fields: [{ name: "__icon", label: "Icon", picker: "icon" }, { name: "aria-label", label: "ARIA label" }] }
  }
  if (props.node.kind === "component" && (/icon$/i.test(props.node.name) || props.node.props.icon != null)) {
    return { title: "Icon", fields: [
      { name: props.node.props.icon != null ? "icon" : "name", label: "Icon", picker: "icon" },
      { name: "aria-label", label: "ARIA label" },
    ] }
  }
  return null
})
const typeSectionId = computed(() => {
  if (isInlineIcon.value || (props.node.kind === "component" && (/icon$/i.test(props.node.name) || props.node.props.icon != null))) return "icon"
  return null
})
const showIdentity = computed(() => props.cluster !== "attributes")
const showAttributes = computed(() => props.cluster !== "identity")
const inlineIconOwnedProps = ["class", "src", "alt", "role", "aria-label"] as const
const projectRoot = computed(() => inspector?.projectPath.value ?? "")
const elementContext = computed(() => {
  const model = inspector?.document.model.value
  const path = inspector?.selectedPath.value
  return model && path ? resolveElementInspectorTarget(model, path) : null
})
const attributePropNames = computed(() => propNames.filter((name) => {
  if (name === "title" && elementContext.value?.linkNode) return false
  if (name !== "aria-label" && name !== "role") return true
  const tag = element.value?.name.toLowerCase()
  if (isInlineIcon.value || tag === "video" || tag === "button" || tag === "nav") return false
  return true
}))
const attributesHaveChanges = computed(() => Boolean(element.value && attributePropNames.value.some((name) => element.value?.props[name] != null)))
const attributesResetDisabled = computed(() => props.disabled || Boolean(element.value && attributePropNames.value.some((name) => {
  const value = element.value?.props[name]
  return value != null && value.type !== "string" && value.type !== "bare"
})))
const typeHasChanges = computed(() => Boolean(typeFields.value?.fields.some((field) => propValue(field.name))))
const typeResetDisabled = computed(() => props.disabled
  || Boolean(typeFields.value?.fields.some((field) => propIsExpression(field.name)))
  || Boolean(isInlineIcon.value && element.value && inlineIconOwnedProps.some((name) => {
    const value = element.value?.props[name]
    return value != null && value.type !== "string" && value.type !== "bare"
  })))

function propValue(name: string) {
  const node = props.node
  if (!("props" in node)) return ""
  if (name === "__icon") return stringFieldDisplay(node.props?.class).text || stringFieldDisplay(node.props?.src).text
  return stringFieldDisplay(node.props?.[name]).text
}

function propIsExpression(name: string) {
  const node = props.node
  if (name === "__icon") return "props" in node && (stringFieldDisplay(node.props?.class).isExpr || stringFieldDisplay(node.props?.src).isExpr)
  return "props" in node && stringFieldDisplay(node.props?.[name]).isExpr
}

function setProp(name: string, value: string | number, immediate: boolean) {
  if (propIsExpression(name)) return
  const next = String(value)
  const prop: PropValue | undefined = next ? { type: "string", value: next } : undefined
  inspector?.document.setSelectedProp(name, prop, { immediate })
}

function openPicker(field: TypeField) {
  if (props.disabled || propIsExpression(field.name) || field.name === "__icon" && typeResetDisabled.value) return
  pickerField.value = field
  if (field.picker === "icon") iconPickerOpen.value = true
  else mediaPickerOpen.value = true
}

function selectMedia(asset: MediaAsset) {
  const field = pickerField.value
  if (field) setProp(field.name, asset.url, true)
  pickerField.value = null
}

function selectIcon(value: string) {
  const field = pickerField.value
  if (field?.name === "__icon") {
    const path = inspector?.selectedPath.value
    const nodeId = element.value?.id
    if (path) inspector.document.commitInspectorMutation("Choose icon", (model) => {
      const selected = nodeAtMarkerPath(model.nodes, path)
      if (selected?.kind !== "element" || selected.id !== nodeId) return { ok: false, reason: "Icon element is unavailable" }
      if (inlineIconOwnedProps.some((name) => {
        const prop = selected.props[name]
        return prop != null && prop.type !== "string" && prop.type !== "bare"
      })) return { ok: false, selectPath: path, reason: "Icon attributes are expression-bound" }
      applyComposerIconElement(selected, value)
      return { ok: true, selectPath: path }
    }, { immediate: true, coalesceKey: null })
  } else if (field) setProp(field.name, value, true)
  pickerField.value = null
}

function commitContent(immediate: boolean) {
  const path = inspector?.selectedPath.value
  if (!path) return
  inspector.document.commitInspectorMutation("Edit text content", (model) => {
    const selected = nodeAtMarkerPath(model.nodes, path)
    if (selected?.kind !== "element" || !Array.isArray(selected.children) || selected.children.length !== 1 || selected.children[0]?.kind !== "text") {
      return { ok: false, reason: "Element content is not a single editable text node" }
    }
    selected.children[0].value = contentDraft.value
    return { ok: true, selectPath: path }
  }, { immediate, coalesceKey: immediate ? null : `content:${path}` })
}

function commitInitials(immediate: boolean) {
  const selectedPath = inspector?.selectedPath.value
  const fallbackPath = avatarParts.value?.fallback?.path
  if (!selectedPath || !fallbackPath) return
  inspector.document.commitInspectorMutation("Edit avatar initials", (model) => {
    const fallback = nodeAtMarkerPath(model.nodes, fallbackPath)
    if (fallback?.kind !== "element" || !Array.isArray(fallback.children) || fallback.children.length !== 1 || fallback.children[0]?.kind !== "text") {
      return { ok: false, selectPath: selectedPath, reason: "Avatar initials are unavailable" }
    }
    if (containsDynamicAstroContent(fallback.children)) {
      return { ok: false, selectPath: selectedPath, reason: "Expression-bound initials must be detached before editing" }
    }
    fallback.children[0].value = initialsDraft.value
    return { ok: true, selectPath: selectedPath }
  }, { immediate, coalesceKey: immediate ? null : `avatar-initials:${fallbackPath}` })
}

function updateRichText(children: EditableNode[]) {
  const path = inspector?.selectedPath.value
  if (!path) return
  inspector.document.commitInspectorMutation("Edit rich text", (model) => {
    const selected = nodeAtMarkerPath(model.nodes, path)
    if (!isComposerRichTextHost(selected)) {
      return { ok: false, reason: "Rich text element is unavailable" }
    }
    selected.children = children
    return { ok: true, selectPath: path }
  }, { immediate: false, coalesceKey: `rich-text:${path}` })
}

function commitRichText() {
  void inspector?.document.flushSave()
}
function resetContent() {
  const path = inspector?.selectedPath.value
  if (!path || contentResetDisabled.value) return
  inspector.document.commitInspectorMutation("Reset content", (model) => {
    const selected = nodeAtMarkerPath(model.nodes, path)
    if (selected?.kind !== "element" || !Array.isArray(selected.children)) return { ok: false, selectPath: path, reason: "Content is unavailable" }
    if (containsDynamicAstroContent(selected.children)) return { ok: false, selectPath: path, reason: "Expression-bound content must be detached before reset" }
    if (isComposerRichTextHost(selected)) selected.children = []
    else {
      const text = selected.children.length === 1 ? selected.children[0] : null
      if (text?.kind !== "text") return { ok: false, selectPath: path, reason: "Content cannot be reset safely" }
      text.value = ""
    }
    return { ok: true, selectPath: path }
  }, { immediate: true, coalesceKey: null })
}
function resetInitials() {
  const selectedPath = inspector?.selectedPath.value
  const fallbackPath = avatarParts.value?.fallback?.path
  if (!selectedPath || !fallbackPath || initialsResetDisabled.value) return
  inspector.document.commitInspectorMutation("Reset avatar initials", (model) => {
    const fallback = nodeAtMarkerPath(model.nodes, fallbackPath)
    if (fallback?.kind !== "element" || !Array.isArray(fallback.children)) {
      return { ok: false, selectPath: selectedPath, reason: "Avatar initials are unavailable" }
    }
    if (containsDynamicAstroContent(fallback.children)) {
      return { ok: false, selectPath: selectedPath, reason: "Expression-bound initials must be detached before reset" }
    }
    const text = fallback.children.length === 1 ? fallback.children[0] : null
    if (text?.kind !== "text") return { ok: false, selectPath: selectedPath, reason: "Avatar initials cannot be reset safely" }
    text.value = ""
    return { ok: true, selectPath: selectedPath }
  }, { immediate: true, coalesceKey: null })
}
function resetTypeSection() {
  const path = inspector?.selectedPath.value
  if (!path || typeResetDisabled.value || !typeFields.value) return
  inspector.document.commitInspectorMutation("Reset icon", (model) => {
    const selected = nodeAtMarkerPath(model.nodes, path)
    if (!selected || !("props" in selected)) return { ok: false, selectPath: path, reason: "Icon is unavailable" }
    for (const field of typeFields.value?.fields ?? []) {
      if (field.name === "__icon") {
        delete selected.props.class
        delete selected.props.src
        delete selected.props.alt
        delete selected.props.role
      } else delete selected.props[field.name]
    }
    return { ok: true, selectPath: path }
  }, { immediate: true, coalesceKey: null })
}
function resetAttributes() {
  const path = inspector?.selectedPath.value
  if (!path || attributesResetDisabled.value) return
  inspector.document.commitInspectorMutation("Reset HTML attributes", (model) => {
    const selected = nodeAtMarkerPath(model.nodes, path)
    if (selected?.kind !== "element") return { ok: false, selectPath: path, reason: "Element is unavailable" }
    if (attributePropNames.value.some((name) => {
      const value = selected.props[name]
      return value != null && value.type !== "string" && value.type !== "bare"
    })) return { ok: false, selectPath: path, reason: "Expression-bound attributes must be detached before reset" }
    for (const name of attributePropNames.value) delete selected.props[name]
    return { ok: true, selectPath: path }
  }, { immediate: true, coalesceKey: null })
}

function setStyle(
  value: PropValue | undefined,
  immediate: boolean,
  options?: { historyBoundary?: boolean; preserveApply?: boolean; deletedKeys?: string[] },
) {
  emit("setStyle", value, immediate, options)
}
</script>

<template>
  <template v-if="showIdentity">
    <ComposerBemPresetSection
      v-if="element && (isComposerAlertNode(props.node) || isComposerBadgeNode(props.node))"
      :node="element"
      :disabled="disabled"
      :open-section="openSection"
      @update:open-section="emit('update:openSection', $event)"
    />

    <InspectorPropertySection
      v-if="directCmsText"
      :title="m.composer_inspector_section_content()"
      :open="openSection === 'content'"
      :has-changes="true"
      @update:open="emit('update:openSection', $event ? 'content' : openSection === 'content' ? null : openSection ?? null)"
    >
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <Label for="composer-cms-content" class="text-[10px] uppercase tracking-wide text-muted-foreground">
            {{ cmsTextFieldLabel }}
          </Label>
          <span class="text-[9px] text-muted-foreground">CMS</span>
        </div>
        <p v-if="cmsTextLoading" class="text-[11px] text-muted-foreground">Loading content…</p>
        <template v-else-if="cmsTextRecord">
          <Textarea
            v-if="cmsTextMultiline"
            id="composer-cms-content"
            v-model="cmsTextDraft"
            class="min-h-20 text-xs"
            :disabled="disabled || cmsTextSaving || directCmsText.contentExposure !== 'editable'"
            @change="saveCmsText"
          />
          <Input
            v-else
            id="composer-cms-content"
            v-model="cmsTextDraft"
            class="h-8 text-xs"
            :disabled="disabled || cmsTextSaving || directCmsText.contentExposure !== 'editable'"
            @change="saveCmsText"
          />
          <p class="text-[10px] text-muted-foreground">
            {{ directCmsText.collection }} · {{ directCmsText.entrySlug }} · {{ cmsTextLocale }}
          </p>
        </template>
        <p v-if="cmsTextError" role="alert" class="text-[11px] text-destructive">{{ cmsTextError }}</p>
        <p class="sr-only" role="status" aria-live="polite">{{ cmsTextNotice }}</p>
      </div>
    </InspectorPropertySection>

    <InspectorPropertySection
      v-else-if="richTextElement && !buttonNode"
      :title="m.composer_inspector_section_content()"
      :open="openSection === 'content'"
      :has-changes="contentHasChanges"
      :show-reset="openSection === 'content' && contentHasChanges"
      :reset-disabled="contentResetDisabled"
      reset-label="Reset Content"
      content-flush
      @update:open="emit('update:openSection', $event ? 'content' : openSection === 'content' ? null : openSection ?? null)"
      @reset="resetContent"
    >
      <ComposerRichTextEditor
        :key="inspector?.selectedPath.value ?? richTextElement.id"
        :node="richTextElement"
        :path="inspector?.selectedPath.value ?? ''"
        :disabled="disabled"
        @update="updateRichText"
        @commit="commitRichText"
        @edit-code="modeNavigation?.openCode()"
      />
    </InspectorPropertySection>

    <InspectorPropertySection
      v-if="firstText !== null && !richTextElement && !buttonNode"
      :title="m.composer_inspector_section_content()"
      :open="openSection === 'content'"
      :has-changes="contentHasChanges"
      :show-reset="openSection === 'content' && contentHasChanges"
      :reset-disabled="contentResetDisabled"
      reset-label="Reset Content"
      @update:open="emit('update:openSection', $event ? 'content' : openSection === 'content' ? null : openSection ?? null)"
      @reset="resetContent"
    >
      <div class="space-y-1.5">
        <Label for="composer-design-content" class="text-[10px] uppercase tracking-wide text-muted-foreground">Text</Label>
        <Input
          id="composer-design-content"
          v-model="contentDraft"
          class="h-8 text-xs"
          :disabled="disabled"
          @update:model-value="commitContent(false)"
          @change="commitContent(true)"
        />
      </div>
    </InspectorPropertySection>

    <ComposerMediaSection
      v-if="mediaTarget"
      :node="mediaTarget.node"
      :target-path="mediaTarget.path"
      :disabled="disabled"
      :open-section="openSection"
      @update:open-section="emit('update:openSection', $event)"
    />

    <InspectorPropertySection
      v-if="avatarParts?.fallback && fallbackText !== null"
      :title="m.composer_inspector_avatar_initials()"
      :open="openSection === 'initials'"
      :has-changes="initialsHasChanges"
      :show-reset="openSection === 'initials' && initialsHasChanges"
      :reset-disabled="initialsResetDisabled"
      reset-label="Reset Initials"
      @update:open="emit('update:openSection', $event ? 'initials' : openSection === 'initials' ? null : openSection ?? null)"
      @reset="resetInitials"
    >
      <Input
        id="composer-design-avatar-initials"
        v-model="initialsDraft"
        class="h-8 text-xs"
        :disabled="disabled || initialsResetDisabled"
        maxlength="4"
        @update:model-value="commitInitials(false)"
        @change="commitInitials(true)"
      />
    </InspectorPropertySection>

    <ComposerButtonSection
      v-if="buttonNode"
      :node="buttonNode"
      :disabled="disabled"
      :open-section="openSection"
      @update:open-section="emit('update:openSection', $event)"
    />

    <InspectorPropertySection
      v-if="typeFields"
      :title="typeFields.title"
      :open="firstText === null && !richTextElement && openSection === typeSectionId"
      :has-changes="typeHasChanges"
      :show-reset="openSection === typeSectionId && typeHasChanges"
      :reset-disabled="typeResetDisabled"
      reset-label="Reset Icon"
      @update:open="emit('update:openSection', $event ? typeSectionId : openSection === typeSectionId ? null : openSection ?? null)"
      @reset="resetTypeSection"
    >
      <div class="space-y-2">
        <div v-for="field in typeFields.fields" :key="field.name" class="grid grid-cols-[68px_1fr] items-center gap-2">
          <span class="truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{{ field.label }}</span>
          <Select v-if="field.options" :model-value="propValue(field.name)" :disabled="disabled || propIsExpression(field.name)" @update:model-value="setProp(field.name, String($event), true)">
            <SelectTrigger class="h-8 min-w-0 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent><SelectItem v-for="option in field.options" :key="option" :value="option">{{ option }}</SelectItem></SelectContent>
          </Select>
          <div v-else class="flex min-w-0 items-center gap-1">
            <Input
              :model-value="propValue(field.name)"
              class="h-8 min-w-0 flex-1 text-xs"
              :class="propIsExpression(field.name) && 'font-mono'"
              :disabled="disabled || propIsExpression(field.name) || field.name === '__icon' && typeResetDisabled"
              :title="propIsExpression(field.name) ? m.composer_inspector_expression_field_hint() : undefined"
              @update:model-value="field.name !== '__icon' && setProp(field.name, $event, false)"
              @change="field.name !== '__icon' && setProp(field.name, ($event.target as HTMLInputElement).value, true)"
            />
            <Button
              v-if="field.picker"
              type="button"
              size="icon-sm"
              variant="outline"
              class="size-8 shrink-0 border-dashed"
              :disabled="disabled || propIsExpression(field.name) || field.name === '__icon' && typeResetDisabled"
              :aria-label="field.picker === 'icon' ? m.picker_icon_title() : m.picker_media_title()"
              :title="field.picker === 'icon' ? m.picker_icon_title() : m.picker_media_title()"
              @click="openPicker(field)"
            ><AppIcon :name="field.picker === 'icon' ? 'sparkles' : 'image'" :size="14" /></Button>
          </div>
        </div>
      </div>
    </InspectorPropertySection>

    <ComposerLinkSection
      v-if="elementContext?.sections.includes('link')"
      :disabled="disabled"
      :open-section="openSection"
      @update:open-section="emit('update:openSection', $event)"
    />

    <ComposerListSection
      v-if="elementContext?.listNode"
      :disabled="disabled"
      :open-section="openSection"
      :style-text="styleText"
      :inherited-style-text="inheritedStyleText"
      @update:open-section="emit('update:openSection', $event)"
      @set-style="setStyle"
    />

    <ComposerSpecialElementSections
      v-if="element"
      :node="element"
      :disabled="disabled"
      :open-section="openSection"
      @update:open-section="emit('update:openSection', $event)"
    />

    <MediaPickerDialog
      v-model:open="mediaPickerOpen"
      :project-root="projectRoot"
      :media-types="pickerField?.mediaTypes ?? []"
      @select="selectMedia"
    />
    <IconPickerDialog
      v-model:open="iconPickerOpen"
      :project-root="projectRoot"
      :value="pickerField ? propValue(pickerField.name) : ''"
      @select="selectIcon"
    />
  </template>

  <InspectorPropertySection
    v-if="showAttributes && element"
    :title="m.composer_inspector_section_attributes()"
    :open="openSection === 'attributes'"
    :has-changes="attributesHaveChanges"
    :show-reset="openSection === 'attributes' && attributesHaveChanges"
    :reset-disabled="attributesResetDisabled"
    reset-label="Reset HTML attributes"
    @update:open="emit('update:openSection', $event ? 'attributes' : openSection === 'attributes' ? null : openSection ?? null)"
    @reset="resetAttributes"
  >
    <div class="space-y-3">
      <label class="space-y-1">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">HTML tag</span>
        <Select :model-value="element.name" :disabled="disabled" @update:model-value="inspector?.document.setSelectedTag(String($event))">
          <SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem v-for="tag in commonTags" :key="tag" :value="tag">{{ tag }}</SelectItem></SelectContent>
        </Select>
      </label>
      <label v-for="name in attributePropNames" :key="name" class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{{ name }}</span>
        <Input
          :model-value="propValue(name)"
          class="h-8 min-w-0 font-mono text-xs"
          :disabled="disabled || propIsExpression(name)"
          :title="propIsExpression(name) ? 'Detach or rebind this expression in Props before editing.' : undefined"
          @update:model-value="setProp(name, $event, false)"
          @change="setProp(name, ($event.target as HTMLInputElement).value, true)"
        />
      </label>
    </div>
  </InspectorPropertySection>
</template>
