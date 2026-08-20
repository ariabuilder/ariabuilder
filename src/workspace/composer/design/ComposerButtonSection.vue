<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { ColorField } from "@/components/ui/color-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { IconPickerDialog } from "@/components/ui/icon-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import { resolveProjectIcons } from "@/lib/design"
import { normalizeIconValue } from "@/lib/pickers/iconPicker"
import { GLOBAL_STYLE_BUTTON_VARIANTS } from "../../../../shared/design"
import {
  allocNodeId,
  clearManagedNativeButtonIconAuthoring,
  clearNativeButtonPopover,
  NATIVE_BUTTON_ICON_CSS_PROPERTIES,
  isBooleanChecked,
  isComposerButtonNode,
  nativeButtonIconValue,
  parseSanitizedSvg,
  listComposerPopoverTargets,
  nodeAtMarkerPath,
  resetElementButtonAtPath,
  resolveComposerButtonPropNames,
  setElementLinkAtPath,
  setNativeButtonIconAtPath,
  setNativeButtonIconSettingAtPath,
  setNativeButtonIconSideAtPath,
  setNativeButtonIconSpaceBetweenAtPath,
  setNativeButtonPopover,
  setNativeButtonPopoverAction,
  setPropAtPath,
  stringFieldDisplay,
  type ComposerButtonNode,
  type ElementLinkValue,
  type ComposerPopoverAction,
} from "../../../../shared/composer"
import type { ElementNode, PropField } from "../../../../shared/composer/types"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import { beginPointerScrub, useInspectorLiveStyleSession } from "../inspector/useInspectorLiveStyleSession"
import InspectorPropertySection from "./InspectorPropertySection.vue"

const props = withDefaults(defineProps<{
  node: ComposerButtonNode
  openSection?: string | null
  disabled?: boolean
  contentOnly?: boolean
  schemaFields?: PropField[]
}>(), { contentOnly: false, schemaFields: () => [] })
const emit = defineEmits<{ "update:openSection": [value: string | null] }>()
const inspector = tryUseInspectorContext()
const pickerOpen = ref(false)

const selectableVariants = GLOBAL_STYLE_BUTTON_VARIANTS.filter((variant) => variant !== "disabled")
const isComponent = computed(() => props.node.kind === "component")
const propNames = computed(() => resolveComposerButtonPropNames(props.node, props.schemaFields))
const variantPropName = computed(() => propNames.value.variant)
const sizePropName = computed(() => propNames.value.size)
const iconPropName = computed(() => propNames.value.icon)
const iconPositionPropName = computed(() => propNames.value.iconPosition)
const iconGapPropName = computed(() => propNames.value.iconGap)
const iconSizePropName = computed(() => propNames.value.iconSize)
const iconColorPropName = computed(() => propNames.value.iconColor)
const iconSpaceBetweenPropName = computed(() => propNames.value.iconSpaceBetween)
const hrefPropName = computed(() => propNames.value.href)
const ariaLabelPropName = computed(() => propNames.value.ariaLabel)

const variantOptions = computed(() => {
  const schemaOptions = props.schemaFields.find((field) => field.name === variantPropName.value)?.options
  return schemaOptions?.length ? schemaOptions : selectableVariants
})
const variantDefault = computed(() => {
  const value = props.schemaFields.find((field) => field.name === variantPropName.value)?.default
  return typeof value === "string" ? value : "primary"
})
const sizeOptions = computed(() => {
  const schemaOptions = props.schemaFields.find((field) => field.name === sizePropName.value)?.options
  return schemaOptions?.length ? schemaOptions : ["sm", "default", "lg", "icon"]
})
const sizeDefault = computed(() => {
  const value = props.schemaFields.find((field) => field.name === sizePropName.value)?.default
  return typeof value === "string" ? value : "default"
})
function optionLabel(value: string): string {
  const known: Record<string, string> = {
    sm: "Small",
    lg: "Large",
    default: "Default",
    icon: "Icon",
  }
  return known[value] ?? value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

const nativeIconChild = computed(() => props.node.kind === "element"
  ? (props.node.children ?? []).find((child) => child.kind === "element" && stringFieldDisplay(child.props?.["data-aria-button-icon"]).text === "true") ?? null
  : null)
const componentIconProp = computed(() => iconPropName.value ? props.node.props[iconPropName.value] : undefined)
const selectedIconValue = computed(() => isComponent.value
  ? stringFieldDisplay(componentIconProp.value).text
  : nativeButtonIconValue(nativeIconChild.value))
const hasIcon = computed(() => Boolean(nativeIconChild.value || stringFieldDisplay(componentIconProp.value).text))
const iconIsDynamic = computed(() => {
  if (isComponent.value) return Boolean(componentIconProp.value && componentIconProp.value.type !== "string")
  if (props.node.kind !== "element") return false
  return Boolean(
    props.node.props.style && props.node.props.style.type !== "string"
    || nativeIconChild.value?.kind === "element" && (
      nativeIconChild.value.props.style && nativeIconChild.value.props.style.type !== "string"
      || nativeIconChild.value.props["data-aria-button-icon-value"]
        && nativeIconChild.value.props["data-aria-button-icon-value"]?.type !== "string"
    ),
  )
})

const iconSideOptions = [
  { value: "left", label: "Icon on left", icon: "arrowLeft" },
  { value: "right", label: "Icon on right", icon: "arrowRight" },
] as const
const iconSideValue = computed<"left" | "right">(() =>
  stringFieldDisplay(props.node.props[iconPositionPropName.value]).text === "right" ? "right" : "left",
)
const iconSizeValue = computed(() => stringFieldDisplay(props.node.props[iconSizePropName.value]).text)
const iconColorValue = computed(() => stringFieldDisplay(props.node.props[iconColorPropName.value]).text)
const iconGapValue = computed(() => stringFieldDisplay(props.node.props[iconGapPropName.value]).text)
const iconSizeDraft = ref(iconSizeValue.value)
const iconGapDraft = ref(iconGapValue.value)
const iconError = ref("")
const iconPreviewPath = computed(() => inspector?.selectedPath.value ?? null)
const iconPreview = useInspectorLiveStyleSession({
  path: iconPreviewPath,
  preview: (path, cssText) => inspector?.preview.style?.(path, cssText),
  clear: (path) => inspector?.preview.clearStyle?.(path),
  onCancel: () => {
    iconSizeDraft.value = iconSizeValue.value
    iconGapDraft.value = iconGapValue.value
  },
})

watch(iconSizeValue, (value) => { if (!iconPreview.active.value) iconSizeDraft.value = value })
watch(iconGapValue, (value) => { if (!iconPreview.active.value) iconGapDraft.value = value })

const labelProp = computed(() => isComponent.value ? props.node.props[propNames.value.label] : undefined)
function isManagedNativeIcon(node: NonNullable<ComposerButtonNode["children"]>[number]): boolean {
  return node.kind === "element"
    && stringFieldDisplay(node.props["data-aria-button-icon"]).text === "true"
}
const labelChildren = computed(() => (props.node.children ?? []).filter((child) => !isManagedNativeIcon(child)))
const simpleTextChild = computed(() => {
  const children = labelChildren.value
  return children.length === 1 && children[0]?.kind === "text"
    ? children[0]
    : null
})
const labelValue = computed(() => labelProp.value
  ? stringFieldDisplay(labelProp.value).text
  : simpleTextChild.value?.value ?? "")
const labelIsDynamic = computed(() => Boolean(
  labelProp.value && labelProp.value.type !== "string"
  || labelChildren.value.length > 0 && !simpleTextChild.value,
))

const hrefProp = computed(() => props.node.props[hrefPropName.value])
const href = computed(() => stringFieldDisplay(hrefProp.value).text)
const hrefIsDynamic = computed(() => Boolean(hrefProp.value && hrefProp.value.type !== "string"))
const targetBlank = computed(() => stringFieldDisplay(props.node.props.target).text === "_blank")
const targetIsDynamic = computed(() => Boolean(props.node.props.target && props.node.props.target.type !== "string"))
const relValue = computed(() => stringFieldDisplay(props.node.props.rel).text)
const relTokens = computed(() => new Set(relValue.value.split(/\s+/).filter(Boolean)))
const linkAdvancedIsDynamic = computed(() => ["rel", "title", "download"].some((name) => {
  const value = props.node.props[name]
  return Boolean(value && value.type !== "string" && !(name === "download" && value.type === "bare"))
}))
const nativeAction = computed<"none" | "link" | "popover">(() => {
  if (isComponent.value || props.node.kind !== "element") return "none"
  if (props.node.props.popovertarget != null) return "popover"
  if (props.node.name.toLowerCase() === "a" || href.value) return "link"
  return "none"
})
const nativeActionOptions = [
  { value: "none", label: "None", icon: "dashedLine" },
  { value: "link", label: "Link", icon: "link" },
  { value: "popover", label: "Popover", icon: "target" },
] as const
const popoverTargets = computed(() => inspector?.document.model.value
  ? listComposerPopoverTargets(inspector.document.model.value)
  : [])
const currentPopoverTarget = computed(() => {
  const id = stringFieldDisplay(props.node.props.popovertarget).text
  return popoverTargets.value.find((target) => target.id === id) ?? null
})
const popoverTargetIsDynamic = computed(() => Boolean(
  props.node.props.popovertarget && props.node.props.popovertarget.type !== "string",
))
const popoverAction = computed(() => {
  const value = stringFieldDisplay(props.node.props.popovertargetaction).text
  return value === "show" || value === "hide" ? value : "toggle"
})

const componentOwnedProps = computed(() => [...new Set([
  variantPropName.value, sizePropName.value, iconPropName.value,
  iconPositionPropName.value, iconGapPropName.value, iconSpaceBetweenPropName.value,
  iconSizePropName.value, iconColorPropName.value, "disabled", ariaLabelPropName.value,
  hrefPropName.value, "target", "rel", "title", "download",
].filter((name): name is string => Boolean(name)))])
const nativeOwnedProps = [
  "data-button-variant", "data-button-size", "data-button-icon-position",
  "data-button-icon-gap", "data-button-icon-size", "data-button-icon-color",
  "data-button-icon-space-between", "disabled", "aria-label", "href", "target", "rel",
  "title", "download",
  "popovertarget", "popovertargetaction",
] as const
const ownedProps = computed<readonly string[]>(() => isComponent.value ? componentOwnedProps.value : nativeOwnedProps)
const hasChanges = computed(() => Boolean(
  hasIcon.value || ownedProps.value.some((name) => props.node.props[name] != null),
))
const resetDisabled = computed(() => props.disabled || iconIsDynamic.value || ownedProps.value.some((name) => {
  const value = props.node.props[name]
  return value != null && value.type !== "string" && value.type !== "bare"
}))

function propIsDynamic(name: string, allowBare = false) {
  const value = props.node.props[name]
  return Boolean(value && value.type !== "string" && !(allowBare && value.type === "bare"))
}

function setString(name: string, value: unknown) {
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || props.disabled) return
  const next = String(value)
  inspector.document.commitInspectorMutation(`Edit button ${name}`, (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    const current = node && "props" in node ? node.props[name] : undefined
    if (!isComposerButtonNode(node) || node.id !== nodeId) return { ok: false, selectPath: path, reason: "Button selection changed" }
    if (current && current.type !== "string") return { ok: false, selectPath: path, reason: `${name} is expression-bound` }
    return setPropAtPath(model, path, name, next ? { type: "string", value: next } : undefined)
  }, { immediate: true, coalesceKey: null })
}

function setBoolean(name: string, value: boolean) {
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || props.disabled) return
  inspector.document.commitInspectorMutation(`Edit button ${name}`, (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    const current = node && "props" in node ? node.props[name] : undefined
    if (!isComposerButtonNode(node) || node.id !== nodeId) return { ok: false, selectPath: path, reason: "Button selection changed" }
    if (current && current.type !== "string" && current.type !== "bare") return { ok: false, selectPath: path, reason: `${name} is expression-bound` }
    return setPropAtPath(model, path, name, value ? { type: "bare" } : undefined)
  }, { immediate: true, coalesceKey: null })
}

function setLabel(value: unknown) {
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || props.disabled || labelIsDynamic.value) return
  const next = String(value)
  inspector.document.commitInspectorMutation("Edit button label", (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    if (!isComposerButtonNode(node) || node.id !== nodeId) return { ok: false, selectPath: path, reason: "Button selection changed" }
    const existingLabel = node.kind === "component" ? node.props[propNames.value.label] : undefined
    if (existingLabel) {
      if (existingLabel.type !== "string") return { ok: false, selectPath: path, reason: "Button label is expression-bound" }
      node.props[propNames.value.label] = { type: "string", value: next }
      return { ok: true, selectPath: path }
    }
    const contentChildren = (node.children ?? []).filter((child) => !isManagedNativeIcon(child))
    if (contentChildren.length === 1 && contentChildren[0]?.kind === "text") {
      contentChildren[0].value = next
      return { ok: true, selectPath: path }
    }
    if (node.kind === "component" && node.children === null) {
      node.props[propNames.value.label] = { type: "string", value: next }
      return { ok: true, selectPath: path }
    }
    if (Array.isArray(node.children) && contentChildren.length === 0) {
      node.children.push({ id: allocNodeId(), kind: "text", value: next })
      return { ok: true, selectPath: path }
    }
    return { ok: false, selectPath: path, reason: "Formatted button content must be edited in Code" }
  }, { immediate: false, coalesceKey: `button-label:${path}` })
}

function currentLinkValue(node: ElementNode, nextHref: string, nextTargetBlank = targetBlank.value): ElementLinkValue | null {
  if (!nextHref) return null
  const currentRel = node.props.rel
  const nextRelTokens = currentRel && currentRel.type !== "string"
    ? null
    : new Set(stringFieldDisplay(currentRel).text.split(/\s+/).filter(Boolean))
  if (nextRelTokens && nextTargetBlank && /^https?:\/\//i.test(nextHref)) nextRelTokens.add("noopener")
  return {
    href: { type: "string", value: nextHref },
    target: { type: "string", value: nextTargetBlank ? "_blank" : "_self" },
    rel: nextRelTokens
      ? nextRelTokens.size ? { type: "string", value: [...nextRelTokens].join(" ") } : undefined
      : currentRel,
    title: node.props.title,
    download: node.props.download,
  }
}

function setHref(value: unknown) {
  const next = String(value).trim()
  if (isComponent.value) {
    setString(hrefPropName.value, next)
    return
  }
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || props.disabled || hrefIsDynamic.value || targetIsDynamic.value) return
  inspector.document.commitInspectorMutation("Edit button URL", (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    if (!isComposerButtonNode(node) || node.kind !== "element" || node.id !== nodeId) return { ok: false, selectPath: path, reason: "Button selection changed" }
    return setElementLinkAtPath(model, path, currentLinkValue(node, next))
  }, { immediate: true, coalesceKey: null })
}

function setTargetBlank(value: boolean) {
  if (props.disabled || !href.value || hrefIsDynamic.value || targetIsDynamic.value || linkAdvancedIsDynamic.value) return
  if (isComponent.value) {
    setString("target", value ? "_blank" : "_self")
    return
  }
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path) return
  inspector.document.commitInspectorMutation("Edit button target", (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    if (!isComposerButtonNode(node) || node.kind !== "element" || node.id !== nodeId) return { ok: false, selectPath: path, reason: "Button selection changed" }
    return setElementLinkAtPath(model, path, currentLinkValue(node, href.value, value))
  }, { immediate: true, coalesceKey: null })
}

function setRelToken(token: "noopener" | "noreferrer" | "nofollow", enabled: boolean) {
  if (linkAdvancedIsDynamic.value) return
  const next = new Set(relTokens.value)
  if (enabled) next.add(token)
  else next.delete(token)
  setString("rel", [...next].join(" "))
}

function setNativeAction(value: unknown) {
  const action = String(value) as "none" | "link" | "popover"
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || props.disabled || isComponent.value) return
  inspector.document.commitInspectorMutation(`Set button action to ${action}`, (model) => {
    const current = nodeAtMarkerPath(model.nodes, path)
    if (!isComposerButtonNode(current) || current.kind !== "element" || current.id !== nodeId) {
      return { ok: false, selectPath: path, reason: "Button selection changed" }
    }
    if (action === "link") {
      const cleared = clearNativeButtonPopover(model, path)
      if (!cleared.ok) return cleared
      const refreshed = nodeAtMarkerPath(model.nodes, path)
      if (!refreshed || refreshed.kind !== "element") return { ok: false, selectPath: path, reason: "Button is unavailable" }
      if (refreshed.props["data-button-variant"] == null) {
        refreshed.props["data-button-variant"] = { type: "string", value: "primary" }
      }
      return setElementLinkAtPath(model, path, currentLinkValue(refreshed, href.value || "#"))
    }
    if (current.name.toLowerCase() === "a") {
      const unlinked = setElementLinkAtPath(model, path, null)
      if (!unlinked.ok) return unlinked
    }
    const button = nodeAtMarkerPath(model.nodes, path)
    if (!button || button.kind !== "element") return { ok: false, selectPath: path, reason: "Button is unavailable" }
    delete button.props.href
    delete button.props.target
    delete button.props.rel
    delete button.props.download
    if (action === "none") return clearNativeButtonPopover(model, path)
    const target = popoverTargets.value[0]
    return target
      ? setNativeButtonPopover(model, path, target.path, "toggle")
      : { ok: true, selectPath: path }
  }, { immediate: true, coalesceKey: null })
}

function nativeActionDisabled(action: typeof nativeActionOptions[number]["value"]): boolean {
  if (props.disabled || popoverTargetIsDynamic.value) return true
  return action === "popover" && !popoverTargets.value.length && nativeAction.value !== "popover"
}

function onNativeActionKeydown(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
  event.preventDefault()
  const enabled = nativeActionOptions.filter((option) => !nativeActionDisabled(option.value))
  if (!enabled.length) return
  const currentIndex = Math.max(0, enabled.findIndex((option) => option.value === nativeAction.value))
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? enabled.length - 1
      : (currentIndex + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + enabled.length) % enabled.length
  const next = enabled[nextIndex]
  if (!next) return
  const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
  group?.querySelector<HTMLButtonElement>(`[data-button-action="${next.value}"]`)?.focus()
  setNativeAction(next.value)
}

function onIconSideKeydown(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
  event.preventDefault()
  const currentIndex = iconSideOptions.findIndex((option) => option.value === iconSideValue.value)
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? iconSideOptions.length - 1
      : (currentIndex + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + iconSideOptions.length) % iconSideOptions.length
  const next = iconSideOptions[nextIndex]
  if (!next) return
  const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
  group?.querySelector<HTMLButtonElement>(`[data-icon-side="${next.value}"]`)?.focus()
  setIconSide(next.value)
}

function setPopoverTarget(value: unknown) {
  const path = inspector?.selectedPath.value
  const targetPath = String(value)
  if (!path || !targetPath || props.disabled || popoverTargetIsDynamic.value) return
  inspector.document.commitInspectorMutation("Set popover target", (model) =>
    setNativeButtonPopover(model, path, targetPath, popoverAction.value as ComposerPopoverAction),
  { immediate: true, coalesceKey: null })
}

function setPopoverAction(value: unknown) {
  const path = inspector?.selectedPath.value
  if (!path || props.disabled || popoverTargetIsDynamic.value) return
  inspector.document.commitInspectorMutation("Set popover trigger behavior", (model) =>
    setNativeButtonPopoverAction(model, path, String(value) as ComposerPopoverAction),
  { immediate: true, coalesceKey: null })
}

function revealPopover() {
  if (currentPopoverTarget.value) {
    inspector?.selection.illuminate(currentPopoverTarget.value.path, { source: "api" })
  }
}

function previewIconSetting(setting: "size" | "color" | "gap", value: string) {
  const trimmed = value.trim()
  if (setting === "size") iconSizeDraft.value = value
  if (setting === "gap") iconGapDraft.value = value
  iconPreview.preview(`${NATIVE_BUTTON_ICON_CSS_PROPERTIES[setting]}: ${trimmed || "initial"}`)
}

function commitIconSetting(setting: "size" | "color" | "gap", value: string) {
  const trimmed = value.trim()
  if (setting === "size") iconSizeDraft.value = trimmed
  if (setting === "gap") iconGapDraft.value = trimmed
  iconPreview.commit(`${NATIVE_BUTTON_ICON_CSS_PROPERTIES[setting]}: ${trimmed || "initial"}`)
  const propName = setting === "size"
    ? iconSizePropName.value
    : setting === "color"
      ? iconColorPropName.value
      : iconGapPropName.value
  if (isComponent.value) {
    setString(propName, trimmed)
    return
  }
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || props.disabled || iconIsDynamic.value) return
  inspector.document.commitInspectorMutation(`Edit button icon ${setting}`, (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    if (node?.kind !== "element" || node.id !== nodeId) return { ok: false, selectPath: path, reason: "Button selection changed" }
    return setNativeButtonIconSettingAtPath(model, path, setting, trimmed)
  }, { immediate: true, coalesceKey: null })
}

function formatIconMetric(value: number, unit: string): string {
  const rounded = Math.round(Math.max(0, value) * 100) / 100
  return `${rounded}${unit}`
}

function isScrubbableIconMetric(value: string): boolean {
  return /^-?(?:\d+\.?\d*|\.\d+)[a-zA-Z%]+$/.test(value.trim()) || !value.trim()
}

function beginIconMetricScrub(setting: "size" | "gap", event: MouseEvent) {
  if (props.disabled || iconIsDynamic.value || !(event.target instanceof HTMLInputElement)) return
  const raw = (setting === "size" ? iconSizeDraft.value : iconGapDraft.value)
    || (setting === "size" ? "1em" : "0.5rem")
  const match = raw.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))([a-zA-Z%]+)$/)
  if (!match) return
  const origin = Number.parseFloat(match[1] ?? "0")
  const unit = match[2] ?? "px"
  const step = unit === "em" || unit === "rem" ? 0.05 : 1
  beginPointerScrub({
    event,
    value: origin,
    step,
    pixelsPerStep: 1,
    onPreview: (number) => previewIconSetting(setting, formatIconMetric(number, unit)),
    onCommit: (number) => commitIconSetting(setting, formatIconMetric(number, unit)),
    onCancel: () => iconPreview.cancel(),
  })
}

function setIconSide(side: "left" | "right") {
  if (isComponent.value) {
    setString(iconPositionPropName.value, side)
    return
  }
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || props.disabled || iconIsDynamic.value) return
  inspector.document.commitInspectorMutation("Set button icon side", (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    if (node?.kind !== "element" || node.id !== nodeId) return { ok: false, selectPath: path, reason: "Button selection changed" }
    return setNativeButtonIconSideAtPath(model, path, side)
  }, { immediate: true, coalesceKey: null })
}

function setIconSpaceBetween(enabled: boolean) {
  if (isComponent.value) {
    setBoolean(iconSpaceBetweenPropName.value, enabled)
    return
  }
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || props.disabled || iconIsDynamic.value) return
  inspector.document.commitInspectorMutation("Set button icon spacing", (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    if (node?.kind !== "element" || node.id !== nodeId) return { ok: false, selectPath: path, reason: "Button selection changed" }
    return setNativeButtonIconSpaceBetweenAtPath(model, path, enabled)
  }, { immediate: true, coalesceKey: null })
}

function decodeSvgDataUrl(value: string): string {
  const comma = value.indexOf(",")
  if (comma < 0) return ""
  const metadata = value.slice(0, comma)
  const payload = value.slice(comma + 1)
  return /;base64$/i.test(metadata) ? atob(payload) : decodeURIComponent(payload)
}

async function chooseIcon(value: string, resolvedDataUrl?: string) {
  if (isComponent.value && iconPropName.value) {
    setString(iconPropName.value, value)
    return
  }
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || props.disabled || iconIsDynamic.value) return
  iconError.value = ""
  if (!value) {
    clearIcon()
    return
  }
  let source: ElementNode
  try {
    const isUrl = /^(?:https?:\/\/|\/|\.\/|\.\.\/|data:image\/)/i.test(value)
    const iconId = normalizeIconValue(value)
    const dataUrl = resolvedDataUrl || (!isUrl
      ? (await resolveProjectIcons(inspector?.projectPath.value ?? "", [iconId])).icons[iconId]?.dataUrl
      : "")
    if (dataUrl) {
      const parsed = parseSanitizedSvg(decodeSvgDataUrl(dataUrl))
      if (!parsed.ok) throw new Error(parsed.error)
      source = parsed.node
    } else if (isUrl) {
      source = {
        id: allocNodeId(), kind: "element", name: "img",
        props: { src: { type: "string", value }, alt: { type: "string", value: "" } },
        children: null,
      }
    } else {
      throw new Error("The selected icon could not be resolved.")
    }
  } catch (cause) {
    iconError.value = cause instanceof Error ? cause.message : "The selected icon could not be added."
    return
  }
  if (inspector?.selectedPath.value !== path) return
  inspector.document.commitInspectorMutation("Choose button icon", (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    if (!isComposerButtonNode(node) || node.kind !== "element" || node.id !== nodeId || !Array.isArray(node.children)) return { ok: false, selectPath: path, reason: "Button is unavailable" }
    return setNativeButtonIconAtPath(model, path, source, value)
  }, { immediate: true, coalesceKey: null })
}

function clearIcon() {
  if (isComponent.value && iconPropName.value) {
    setString(iconPropName.value, "")
    return
  }
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || props.disabled || iconIsDynamic.value) return
  inspector.document.commitInspectorMutation("Remove button icon", (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    if (!isComposerButtonNode(node) || node.kind !== "element" || node.id !== nodeId || !Array.isArray(node.children)) return { ok: false, selectPath: path, reason: "Button is unavailable" }
    clearManagedNativeButtonIconAuthoring(node)
    return { ok: true, selectPath: path }
  }, { immediate: true, coalesceKey: null })
}

function resetButton() {
  const path = inspector?.selectedPath.value
  const nodeId = props.node.id
  if (!path || resetDisabled.value) return
  inspector.document.commitInspectorMutation("Reset button", (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    if (!isComposerButtonNode(node) || node.id !== nodeId) return { ok: false, selectPath: path, reason: "Button selection changed" }
    if (node.kind === "component") {
      for (const name of componentOwnedProps.value) delete node.props[name]
      return { ok: true, selectPath: path }
    }
    if (node.name.toLowerCase() === "a") {
      const unlinked = setElementLinkAtPath(model, path, null)
      if (!unlinked.ok) return unlinked
    }
    delete node.props.popovertarget
    delete node.props.popovertargetaction
    return resetElementButtonAtPath(model, path)
  }, { immediate: true, coalesceKey: null })
}
</script>

<template>
  <InspectorPropertySection
    title="Button"
    :content-only="contentOnly"
    :open="openSection === 'button'"
    :has-changes="hasChanges"
    :show-reset="openSection === 'button' && hasChanges"
    :reset-disabled="resetDisabled"
    reset-label="Reset Button"
    @update:open="emit('update:openSection', $event ? 'button' : openSection === 'button' ? null : openSection ?? null)"
    @reset="resetButton"
  >
    <div class="space-y-3">
      <div v-if="!isComponent" class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Action</span>
        <TooltipProvider :delay-duration="0" :skip-delay-duration="0">
          <div class="flex items-center gap-1" role="radiogroup" aria-label="Button action">
            <Tooltip v-for="action in nativeActionOptions" :key="action.value">
              <TooltipTrigger as-child>
                <button
                  type="button"
                  role="radio"
                  :aria-label="action.label"
                  :aria-checked="nativeAction === action.value"
                  :tabindex="nativeAction === action.value && !nativeActionDisabled(action.value) ? 0 : -1"
                  :data-button-action="action.value"
                  :disabled="nativeActionDisabled(action.value)"
                  :class="[
                    'flex size-7 items-center justify-center rounded-sm border transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-45',
                    nativeAction === action.value
                      ? 'border-primary/70 bg-primary/10 text-primary dark:bg-primary/15'
                      : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/40 hover:text-foreground',
                  ]"
                  @click="setNativeAction(action.value)"
                  @keydown="onNativeActionKeydown"
                >
                  <AppIcon :name="action.icon" :size="16" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{{ action.label }}</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      <template v-if="!isComponent && nativeAction === 'popover'">
        <label class="grid grid-cols-[68px_1fr] items-center gap-2">
          <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Target</span>
          <Select :model-value="currentPopoverTarget?.path" :disabled="disabled || !popoverTargets.length || popoverTargetIsDynamic" @update:model-value="setPopoverTarget">
            <SelectTrigger class="h-8 text-xs" aria-label="Popover target"><SelectValue placeholder="Choose popover…" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="target in popoverTargets" :key="target.path" :value="target.path">{{ target.label }}<template v-if="target.id"> · #{{ target.id }}</template></SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label class="grid grid-cols-[68px_1fr] items-center gap-2">
          <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Behavior</span>
          <Select :model-value="popoverAction" :disabled="disabled || !currentPopoverTarget || popoverTargetIsDynamic" @update:model-value="setPopoverAction">
            <SelectTrigger class="h-8 text-xs" aria-label="Popover trigger behavior"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="toggle">Toggle</SelectItem><SelectItem value="show">Show</SelectItem><SelectItem value="hide">Hide</SelectItem></SelectContent>
          </Select>
        </label>
        <Button type="button" size="sm" variant="outline" class="h-8 w-full text-[11px]" :disabled="!currentPopoverTarget" @click="revealPopover">Go to popover</Button>
        <p v-if="!popoverTargets.length" class="text-[11px] leading-relaxed text-muted-foreground">Add a Popover to this source before assigning the button.</p>
        <p v-if="popoverTargetIsDynamic" class="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">This trigger is expression-bound. Edit it in Code before assigning a static Popover.</p>
      </template>

      <label class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Variant</span>
        <Select
          data-testid="button-variant-select"
          :model-value="stringFieldDisplay(node.props[variantPropName]).text || variantDefault"
          :disabled="disabled || propIsDynamic(variantPropName)"
          @update:model-value="setString(variantPropName, $event)"
        >
          <SelectTrigger class="h-8 text-xs" aria-label="Button variant"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="value in variantOptions" :key="value" :value="value">{{ optionLabel(value) }}</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <label v-if="isComponent" class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Size</span>
        <Select
          :model-value="stringFieldDisplay(node.props[sizePropName]).text || sizeDefault"
          :disabled="disabled || propIsDynamic(sizePropName)"
          @update:model-value="setString(sizePropName, $event)"
        >
          <SelectTrigger class="h-8 text-xs" aria-label="Button size"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="value in sizeOptions" :key="value" :value="value">{{ optionLabel(value) }}</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <label class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Label</span>
        <Input
          :model-value="labelValue"
          class="h-8 text-xs"
          :disabled="disabled || labelIsDynamic"
          :title="labelIsDynamic ? 'Formatted or expression-bound labels must be edited in Code.' : undefined"
          @update:model-value="setLabel"
        />
      </label>

      <label v-if="isComponent || nativeAction === 'link'" class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">URL</span>
        <Input
          :model-value="href"
          class="h-8 text-xs"
          type="text"
          inputmode="url"
          placeholder="/about or https://…"
          :disabled="disabled || hrefIsDynamic || targetIsDynamic"
          @change="setHref(($event.target as HTMLInputElement).value)"
        />
      </label>

      <Label v-if="href && (isComponent || nativeAction === 'link')" class="flex items-center justify-between gap-2 text-xs">
        Open in new tab
        <Switch
          :model-value="targetBlank"
          :disabled="disabled || hrefIsDynamic || targetIsDynamic || linkAdvancedIsDynamic"
          @update:model-value="setTargetBlank(Boolean($event))"
        />
      </Label>

      <div class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Icon</span>
        <div class="flex gap-1">
          <Button type="button" size="sm" variant="outline" class="h-8 flex-1" :disabled="disabled || iconIsDynamic" @click="pickerOpen = true">Choose icon</Button>
          <Button type="button" size="sm" variant="ghost" class="h-8" :disabled="disabled || iconIsDynamic || !hasIcon" aria-label="Remove button icon" @click="clearIcon">Clear</Button>
        </div>
      </div>
      <p v-if="iconError" role="alert" class="text-[10px] leading-relaxed text-destructive">{{ iconError }}</p>

      <div v-if="hasIcon" class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Icon side</span>
        <TooltipProvider :delay-duration="0" :skip-delay-duration="0">
          <div class="flex items-center gap-1" role="radiogroup" aria-label="Button icon side">
            <Tooltip v-for="side in iconSideOptions" :key="side.value">
              <TooltipTrigger as-child>
                <button
                  type="button"
                  role="radio"
                  :aria-label="side.label"
                  :aria-checked="iconSideValue === side.value"
                  :tabindex="iconSideValue === side.value ? 0 : -1"
                  :data-icon-side="side.value"
                  :disabled="disabled || iconIsDynamic || propIsDynamic(iconPositionPropName)"
                  :class="[
                    'flex size-7 items-center justify-center rounded-sm border transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-45',
                    iconSideValue === side.value
                      ? 'border-primary/70 bg-primary/10 text-primary dark:bg-primary/15'
                      : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/40 hover:text-foreground',
                  ]"
                  @click="setIconSide(side.value)"
                  @keydown="onIconSideKeydown"
                >
                  <AppIcon :name="side.icon" :size="16" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{{ side.label }}</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      <div v-if="hasIcon" class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Icon size</span>
        <VariableAssignableInput
          :model-value="iconSizeDraft"
          :input-class="['h-8 border-dashed border-border/70 bg-sidebar font-mono text-xs', isScrubbableIconMetric(iconSizeDraft) ? 'cursor-ew-resize' : 'cursor-text']"
          placeholder="1em"
          :disabled="disabled || iconIsDynamic || propIsDynamic(iconSizePropName)"
          aria-label="Button icon size"
          @update:model-value="previewIconSetting('size', String($event))"
          @commit="commitIconSetting('size', String($event))"
          @mousedown="beginIconMetricScrub('size', $event)"
        />
      </div>

      <div v-if="hasIcon" class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Icon color</span>
        <ColorField
          :model-value="iconColorValue || 'currentColor'"
          layout="unified"
          persist-mode="commit"
          show-alpha
          show-design-colors
          show-variables
          placeholder="currentColor"
          :disabled="disabled || iconIsDynamic || propIsDynamic(iconColorPropName)"
          content-side="left"
          content-align="center"
          trigger-label="Button icon color"
          @preview="previewIconSetting('color', String($event))"
          @commit="commitIconSetting('color', String($event))"
        />
      </div>

      <Label v-if="hasIcon" class="flex items-center justify-between gap-2 text-xs">
        Space between
        <Switch
          :model-value="isBooleanChecked(node.props[iconSpaceBetweenPropName], false)"
          :disabled="disabled || iconIsDynamic || propIsDynamic(iconSpaceBetweenPropName, true)"
          @update:model-value="setIconSpaceBetween(Boolean($event))"
        />
      </Label>

      <div v-if="hasIcon" class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Icon gap</span>
        <VariableAssignableInput
          :model-value="iconGapDraft"
          :input-class="['h-8 border-dashed border-border/70 bg-sidebar font-mono text-xs', isScrubbableIconMetric(iconGapDraft) ? 'cursor-ew-resize' : 'cursor-text']"
          placeholder="0.5rem"
          :disabled="disabled || iconIsDynamic || propIsDynamic(iconGapPropName)"
          aria-label="Button icon gap"
          @update:model-value="previewIconSetting('gap', String($event))"
          @commit="commitIconSetting('gap', String($event))"
          @mousedown="beginIconMetricScrub('gap', $event)"
        />
      </div>

      <Label class="flex items-center justify-between gap-2 text-xs">
        Disabled
        <Switch
          :model-value="isBooleanChecked(node.props.disabled, false)"
          :disabled="disabled || (!isComponent && node.name.toLowerCase() === 'a') || propIsDynamic('disabled', true)"
          @update:model-value="setBoolean('disabled', Boolean($event))"
        />
      </Label>

      <template v-if="href && (isComponent || nativeAction === 'link')">
        <Label class="flex items-center justify-between gap-2 text-xs">
          Download
          <Switch
            :model-value="isBooleanChecked(node.props.download, false)"
            :disabled="disabled || linkAdvancedIsDynamic"
            @update:model-value="setBoolean('download', Boolean($event))"
          />
        </Label>

        <label class="grid grid-cols-[68px_1fr] items-center gap-2">
          <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Title</span>
          <Input
            :model-value="stringFieldDisplay(node.props.title).text"
            class="h-8 text-xs"
            placeholder="Optional link title"
            :disabled="disabled || linkAdvancedIsDynamic"
            @change="setString('title', ($event.target as HTMLInputElement).value)"
          />
        </label>

        <div class="grid grid-cols-[68px_1fr] items-start gap-2">
          <span class="pt-2 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Relationship</span>
          <div class="space-y-2 rounded-md border border-dashed border-border/60 px-2.5 py-2">
            <Label class="flex items-center justify-between gap-2 text-[11px] font-normal">
              No opener
              <Switch :model-value="relTokens.has('noopener')" :disabled="disabled || linkAdvancedIsDynamic" @update:model-value="setRelToken('noopener', Boolean($event))" />
            </Label>
            <Label class="flex items-center justify-between gap-2 text-[11px] font-normal">
              No referrer
              <Switch :model-value="relTokens.has('noreferrer')" :disabled="disabled || linkAdvancedIsDynamic" @update:model-value="setRelToken('noreferrer', Boolean($event))" />
            </Label>
            <Label class="flex items-center justify-between gap-2 text-[11px] font-normal">
              No follow
              <Switch :model-value="relTokens.has('nofollow')" :disabled="disabled || linkAdvancedIsDynamic" @update:model-value="setRelToken('nofollow', Boolean($event))" />
            </Label>
          </div>
        </div>
      </template>

      <label class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">ARIA label</span>
        <Input
          :model-value="stringFieldDisplay(node.props[ariaLabelPropName]).text"
          class="h-8 text-xs"
          :disabled="disabled || propIsDynamic(ariaLabelPropName)"
          @change="setString(ariaLabelPropName, ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>
    <IconPickerDialog :open="pickerOpen" :project-root="inspector?.projectPath.value ?? ''" :value="selectedIconValue" @update:open="pickerOpen = $event" @select="chooseIcon" />
  </InspectorPropertySection>
</template>
