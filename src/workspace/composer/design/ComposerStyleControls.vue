<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { m } from "@/paraglide/messages.js"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { buildOpacityVariableReferenceOptions } from "@/workspace/design/lib/variableReferences"
import {
  BACKGROUND_SECTION_PROPERTIES,
  COMPOSER_FILTER_PROPERTIES,
  CORNER_SECTION_PROPERTIES,
  LEGACY_LOGICAL_RADIUS_PROPERTIES,
  PHYSICAL_RADIUS_PROPERTIES,
  HEIGHT_SIZING_PROP,
  SHADOW_SECTION_PROPERTIES,
  SIZE_SECTION_PROPERTIES,
  TRANSFORM_SECTION_PROPERTIES,
  WIDTH_SIZING_PROP,
  applySizeMode,
  applySizingResolution,
  getStyleProp,
  isComposerPopoverTarget,
  layoutParentContextForPath,
  mergeParentLayoutContext,
  nodeAtMarkerPath,
  parentPathOf,
  parseStyleAttr,
  resolveInsetSides,
  resolveSpacingSides,
  serializeStyleAttr,
  setStyleProp,
  staticClassListTokens,
  withPreviewImportant,
  type SizeAxis,
  type SizeMode,
  type CornerValues,
} from "../../../../shared/composer"
import type { PropValue } from "../../../../shared/composer/types"
import { tryUseComposerBeacon } from "../selection/useComposerBeacon"
import { tryUseComposerDocument } from "../useComposerDocumentSession"
import { tryUseComposerDesignClasses } from "../useComposerDesignContext"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import { beginPointerScrub, useInspectorLiveStyleSession } from "../inspector/useInspectorLiveStyleSession"
import ComposerStyleField from "./ComposerStyleField.vue"
import ComposerLinkedSides from "./ComposerLinkedSides.vue"
import ComposerPositionControls from "./ComposerPositionControls.vue"
import ComposerDisplayControls from "./ComposerDisplayControls.vue"
import ComposerSizeControls from "./ComposerSizeControls.vue"
import ComposerTypographyControls from "./ComposerTypographyControls.vue"
import ComposerTransformControls from "./ComposerTransformControls.vue"
import ComposerBackgroundControls from "./ComposerBackgroundControls.vue"
import ComposerBorderControls from "./ComposerBorderControls.vue"
import ComposerCornerControls from "./ComposerCornerControls.vue"
import ComposerShadowControls from "./ComposerShadowControls.vue"
import ComposerFilterControls from "./ComposerFilterControls.vue"
import ComposerOpacityControls from "./ComposerOpacityControls.vue"
import type { ComposerStyleCommitResult } from "./composerOpacity"
import { BORDER_SECTION_PROPERTIES, resolveBorderStyleFromClasses } from "./composerBorder"
import type { DisplayProperty } from "./ComposerDisplayControls.vue"
import InspectorPropertySection from "./InspectorPropertySection.vue"
import InspectorBreakpointIndicators from "./InspectorBreakpointIndicators.vue"
import {
  resolveInspectorSectionState,
  type InspectorBreakpointStyleSource,
} from "./inspectorSectionState"

type StyleField = {
  prop: string
  label: string
  placeholder?: string
  options?: readonly string[]
  scrub?: boolean
  mediaPicker?: boolean
  unitless?: boolean
  units?: readonly string[]
}
type StyleSection = {
  id: string
  label: string
  fields: readonly StyleField[]
  extraProps?: readonly string[]
}

const TYPOGRAPHY_PROPERTIES = [
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration",
  "text-wrap",
  "white-space",
] as const

const DISPLAY_PROPERTIES: readonly DisplayProperty[] = [
  "display",
  "visibility",
  "overflow",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "align-content",
  "justify-items",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "flow-tolerance",
]

const GRID_DISPLAY_MODES = new Set<string>(["grid", "grid-lanes", "inline-grid"])

const props = defineProps<{
  styleText: string
  isExpr: boolean
  disabled?: boolean
  defaultSection?: string
  inheritedStyleText?: string
  openSection?: string | null
  breakpointStyles?: readonly InspectorBreakpointStyleSource[]
  currentBreakpoint?: string
  commitStyle?: (
    value: PropValue | undefined,
    options?: { historyBoundary?: boolean; preserveApply?: boolean; deletedKeys?: string[] },
  ) => Promise<ComposerStyleCommitResult>
}>()
const emit = defineEmits<{
  setStyle: [value: PropValue | undefined, immediate: boolean, options?: { historyBoundary?: boolean; preserveApply?: boolean; deletedKeys?: string[] }]
  "update:openSection": [value: string | null]
  selectBreakpoint: [value: string]
}>()

const sections: readonly StyleSection[] = [
  {
    id: "display", label: "Display",
    fields: [],
    extraProps: [...DISPLAY_PROPERTIES, "row-gap", "column-gap"],
  },
  {
    id: "size", label: "Size",
    fields: [],
    extraProps: SIZE_SECTION_PROPERTIES,
  },
  {
    id: "spacing", label: "Spacing",
    extraProps: ["padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left"],
    fields: [],
  },
  {
    id: "position", label: "Position",
    extraProps: ["position", "inset", "top", "right", "bottom", "left", "z-index"],
    fields: [],
  },
  {
    id: "transform", label: "Transform",
    fields: [],
    extraProps: TRANSFORM_SECTION_PROPERTIES,
  },
  {
    id: "typography", label: "Typography",
    fields: [],
    extraProps: TYPOGRAPHY_PROPERTIES,
  },
  {
    id: "background", label: "Background",
    fields: [],
    extraProps: BACKGROUND_SECTION_PROPERTIES,
  },
  {
    id: "border", label: "Border",
    extraProps: BORDER_SECTION_PROPERTIES,
    fields: [],
  },
  {
    id: "corner", label: "Corner",
    fields: [],
    extraProps: CORNER_SECTION_PROPERTIES,
  },
  { id: "shadow", label: "Shadow", fields: [], extraProps: SHADOW_SECTION_PROPERTIES },
  { id: "filter", label: "Filter", fields: [], extraProps: COMPOSER_FILTER_PROPERTIES },
  { id: "opacity", label: "Opacity", fields: [], extraProps: ["opacity"] },
]
const popoverSection: StyleSection = {
  id: "popover",
  label: "Popover",
  fields: [],
  extraProps: ["position-area", "position-try-fallbacks", "inset", "margin"],
}

const sectionLabels: Record<string, () => string> = {
  typography: m.composer_inspector_section_typography,
  display: m.composer_inspector_section_display,
  size: m.composer_inspector_section_size,
  spacing: m.composer_inspector_section_spacing,
  position: m.composer_inspector_section_position,
  transform: m.composer_inspector_section_transform,
  background: m.composer_inspector_section_background,
  border: m.composer_inspector_section_border,
  corner: m.composer_inspector_section_corner,
  shadow: m.composer_inspector_section_shadow,
  filter: m.composer_inspector_section_filter,
  opacity: m.composer_inspector_section_opacity,
}
function sectionLabel(section: StyleSection) { return sectionLabels[section.id]?.() ?? section.label }

const beacon = tryUseComposerBeacon()
const doc = tryUseComposerDocument()
const design = tryUseComposerDesignClasses()
const inspector = tryUseInspectorContext()
const isPopoverTarget = computed(() => isComposerPopoverTarget(inspector?.selectedNode.value))
const visibleSections = computed<readonly StyleSection[]>(() => isPopoverTarget.value
  ? [popoverSection, ...sections]
  : sections)
const previewPath = computed(() => beacon?.selectedPath.value ?? null)
const localMap = ref<Record<string, string>>(parseStyleAttr(props.styleText))
let pendingCommittedCss: string | null = null
let committedPreviewHeld = false
const inheritedMap = computed(() => parseStyleAttr(props.inheritedStyleText ?? ""))
const internalOpenSection = ref<string | null>(props.defaultSection ?? "display")
const activeSection = computed({
  get: () => props.openSection === undefined ? internalOpenSection.value : props.openSection,
  set: (value: string | null) => {
    internalOpenSection.value = value
    emit("update:openSection", value)
  },
})
const sizeCancelEpoch = ref(0)
const live = useInspectorLiveStyleSession({
  path: previewPath,
  preview: (path, cssText) => doc?.previewStyle(
    path,
    cssText,
    inspector?.isContextSelection.value
      ? inspector.sourceFile.value ?? undefined
      : undefined,
  ),
  clear: (path) => doc?.clearPreviewStyle(
    path,
    inspector?.isContextSelection.value
      ? inspector.sourceFile.value ?? undefined
      : undefined,
  ),
  onCancel: (cssText) => {
    localMap.value = parseStyleAttr(cssText)
    sizeCancelEpoch.value += 1
  },
})
const paddingLinked = ref(true)
const marginLinked = ref(true)
const parentComputedDisplay = ref("")
const parentComputedFlexDirection = ref("")
let parentDisplayRequest = 0
const cornerResolvedPhysicalRadius = ref<CornerValues | null>(null)
const cornerLogicalResolutionFailed = ref(false)
let cornerRadiusRequest = 0

const cornerLogicalRadiusSignature = computed(() => Object.values(LEGACY_LOGICAL_RADIUS_PROPERTIES)
  .map((property) => `${property}:${localMap.value[property] ?? ""}:${inheritedMap.value[property] ?? ""}`)
  .join("|"))
const hasLegacyLogicalRadius = computed(() => Object.values(LEGACY_LOGICAL_RADIUS_PROPERTIES)
  .some((property) => Boolean(localMap.value[property]?.trim() || inheritedMap.value[property]?.trim())))

watch(
  () => [
    inspector?.selectedPath.value,
    inspector?.sourceFile.value,
    inspector?.targetBreakpoint.value,
    inspector?.selectedPseudo.value,
    cornerLogicalRadiusSignature.value,
  ] as const,
  async ([path]) => {
    const request = ++cornerRadiusRequest
    cornerResolvedPhysicalRadius.value = null
    cornerLogicalResolutionFailed.value = false
    if (!path || !doc || !hasLegacyLogicalRadius.value) return
    try {
      const properties = Object.values(PHYSICAL_RADIUS_PROPERTIES)
      const styles = await doc.computedStyle({
        path,
        ...(inspector?.isContextSelection.value && inspector.sourceFile.value
          ? { relativePath: inspector.sourceFile.value }
          : {}),
        properties,
      })
      if (request !== cornerRadiusRequest) return
      const resolved = Object.fromEntries(Object.entries(PHYSICAL_RADIUS_PROPERTIES).map(([corner, property]) => [
        corner,
        styles[property]?.trim() ?? "",
      ])) as CornerValues
      if (Object.values(resolved).some((value) => !value)) {
        cornerLogicalResolutionFailed.value = true
        return
      }
      cornerResolvedPhysicalRadius.value = resolved
    } catch {
      if (request !== cornerRadiusRequest) return
      cornerLogicalResolutionFailed.value = true
    }
  },
  { immediate: true },
)

watch(() => props.styleText, (next) => {
  if (pendingCommittedCss === next) {
    pendingCommittedCss = null
    localMap.value = parseStyleAttr(next)
    syncSpacingLinkedState()
    return
  }
  if (live.active.value) live.clear()
  else if (committedPreviewHeld) doc?.clearPreviewStyle(previewPath.value ?? undefined)
  pendingCommittedCss = null
  committedPreviewHeld = false
  localMap.value = parseStyleAttr(next)
  syncSpacingLinkedState()
})
watch(() => props.defaultSection, (next) => { if (next && props.openSection === undefined) activeSection.value = next })

function authoredValue(prop: string) { return getStyleProp(localMap.value, prop) }
function value(prop: string) { return authoredValue(prop) || getStyleProp(inheritedMap.value, prop) }
function isInherited(prop: string) { return !authoredValue(prop) && Boolean(getStyleProp(inheritedMap.value, prop)) }
function spacingValues(property: "padding" | "margin") {
  return resolveSpacingSides({ ...inheritedMap.value, ...localMap.value }, property)
}
function syncSpacingLinkedState() {
  const padding = spacingValues("padding")
  const margin = spacingValues("margin")
  paddingLinked.value = padding.top === padding.bottom && padding.left === padding.right
  marginLinked.value = margin.top === margin.bottom && margin.left === margin.right
}
syncSpacingLinkedState()
function nearestLayoutParentPath(path: string | null | undefined): string | null {
  const model = doc?.model.value
  if (!path || !model) return null
  let candidate = parentPathOf(path)
  while (candidate) {
    const node = nodeAtMarkerPath(model.nodes, candidate)
    if (node && (node.kind === "element" || node.kind === "component")) return candidate
    candidate = parentPathOf(candidate)
  }
  return null
}
watch(
  () => [
    inspector?.selectedPath.value,
    inspector?.sourceFile.value,
    inspector?.targetBreakpoint.value,
  ] as const,
  async ([path]) => {
    const request = ++parentDisplayRequest
    const parentPath = nearestLayoutParentPath(path)
    if (!path || !doc || !parentPath) {
      parentComputedDisplay.value = ""
      parentComputedFlexDirection.value = ""
      return
    }
    try {
      const styles = await doc.computedStyle({
        path: parentPath,
        ...(inspector?.isContextSelection.value && inspector.sourceFile.value
          ? { relativePath: inspector.sourceFile.value }
          : {}),
        properties: ["display", "flex-direction"],
      })
      if (request !== parentDisplayRequest) return
      parentComputedDisplay.value = styles.display?.trim() ?? ""
      parentComputedFlexDirection.value = styles["flex-direction"]?.trim() ?? ""
    } catch {
      if (request !== parentDisplayRequest) return
      parentComputedDisplay.value = ""
      parentComputedFlexDirection.value = ""
    }
  },
  { immediate: true },
)
const parentIsGrid = computed(() => {
  const computedDisplay = parentComputedDisplay.value
  if (computedDisplay) return GRID_DISPLAY_MODES.has(computedDisplay)
  return GRID_DISPLAY_MODES.has(currentParentLayout()?.display ?? "")
})
const elementTag = computed(() => {
  const node = inspector?.selectedNode.value
  return node?.kind === "element" ? node.name : null
})
const typographyValues = computed(() => Object.fromEntries(
  TYPOGRAPHY_PROPERTIES.map((property) => [property, value(property)]),
))
const displayValues = computed(() => Object.fromEntries(
  DISPLAY_PROPERTIES.map((property) => [property, value(property)]),
))
const inheritedDisplayProperties = computed(() =>
  DISPLAY_PROPERTIES.filter((property) => isInherited(property)),
)
const inheritedTypographyProperties = computed(() =>
  TYPOGRAPHY_PROPERTIES.filter((property) => isInherited(property)),
)
const sizeValues = computed(() => Object.fromEntries(
  SIZE_SECTION_PROPERTIES.map((property) => [property, value(property)]),
))
const inheritedSizeProperties = computed(() =>
  SIZE_SECTION_PROPERTIES.filter((property) => isInherited(property)),
)
const backgroundValues = computed(() => Object.fromEntries(
  BACKGROUND_SECTION_PROPERTIES.map((property) => [property, value(property)]),
))
const inheritedBackgroundProperties = computed(() =>
  BACKGROUND_SECTION_PROPERTIES.filter((property) => isInherited(property)),
)
const opacityVariableOptions = computed(() => {
  const variables = design?.snapshot.value?.variables
  return variables ? buildOpacityVariableReferenceOptions(variables) : []
})
const opacityPersisting = ref(false)
const opacitySaveError = ref("")
let opacityCommitVersion = 0
const borderValues = computed(() => {
  const values = Object.fromEntries(
    BORDER_SECTION_PROPERTIES.map((property) => [property, value(property)]),
  ) as Record<string, string>
  if (!values["border-style"] && !values.border) {
    const node = inspector?.selectedNode.value
    const tokens = node && "props" in node
      ? [
          ...staticClassListTokens(node.props.class),
          ...staticClassListTokens(node.props["class:list"]),
        ]
      : []
    const fromClass = resolveBorderStyleFromClasses(tokens)
    if (fromClass) values["border-style"] = fromClass
  }
  return values
})
const inheritedBorderProperties = computed(() =>
  BORDER_SECTION_PROPERTIES.filter((property) => isInherited(property)),
)
const shadowValues = computed(() => Object.fromEntries(
  SHADOW_SECTION_PROPERTIES.map((property) => [property, value(property)]),
))
const inheritedShadowProperties = computed(() =>
  SHADOW_SECTION_PROPERTIES.filter((property) => isInherited(property)),
)
const filterValues = computed(() => Object.fromEntries(
  COMPOSER_FILTER_PROPERTIES.map((property) => [property, value(property)]),
))
const inheritedFilterProperties = computed(() =>
  COMPOSER_FILTER_PROPERTIES.filter((property) => isInherited(property)),
)
const filterResetEpoch = ref(0)
const sizeResetKey = computed(() =>
  `${inspector?.selectedPath.value ?? ""}:${props.currentBreakpoint ?? "base"}`,
)
const filterResetKey = computed(() => `${sizeResetKey.value}:${filterResetEpoch.value}`)
function currentParentLayout() {
  const model = doc?.model.value
  const path = inspector?.selectedPath.value ?? previewPath.value
  const authored = model && path ? layoutParentContextForPath(model.nodes, path) : null
  return mergeParentLayoutContext(authored, {
    display: parentComputedDisplay.value,
    flexDirection: parentComputedFlexDirection.value,
  })
}
function sizeUpdateAxes(updates: Record<string, string>): SizeAxis[] {
  const axes: SizeAxis[] = []
  if ("width" in updates || WIDTH_SIZING_PROP in updates) axes.push("width")
  if ("height" in updates || HEIGHT_SIZING_PROP in updates) axes.push("height")
  return axes
}
function patchSize(updates: Record<string, string>, preview: boolean) {
  if (props.disabled || props.isExpr) return
  let next = applyStyleUpdates(updates)
  const axes = sizeUpdateAxes(updates)
  if (axes.length) next = applySizingResolution(next, currentParentLayout(), axes)
  if (preview) {
    paintMergedPreview(next, deletedKeysFrom(updates))
    return
  }
  commitMap(next, false, deletedKeysFrom(updates))
}
function onSizeMode(axis: SizeAxis, mode: SizeMode) {
  if (props.disabled || props.isExpr || mode === "exact") return
  commitMap(applySizeMode(localMap.value, axis, mode, currentParentLayout()))
}
const positionValues = computed(() => {
  const sides = resolveInsetSides({ ...inheritedMap.value, ...localMap.value })
  return {
    position: value("position"),
    top: sides.top,
    right: sides.right,
    bottom: sides.bottom,
    left: sides.left,
    "z-index": value("z-index"),
  }
})
const popoverPlacementOptions = [
  ["block-start span-inline-start", "Above left"],
  ["block-start", "Above center"],
  ["block-start span-inline-end", "Above right"],
  ["inline-start", "Left"],
  ["inline-end", "Right"],
  ["block-end span-inline-start", "Below left"],
  ["block-end", "Below center"],
  ["block-end span-inline-end", "Below right"],
  ["__center__", "Viewport centered"],
] as const
const popoverPlacement = computed(() => value("position-area") || (value("inset") === "0" ? "__center__" : "block-end"))
function setPopoverPlacement(raw: unknown) {
  const placement = String(raw)
  commitProps(placement === "__center__"
    ? { "position-area": "", "position-try-fallbacks": "", inset: "0", margin: "auto" }
    : {
        "position-area": placement,
        "position-try-fallbacks": "flip-block, flip-inline",
        inset: "auto",
        margin: value("margin") === "auto" ? "0.75rem" : value("margin") || "0.75rem",
      })
}
const headingLevel = computed(() => {
  if (inspector?.isContextSelection.value) return null
  const node = inspector?.selectedNode.value
  if (node?.kind !== "element") return null
  const match = /^h([1-6])$/i.exec(node.name)
  return match ? Number(match[1]) : null
})
function sectionHasChanges(section: StyleSection) {
  return sectionState(section).hasAuthoredValues
}
function sectionProperties(section: StyleSection) {
  return [...section.fields.map((field) => field.prop), ...(section.extraProps ?? [])]
}
function sectionState(section: StyleSection) {
  const sources = props.breakpointStyles?.length
    ? props.breakpointStyles
    : [{ id: "base", label: "Base", width: null, styleText: serializeStyleAttr(localMap.value) }]
  return resolveInspectorSectionState(
    sectionProperties(section),
    props.currentBreakpoint ?? "base",
    sources,
  )
}
function removedStyleKeys(next: Record<string, string>, extra: readonly string[] = []): string[] {
  const deletes = new Set(extra.map((key) => key.toLowerCase()))
  for (const key of Object.keys(localMap.value)) {
    if (!String(next[key] ?? "").trim()) deletes.add(key)
  }
  return [...deletes]
}
function mergeWithClassBody(next: Record<string, string>, deletedKeys: readonly string[] = []) {
  const merged = { ...parseStyleAttr(props.styleText), ...next }
  for (const key of removedStyleKeys(next, deletedKeys)) delete merged[key]
  return merged
}
function commitOptions(historyBoundary: boolean, deletedKeys: readonly string[]) {
  return {
    ...(historyBoundary ? { historyBoundary: true } : {}),
    ...(deletedKeys.length ? { deletedKeys: [...deletedKeys] } : {}),
  }
}
function paintMergedPreview(next: Record<string, string>, deletedKeys: readonly string[] = []) {
  const origin = serializeStyleAttr(localMap.value)
  const merged = mergeWithClassBody(next, deletedKeys)
  localMap.value = merged
  live.preview(withPreviewImportant(serializeStyleAttr(merged)), origin)
}
function commitMap(next: Record<string, string>, historyBoundary = false, deletedKeys: readonly string[] = []) {
  const deletes = removedStyleKeys(next, deletedKeys)
  const merged = mergeWithClassBody(next, deletedKeys)
  localMap.value = merged
  const css = serializeStyleAttr(merged)
  pendingCommittedCss = css
  committedPreviewHeld = true
  emit("setStyle", css ? { type: "string", value: css } : undefined, true, commitOptions(historyBoundary, deletes))
  live.commit(withPreviewImportant(css))
}
async function commitOpacityMap(
  next: Record<string, string>,
  historyBoundary = false,
): Promise<ComposerStyleCommitResult> {
  if (props.disabled || props.isExpr) {
    return { ok: false, error: m.composer_opacity_save_failed() }
  }
  const origin = serializeStyleAttr(localMap.value)
  const deletes = removedStyleKeys(next)
  const merged = mergeWithClassBody(next, deletes)
  const css = serializeStyleAttr(merged)
  const version = ++opacityCommitVersion
  const context = [
    inspector?.sourceFile.value ?? "",
    inspector?.selectedPath.value ?? "",
    inspector?.activeClassName.value ?? "__element__",
    props.currentBreakpoint ?? "base",
    inspector?.selectedPseudo.value ?? "default",
  ].join(":")
  localMap.value = merged
  if (!live.active.value) live.preview(withPreviewImportant(css), origin)
  pendingCommittedCss = css
  committedPreviewHeld = true
  opacityPersisting.value = true
  opacitySaveError.value = ""
  const committedValue = css ? { type: "string" as const, value: css } : undefined
  const options = commitOptions(historyBoundary, deletes)
  let result: ComposerStyleCommitResult
  try {
    result = props.commitStyle
      ? await props.commitStyle(committedValue, options)
      : (() => {
          emit("setStyle", committedValue, true, Object.keys(options).length ? options : undefined)
          return { ok: true } as const
        })()
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : m.composer_opacity_save_failed(),
    }
  }
  if (version !== opacityCommitVersion) return result
  opacityPersisting.value = false
  const currentContext = [
    inspector?.sourceFile.value ?? "",
    inspector?.selectedPath.value ?? "",
    inspector?.activeClassName.value ?? "__element__",
    props.currentBreakpoint ?? "base",
    inspector?.selectedPseudo.value ?? "default",
  ].join(":")
  if (context !== currentContext) return result
  if (!result.ok) {
    pendingCommittedCss = null
    committedPreviewHeld = false
    opacitySaveError.value = result.error
    live.cancel()
    return result
  }
  opacitySaveError.value = ""
  live.commit(withPreviewImportant(css))
  return result
}
function commitOpacity(value: string) {
  return commitOpacityMap(setStyleProp(localMap.value, "opacity", value))
}
function previewProp(prop: string, nextValue: string) {
  if (props.disabled || props.isExpr) return
  if (prop === "opacity") opacitySaveError.value = ""
  paintMergedPreview(
    setStyleProp(localMap.value, prop, nextValue),
    nextValue.trim() ? [] : [prop],
  )
}
function commitProp(prop: string, nextValue: string) {
  if (props.disabled || props.isExpr) return
  commitMap(setStyleProp(localMap.value, prop, nextValue), false, nextValue.trim() ? [] : [prop])
}
function applyStyleUpdates(updates: Record<string, string>) {
  let next = { ...localMap.value }
  for (const [prop, nextValue] of Object.entries(updates)) {
    next = setStyleProp(next, prop, nextValue)
  }
  return next
}
function deletedKeysFrom(updates: Record<string, string>): string[] {
  return Object.entries(updates)
    .filter(([, value]) => !String(value).trim())
    .map(([key]) => key)
}
function previewProps(updates: Record<string, string>) {
  if (props.disabled || props.isExpr) return
  paintMergedPreview(applyStyleUpdates(updates), deletedKeysFrom(updates))
}
function commitProps(updates: Record<string, string>) {
  if (props.disabled || props.isExpr) return
  commitMap(applyStyleUpdates(updates), false, deletedKeysFrom(updates))
}
function resetSection(section: StyleSection) {
  if (live.active.value) live.cancel()
  let next = { ...localMap.value }
  const deletedKeys = sectionProperties(section)
  for (const prop of deletedKeys) {
    next = setStyleProp(next, prop, "")
  }
  commitMap(next, true, deletedKeys)
  if (section.id === "filter") filterResetEpoch.value += 1
}
async function resetOpacitySection(section: StyleSection): Promise<void> {
  let next = { ...localMap.value }
  for (const prop of sectionProperties(section)) {
    next = setStyleProp(next, prop, "")
  }
  await commitOpacityMap(next, true)
}
function scrub(event: PointerEvent, field: StyleField) {
  if (props.disabled || props.isExpr) return
  const raw = value(field.prop) || field.placeholder || "0"
  const match = raw.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/)
  if (!match) return
  const origin = Number(match[1])
  const unit = match[2] ?? ""
  if (!Number.isFinite(origin)) return
  const step = field.prop === "opacity" ? 0.01 : 1
  const format = (number: number) => `${step < 1 ? Number(number.toFixed(2)) : Math.round(number)}${unit}`
  beginPointerScrub({
    event, value: origin, step, pixelsPerStep: 2,
    onPreview: (number) => previewProp(field.prop, format(number)),
    onCommit: (number) => commitProp(field.prop, format(number)),
    onCancel: () => live.cancel(),
  })
}
function scrubTypography(event: PointerEvent, prop: "font-size" | "line-height" | "letter-spacing") {
  const raw = value(prop) || (prop === "line-height" ? "1.5" : "0")
  const match = raw.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/)
  if (!match) return
  const origin = Number(match[1])
  const unit = match[2] ?? ""
  if (!Number.isFinite(origin)) return
  const step = !unit && prop === "line-height" ? 0.1 : ["em", "rem"].includes(unit) ? 0.01 : 1
  const precision = step === 0.01 ? 2 : step === 0.1 ? 1 : 0
  const format = (number: number) => `${Number(number.toFixed(precision))}${unit}`
  beginPointerScrub({
    event,
    value: origin,
    step,
    pixelsPerStep: 2,
    onPreview: (number) => previewProp(prop, format(number)),
    onCommit: (number) => commitProp(prop, format(number)),
    onCancel: () => live.cancel(),
  })
}
function setHeadingLevel(level: number) {
  if (headingLevel.value !== level) doc?.setSelectedTag(`h${level}`)
}
</script>

<template>
  <div v-if="isExpr" class="border-y border-dashed border-border bg-muted/50 px-3 py-4 text-[11px] leading-relaxed text-muted-foreground">
    {{ m.composer_inspector_expression_style_hint() }}
  </div>
  <div v-else>
    <InspectorPropertySection
      v-for="section in visibleSections"
      :key="section.id"
      :title="sectionLabel(section)"
      :open="activeSection === section.id"
      :has-changes="sectionHasChanges(section)"
      :show-reset="activeSection === section.id && sectionState(section).canReset"
      :reset-disabled="section.id === 'opacity' && opacityPersisting"
      :reset-label="m.composer_inspector_reset_section({ section: sectionLabel(section) })"
      @update:open="$event ? (activeSection = section.id) : activeSection === section.id && (activeSection = null)"
      @reset="section.id === 'opacity' ? void resetOpacitySection(section) : resetSection(section)"
    >
      <template #actions>
        <InspectorBreakpointIndicators
          v-if="breakpointStyles?.length"
          :breakpoints="sectionState(section).overrideBreakpoints"
          @select="emit('selectBreakpoint', $event)"
        />
      </template>
      <div v-if="section.id === 'popover'" class="space-y-3">
        <label class="grid grid-cols-[68px_1fr] items-center gap-2">
          <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Placement</span>
          <Select :model-value="popoverPlacement" :disabled="disabled" @update:model-value="setPopoverPlacement">
            <SelectTrigger class="h-8 text-xs" aria-label="Popover placement"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="[placement, label] in popoverPlacementOptions" :key="placement" :value="placement">{{ label }}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label class="grid grid-cols-[68px_1fr] items-center gap-2">
          <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Gap</span>
          <Input :model-value="value('margin')" class="h-8 text-xs" placeholder="0.75rem" :disabled="disabled" @update:model-value="previewProps({ margin: String($event) })" @change="commitProps({ margin: ($event.target as HTMLInputElement).value })" />
        </label>
        <p class="text-[11px] leading-relaxed text-muted-foreground">Placement follows the button that opened this native popover and flips when space is limited.</p>
      </div>
      <ComposerTypographyControls
        v-if="section.id === 'typography'"
        :values="typographyValues"
        :inherited-properties="inheritedTypographyProperties"
        :font-options="design?.fontOptions.value ?? []"
        :heading-level="headingLevel"
        :disabled="disabled"
        @preview="previewProp"
        @commit="commitProp"
        @scrub="scrubTypography"
        @heading-level="setHeadingLevel"
      />
      <ComposerDisplayControls
        v-else-if="section.id === 'display'"
        :values="displayValues"
        :inherited-properties="inheritedDisplayProperties"
        :parent-is-grid="parentIsGrid"
        :element-tag="elementTag"
        :disabled="disabled"
        @preview="previewProp"
        @commit="commitProp"
      />
      <ComposerSizeControls
        v-else-if="section.id === 'size'"
        :values="sizeValues"
        :inherited-properties="inheritedSizeProperties"
        :reset-key="sizeResetKey"
        :cancel-epoch="sizeCancelEpoch"
        :disabled="disabled"
        @mode="onSizeMode"
        @preview="patchSize($event, true)"
        @commit="patchSize($event, false)"
        @cancel="live.cancel()"
      />
      <ComposerBackgroundControls
        v-else-if="section.id === 'background'"
        :key="sizeResetKey"
        :values="backgroundValues"
        :inherited-properties="inheritedBackgroundProperties"
        :disabled="disabled"
        @preview="previewProps"
        @commit="commitProps"
      />
      <ComposerBorderControls
        v-else-if="section.id === 'border'"
        :key="sizeResetKey"
        :values="borderValues"
        :inherited-properties="inheritedBorderProperties"
        :reset-key="sizeResetKey"
        :disabled="disabled"
        @preview="previewProps"
        @commit="commitProps"
        @cancel="live.cancel()"
      />
      <ComposerCornerControls
        v-else-if="section.id === 'corner'"
        :styles="localMap"
        :inherited-styles="inheritedMap"
        :resolved-physical-radius="cornerResolvedPhysicalRadius"
        :logical-radius-resolution-failed="cornerLogicalResolutionFailed"
        :reset-key="sizeResetKey"
        :disabled="disabled"
        @preview="previewProps"
        @commit="commitProps"
        @cancel="live.cancel()"
      />
      <ComposerShadowControls
        v-else-if="section.id === 'shadow'"
        :values="shadowValues"
        :inherited-properties="inheritedShadowProperties"
        :reset-key="sizeResetKey"
        :disabled="disabled"
        @preview="previewProps"
        @commit="commitProps"
        @cancel="live.cancel()"
      />
      <ComposerFilterControls
        v-else-if="section.id === 'filter'"
        :key="filterResetKey"
        :values="filterValues"
        :inherited-properties="inheritedFilterProperties"
        :reset-key="filterResetKey"
        :disabled="disabled"
        @preview="previewProps"
        @commit="commitProps"
        @cancel="live.cancel()"
      />
      <ComposerOpacityControls
        v-else-if="section.id === 'opacity'"
        :model-value="value('opacity') || '1'"
        :variable-options="opacityVariableOptions"
        :inherited="isInherited('opacity')"
        :disabled="disabled"
        :persisting="opacityPersisting"
        :external-error="opacitySaveError"
        :preview-value="(value) => previewProp('opacity', value)"
        :commit-value="commitOpacity"
        :cancel-preview="() => { live.cancel() }"
      />

      <template v-else>
      <ComposerTransformControls
        v-if="section.id === 'transform'"
        :transform="value('transform')"
        :transform-origin="value('transform-origin')"
        :translate="value('translate')"
        :rotate="value('rotate')"
        :scale="value('scale')"
        :inherited-transform="getStyleProp(inheritedMap, 'transform')"
        :inherited-transform-origin="getStyleProp(inheritedMap, 'transform-origin')"
        :reset-key="`${previewPath ?? ''}:${currentBreakpoint ?? 'base'}`"
        :disabled="disabled"
        @preview="previewProps"
        @commit="commitProps"
        @cancel="live.cancel()"
      />

      <div v-if="section.id === 'spacing'" class="mb-3 space-y-4">
        <ComposerLinkedSides
          v-model:linked="marginLinked"
          label="Margin"
          property="margin"
          :values="spacingValues('margin')"
          :disabled="disabled"
          @preview="previewProps"
          @commit="commitProps"
          @cancel="live.cancel()"
        />
        <ComposerLinkedSides
          v-model:linked="paddingLinked"
          label="Padding"
          property="padding"
          :values="spacingValues('padding')"
          :disabled="disabled"
          @preview="previewProps"
          @commit="commitProps"
          @cancel="live.cancel()"
        />
      </div>

      <ComposerPositionControls
        v-else-if="section.id === 'position'"
        :values="positionValues"
        :disabled="disabled"
        @preview="previewProps"
        @commit="commitProps"
        @cancel="live.cancel()"
      />

      <div v-if="section.fields.length" class="grid grid-cols-2 gap-2">
        <ComposerStyleField
          v-for="field in section.fields"
          :key="field.prop"
          :label="field.label"
          :model-value="value(field.prop)"
          :placeholder="field.placeholder"
          :options="field.options"
          :scrub="field.scrub"
          :media-picker="field.mediaPicker"
          :inherited="isInherited(field.prop)"
          :unitless="field.unitless"
          :units="field.units"
          :disabled="disabled"
          @preview="previewProp(field.prop, $event)"
          @commit="commitProp(field.prop, $event)"
          @scrub="scrub($event, field)"
        />
      </div>
      </template>
    </InspectorPropertySection>
  </div>
</template>
