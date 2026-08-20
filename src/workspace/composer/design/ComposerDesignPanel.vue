<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
import { toast } from "vue-sonner"
import { m } from "@/paraglide/messages.js"
import { useVariableReferenceOptions } from "@/composables/useVariableReferenceOptions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { renameClassAcrossProject } from "@/lib/design"
import ClassManagerCssDialog from "@/workspace/design/dialogs/ClassManagerCssDialog.vue"
import ClassManagerNameDialog from "@/workspace/design/dialogs/ClassManagerNameDialog.vue"
import { useClassManagerInventory } from "@/workspace/design/composables/useClassManagerInventory"
import { createSequentialDuplicateName } from "@/workspace/design/lib/classManagerCss"
import {
  addClassName,
  appendClassListToken,
  commitStringValue,
  discoverAstroStyleClasses,
  duplicateAstroStyleClass,
  extractClassRuleCss,
  forkAriaBemModifier,
  isAriaBemBlockClass,
  isAriaBemSystemClass,
  isOpaquePropValue,
  isComposerButtonNode,
  isComposerAvatarNode,
  isComposerAlertNode,
  isComposerBadgeNode,
  isComposerPopoverTarget,
  nodeAtMarkerPath,
  parseStyleAttr,
  patchClassDeclarations,
  readAstroStyleClassDeclarations,
  readClassDeclarations,
  removeClassListTokens,
  resolveElementInspectorTarget,
  renameClassRuleCss,
  splitClassNames,
  serializeStyleAttr,
  staticClassListTokens,
  withPreviewImportant,
  stringFieldDisplay,
  setPropAtPath,
  writeAstroStyleClassDeclarations,
  writeClassDeclarations,
  type ClassRuleState,
} from "../../../../shared/composer"
import type { EditableNode, PropValue } from "../../../../shared/composer/types"
import { isComposerRichTextHost } from "../../../../shared/composer/richText"
import { tryUseComposerBridgeClasses } from "../useComposerBridgeClasses"
import { tryUseComposerDesignClasses } from "../useComposerDesignContext"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import ComposerClassEditor from "./ComposerClassEditor.vue"
import ComposerContentAttributes from "./ComposerContentAttributes.vue"
import ComposerStyleControls from "./ComposerStyleControls.vue"
import {
  composerClassTextForInspector,
  preserveComposerMotionClasses,
  resolveComposerClassTarget,
  visibleComposerClassNames,
} from "./composerClassTokens"
import {
  conflictingBorderPresentationUtilities,
  retainCompatibleBorderApplyDirectives,
} from "./composerBorder"
import type { InspectorBreakpointStyleSource } from "./inspectorSectionState"
import { createAutomaticAriaClassName } from "./autoClassName"
import type { ComposerStyleCommitResult } from "./composerOpacity"

const inspector = tryUseInspectorContext()
const bridge = tryUseComposerBridgeClasses()
const design = tryUseComposerDesignClasses()
const { variableReferenceOptions } = useVariableReferenceOptions()
const doc = inspector?.document
const projectRoot = computed(() => inspector?.projectPath.value ?? "")
const classInventory = useClassManagerInventory(projectRoot)
const openSection = ref<string | null>("display")
const cssDialogOpen = ref(false)
const nameDialogMode = ref<"rename" | "duplicate" | "fork" | null>(null)
const bemForkBlock = ref<string | null>(null)
const copiedDeclarations = ref<{ source: string; css: string } | null>(null)
let classSaveTimer: ReturnType<typeof setTimeout> | null = null
let unregisterBeforeFlush: (() => void) | null = null
let unregisterClassHeaderActions: (() => void) | null = null
const INSPECTOR_SAVE_DEBOUNCE_MS = 750
let classSaveChain: Promise<void> = Promise.resolve()
let classInventoryReady: Promise<void> = Promise.resolve()
let classActivationChain: Promise<void> = Promise.resolve()
let classActivationVersion = 0
let automaticClassCommitChain: Promise<void> = Promise.resolve()

const selectedNode = computed<EditableNode | null>(() => inspector?.selectedNode.value ?? null)
const selectedNodeIsPopover = (node: EditableNode | null | undefined): boolean =>
  isComposerPopoverTarget(node)
const selectedNodeIsButton = (node: EditableNode | null | undefined): boolean =>
  isComposerButtonNode(node)
const selectedNodeHasVariant = (node: EditableNode | null | undefined): boolean =>
  isComposerAlertNode(node) || isComposerBadgeNode(node)
const selectedNodeIsAvatar = (node: EditableNode | null | undefined): boolean =>
  isComposerAvatarNode(node)
const supportsDesign = computed(() => {
  const node = selectedNode.value
  return Boolean(node && ["element", "component", "slot", "fragment", "raw"].includes(node.kind))
})
const editable = computed(() => Boolean(
  doc?.editable.value && !inspector?.isContextSelection.value,
))
const showReadOnlyNotice = computed(
  () => !editable.value && !(doc?.mutationPending?.value ?? false),
)
const selectedPath = computed(() => inspector?.selectedPath.value ?? null)
const renderedClasses = computed(() => {
  const path = selectedPath.value
  if (!path || !bridge) return []
  const runs = bridge.pathClasses.value[path]
  const occurrence = inspector?.selection.selectedOccurrence.value ?? 0
  return visibleComposerClassNames(runs?.[occurrence] ?? runs?.[0] ?? [])
})
const inferredClassTarget = computed(() => resolveComposerClassTarget(
  doc?.model.value,
  selectedPath.value,
  renderedClasses.value,
))
const retainedClassTargetPath = ref<string | null>(null)
watch(selectedPath, () => { retainedClassTargetPath.value = null })
watch(inferredClassTarget, (target) => {
  if (target && target.path !== selectedPath.value) retainedClassTargetPath.value = target.path
}, { immediate: true })
const classTargetPath = computed(() => retainedClassTargetPath.value
  ?? inferredClassTarget.value?.path
  ?? selectedPath.value)
const classTargetNode = computed<EditableNode | null>(() => {
  const model = doc?.model.value
  const path = classTargetPath.value
  return model && path ? nodeAtMarkerPath(model.nodes, path) : selectedNode.value
})
const classNodeProps = computed(() => {
  const node = classTargetNode.value
  return node && "props" in node ? node.props ?? {} : {}
})
const selectedNodeProps = computed(() => {
  const node = selectedNode.value
  return node && "props" in node ? node.props ?? {} : {}
})
const classProp = computed<PropValue | undefined>(() => classNodeProps.value.class ?? classNodeProps.value["class:list"])
const classPropName = computed(() => classNodeProps.value.class != null ? "class" : classNodeProps.value["class:list"] != null ? "class:list" : "class")
const classDisplay = computed(() => stringFieldDisplay(classProp.value))
const classTextForInspector = computed(() => composerClassTextForInspector(
  classProp.value,
  classDisplay.value.text,
))
const classIsExpr = computed(() => classDisplay.value.isExpr || classDisplay.value.opaque || classPropName.value === "class:list")
const classOpaque = computed(() => isOpaquePropValue(classProp.value))
const rawAttachedClassNames = computed(() => classPropName.value === "class:list"
  ? staticClassListTokens(classProp.value)
  : classIsExpr.value ? [] : splitClassNames(classDisplay.value.text))
const attachedClassNames = computed(() => visibleComposerClassNames(rawAttachedClassNames.value))
const styleProp = computed<PropValue | undefined>(() => selectedNodeProps.value.style)
const styleDisplay = computed(() => stringFieldDisplay(styleProp.value))
const styleIsExpr = computed(() => styleDisplay.value.isExpr || styleDisplay.value.opaque)
const activeClassName = computed(() => inspector?.activeClassName.value ?? null)
const astroStyleClasses = computed(() => discoverAstroStyleClasses(doc?.model.value))
const activeAstroStyleClass = computed(() => {
  const name = activeClassName.value
  return name ? astroStyleClasses.value.find((item) => item.name === name) ?? null : null
})
const breakpointEntries = computed(() => Object.entries(design?.framework.value?.breakpoints ?? {
  sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536,
}).sort(([, left], [, right]) => left - right))
const classRuleState = computed<ClassRuleState>(() => {
  const breakpoint = inspector?.targetBreakpoint.value ?? "base"
  const width = breakpointEntries.value.find(([name]) => name === breakpoint)?.[1]
  return {
    ...(inspector?.selectedPseudo.value !== "default" ? { selectorSuffix: inspector?.selectedPseudo.value } : {}),
    ...(width != null ? { minWidthPx: width } : {}),
  }
})
const activeStyleText = computed(() => {
  const name = activeClassName.value
  if (!name) return styleDisplay.value.text
  return readAstroStyleClassDeclarations(doc?.model.value, name, classRuleState.value)
    ?? readClassDeclarations(classInventory.content.value, name, classRuleState.value)
})
const activeClassBreakpointStyles = computed<InspectorBreakpointStyleSource[]>(() => {
  const name = activeClassName.value
  if (!name) return []
  const pseudo = inspector?.selectedPseudo.value ?? "default"
  const selectorState = pseudo === "default" ? {} : { selectorSuffix: pseudo }
  const readState = (state: ClassRuleState) => readAstroStyleClassDeclarations(
    doc?.model.value,
    name,
    state,
  ) ?? readClassDeclarations(classInventory.content.value, name, state)
  return [
    {
      id: "base",
      label: m.composer_inspector_breakpoint_base(),
      width: null,
      styleText: readState(selectorState),
    },
    ...breakpointEntries.value.map(([id, width]) => ({
      id,
      label: id,
      width,
      styleText: readState({ ...selectorState, minWidthPx: width }),
    })),
  ]
})
const inheritedStyleText = computed(() => {
  const className = activeClassName.value
  if (!className) return ""
  const breakpoint = inspector?.targetBreakpoint.value ?? "base"
  const targetWidth = breakpointEntries.value.find(([name]) => name === breakpoint)?.[1]
  const pseudo = inspector?.selectedPseudo.value ?? "default"
  const merged: Record<string, string> = {}
  const readState = (state: ClassRuleState) => readAstroStyleClassDeclarations(
    doc?.model.value,
    className,
    state,
  ) ?? readClassDeclarations(classInventory.content.value, className, state)
  const mergeState = (state: ClassRuleState) => Object.assign(merged, parseStyleAttr(readState(state)))
  const lowerBreakpoints = breakpointEntries.value.filter(([, width]) => targetWidth != null && width < targetWidth)
  const inheritedDefaultBreakpoints = breakpointEntries.value.filter(([, width]) =>
    targetWidth != null && (pseudo === "default" ? width < targetWidth : width <= targetWidth),
  )

  if (!(breakpoint === "base" && pseudo === "default")) mergeState({})
  for (const [, width] of inheritedDefaultBreakpoints) mergeState({ minWidthPx: width })
  if (pseudo !== "default") {
    if (breakpoint !== "base") {
      mergeState({ selectorSuffix: pseudo })
      for (const [, width] of lowerBreakpoints) mergeState({ selectorSuffix: pseudo, minWidthPx: width })
    }
  }
  return serializeStyleAttr(merged)
})
const styleSessionKey = computed(() => [
  inspector?.sourceFile.value ?? "",
  inspector?.selectedPath.value ?? "",
  activeClassName.value ?? "__element__",
  inspector?.targetBreakpoint.value ?? "base",
  inspector?.selectedPseudo.value ?? "default",
].join(":"))
function styleCommitContextKey(): string {
  return [
    inspector?.sourceFile.value ?? "",
    selectedPath.value ?? "",
    activeClassName.value ?? "__element__",
    inspector?.targetBreakpoint.value ?? "base",
    inspector?.selectedPseudo.value ?? "default",
  ].join(":")
}

function repaintCommittedStyle(css: string): void {
  const path = selectedPath.value
  const contextKey = styleCommitContextKey()
  if (!path) return
  void nextTick(() => {
    if (contextKey !== styleCommitContextKey()) return
    doc?.previewStyle(path, withPreviewImportant(css))
  })
}
const defaultStyleSection = computed(() => {
  const node = selectedNode.value
  if (selectedNodeIsPopover(node)) return "popover"
  if (selectedNodeIsButton(node)) return "typography"
  if (node?.kind !== "element") return "display"
  if (["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "label", "a", "button"].includes(node.name)) return "typography"
  if (["img", "picture", "video"].includes(node.name)) return "size"
  return "display"
})
const defaultOpenSection = computed(() => {
  const node = selectedNode.value
  if (selectedNodeIsPopover(node)) return "popover"
  if (selectedNodeIsButton(node)) return "button"
  if (node?.kind === "component" && (/icon$/i.test(node.name) || node.props.icon != null)) return "icon"
  if (node?.kind !== "element") return defaultStyleSection.value
  if (node.name === "button" || node.props["data-button-variant"] != null) return "button"
  if (node.name === "a") return "link"
  if (selectedNodeHasVariant(node)) return "variant"
  if (isComposerRichTextHost(node)) return "content"
  const ariaType = stringFieldDisplay(node.props?.["data-aria-type"]).text
  if (ariaType === "Icon") return "icon"
  if (selectedNodeIsAvatar(node) || ["img", "picture"].includes(node.name)) return "image"
  if (node.name === "video") return "video"
  if (["pre", "code"].includes(node.name)) return "code"
  if (node.name === "svg") return ariaType === "Icon" ? "icon" : "svg"
  if (node.name === "nav") return "navigation"
  const model = doc?.model.value
  const path = inspector?.selectedPath.value
  const context = model && path ? resolveElementInspectorTarget(model, path) : null
  if (context?.sections.includes("icon-list")) return "icon-list"
  if (context?.sections.includes("list")) return "list"
  if (context?.sections.includes("link")) return "link"
  return defaultStyleSection.value
})

watch(() => inspector?.selectedPath.value, () => { openSection.value = defaultOpenSection.value }, { immediate: true })

function bootstrapClassInventory() {
  classInventoryReady = projectRoot.value ? classInventory.bootstrap() : Promise.resolve()
  return classInventoryReady
}

async function waitForClassInventory() {
  while (true) {
    const pending = classInventoryReady
    await pending
    if (pending === classInventoryReady) return
  }
}

onMounted(() => {
  void bootstrapClassInventory()
  unregisterBeforeFlush = doc?.registerBeforeFlush(flushPendingClassSave) ?? null
  unregisterClassHeaderActions = inspector?.registerClassHeaderActions({
    canPasteStyles: () => Boolean(copiedDeclarations.value),
    copyStyles: () => copyStyles(),
    pasteStyles: () => pasteStyles(),
    editCss: () => openCssEditor(),
    done: () => inspector.clearActiveClass(),
    rename: () => openNameDialog("rename"),
    duplicate: () => openNameDialog("duplicate"),
    removeActive: () => removeActiveFromNode(),
  }) ?? null
})
watch(projectRoot, (next, previous) => { if (next !== previous) void bootstrapClassInventory() })
watch(attachedClassNames, (names) => {
  if (activeClassName.value && !names.includes(activeClassName.value)) inspector?.clearActiveClass()
})
onUnmounted(() => {
  unregisterClassHeaderActions?.()
  unregisterClassHeaderActions = null
  void flushPendingClassSave().finally(() => {
    unregisterBeforeFlush?.()
    unregisterBeforeFlush = null
  })
})

function setClassValue(value: PropValue | undefined, _immediate: boolean) {
  const path = classTargetPath.value
  if (!classOpaque.value && path) {
    const nextValue = classPropName.value === "class"
      ? preserveComposerMotionClasses(rawAttachedClassNames.value, value)
      : value
    doc?.mutateModel(
      (model) => setPropAtPath(model, path, classPropName.value, nextValue),
      {
        immediate: false,
        coalesceKey: `prop:${path}:${classPropName.value}`,
        saveDelayMs: INSPECTOR_SAVE_DEBOUNCE_MS,
      },
    )
  }
}

function syncConflictingBorderUtilities(css: string) {
  if (classOpaque.value) return
  const removed = removeClassListTokens(
    classProp.value,
    conflictingBorderPresentationUtilities(css),
  )
  if (!removed.safe) return
  const before = classProp.value?.type === "string" || classProp.value?.type === "expr"
    ? classProp.value.value
    : ""
  const after = removed.value?.type === "string" || removed.value?.type === "expr"
    ? removed.value.value
    : ""
  if (before === after) return
  setClassValue(removed.value, true)
}
function addExpressionClass(name: string) {
  if (!classOpaque.value) setClassValue(appendClassListToken(classProp.value, name), false)
}
function removeExpressionClass(name: string) {
  if (classPropName.value !== "class:list" || classOpaque.value) return
  const removed = removeClassListTokens(classProp.value, (token) => token === name)
  if (removed.safe) setClassValue(removed.value, false)
}

async function activateClass(name: string): Promise<boolean> {
  const version = ++classActivationVersion
  if (astroStyleClasses.value.some((item) => item.name === name)) {
    inspector?.setActiveClass(name)
    return true
  }
  let activated = false
  const run = classActivationChain.catch(() => undefined).then(async () => {
    if (classSaveTimer) {
      clearTimeout(classSaveTimer)
      classSaveTimer = null
      enqueueClassSave()
    }
    await classSaveChain
    await waitForClassInventory()
    if (version !== classActivationVersion) return
    const source = design?.snapshot.value?.classes.find((item) => item.name === name)?.relativeFile
    const loadedHere = classInventory.classEntries.value.some((item) => item.name === name)
    const target = source
      || (loadedHere ? classInventory.selectedPath.value : "")
      || design?.snapshot.value?.entryRelativePath
      || classInventory.selectedPath.value
    if (target && target !== classInventory.selectedPath.value) await classInventory.loadFile(target)
    if (version !== classActivationVersion) return
    inspector?.setActiveClass(name)
    activated = true
  })
  classActivationChain = run.then(() => undefined, () => undefined)
  await run
  return activated
}

function enqueueClassSave(coalesceKey: string | null = `css:${classInventory.selectedPath.value}:${activeClassName.value}:${inspector?.targetBreakpoint.value}:${inspector?.selectedPseudo.value}`) {
  const relativeFile = classInventory.selectedPath.value
  const content = classInventory.content.value
  classSaveChain = classSaveChain.catch(() => undefined).then(async () => {
    const beforeContent = classInventory.diskContent.value
    const expectedMtimeMs = classInventory.mtimeMs.value
    if (!relativeFile || content === beforeContent) return
    const revision = await doc?.commitStylesheetEdit({
      relativeFile, content, beforeContent, expectedMtimeMs,
    }, { coalesceKey })
    if (revision) classInventory.adoptSavedContent(content, revision.mtimeMs)
    else classInventory.error.value = m.composer_inspector_css_conflict()
  })
}

async function flushPendingClassSave() {
  if (classSaveTimer) {
    clearTimeout(classSaveTimer)
    classSaveTimer = null
    enqueueClassSave()
  }
  await classSaveChain
}

function setActiveClassStyle(
  value: PropValue | undefined,
  immediate: boolean,
  options: { historyBoundary?: boolean; preserveApply?: boolean; deletedKeys?: readonly string[] } = {},
) {
  const preserveApply = options.preserveApply ?? true
  const className = activeClassName.value
  if (!className) return false
  const requestedCss = value?.type === "string" ? value.value : ""
  const css = preserveApply
    ? retainCompatibleBorderApplyDirectives(
      activeStyleText.value,
      patchClassDeclarations(
        activeStyleText.value,
        requestedCss,
        options.deletedKeys ?? [],
      ),
    )
    : requestedCss
  if (activeAstroStyleClass.value) {
    const changed = doc?.mutateModel((model) => ({
      ok: writeAstroStyleClassDeclarations(model, className, css, classRuleState.value),
      selectPath: inspector?.selectedPath.value ?? null,
    }), {
      immediate: options.historyBoundary ? true : false,
      coalesceKey: options.historyBoundary ? null : `astro-css:${activeAstroStyleClass.value.stylePath}:${className}:${inspector?.targetBreakpoint.value}:${inspector?.selectedPseudo.value}`,
      saveDelayMs: INSPECTOR_SAVE_DEBOUNCE_MS,
    })
    if (!changed) return false
    syncConflictingBorderUtilities(css)
    repaintCommittedStyle(css)
    return true
  }
  if (options.historyBoundary && classSaveTimer) {
    clearTimeout(classSaveTimer)
    classSaveTimer = null
    enqueueClassSave()
  }
  classInventory.content.value = writeClassDeclarations(classInventory.content.value, className, css, classRuleState.value)
  if (!immediate) return true
  if (options.historyBoundary) {
    enqueueClassSave(null)
    syncConflictingBorderUtilities(css)
    return true
  }
  if (classSaveTimer) clearTimeout(classSaveTimer)
  classSaveTimer = setTimeout(() => {
    classSaveTimer = null
    enqueueClassSave()
  }, INSPECTOR_SAVE_DEBOUNCE_MS)
  syncConflictingBorderUtilities(css)
  repaintCommittedStyle(css)
  return true
}

function nextClassValue(name: string): PropValue | undefined {
  if (classPropName.value === "class:list") return appendClassListToken(classProp.value, name)
  return commitStringValue(undefined, addClassName(rawAttachedClassNames.value, name).join(" "))
}

type AutomaticClassCommitTarget = {
  contextKey: string
  targetPath: string
  stylePath: string
  propName: "class" | "class:list"
  propValue: PropValue | undefined
  attachedClassNames: string[]
}

async function createAutomaticClass(
  css: string,
  commitTarget?: AutomaticClassCommitTarget,
): Promise<boolean> {
  if ((!commitTarget && classOpaque.value) || !doc) return false
  try {
    await doc.flushSave()
  } catch {
    return false
  }
  await flushPendingClassSave()
  await waitForClassInventory()
  const entry = design?.snapshot.value?.entryRelativePath
  if (entry && entry !== classInventory.selectedPath.value) await classInventory.loadFile(entry)
  const relativeFile = classInventory.selectedPath.value
  const targetPath = commitTarget?.targetPath ?? classTargetPath.value
  const stylePath = commitTarget?.stylePath ?? selectedPath.value
  if (!relativeFile || !targetPath || !stylePath) {
    toast.error(m.composer_inspector_classes_create_failed(), { description: m.composer_inspector_classes_create_failed_hint() })
    return false
  }

  const existing = new Set([
    ...(design?.snapshot.value?.classes.map((item) => item.name) ?? []),
    ...classInventory.classEntries.value.map((item) => item.name),
    ...astroStyleClasses.value.map((item) => item.name),
  ])
  const name = createAutomaticAriaClassName(existing)
  const beforeContent = classInventory.diskContent.value
  const localContent = classInventory.content.value
  if (!classInventory.createClass(name, css)) return false
  const nextContent = classInventory.content.value
  const shouldRemove = conflictingBorderPresentationUtilities(css)
  const sourceNames = (commitTarget?.attachedClassNames ?? rawAttachedClassNames.value)
    .filter((token) => !shouldRemove(token))
  const sourceValue = commitTarget?.propValue ?? classProp.value
  const strippedSource = removeClassListTokens(sourceValue, shouldRemove)
  const classValue = (commitTarget?.propName ?? classPropName.value) === "class:list"
    ? appendClassListToken(strippedSource.safe ? strippedSource.value : sourceValue, name)
    : commitStringValue(undefined, addClassName(sourceNames, name).join(" "))
  const revisions = await doc.commitModelWithStylesheet((model) => {
    const attached = setPropAtPath(
      model,
      targetPath,
      commitTarget?.propName ?? classPropName.value,
      classValue,
    )
    if (!attached.ok) return attached
    const cleared = setPropAtPath(model, stylePath, "style", undefined)
    return cleared.ok
      ? { ok: true }
      : cleared
  }, {
    relativeFile,
    content: nextContent,
    beforeContent,
    expectedMtimeMs: classInventory.mtimeMs.value,
  })
  const revision = revisions?.find((item) => item.relativeFile === relativeFile)
  if (!revision) {
    if (classInventory.selectedPath.value === relativeFile) {
      classInventory.content.value = localContent
    }
    toast.error(m.composer_inspector_classes_create_failed(), { description: m.composer_inspector_classes_create_failed_hint() })
    return false
  }
  if (classInventory.selectedPath.value === relativeFile) {
    classInventory.adoptSavedContent(nextContent, revision.mtimeMs)
  }
  if (!commitTarget || commitTarget.contextKey === styleCommitContextKey()) {
    inspector?.setActiveClass(name)
  }
  toast.success(m.composer_inspector_classes_created({ name }))
  return true
}

function setStyleValue(
  value: PropValue | undefined,
  immediate: boolean,
  options: { historyBoundary?: boolean; preserveApply?: boolean; deletedKeys?: readonly string[] } = {},
) {
  if (activeClassName.value) {
    setActiveClassStyle(value, immediate, options)
    return
  }
  const requestedCss = value?.type === "string" ? value.value : ""
  if (!requestedCss.trim()) {
    if ((!styleIsExpr.value || !styleProp.value) && immediate) {
      doc?.setSelectedProp("style", undefined, { immediate: options.historyBoundary ? true : false })
    }
    return
  }
  automaticClassCommitChain = automaticClassCommitChain
    .catch(() => undefined)
    .then(async () => {
      if (activeClassName.value) {
        setActiveClassStyle(value, immediate, options)
        return
      }
      await createAutomaticClass(requestedCss)
    })
}

function styleCommitFailure(): ComposerStyleCommitResult {
  return {
    ok: false,
    error:
      doc?.saveError.value
      ?? classInventory.error.value
      ?? m.composer_opacity_save_failed(),
  }
}

async function commitStyleValue(
  value: PropValue | undefined,
  options: { historyBoundary?: boolean; preserveApply?: boolean; deletedKeys?: readonly string[] } = {},
): Promise<ComposerStyleCommitResult> {
  if (!doc || !editable.value) return styleCommitFailure()
  const requestedCss = value?.type === "string" ? value.value : ""
  const className = activeClassName.value
  const contextKey = styleCommitContextKey()

  if (!className) {
    if (!requestedCss.trim()) {
      if (!styleProp.value) return { ok: true }
      const path = selectedPath.value
      if (!path || styleIsExpr.value) return styleCommitFailure()
      const ok = await doc.commitModelMutation((model) => {
        const changed = setPropAtPath(model, path, "style", undefined)
        return changed.ok ? { ok: true } : changed
      })
      return ok ? { ok: true } : styleCommitFailure()
    }
    const targetPath = classTargetPath.value
    const stylePath = selectedPath.value
    if (!targetPath || !stylePath || classOpaque.value) return styleCommitFailure()
    const locked = await doc.withMutationLock(() => createAutomaticClass(requestedCss, {
      contextKey,
      targetPath,
      stylePath,
      propName: classPropName.value,
      propValue: classProp.value,
      attachedClassNames: [...rawAttachedClassNames.value],
    }))
    return locked.acquired && locked.value ? { ok: true } : styleCommitFailure()
  }

  const css = options.preserveApply ?? true
    ? retainCompatibleBorderApplyDirectives(
      activeStyleText.value,
      patchClassDeclarations(
        activeStyleText.value,
        requestedCss,
        options.deletedKeys ?? [],
      ),
    )
    : requestedCss
  const state = { ...classRuleState.value }
  const astroClass = activeAstroStyleClass.value
  if (astroClass) {
    const ok = await doc.commitModelMutation((model) => ({
      ok: writeAstroStyleClassDeclarations(model, className, css, state),
      reason: m.composer_opacity_save_failed(),
    }))
    if (ok) syncConflictingBorderUtilities(css)
    return ok ? { ok: true } : styleCommitFailure()
  }

  const breakpoint = inspector?.targetBreakpoint.value ?? "base"
  const pseudo = inspector?.selectedPseudo.value ?? "default"
  const locked = await doc.withMutationLock(async (): Promise<ComposerStyleCommitResult> => {
    await flushPendingClassSave()
    await waitForClassInventory()
    if (contextKey !== styleCommitContextKey()) return styleCommitFailure()
    const relativeFile = classInventory.selectedPath.value
    const beforeContent = classInventory.diskContent.value
    const sourceContent = classInventory.content.value
    const expectedMtimeMs = classInventory.mtimeMs.value
    if (!relativeFile) return styleCommitFailure()
    const nextContent = writeClassDeclarations(
      sourceContent,
      className,
      css,
      state,
    )
    const revision = await doc.commitStylesheetEdit({
      relativeFile,
      content: nextContent,
      beforeContent,
      expectedMtimeMs,
    }, {
      coalesceKey: options.historyBoundary
        ? null
        : `opacity:${relativeFile}:${className}:${breakpoint}:${pseudo}`,
    })
    if (!revision) return styleCommitFailure()
    if (
      classInventory.selectedPath.value === relativeFile
      && contextKey === styleCommitContextKey()
    ) {
      classInventory.adoptSavedContent(nextContent, revision.mtimeMs)
    }
    syncConflictingBorderUtilities(css)
    return { ok: true }
  })
  return locked.acquired ? locked.value : styleCommitFailure()
}

async function persistCreatedClass(name: string, nextContent: string, beforeContent: string) {
  const relativeFile = classInventory.selectedPath.value
  if (!relativeFile) return false
  const revisions = await doc?.setSelectedPropWithStylesheet(classPropName.value, nextClassValue(name), {
    relativeFile, content: nextContent, beforeContent, expectedMtimeMs: classInventory.mtimeMs.value,
  }, classTargetPath.value ?? undefined)
  const revision = revisions?.find((item) => item.relativeFile === relativeFile)
  if (!revision) return false
  classInventory.adoptSavedContent(nextContent, revision.mtimeMs)
  inspector?.setActiveClass(name)
  return true
}

async function createAndAttachClass(rawName: string) {
  if (classOpaque.value) return
  await classSaveChain
  const entry = design?.snapshot.value?.entryRelativePath
  if (entry && entry !== classInventory.selectedPath.value) await classInventory.loadFile(entry)
  const before = classInventory.diskContent.value
  const name = classInventory.createClass(rawName)
  if (!name) { toast.error(m.composer_inspector_classes_create_failed(), { description: m.composer_inspector_classes_create_failed_hint() }); return }
  if (await persistCreatedClass(name, classInventory.content.value, before)) toast.success(m.composer_inspector_classes_created({ name }))
}

async function resolveClassActionTarget(requested?: string) {
  if (requested && requested !== activeClassName.value) {
    if (!await activateClass(requested)) return null
  }
  return requested ?? activeClassName.value
}

async function copyStyles(requested?: string) {
  const name = await resolveClassActionTarget(requested)
  if (!name) return
  copiedDeclarations.value = { source: name, css: activeStyleText.value }
  toast.success(m.composer_inspector_classes_copied({ name }))
}
async function pasteStyles(requested?: string) {
  const name = await resolveClassActionTarget(requested)
  if (!name || !copiedDeclarations.value) return
  setStyleValue({ type: "string", value: copiedDeclarations.value.css }, true)
  toast.success(m.composer_inspector_classes_pasted({ name: copiedDeclarations.value.source }))
}
async function openCssEditor(requested?: string) {
  if (!await resolveClassActionTarget(requested)) return
  cssDialogOpen.value = true
}
async function openNameDialog(mode: "rename" | "duplicate", requested?: string) {
  if (!await resolveClassActionTarget(requested)) return
  nameDialogMode.value = mode
}

function openBemFork(blockClass: string) {
  if (!editable.value) return
  bemForkBlock.value = blockClass
  nameDialogMode.value = "fork"
}

async function forkBemVariant(payload: { name: string }) {
  const block = bemForkBlock.value
  if (!block) return
  const forked = forkAriaBemModifier(rawAttachedClassNames.value, block, payload.name)
  if (!forked.ok) {
    toast.error(m.composer_inspector_bem_fork_failed(), { description: forked.reason })
    return
  }
  nameDialogMode.value = null
  bemForkBlock.value = null
  const existing = new Set([
    ...(design?.snapshot.value?.classes.map((item) => item.name) ?? []),
    ...classInventory.classEntries.value.map((item) => item.name),
    ...astroStyleClasses.value.map((item) => item.name),
  ])
  if (existing.has(forked.modifier)) {
    setClassValue(nextClassValue(forked.modifier), true)
    inspector?.setActiveClass(forked.modifier)
    return
  }
  await createAndAttachClass(forked.modifier)
}
function saveCss(css: string) {
  setStyleValue(css.trim() ? { type: "string", value: css } : undefined, true, { preserveApply: false })
  cssDialogOpen.value = false
}

async function duplicateActive(payload: { name: string }) {
  const source = activeClassName.value
  if (!source) return
  await classSaveChain
  const existing = new Set([
    ...(design?.snapshot.value?.classes.map((item) => item.name) ?? []),
    ...astroStyleClasses.value.map((item) => item.name),
  ])
  const requested = payload.name || createSequentialDuplicateName(source, existing)
  if (existing.has(requested)) { toast.error(m.composer_inspector_classes_name_exists()); return }
  if (activeAstroStyleClass.value) {
    const targetPath = classTargetPath.value
    if (!targetPath) return
    const attachedValue = nextClassValue(requested)
    const changed = doc?.mutateModel((model) => {
      const prop = setPropAtPath(model, targetPath, classPropName.value, attachedValue)
      if (!prop.ok) return prop
      if (!duplicateAstroStyleClass(model, source, requested)) {
        return { ok: false, selectPath: targetPath, reason: "Local class rule could not be duplicated" }
      }
      return prop
    }, { immediate: true })
    if (changed) {
      inspector?.setActiveClass(requested)
      toast.success(m.composer_inspector_classes_duplicated({ name: source }))
    }
    nameDialogMode.value = null
    return
  }
  const before = classInventory.diskContent.value
  const extracted = extractClassRuleCss(classInventory.content.value, source)
  const duplicateCss = renameClassRuleCss(extracted, source, requested)
  const next = `${classInventory.content.value.replace(/\s+$/, "")}\n\n${duplicateCss}\n`
  classInventory.content.value = next
  if (await persistCreatedClass(requested, next, before)) toast.success(m.composer_inspector_classes_duplicated({ name: source }))
  nameDialogMode.value = null
}

async function renameActive(payload: { name: string }) {
  const source = activeClassName.value
  if (!source || source === payload.name) return
  if (isAriaBemBlockClass(source) || isAriaBemSystemClass(source)) {
    toast.error(m.composer_inspector_classes_rename_failed(), {
      description: m.composer_inspector_bem_fork_failed(),
    })
    return
  }
  const result = await renameClassAcrossProject(projectRoot.value, source, payload.name)
  if (!result.ok) { toast.error(m.composer_inspector_classes_rename_failed(), { description: result.message }); return }
  inspector?.clearActiveClass()
  await classInventory.bootstrap()
  doc?.reloadPreview()
  nameDialogMode.value = null
  toast.success(m.composer_inspector_classes_renamed({ from: source, to: payload.name }))
}

function removeActiveFromNode() {
  const name = activeClassName.value
  if (!name) return
  if (classPropName.value === "class:list") removeExpressionClass(name)
  else if (!classIsExpr.value) {
    const next = splitClassNames(classDisplay.value.text).filter((item) => item !== name)
    setClassValue(commitStringValue(undefined, next.join(" ")), true)
  }
  inspector?.clearActiveClass()
}
</script>

<template>
  <div v-if="!selectedNode || !supportsDesign" class="px-3 py-6 text-xs leading-relaxed text-muted-foreground">
    {{ m.composer_inspector_design_unavailable() }}
  </div>
  <div v-else class="h-full min-h-0 overflow-y-auto">
    <p v-if="showReadOnlyNotice" class="border-b border-dashed border-border px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">{{ m.composer_inspector_read_only() }}</p>

    <ComposerClassEditor
      :class-text="classTextForInspector"
      :source-class-names="attachedClassNames"
      :is-expr="classIsExpr"
      :opaque="classOpaque"
      :rendered-classes="renderedClasses"
      :custom-class-names="[
        ...classInventory.classEntries.value.map((item) => item.name),
        ...astroStyleClasses.map((item) => item.name),
      ]"
      :active-class-name="activeClassName"
      :can-paste-styles="Boolean(copiedDeclarations)"
      :disabled="!editable"
      @set-class="setClassValue"
      @add-expr-class="addExpressionClass"
      @remove-expr-class="removeExpressionClass"
      @activate-class="activateClass"
      @create-class="createAndAttachClass"
      @done="inspector?.clearActiveClass()"
      @copy-styles="copyStyles"
      @paste-styles="pasteStyles"
      @edit-css="openCssEditor"
      @rename="openNameDialog('rename', $event)"
      @duplicate="openNameDialog('duplicate', $event)"
      @fork-bem="openBemFork"
    />

    <div v-if="activeClassName" class="flex h-9 items-center gap-2 border-b border-dashed border-border bg-sidebar/60 px-3">
      <span class="text-[9px] font-medium uppercase tracking-widest text-muted-foreground">{{ m.composer_inspector_breakpoint() }}</span>
      <Select :model-value="inspector?.targetBreakpoint.value ?? 'base'" @update:model-value="inspector && (inspector.targetBreakpoint.value = String($event))">
        <SelectTrigger class="ml-auto h-7 w-32 text-[11px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="base">{{ m.composer_inspector_breakpoint_base() }}</SelectItem>
          <SelectItem v-for="[name, width] in breakpointEntries" :key="name" :value="name">{{ name }} · {{ width }}px</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <ComposerContentAttributes
      cluster="identity"
      v-model:open-section="openSection"
      :node="selectedNode"
      :disabled="!editable"
      :style-text="activeClassName ? activeStyleText : undefined"
      :inherited-style-text="activeClassName ? inheritedStyleText : undefined"
      @set-style="setStyleValue"
    />
    <ComposerStyleControls
      :key="styleSessionKey"
      :style-text="activeStyleText"
      :is-expr="!activeClassName && styleIsExpr"
      :disabled="!editable || (!activeClassName && styleIsExpr)"
      :default-section="defaultStyleSection"
      :inherited-style-text="inheritedStyleText"
      :breakpoint-styles="activeClassBreakpointStyles"
      :current-breakpoint="inspector?.targetBreakpoint.value ?? 'base'"
      :commit-style="commitStyleValue"
      v-model:open-section="openSection"
      @select-breakpoint="inspector && (inspector.targetBreakpoint.value = $event)"
      @set-style="setStyleValue"
    />
    <ComposerContentAttributes
      cluster="attributes"
      v-model:open-section="openSection"
      :node="selectedNode"
      :disabled="!editable"
    />

    <ClassManagerCssDialog
      :open="cssDialogOpen"
      :class-name="activeClassName ?? ''"
      :initial-css="activeStyleText"
      :variable-references="variableReferenceOptions"
      :class-references="[
        ...(design?.classNames.value ?? []),
        ...classInventory.classEntries.value.map((item) => item.name),
        ...astroStyleClasses.map((item) => item.name),
      ]"
      :utility-references="design?.utilityCandidates.value ?? []"
      @update:open="cssDialogOpen = $event"
      @save="saveCss"
    />
    <ClassManagerNameDialog
      :open="nameDialogMode !== null"
      :mode="nameDialogMode ?? 'rename'"
      :initial-name="nameDialogMode === 'duplicate' && activeClassName ? createSequentialDuplicateName(activeClassName, new Set([...(design?.snapshot.value?.classes.map((item) => item.name) ?? []), ...astroStyleClasses.map((item) => item.name)])) : nameDialogMode === 'fork' ? '' : activeClassName ?? ''"
      @update:open="!$event && (nameDialogMode = null, bemForkBlock = null)"
      @submit="nameDialogMode === 'rename' ? renameActive($event) : nameDialogMode === 'fork' ? forkBemVariant($event) : duplicateActive($event)"
    />
  </div>
</template>
