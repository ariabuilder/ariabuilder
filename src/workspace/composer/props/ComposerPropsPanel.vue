<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { extractComposerPropSchema } from "@/lib/composer"
import {
  evaluateConditionSet,
  type ComponentControlMetadata,
  type ConditionResult,
} from "../../../../shared/conditions"
import {
  createLayoutPropDrafts,
  loadRequiredLayoutProps,
  serializeLayoutPropDrafts,
  type LayoutPropDraftValue,
} from "@/lib/layoutProps"
import { m } from "@/paraglide/messages.js"
import { confirm } from "@/composables/useConfirm"
import {
  ARIA_LAYER_LABEL_ATTR,
  getElementPropsSchema,
  getElementSchema,
  evaluateComposerConditionalValue,
  isComposerButtonNode,
  isComposerPopoverTarget,
  isOpaquePropValue,
  nodeAtMarkerPath,
  resolveComposerButtonPropNames,
  buildComposerLayoutContract,
  describeComposerCmsSelection,
  isValidComposerSlotName,
  parseManagedConditionalPropValue,
  setConditionalTextValueAtPath,
  setTextAtPath,
  textNodePropValue,
} from "../../../../shared/composer"
import type {
  AstroImport,
  AstroPropMap,
  EditableNode,
  PropField,
  PropValue,
} from "../../../../shared/composer/types"
import { tryUseComposerBeacon } from "../selection/useComposerBeacon"
import { tryUseComposerDocument } from "../useComposerDocumentSession"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import ComposerAttributesSection from "./ComposerAttributesSection.vue"
import ComposerContentBindingSection from "./ComposerContentBindingSection.vue"
import ComposerPropField from "./ComposerPropField.vue"
import ComposerCmsPropBindingControl from "./ComposerCmsPropBindingControl.vue"
import ComposerButtonSection from "../design/ComposerButtonSection.vue"
import InspectorPropertySection from "../design/InspectorPropertySection.vue"
import ComposerPopoverSection from "./ComposerPopoverSection.vue"
import ComposerControlConditionsDialog from "../conditions/ComposerControlConditionsDialog.vue"
import ComposerConditionalValueDialog from "../conditions/ComposerConditionalValueDialog.vue"
import ProjectImagePickerField from "@/workspace/studio/media/components/ProjectImagePickerField.vue"
import { componentConditionContext, conditionSourcesForDocument } from "../conditions/conditionSources"
import { useConditionCollections } from "../conditions/useConditionCollections"

const beacon = tryUseComposerBeacon()
const doc = tryUseComposerDocument()
const inspector = tryUseInspectorContext()

type LoadedSchema = {
  fields: PropField[]
  extendsTag: string | null
  slots: string[]
  hasRest: boolean
  relativeFile: string | null
  mtimeMs: number | null
  controlMetadataFound?: boolean
  controlMetadataValid?: boolean
  controlMetadataError?: string
}

const componentSchema = ref<LoadedSchema | null>(null)
const schemaLoading = ref(false)
const schemaError = ref<string | null>(null)
const controlConditionsOpen = ref(false)
const conditionalValueOpen = ref(false)
const conditionalValueField = ref<PropField | null>(null)
const textConditionalValueOpen = ref(false)
const textConditionalField: PropField = { name: "content", type: "string", optional: false }

const selectedPath = computed(() => inspector?.selectedPath.value ?? beacon?.selectedPath.value ?? null)
const contextual = computed(() => Boolean(inspector?.isContextSelection.value))
const editable = computed(() => Boolean(doc?.editable.value) && !contextual.value)
const model = computed(() => doc?.model.value ?? null)
const conditionDialogOpen = computed(() => conditionalValueOpen.value || textConditionalValueOpen.value)
const conditionProjectPath = computed(() => doc?.projectPath.value ?? "")
const {
  collections: conditionCollections,
  loading: conditionSourcesLoading,
  error: conditionSourcesError,
  hasRegisteredCollections: hasConditionCollections,
} = useConditionCollections(conditionDialogOpen, conditionProjectPath)

const selectedNode = computed((): EditableNode | null => {
  if (inspector?.contextSelection.value) return inspector.contextSelection.value.node
  const path = selectedPath.value
  const nodes = model.value?.nodes
  if (!path || !nodes) return null
  return nodeAtMarkerPath(nodes, path)
})
const cmsSelection = computed(() => model.value && selectedPath.value
  ? describeComposerCmsSelection(model.value, selectedPath.value)
  : null)
const buttonNode = computed(() => isComposerButtonNode(selectedNode.value) ? selectedNode.value : null)
const popoverNode = computed(() => isComposerPopoverTarget(selectedNode.value) ? selectedNode.value : null)
const selectedSlot = computed(() => {
  if (selectedNode.value?.kind !== "slot" || !model.value || !selectedPath.value) return null
  return buildComposerLayoutContract(model.value).slots.find(
    (slot) => slot.path === selectedPath.value,
  ) ?? null
})
const slotNameDraft = ref("")
const slotBusy = ref(false)
watch(selectedSlot, (slot) => {
  slotNameDraft.value = slot?.name ?? ""
}, { immediate: true })
const slotNameError = computed(() => {
  const slot = selectedSlot.value
  const value = slotNameDraft.value.trim()
  if (!slot?.name || value === slot.name) return ""
  if (!isValidComposerSlotName(value)) return m.composer_layout_slot_name_error()
  if (
    model.value &&
    buildComposerLayoutContract(model.value).namedSlots.some(
      (candidate) => candidate.path !== slot.path && candidate.name === value,
    )
  ) return m.composer_layout_slot_name_duplicate({ name: value })
  return ""
})

async function commitSlotRename() {
  const slot = selectedSlot.value
  const value = slotNameDraft.value.trim()
  if (!slot?.name || !value || value === slot.name || slotNameError.value) return
  slotBusy.value = true
  try {
    await doc?.renameLayoutSlot(slot, value)
  } finally {
    slotBusy.value = false
  }
}

async function deleteNamedSlot() {
  const slot = selectedSlot.value
  if (!slot?.name) return
  slotBusy.value = true
  const usage = await doc?.inspectLayoutSlotUsage(slot)
  slotBusy.value = false
  if (!usage) return
  const accepted = await confirm({
    title: m.composer_layout_slot_delete_title({ name: slot.label }),
    description: m.composer_layout_slot_delete_description({
      fallbackCount: String(usage.fallbackNodes),
      pageCount: String(usage.affectedPages),
    }),
    confirmLabel: m.composer_layout_slot_delete_action(),
    cancelLabel: m.confirm_cancel(),
    destructive: true,
  })
  if (!accepted) return
  slotBusy.value = true
  try {
    await doc?.deleteLayoutSlot(slot)
  } finally {
    slotBusy.value = false
  }
}

const isLayout = computed(
  () => selectedNode.value?.id === "layout",
)
const isLayoutSettings = computed(
  () => selectedPath.value === "@layout" || isLayout.value,
)
const activeLayoutValue = computed(() => {
  const node = selectedNode.value
  if (node?.kind !== "component" || !isLayout.value) return "__none"
  return doc?.availableLayouts.value.find((layout) => layout.name === node.name)?.file
    ?? `name:${node.name}`
})

const pendingLayout = ref<{ name: string; file: string } | null>(null)
const layoutFields = ref<PropField[]>([])
const layoutFieldValues = ref<Record<string, LayoutPropDraftValue>>({})
const layoutApplyBusy = ref(false)
const layoutApplyError = ref<string | null>(null)

async function onLayoutChange(value: unknown) {
  const next = String(value)
  if (next === "__none") {
    if (isLayout.value) doc?.removePageLayout()
    return
  }
  const layout = doc?.availableLayouts.value.find((candidate) => candidate.file === next)
  if (!layout || !doc) return
  pendingLayout.value = layout
  layoutFields.value = []
  layoutFieldValues.value = {}
  layoutApplyBusy.value = true
  layoutApplyError.value = null
  try {
    const fields = await loadRequiredLayoutProps(doc.projectPath.value, layout.file)
    if (!fields.length) {
      pendingLayout.value = null
      doc.assignPageLayout(layout)
      return
    }
    layoutFields.value = fields
    layoutFieldValues.value = createLayoutPropDrafts(fields)
    layoutApplyError.value = serializeLayoutPropDrafts(
      fields,
      layoutFieldValues.value,
    ).error
  } catch (error) {
    layoutApplyError.value = error instanceof Error ? error.message : String(error)
  } finally {
    layoutApplyBusy.value = false
  }
}

function updateLayoutField(name: string, value: string | boolean) {
  layoutFieldValues.value = { ...layoutFieldValues.value, [name]: value }
  layoutApplyError.value = serializeLayoutPropDrafts(
    layoutFields.value,
    layoutFieldValues.value,
  ).error
}

function closeLayoutProps() {
  if (layoutApplyBusy.value) return
  pendingLayout.value = null
  layoutFields.value = []
  layoutFieldValues.value = {}
  layoutApplyError.value = null
}

function applyPendingLayout() {
  const layout = pendingLayout.value
  if (!layout || !doc) return
  const serialized = serializeLayoutPropDrafts(
    layoutFields.value,
    layoutFieldValues.value,
  )
  layoutApplyError.value = serialized.error
  if (serialized.error) return
  if (doc.assignPageLayout(layout, serialized.props)) closeLayoutProps()
}

const nodeProps = computed((): AstroPropMap => {
  const node = selectedNode.value
  if (
    node &&
    (node.kind === "element" ||
      node.kind === "component" ||
      node.kind === "fragment" ||
      node.kind === "slot" ||
      node.kind === "raw")
  ) {
    return node.props ?? {}
  }
  return {}
})

const importSpecForSelection = computed((): string | null => {
  const node = selectedNode.value
  const context = inspector?.contextSelection.value
  if (context) return context.importSpec ?? null
  const mdl = model.value
  if (!node || !mdl) return null
  if (node.kind !== "component") return null
  const imp = mdl.imports.find((i: AstroImport) => i.name === node.name)
  return imp?.path ?? null
})

const schemaSourceFile = computed(
  () => inspector?.contextSelection.value?.file ?? doc?.editFile.value ?? null,
)

let schemaRequestGeneration = 0

watch(
  () =>
    [
      selectedPath.value,
      importSpecForSelection.value,
      schemaSourceFile.value,
      doc?.projectPath.value ?? "",
      isLayout.value,
    ] as const,
  async ([path, importSpec, editFile, projectPath]) => {
    const generation = ++schemaRequestGeneration
    componentSchema.value = null
    schemaError.value = null
    schemaLoading.value = false
    if (!path || !editFile || !projectPath) return
    const node = selectedNode.value
    if (!node || node.kind !== "component") return
    if (!importSpec) {
      schemaError.value = m.composer_props_schema_unresolved()
      return
    }
    schemaLoading.value = true
    try {
      const result = await extractComposerPropSchema(
        projectPath,
        editFile,
        importSpec,
      )
      if (generation !== schemaRequestGeneration) return
      if (!result.resolved) {
        schemaError.value = m.composer_props_schema_unresolved()
        componentSchema.value = null
        return
      }
      componentSchema.value = {
        fields: result.fields,
        extendsTag: result.extendsTag,
        slots: result.slots,
        hasRest: result.hasRest,
        relativeFile: result.relativeFile,
        mtimeMs: result.mtimeMs,
        controlMetadataFound: result.controlMetadataFound,
        controlMetadataValid: result.controlMetadataValid,
        controlMetadataError: result.controlMetadataError,
      }
    } catch (error) {
      if (generation !== schemaRequestGeneration) return
      schemaError.value =
        error instanceof Error ? error.message : String(error)
    } finally {
      if (generation === schemaRequestGeneration) {
        schemaLoading.value = false
      }
    }
  },
  { immediate: true },
)

function mergeComponentSchema(loaded: LoadedSchema | null): PropField[] {
  if (!loaded) return []
  const own = loaded.fields
  const ownNames = new Set(own.map((f: PropField) => f.name))
  const inherited = loaded.extendsTag
    ? getElementSchema(loaded.extendsTag).filter(
        (f: PropField) => !ownNames.has(f.name),
      )
    : []
  const passesClass =
    loaded.hasRest &&
    !own.some((f: PropField) => /^class(Name|es)?$/i.test(f.name)) &&
    !inherited.some((f: PropField) => f.name === "class")
  return [
    ...own,
    ...(passesClass
      ? [{ name: "class", type: "string" as const, optional: true }]
      : []),
    ...inherited,
  ]
}

const schemaFields = computed((): PropField[] => {
  const node = selectedNode.value
  if (!node) return []
  if (node.kind === "element" || node.kind === "slot") {
    const tag = node.kind === "slot" ? "slot" : node.name
    const fields = getElementPropsSchema(tag)
    return node.kind === "slot" ? fields.filter((field) => field.name !== "name") : fields
  }
  if (node.kind === "component") {
    return mergeComponentSchema(componentSchema.value)
  }
  if (node.kind === "raw") {
    return getElementPropsSchema(node.name)
  }
  return []
})

const schemaNames = computed(() => new Set(schemaFields.value.map((f) => f.name)))

const allowAttrs = computed(() => {
  const node = selectedNode.value
  if (!node) return false
  if (node.kind === "element" || node.kind === "slot") return true
  if (node.kind === "component") return Boolean(componentSchema.value?.hasRest)
  return false
})

const editablePropEntries = computed(() =>
  Object.entries(nodeProps.value).filter(
    ([name, v]) => name !== ARIA_LAYER_LABEL_ATTR && !isOpaquePropValue(v),
  ),
)

const extraPropNames = computed(() => {
  const names = editablePropEntries.value
    .map(([k]) => k)
    .filter((k) => !schemaNames.value.has(k))
  if (!allowAttrs.value) return names
  // class keeps a dedicated field even when not in schema
  return names.filter((k) => k === "class" || k === "slot")
})

const attrNames = computed(() => {
  if (!allowAttrs.value) return []
  return editablePropEntries.value
    .map(([k]) => k)
    .filter(
      (k) => !schemaNames.value.has(k) && k !== "class" && k !== "slot",
    )
})

const extraFields = computed((): PropField[] =>
  extraPropNames.value.map((name) => ({
    name,
    type: "other" as const,
    optional: true,
  })),
)

const allFields = computed(() => [...schemaFields.value, ...extraFields.value])
const componentControlContext = computed(() => componentConditionContext(
  componentSchema.value?.fields ?? [],
  nodeProps.value,
))
const conditionalValueSources = computed(() => conditionSourcesForDocument(
  model.value,
  selectedPath.value,
  conditionCollections.value,
))
const conditionalValueContext = computed(() => componentConditionContext(
  model.value?.propSchema ?? [],
  {},
))

function openConditionalValue(field: PropField) {
  conditionalValueField.value = field
  conditionalValueOpen.value = true
}

function conditionalValueSupported(field: PropField): boolean {
  return field.type !== "attrs" && !isOpaquePropValue(nodeProps.value[field.name])
}

function conditionalValueActive(field: PropField): boolean {
  return Boolean(parseManagedConditionalPropValue(nodeProps.value[field.name]))
}

function conditionalValueStatus(field: PropField): string {
  const conditional = parseManagedConditionalPropValue(nodeProps.value[field.name])
  if (!conditional) return ""
  const match = evaluateComposerConditionalValue(conditional, conditionalValueContext.value)
  if (match.result === "unknown") return "Unknown context"
  if (!match.caseId) return "Otherwise"
  const index = conditional.cases.findIndex((candidate) => candidate.id === match.caseId)
  return index >= 0 ? `Case ${index + 1}` : "Conditional"
}

function saveConditionalValue(value: PropValue) {
  const field = conditionalValueField.value
  if (field) onSetProp(field.name, value, true)
}

const selectedTextPropValue = computed(() => textNodePropValue(selectedNode.value))
const selectedTextConditional = computed(() => parseManagedConditionalPropValue(selectedTextPropValue.value ?? undefined))

function saveTextConditionalValue(value: PropValue) {
  const path = selectedPath.value
  if (!path) return
  doc?.commitInspectorMutation(
    selectedTextConditional.value ? "Edit conditional text" : "Set conditional text",
    (nextModel) => setConditionalTextValueAtPath(nextModel, path, value),
    { immediate: true, coalesceKey: null },
  )
}

function controlConditionResult(field: PropField, kind: "visible" | "enabled"): ConditionResult {
  const condition = kind === "visible" ? field.visibleWhen : field.enabledWhen
  return evaluateConditionSet(condition, componentControlContext.value)
}

function controlDisabled(field: PropField): boolean {
  return controlConditionResult(field, "enabled") === false
}

function controlUnknown(field: PropField): boolean {
  return controlConditionResult(field, "visible") === "unknown"
    || controlConditionResult(field, "enabled") === "unknown"
}

const hiddenControlCount = computed(() => componentSchema.value?.fields.filter(
  (field) => controlConditionResult(field, "visible") === false,
).length ?? 0)
const conditionedControlCount = computed(() => componentSchema.value?.fields.filter(
  (field) => field.visibleWhen || field.enabledWhen,
).length ?? 0)

function onControlMetadataSaved(payload: { metadata: ComponentControlMetadata; mtimeMs: number }) {
  const schema = componentSchema.value
  if (!schema) return
  schema.fields = schema.fields.map((field) => ({
    ...field,
    visibleWhen: payload.metadata.fields[field.name]?.visibleWhen,
    enabledWhen: payload.metadata.fields[field.name]?.enabledWhen,
  }))
  schema.mtimeMs = payload.mtimeMs
  schema.controlMetadataFound = Object.keys(payload.metadata.fields).length > 0
  schema.controlMetadataValid = true
  schema.controlMetadataError = undefined
}

const buttonControlledPropNames = computed(() => {
  if (!buttonNode.value) return new Set<string>()
  const names = resolveComposerButtonPropNames(buttonNode.value, schemaFields.value)
  return new Set([
    ...Object.values(names).filter((name): name is string => Boolean(name)),
    "target", "rel", "title", "download", "disabled",
    "popovertarget", "popovertargetaction",
  ])
})
const popoverControlledPropNames = new Set(["popover", "id", "aria-labelledby"])
const visibleFields = computed(() => allFields.value.filter((field) =>
  !(buttonNode.value && buttonControlledPropNames.value.has(field.name))
  && !(popoverNode.value && popoverControlledPropNames.has(field.name))
  && controlConditionResult(field, "visible") !== false))
const visibleAttrNames = computed(() => attrNames.value.filter((name) =>
  !(buttonNode.value && buttonControlledPropNames.value.has(name))
  && !(popoverNode.value && popoverControlledPropNames.has(name))))

const preferBareBoolean = computed(() => {
  const node = selectedNode.value
  return node?.kind === "element" || node?.kind === "slot" || node?.kind === "raw"
})

const readOnly = computed(() => !editable.value)
const readOnlyMessage = computed(() =>
  contextual.value
    ? m.composer_props_context_readonly({
        file: inspector?.sourceFile.value ?? m.composer_props_context_source(),
      })
    : m.composer_props_readonly(),
)

type DocumentControlKind =
  | "head"
  | "title"
  | "description"
  | "theme-color"
  | "icon"
  | "managed"

function stringProp(node: EditableNode | null, name: string): string | null {
  if (!node || !("props" in node)) return null
  const prop = node.props[name]
  return prop?.type === "string" ? prop.value : null
}

const documentControlKind = computed((): DocumentControlKind | null => {
  const node = selectedNode.value
  if (!node) return null
  if (node.kind === "element") {
    const tag = node.name.toLowerCase()
    if (tag === "head") return "head"
    if (tag === "title") return "title"
    if (tag === "meta") {
      const name = stringProp(node, "name")?.toLowerCase()
      if (name === "description") return "description"
      if (name === "theme-color") return "theme-color"
      if (name === "viewport" || name === "generator") return "managed"
    }
    if (tag === "link") {
      const rel = stringProp(node, "rel")?.toLowerCase()
      if (rel?.includes("icon")) return "icon"
      if (["preconnect", "dns-prefetch", "stylesheet"].includes(rel ?? "")) {
        return "managed"
      }
    }
  }
  if (node.kind === "component" && node.name.toLowerCase() === "clientrouter") {
    return "managed"
  }
  return null
})

const documentControlTitle = computed(() => {
  switch (documentControlKind.value) {
    case "head": return m.composer_document_head_title()
    case "title": return m.composer_document_title_label()
    case "description": return m.composer_document_description_label()
    case "theme-color": return m.composer_document_theme_color_label()
    case "icon": return m.composer_document_icon_label()
    case "managed": return m.composer_document_managed_title()
    default: return ""
  }
})

const documentControlHint = computed(() => {
  switch (documentControlKind.value) {
    case "head": return m.composer_document_head_hint()
    case "title": return m.composer_document_title_hint()
    case "description": return m.composer_document_description_hint()
    case "theme-color": return m.composer_document_theme_color_hint()
    case "icon": return m.composer_document_icon_hint()
    case "managed": return m.composer_document_managed_hint()
    default: return ""
  }
})

const titleContent = computed(() => {
  const node = selectedNode.value
  const path = selectedPath.value
  if (!path || node?.kind !== "element" || node.name.toLowerCase() !== "title") return null
  const children = node.children ?? []
  const index = children.findIndex((child) => child.kind === "text" || child.kind === "expr")
  const child = index >= 0 ? children[index] : null
  if (!child || (child.kind !== "text" && child.kind !== "expr")) return null
  return {
    path: `${path}.${index}`,
    value: child.value,
    dynamic: child.kind === "expr",
  }
})

const documentPrimaryProp = computed(() => {
  switch (documentControlKind.value) {
    case "description":
    case "theme-color": return "content"
    case "icon": return "href"
    default: return null
  }
})
const documentPrimaryDynamic = computed(() => {
  if (documentControlKind.value === "title") return titleContent.value?.dynamic ?? false
  const name = documentPrimaryProp.value
  if (!name) return false
  const node = selectedNode.value
  if (!node || !("props" in node)) return false
  const prop = node.props[name]
  return Boolean(prop && prop.type !== "string")
})
const documentDraft = ref("")

watch(
  () => [selectedPath.value, documentControlKind.value, nodeProps.value] as const,
  () => {
    if (documentControlKind.value === "title") {
      documentDraft.value = titleContent.value?.value ?? ""
      return
    }
    const prop = documentPrimaryProp.value
    documentDraft.value = prop ? stringProp(selectedNode.value, prop) ?? "" : ""
  },
  { immediate: true, deep: true },
)

function updateDocumentPrimary(value: string | number) {
  const next = String(value)
  documentDraft.value = next
  if (readOnly.value || documentPrimaryDynamic.value) return
  if (documentControlKind.value === "title") {
    const target = titleContent.value
    if (!target) return
    doc?.commitInspectorMutation(
      m.composer_document_title_edit_history(),
      (nextModel) => setTextAtPath(nextModel, target.path, next),
      { coalesceKey: `document-title:${target.path}` },
    )
    return
  }
  const prop = documentPrimaryProp.value
  if (prop) onSetProp(prop, { type: "string", value: next }, false)
}

const documentAdvancedFields = computed(() => {
  const primary = documentPrimaryProp.value
  return primary && !documentPrimaryDynamic.value
    ? allFields.value.filter((field) => field.name !== primary)
    : allFields.value
})

const documentIconVariant = computed(() => {
  if (documentControlKind.value !== "icon") return []
  const node = selectedNode.value
  if (!node || !("props" in node)) return []
  return [
    stringProp(node, "sizes"),
    stringProp(node, "type"),
    stringProp(node, "rel"),
  ].filter((value): value is string => Boolean(value))
})

const TAG_OPTIONS = [
  "section", "div", "main", "article", "aside", "header", "footer", "nav",
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span",
  "ul", "ol", "li", "figure", "figcaption", "blockquote", "pre", "code",
] as const

const canChangeTag = computed(
  () =>
    selectedNode.value?.kind === "element" &&
    !["html", "head", "body", "script", "style"].includes(
      selectedNode.value.name.toLowerCase(),
    ),
)
const hasKnownTag = computed(() => {
  const node = selectedNode.value
  return (
    node?.kind === "element" &&
    (TAG_OPTIONS as readonly string[]).includes(node.name.toLowerCase())
  )
})

const textDraft = ref("")
const textFocused = ref(false)
const propertiesSectionOpen = ref(false)

watch(selectedPath, () => {
  propertiesSectionOpen.value = false
})

watch(
  () => selectedNode.value,
  (node) => {
    if (textFocused.value) return
    if (!node) {
      textDraft.value = ""
      return
    }
    if (node.kind === "text" || node.kind === "comment") {
      textDraft.value = node.value
    } else if (node.kind === "expr") {
      textDraft.value = node.value.replace(/^\{|\}$/g, "")
    } else if (node.kind === "map") {
      textDraft.value = node.head
    } else {
      textDraft.value = ""
    }
  },
  { immediate: true },
)

function onSetProp(
  name: string,
  value: PropValue | undefined,
  _immediate: boolean,
) {
  doc?.setSelectedProp(name, value, { immediate: false })
}

function onRenameProp(oldName: string, newName: string) {
  doc?.renameSelectedProp(oldName, newName)
}

function onTextInput(next: string | number) {
  const text = String(next)
  textDraft.value = text
  const node = selectedNode.value
  if (!node) return
  if (node.kind === "expr") {
    doc?.setSelectedText(`{${text}}`, { immediate: false })
    return
  }
  doc?.setSelectedText(text, { immediate: false })
}

const showEmptyHint = computed(() => {
  const node = selectedNode.value
  if (!node) return false
  if (buttonNode.value) return false
  if (popoverNode.value) return false
  if (
    node.kind === "text" ||
    node.kind === "comment" ||
    node.kind === "expr" ||
    node.kind === "map"
  ) {
    return false
  }
  return (
    visibleFields.value.length === 0 &&
    visibleAttrNames.value.length === 0 &&
    !schemaLoading.value
  )
})

const hasOpaqueProps = computed(() =>
  Object.values(nodeProps.value).some(
    (v) => v.type === "spread" || v.type === "shorthand",
  ),
)
</script>

<template>
  <div v-if="isLayoutSettings && !selectedNode" class="space-y-3 px-3 py-4">
    <div class="space-y-1">
      <div class="flex items-center gap-2">
        <AppIcon name="layouts" :size="14" class="text-muted-foreground" />
        <h3 class="text-sm font-medium">{{ m.composer_page_layout_title() }}</h3>
      </div>
      <p class="text-[11px] leading-relaxed text-muted-foreground">
        {{ m.composer_page_layout_description() }}
      </p>
    </div>

    <div class="space-y-1.5">
      <Label class="text-[11px] font-medium tracking-wide text-muted-foreground">
        {{ m.pages_create_layout_label() }}
      </Label>
      <Select :model-value="activeLayoutValue" @update:model-value="onLayoutChange">
        <SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{{ m.pages_create_layout_none() }}</SelectItem>
          <SelectItem
            v-for="layout in doc?.availableLayouts.value ?? []"
            :key="layout.file"
            :value="layout.file"
          >
            {{ layout.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>

  <div v-else-if="!selectedNode" class="space-y-2 px-3 py-4">
    <p class="text-xs text-muted-foreground">
      {{ m.composer_inspector_empty_body() }}
    </p>
  </div>

  <div v-else>
    <div
      v-if="isLayout || readOnly || (selectedNode.kind === 'component' && componentSchema?.relativeFile && componentSchema.fields.length)"
      class="space-y-1 border-b border-dashed border-border px-3 py-3"
    >
      <p
        v-if="isLayout"
        class="text-[11px] leading-relaxed text-muted-foreground"
      >
        {{ m.composer_props_layout_hint() }}
      </p>
      <p
        v-if="readOnly"
        class="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400"
      >
        {{ readOnlyMessage }}
      </p>
      <Button
        v-if="selectedNode.kind === 'component' && componentSchema?.relativeFile && componentSchema.fields.length"
        type="button"
        variant="outline"
        size="sm"
        class="mt-2 h-8 w-full justify-between border-dashed px-2.5 text-xs"
        :disabled="readOnly"
        @click="controlConditionsOpen = true"
      >
        <span class="inline-flex items-center gap-1.5">
          <AppIcon name="branchingPaths" :size="13" aria-hidden="true" />
          Configure controls
        </span>
        <span v-if="conditionedControlCount" class="text-[10px] text-muted-foreground">
          {{ conditionedControlCount }} conditional<span v-if="hiddenControlCount"> · {{ hiddenControlCount }} hidden</span>
        </span>
      </Button>
    </div>

    <div v-if="buttonNode && !documentControlKind" class="border-b border-dashed border-border px-3 py-3">
      <ComposerButtonSection
        :node="buttonNode"
        :disabled="readOnly"
        :content-only="true"
        :schema-fields="schemaFields"
        open-section="button"
      />
    </div>

    <div v-if="popoverNode && !documentControlKind" class="border-b border-dashed border-border px-3 py-3">
      <ComposerPopoverSection
        :node="popoverNode"
        :path="selectedPath ?? undefined"
        :disabled="readOnly"
      />
    </div>

    <div v-if="documentControlKind" class="space-y-3 px-3 py-4">
      <div class="space-y-1">
        <Label
          v-if="documentPrimaryProp || documentControlKind === 'title'"
          for="composer-document-primary"
          class="text-[11px] font-medium tracking-wide text-muted-foreground"
        >
          {{ documentControlTitle }}
        </Label>
        <p v-else class="text-xs font-medium text-foreground">
          {{ documentControlTitle }}
        </p>
        <p class="text-[11px] leading-relaxed text-muted-foreground">
          {{ documentControlHint }}
        </p>
      </div>

      <Textarea
        v-if="documentControlKind === 'description'"
        id="composer-document-primary"
        class="min-h-24 text-xs"
        :model-value="documentDraft"
        :disabled="readOnly || documentPrimaryDynamic"
        @update:model-value="updateDocumentPrimary"
      />
      <template v-else-if="documentControlKind === 'icon'">
        <div
          v-if="documentIconVariant.length"
          class="flex flex-wrap gap-1"
          aria-label="Icon variant"
        >
          <span
            v-for="detail in documentIconVariant"
            :key="detail"
            class="rounded border border-border/70 bg-muted/25 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
          >
            {{ detail }}
          </span>
        </div>
        <ProjectImagePickerField
          input-id="composer-document-primary"
          :project-root="doc?.projectPath.value ?? ''"
          :model-value="documentDraft"
          :preview-alt="documentControlTitle"
          :disabled="readOnly || documentPrimaryDynamic"
          @update:model-value="updateDocumentPrimary"
        />
      </template>
      <Input
        v-else-if="documentControlKind === 'title' || documentPrimaryProp"
        id="composer-document-primary"
        :class="documentControlKind === 'theme-color' ? 'h-8 font-mono text-xs' : 'h-8 text-xs'"
        :model-value="documentDraft"
        :disabled="readOnly || documentPrimaryDynamic"
        :placeholder="documentControlKind === 'theme-color' ? '#0f172a' : undefined"
        @update:model-value="updateDocumentPrimary"
      />

      <p
        v-if="documentPrimaryDynamic"
        class="rounded-md border border-dashed border-border/70 bg-muted/25 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground"
      >
        {{ m.composer_document_dynamic_hint() }}
      </p>

      <details
        v-if="documentControlKind !== 'icon' && (documentAdvancedFields.length || attrNames.length)"
        class="group rounded-md border border-dashed border-border/70"
      >
        <summary
          class="cursor-pointer list-none px-2.5 py-2 text-[11px] font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden"
        >
          {{ m.composer_document_advanced_attributes() }}
        </summary>
        <div class="space-y-3 border-t border-dashed border-border/70 px-2.5 py-3">
          <ComposerPropField
            v-for="field in documentAdvancedFields"
            :key="field.name"
            :field="field"
            :value="nodeProps[field.name]"
            :disabled="readOnly"
            :prefer-bare-boolean="preferBareBoolean"
            @change="(v, immediate) => onSetProp(field.name, v, immediate)"
          />
          <ComposerAttributesSection
            v-if="allowAttrs"
            embedded
            :node-props="nodeProps"
            :names="attrNames"
            :disabled="readOnly"
            @set-prop="onSetProp"
            @rename-prop="onRenameProp"
          />
        </div>
      </details>
    </div>

    <div v-if="!documentControlKind && selectedSlot" class="space-y-2 px-3 py-4">
      <div class="space-y-1.5">
        <Label for="composer-slot-name" class="text-[11px] font-medium tracking-wide text-muted-foreground">
          {{ selectedSlot.name ? m.composer_layout_slot_name_label() : m.composer_palette_page_content_slot() }}
        </Label>
        <Input
          v-if="selectedSlot.name"
          id="composer-slot-name"
          v-model="slotNameDraft"
          class="h-8 text-xs"
          :disabled="readOnly || slotBusy"
          :aria-invalid="Boolean(slotNameError)"
          :aria-describedby="slotNameError ? 'composer-slot-name-error' : undefined"
          @keydown.enter.prevent="commitSlotRename"
          @blur="commitSlotRename"
        />
        <p v-else class="text-[11px] leading-relaxed text-muted-foreground">
          {{ m.composer_layout_default_slot_immutable() }}
        </p>
        <p v-if="slotNameError" id="composer-slot-name-error" class="text-[11px] text-destructive">
          {{ slotNameError }}
        </p>
      </div>
      <Button
        v-if="selectedSlot.name"
        type="button"
        variant="destructive"
        size="sm"
        class="w-full"
        :disabled="readOnly || slotBusy"
        @click="deleteNamedSlot"
      >
        {{ m.composer_layout_slot_delete_action() }}
      </Button>
    </div>

    <div v-if="!documentControlKind && isLayout" class="space-y-1.5 border-b border-dashed border-border px-3 py-3">
      <Label class="text-[11px] font-medium tracking-wide text-muted-foreground">
        {{ m.pages_create_layout_label() }}
      </Label>
      <Select :model-value="activeLayoutValue" @update:model-value="onLayoutChange">
        <SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{{ m.pages_create_layout_none() }}</SelectItem>
          <SelectItem
            v-if="activeLayoutValue.startsWith('name:')"
            :value="activeLayoutValue"
          >
            {{ selectedNode.kind === 'component' ? selectedNode.name : activeLayoutValue }}
          </SelectItem>
          <SelectItem
            v-for="layout in doc?.availableLayouts.value ?? []"
            :key="layout.file"
            :value="layout.file"
          >
            {{ layout.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <ComposerContentBindingSection
      v-if="!documentControlKind && selectedNode.kind !== 'comment' && selectedNode.kind !== 'doctype'"
    />

    <!-- Text / comment -->
    <InspectorPropertySection
      v-if="
        !documentControlKind && (
          selectedNode.kind === 'text' ||
          selectedNode.kind === 'comment'
        )
      "
      :title="m.composer_props_content()"
    >
      <div class="space-y-1.5">
        <div
          v-if="selectedTextConditional"
          class="flex min-h-10 items-center justify-between gap-3 rounded-md border border-dashed border-primary/35 bg-primary/5 px-2.5"
        >
          <span class="text-xs text-primary">Conditional text</span>
          <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-[10px]" :disabled="readOnly" @click="textConditionalValueOpen = true">
            <AppIcon name="branchingPaths" :size="11" aria-hidden="true" />
            Edit value
          </Button>
        </div>
        <Textarea
          v-else
          class="min-h-20 font-mono text-xs"
          :model-value="textDraft"
          :disabled="readOnly"
          spellcheck="false"
          @focus="textFocused = true"
          @blur="textFocused = false"
          @update:model-value="onTextInput"
        />
        <Button
          v-if="!selectedTextConditional && selectedNode.kind === 'text'"
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 px-1.5 text-[10px] text-muted-foreground"
          :disabled="readOnly"
          @click="textConditionalValueOpen = true"
        >
          <AppIcon name="branchingPaths" :size="11" aria-hidden="true" />
          Set conditional value
        </Button>
      </div>
    </InspectorPropertySection>

    <template v-else-if="!documentControlKind && selectedNode.kind !== 'expr' && selectedNode.kind !== 'map'">
      <InspectorPropertySection
        :title="selectedNode.kind === 'element' ? 'Semantic HTML' : 'Properties'"
        :open="propertiesSectionOpen"
        :data-composer-semantic-section="selectedNode.kind === 'element' ? '' : undefined"
        @update:open="propertiesSectionOpen = $event"
      >
        <template v-if="selectedNode.kind === 'element'" #actions>
          <span class="px-1 font-mono text-[10px] font-normal text-muted-foreground/75">{{ selectedNode.name.toLowerCase() }}</span>
        </template>
        <div class="space-y-3">
          <div v-if="canChangeTag && selectedNode.kind === 'element'" class="space-y-1.5">
            <Label class="text-[11px] font-medium tracking-wide text-muted-foreground">
              HTML tag
            </Label>
            <Select
              :model-value="selectedNode.name.toLowerCase()"
              :disabled="readOnly"
              @update:model-value="doc?.setSelectedTag(String($event))"
            >
              <SelectTrigger class="h-8 font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-if="!hasKnownTag"
                  :value="selectedNode.name.toLowerCase()"
                >
                  {{ selectedNode.name.toLowerCase() }}
                </SelectItem>
                <SelectItem v-for="tag in TAG_OPTIONS" :key="tag" :value="tag">
                  {{ tag }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p
            v-if="schemaLoading"
            class="text-[11px] text-muted-foreground"
          >
            {{ m.composer_props_schema_loading() }}
          </p>
          <p
            v-else-if="schemaError && selectedNode.kind === 'component'"
            class="text-[11px] text-muted-foreground"
          >
            {{ schemaError }}
          </p>

          <div v-if="visibleFields.length" class="space-y-3">
            <div v-for="field in visibleFields" :key="field.name" class="group space-y-1">
              <div
                v-if="conditionalValueActive(field)"
                class="flex min-h-9 items-center justify-between gap-2 rounded-md border border-dashed border-primary/35 bg-primary/5 px-2.5"
              >
                <div class="min-w-0">
                  <p class="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{{ field.name }}</p>
                  <p class="text-[10px] text-primary">{{ conditionalValueStatus(field) }}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-[10px]" :disabled="readOnly || controlDisabled(field)" @click="openConditionalValue(field)">
                  <AppIcon name="branchingPaths" :size="11" aria-hidden="true" />
                  Edit value
                </Button>
              </div>
              <ComposerPropField
                v-else
                :field="field"
                :value="nodeProps[field.name]"
                :disabled="readOnly || controlDisabled(field)"
                :prefer-bare-boolean="preferBareBoolean"
                @change="(v, immediate) => onSetProp(field.name, v, immediate)"
              />
              <ComposerCmsPropBindingControl
                v-if="field.type !== 'attrs' && cmsSelection?.canBindProps"
                :prop-name="field.name"
                :value="nodeProps[field.name]"
                :disabled="readOnly || controlDisabled(field)"
              />
              <p
                v-if="controlDisabled(field)"
                class="-mt-2 pl-20 text-[10px] leading-relaxed text-muted-foreground"
              >
                Available when its control condition matches.
              </p>
              <p
                v-else-if="controlUnknown(field)"
                class="-mt-2 pl-20 text-[10px] leading-relaxed text-muted-foreground"
              >
                Unknown here — the control stays available for editing.
              </p>
              <Button
                v-if="conditionalValueSupported(field) && !conditionalValueActive(field)"
                type="button"
                variant="ghost"
                size="sm"
                class="-mt-2 ml-[76px] h-6 w-fit px-1.5 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                :disabled="readOnly || controlDisabled(field)"
                @click="openConditionalValue(field)"
              >
                <AppIcon name="branchingPaths" :size="11" aria-hidden="true" />
                Set conditional value
              </Button>
            </div>
          </div>

          <p
            v-if="showEmptyHint"
            class="text-[11px] leading-relaxed text-muted-foreground"
          >
            {{
              selectedNode.kind === "element" || selectedNode.kind === "slot"
                ? m.composer_props_empty_element()
                : m.composer_props_empty_component()
            }}
          </p>
        </div>
      </InspectorPropertySection>

      <ComposerAttributesSection
        v-if="allowAttrs"
        :key="selectedPath ?? 'attrs'"
        :node-props="nodeProps"
        :names="visibleAttrNames"
        :disabled="readOnly"
        @set-prop="onSetProp"
        @rename-prop="onRenameProp"
      />
    </template>

    <!-- Spread / shorthand notice for opaque prop kinds -->
    <p
      v-if="hasOpaqueProps"
      class="border-b border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground"
    >
      {{ m.composer_props_opaque_hint() }}
    </p>
  </div>

  <Dialog :open="Boolean(pendingLayout)" @update:open="!$event && closeLayoutProps()">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>
          {{ m.composer_apply_layout_title({ name: pendingLayout?.name ?? "" }) }}
        </DialogTitle>
        <DialogDescription>
          {{ m.composer_apply_layout_description() }}
        </DialogDescription>
      </DialogHeader>
      <form class="space-y-3" @submit.prevent="applyPendingLayout">
        <p v-if="layoutApplyBusy" class="text-xs text-muted-foreground" role="status">
          {{ m.composer_layout_props_loading() }}
        </p>
        <label
          v-for="field in layoutFields"
          :key="field.name"
          class="block space-y-1.5 text-sm font-medium"
        >
          <span>{{ field.name }}</span>
          <input
            v-if="field.type === 'boolean'"
            type="checkbox"
            class="size-4 rounded border-input accent-primary"
            :checked="layoutFieldValues[field.name] === true"
            @change="updateLayoutField(field.name, ($event.target as HTMLInputElement).checked)"
          />
          <select
            v-else-if="field.type === 'enum'"
            :value="String(layoutFieldValues[field.name] ?? '')"
            class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @change="updateLayoutField(field.name, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="option in field.options ?? []" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
          <Input
            v-else
            :type="field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'"
            :model-value="String(layoutFieldValues[field.name] ?? '')"
            @update:model-value="updateLayoutField(field.name, String($event))"
          />
        </label>
        <p v-if="layoutApplyError" class="text-xs text-destructive">
          {{ layoutApplyError }}
        </p>
        <DialogFooter class="gap-2 sm:justify-end">
          <Button type="button" variant="outline" @click="closeLayoutProps">
            {{ m.confirm_cancel() }}
          </Button>
          <Button type="submit" :disabled="Boolean(layoutApplyError) || layoutApplyBusy">
            {{ m.composer_apply_layout_action() }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <ComposerControlConditionsDialog
    v-if="componentSchema?.relativeFile"
    v-model:open="controlConditionsOpen"
    :project-path="doc?.projectPath.value ?? ''"
    :relative-file="componentSchema.relativeFile"
    :fields="componentSchema.fields"
    :mtime-ms="componentSchema.mtimeMs"
    :metadata-valid="componentSchema.controlMetadataValid"
    :metadata-error="componentSchema.controlMetadataError"
    @saved="onControlMetadataSaved"
  />

  <ComposerConditionalValueDialog
    v-model:open="conditionalValueOpen"
    :field="conditionalValueField"
    :value="conditionalValueField ? nodeProps[conditionalValueField.name] : undefined"
    :sources="conditionalValueSources"
    :context="conditionalValueContext"
    :disabled="readOnly"
    :sources-loading="conditionSourcesLoading"
    :sources-error="conditionSourcesError"
    :has-registered-collections="hasConditionCollections"
    @save="saveConditionalValue"
  />

  <ComposerConditionalValueDialog
    v-model:open="textConditionalValueOpen"
    :field="textConditionalField"
    :value="selectedTextPropValue ?? undefined"
    :sources="conditionalValueSources"
    :context="conditionalValueContext"
    :disabled="readOnly"
    :sources-loading="conditionSourcesLoading"
    :sources-error="conditionSourcesError"
    :has-registered-collections="hasConditionCollections"
    @save="saveTextConditionalValue"
  />
</template>
