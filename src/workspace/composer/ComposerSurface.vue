<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  provide,
  ref,
  toRef,
  watch,
} from "vue"
import type {
  DevicePreview,
  ScanComponent,
  ScanPage,
  WorkspaceActiveDocument,
} from "@/workspace/types"
import type { ProjectRuntimeSession } from "@/lib/sessions"
import type { AstroCollectionBinding, AstroDocumentModel } from "../../../shared/composer/types"
import { astroCollectionPropsForComponent } from "../../../shared/composer/collectionBindings"
import {
  bareMarkerPath,
  nodeAtMarkerPath,
} from "../../../shared/composer/paths"
import { peekAgentNodeClassTokens } from "../../../shared/composer/agentNodeClasses"
import {
  hashRevision,
  type AgentShellContext,
} from "../../../shared/agent"
import {
  buildComposerLayerTree,
  resolveLayoutPageContentParentPath,
  scopeComposerLayerTreeToInstance,
  type ComposerLayerRow,
  wrapComposerLayerTreeInActiveDocument,
} from "../../../shared/composer/layers"
import { composerRichTextOwnerPath } from "../../../shared/composer/richText"
import { documentHasMotion } from "../../../shared/composer/motion"
import { listComposerPopoverTargets } from "../../../shared/composer/popoverAuthoring"
import { visibleCodeSelectionPath, shouldOpenCodeModeForSelection } from "./chrome/codeEditorSelection"
import {
  buildComposerLayoutContract,
  type ComposerLayoutContract,
} from "../../../shared/composer/layoutAuthoring"
import { openingSelectionPath } from "../../../shared/composer/openingSelection"
import {
  extractComposerPropSchema,
  detectComposerFrameworks,
  listComposerTranslationCatalogs,
  parseComposerPage,
  prepareComposerComponentPreview,
} from "@/lib/composer"
import { provideComposerBeacon } from "./selection/useComposerBeacon"
import type {
  ComposerCodeLayout,
  ComposerPreviewMode,
  ComposerSurfaceMode,
} from "./chrome/composerPreviewMode"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import ComposerCanvasBar from "./chrome/ComposerCanvasBar.vue"
import ComposerCodeSurface from "./chrome/ComposerCodeSurface.vue"
import ComposerCodeFallbackHost from "./chrome/ComposerCodeFallbackHost.vue"
import ComposerInspectorHost from "./chrome/ComposerInspectorHost.vue"
import ComposerLeftPanel from "./chrome/ComposerLeftPanel.vue"
import Stage from "./Stage.vue"
import ComposerBreakpointBoard from "./ComposerBreakpointBoard.vue"
import {
  useComposerDocument,
  type ComposerPasteResult,
} from "./useComposerDocument"
import { useComposerCodeSession } from "./useComposerCodeSession"
import { useComposerPreviewCoordinator } from "./useComposerPreviewCoordinator"
import { useAgentComposerHost } from "./useAgentComposerHost"
import {
  clearAgentSurfaceContext,
  updateAgentSurfaceContext,
} from "@/workspace/agent/surfaceContext"
import { provideComposerDocument } from "./useComposerDocumentSession"
import { provideComposerBridgeClasses } from "./useComposerBridgeClasses"
import { provideComposerDesignClasses } from "./useComposerDesignContext"
import { useComposerEditStack } from "./useComposerEditStack"
import { provideComposerModeNavigation } from "./useComposerModeNavigation"
import {
  canCommitComposerDocumentLoad,
  composerExternalReloadFile,
  shouldPreserveComposerDocumentOnLoadFailure,
} from "./composerExternalReload"
import { shouldCloseComposerDrillForEscape } from "./composerKeyboardBoundary"
import { composerPageNavigationIdentity } from "./composerPageNavigation"
import { resolveComposerComponentFallback } from "./componentResolution"
import {
  composerDocumentLaunchTicket,
  takeComposerDocumentLaunchRequest,
} from "./composerDocumentLaunchRequest"
import {
  decidePageLayoutContextAction,
  shouldClearLayoutForPageLoad,
} from "./pageLayoutContext"
import type {
  ComposerComponentInstanceSegment,
  ComposerComponentPreviewData,
  ComposerComponentPreviewSession,
  ComposerCmsEntryTemplatePreviewContext,
  ComposerDocumentLaunchRequest,
} from "../../../shared/composer"
import { toast } from "vue-sonner"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useDesignSnapshot } from "@/workspace/design/composables/useDesignSnapshot"
import {
  DESIGN_COLOR_PICKER_KEY,
  type DesignColorPickerContext,
} from "@/workspace/design/composables/useDesignColorPickerContext"
import { DESIGN_VARIABLE_REFERENCES_KEY } from "@/composables/useVariableReferenceOptions"
import type { VariableReferenceOption } from "@/workspace/design/lib/variableReferences"
import { buildVariableReferenceOptions } from "@/workspace/design/lib/variableReferences"
import {
  EMPTY_DESIGN_VARIABLES,
  SEMANTIC_CSS_VAR,
  composerFontStylesheetUrls,
} from "../../../shared/design"
import { guardDirtyNavigation, registerDirtyState } from "@/workspace/dirtyState"
import { m } from "@/paraglide/messages.js"
import { previewPageUrl } from "@/lib/preview"
import { applyProjectLocaleToRoute } from "../../../shared/localization"
import { waitForComposerAuthoringPreview } from "@/lib/composerAuthoringPreview"
import { useComposerOptions } from "./chrome/useComposerOptions"
import { provideComposerTranslations } from "./useComposerTranslations"

const props = defineProps<{
  projectPath: string
  selectedRoute: string | null
  pages: ScanPage[]
  components?: ScanComponent[]
  layouts?: ScanComponent[]
  device: DevicePreview
  runtime: ProjectRuntimeSession | null
  /** False while another kept-alive project owns the foreground workspace. */
  active?: boolean
  reloadKey?: number
  previewIsolatedDevice?: DevicePreview | null
  agentShellContext?: AgentShellContext
}>()

const emit = defineEmits<{
  "exit-standalone": []
  "active-document-change": [document: WorkspaceActiveDocument | null]
  "device-change": [device: DevicePreview]
  "preview-immersive-change": [immersive: boolean]
}>()

const translationCatalogs = ref<Awaited<ReturnType<typeof listComposerTranslationCatalogs>>>({
  catalogs: [],
  unsupported: [],
  scannedAt: "",
})
const translationsLoading = ref(false)
const translationsError = ref("")
const activeTranslationLocale = ref("")
let translationLoadGeneration = 0

async function refreshTranslationCatalogs(force = false): Promise<void> {
  const projectPath = props.projectPath
  const generation = ++translationLoadGeneration
  translationsLoading.value = true
  translationsError.value = ""
  try {
    const result = await listComposerTranslationCatalogs(projectPath, force)
    if (generation !== translationLoadGeneration || projectPath !== props.projectPath) return
    translationCatalogs.value = result
    const locales = [...new Set(result.catalogs.flatMap((catalog) => catalog.locales))]
    if (!locales.includes(activeTranslationLocale.value)) {
      activeTranslationLocale.value = result.catalogs[0]?.defaultLocale ?? locales[0] ?? ""
    }
  } catch (cause) {
    if (generation === translationLoadGeneration) translationsError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (generation === translationLoadGeneration) translationsLoading.value = false
  }
}

provideComposerTranslations({
  result: translationCatalogs,
  loading: translationsLoading,
  error: translationsError,
  activeLocale: activeTranslationLocale,
  refresh: refreshTranslationCatalogs,
})

const beacon = provideComposerBeacon()
provideComposerModeNavigation({ openCode: () => void onSurfaceMode("code") })

const stageRef = ref<InstanceType<typeof Stage> | null>(null)
const popoverPreviewTargetId = ref<string | null>(null)
function previewPopover(targetId: string | null, open = true) {
  popoverPreviewTargetId.value = open ? targetId : null
  stageRef.value?.previewPopover(targetId, open)
}
const inspectorRef = ref<InstanceType<typeof ComposerInspectorHost> | null>(null)

function openDesignTools() {
  inspectorRef.value?.openDesignTools()
}

defineExpose({ openDesignTools })

const pathClasses = ref<Record<string, string[][]>>({})
provideComposerBridgeClasses({ pathClasses })

const projectPathRef = toRef(props, "projectPath")
const { snapshot } = useDesignSnapshot(projectPathRef)
const composerFontStylesheetUrlsValue = computed(() =>
  composerFontStylesheetUrls(snapshot.value?.fonts),
)
const frameworkCapabilities = ref<
  import("../../../shared/composer").ComposerFrameworkCapabilities | null
>(null)
const agentKnownDesignClasses = computed<ReadonlySet<string>>(
  () => new Set((snapshot.value?.classes ?? []).map((item) => item.name)),
)
provideComposerDesignClasses(snapshot, frameworkCapabilities)

let frameworkScanGeneration = 0
watch(
  () => props.projectPath,
  async (projectPath) => {
    const generation = ++frameworkScanGeneration
    frameworkCapabilities.value = null
    try {
      const result = await detectComposerFrameworks(projectPath)
      if (generation === frameworkScanGeneration) {
        frameworkCapabilities.value = result
      }
    } catch {
      if (generation === frameworkScanGeneration) {
        frameworkCapabilities.value = null
      }
    }
  },
  { immediate: true },
)

const colorPickerContext = computed<DesignColorPickerContext>(() => {
  const snap = snapshot.value
  if (!snap) {
    return {
      palettes: [],
      semantic: {},
      variables: EMPTY_DESIGN_VARIABLES,
    }
  }
  return {
    palettes: snap.colors.palettes,
    semantic: snap.colors.semantic,
    variables: snap.variables,
  }
})
provide(DESIGN_COLOR_PICKER_KEY, colorPickerContext)

const variableReferences = computed<VariableReferenceOption[]>(() => {
  const snap = snapshot.value
  if (!snap) return []
  const refs: VariableReferenceOption[] = []
  for (const palette of snap.colors.palettes) {
    const base = palette.shades.DEFAULT || palette.shades["500"]
    if (base) {
      refs.push({
        value: palette.name,
        label: `--${palette.name}`,
        meta: base,
        group: "Palette Tokens",
        directValue: base,
      })
    }
    for (const [shade, value] of Object.entries(palette.shades)) {
      if (shade === "DEFAULT" || !value) continue
      refs.push({
        value: `${palette.name}-${shade}`,
        label: `--${palette.name}-${shade}`,
        meta: value,
        group: "Palette Tokens",
        directValue: value,
      })
    }
  }
  for (const [key, cssVar] of Object.entries(SEMANTIC_CSS_VAR)) {
    const color =
      snap.colors.semantic[key as keyof typeof snap.colors.semantic]
    if (!color) continue
    refs.push({
      value: cssVar,
      label: `--${cssVar}`,
      meta: color,
      group: "Semantic Tokens",
      directValue: color,
    })
  }
  refs.push(...buildVariableReferenceOptions(snap.variables))
  return refs
})
provide(DESIGN_VARIABLE_REFERENCES_KEY, variableReferences)

const model = ref<AstroDocumentModel | null>(null)

watch(
  [model, () => beacon.selections.value] as const,
  ([currentModel, selections]) => {
    if (!currentModel || !selections.length) return
    const visible = selections.map((selection) => ({
      ...selection,
      path: composerRichTextOwnerPath(
        currentModel,
        bareMarkerPath(selection.path),
      ) ?? selection.path,
    }))
    const currentKey = selections.map((selection) => `${selection.path}#${selection.occurrence}`).join(",")
    const visibleKey = visible.map((selection) => `${selection.path}#${selection.occurrence}`).join(",")
    if (currentKey !== visibleKey) {
      beacon.setSelections(visible, { source: "api", reveal: "none" })
    }
  },
)
/** File that owns `model`; null while a different document is loading. */
const modelFile = ref<string | null>(null)
const parseLoading = ref(false)
const parseError = ref<string | null>(null)
const bailReason = ref<string | null>(null)
const pageLayoutContract = ref<ComposerLayoutContract | null>(null)
const pageLayoutModel = ref<AstroDocumentModel | null>(null)
const pageLayoutFile = ref<string | null>(null)
/** Page file that owns the current layout projection (survives drills). */
const pageLayoutOwnerFile = ref<string | null>(null)
/** File currently being edited (page, or drilled component/layout). */
const editFile = ref<string | null>(null)
/** Last known mtime of the edited file (for external reload). */
const editedMtimeMs = ref<number | null>(null)

const surfaceMode = ref<ComposerSurfaceMode>("design")
const composerOptions = useComposerOptions()
const CODE_LAYOUT_KEY = "aria.composer.code-layout"
const codeLayout = ref<ComposerCodeLayout>(
  localStorage.getItem(CODE_LAYOUT_KEY) === "full" ||
    localStorage.getItem(CODE_LAYOUT_KEY) === "horizontal" ||
    localStorage.getItem(CODE_LAYOUT_KEY) === "vertical"
    ? (localStorage.getItem(CODE_LAYOUT_KEY) as ComposerCodeLayout)
    : "vertical",
)

const editStack = useComposerEditStack()
const componentPreviewSession = ref<ComposerComponentPreviewSession | null>(null)
const cmsEntryTemplatePreview = ref<ComposerCmsEntryTemplatePreviewContext | null>(null)
const hardReloadRevision = ref(0)

watch(
  () => editStack.current.value,
  (entry) => {
    if (!entry) return
    emit("active-document-change", {
      kind: entry.kind,
      name: entry.name,
      file: entry.file,
    })
  },
  { immediate: true },
)

function previewStorageKey(file: string): string {
  return `aria.composer.component-preview:${props.projectPath}:${file}`
}

function readPreviewOverride(file: string): Partial<
  Pick<ComposerComponentPreviewData, "props" | "slots">
> | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(previewStorageKey(file)) ?? "null") as unknown
    if (!parsed || typeof parsed !== "object") return null
    const value = parsed as { props?: unknown; slots?: unknown }
    return {
      ...(value.props && typeof value.props === "object" ? { props: value.props as ComposerComponentPreviewData["props"] } : {}),
      ...(value.slots && typeof value.slots === "object" ? { slots: value.slots as ComposerComponentPreviewData["slots"] } : {}),
    }
  } catch {
    return null
  }
}

function writePreviewOverride(file: string, data: ComposerComponentPreviewData) {
  try {
    localStorage.setItem(
      previewStorageKey(file),
      JSON.stringify({ props: data.props, slots: data.slots }),
    )
  } catch {
    /* editor-only persistence is best effort */
  }
}

/** Design (instrumented) vs interactive browse — local until session persistence. */
const previewMode = ref<ComposerPreviewMode>("design")

const isDesignMode = computed(() => surfaceMode.value !== "interactive")
watch(isDesignMode, (active) => {
  if (!active) previewPopover(null, false)
})
watch(
  () => [beacon.selectedPath.value, model.value] as const,
  ([path, currentModel]) => {
    const activeId = popoverPreviewTargetId.value
    if (!activeId || !path || !currentModel) return
    const target = listComposerPopoverTargets(currentModel).find((candidate) => candidate.id === activeId)
    const remainsInContext = Boolean(target && (
      path === target.path
      || path.startsWith(`${target.path}.`)
      || target.triggers.some((trigger) => trigger.path === path)
    ))
    if (!remainsInContext) previewPopover(null, false)
  },
)
/** Immersive preview: hide composer chrome; stage fills the surface. */
const isPreviewImmersive = computed(() => surfaceMode.value === "interactive")
watch(
  isPreviewImmersive,
  (immersive) => emit("preview-immersive-change", immersive),
  { immediate: true },
)
/** Keep the Stage iframe mounted in code-full so Design ↔ Code does not remount. */
const showStage = computed(
  () => surfaceMode.value !== "code" || codeLayout.value !== "full",
)
/** Keep the code panel mounted (collapsed when hidden) so the splitter never remounts mid-layout. */
const showCodePanel = computed(() => surfaceMode.value === "code")
/** Side-by-side or stacked code + preview — uses ResizablePanelGroup. */
const isCodeSplit = computed(
  () =>
    surfaceMode.value === "code" &&
    (codeLayout.value === "vertical" || codeLayout.value === "horizontal"),
)
/**
 * Aria "vertical" = columns (preview | code) → splitter direction horizontal.
 * Aria "horizontal" = rows (preview / code) → splitter direction vertical.
 * Non-split modes keep a stable horizontal group so Stage is never remounted.
 */
const codeSplitDirection = computed<"horizontal" | "vertical">(() =>
  isCodeSplit.value && codeLayout.value === "horizontal"
    ? "vertical"
    : "horizontal",
)

/** Panel sizes — both panels stay mounted; hidden side collapses to 0. */
const stagePanelDefaultSize = computed(() => {
  if (!showStage.value) return 0
  return isCodeSplit.value ? 50 : 100
})
const stagePanelMinSize = computed(() => {
  if (!showStage.value) return 0
  return isCodeSplit.value ? 20 : 100
})
const codePanelDefaultSize = computed(() => {
  if (!showCodePanel.value) return 0
  return isCodeSplit.value ? 50 : 100
})
const codePanelMinSize = computed(() => {
  if (!showCodePanel.value) return 0
  return isCodeSplit.value ? 20 : 100
})

const showCodeFallback = computed(
  () =>
    surfaceMode.value !== "code" &&
    Boolean(bailReason.value) &&
    !parseLoading.value &&
    !model.value,
)

const previewCoordinator = useComposerPreviewCoordinator({
  projectPath: toRef(props, "projectPath"),
  editFile,
  patchNodes: (payload) => stageRef.value?.patchNodes(payload),
  reconcile: (payload) => stageRef.value?.reconcile(payload),
})

const codeSession = useComposerCodeSession({
  projectPath: toRef(props, "projectPath"),
  editFile,
  editedMtimeMs,
  collectionProps: computed(() => editStack.current.value?.collectionProps),
  preview: {
    setSource: (source) => { previewCoordinator.applySource(source) },
    clear: previewCoordinator.clear,
    revision: previewCoordinator.revision,
  },
  onProjection(result) {
    if (result.editable) {
      model.value = result.model
      modelFile.value = editFile.value
      bailReason.value = null
      parseError.value = null
      const selected = beacon.selectedPath.value
      if (selected && !nodeAtMarkerPath(result.model.nodes, bareMarkerPath(selected))) {
        beacon.dim()
      }
    } else if (result.compilerValid) {
      model.value = null
      modelFile.value = null
      bailReason.value = result.reason || "This Astro source cannot be projected visually."
      beacon.dim()
    }
  },
})

const isEditable = computed(
  () =>
    Boolean(model.value) &&
    modelFile.value === editFile.value &&
    !bailReason.value &&
    !parseLoading.value &&
    // Visual inspector edits keep analysis "valid" on purpose: "checking"
    // would disable this flag and blur the focused Props field after each key.
    (!codeSession.dirty.value || codeSession.analysisStatus.value === "valid"),
)

const stagedSource = computed(() =>
  surfaceMode.value === "code" || codeSession.dirty.value
    ? codeSession.workingSource.value
    : null,
)

const selectedPage = computed(
  () =>
    props.pages.find((p) => p.route === props.selectedRoute) ??
    props.pages.find((p) => p.route === "/") ??
    null,
)
const cmsListCollectionLabel = computed(() => {
  if (selectedPage.value?.role !== "cms-collection" || !model.value?.collectionBindings) return null
  const binding = Object.values(model.value.collectionBindings).find((candidate) => candidate.cardinality === "many")
  const collection = binding?.collections[0]
  if (!collection) return null
  return collection
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
})
const pageNavigationIdentity = computed(() =>
  composerPageNavigationIdentity({
    projectPath: props.projectPath,
    selectedRoute: props.selectedRoute,
    selectedPageFile: selectedPage.value?.file ?? null,
  }),
)

const activeLayerTree = computed(() => {
  if (!model.value || modelFile.value !== editFile.value) {
    return { content: [], document: [], contentParentPath: null }
  }
  return buildComposerLayerTree(model.value, {
    layoutContract: editStack.current.value?.kind === "page" ? pageLayoutContract.value : null,
    layoutModel: editStack.current.value?.kind === "page" ? pageLayoutModel.value : null,
    layoutFile: editStack.current.value?.kind === "page" ? pageLayoutFile.value : null,
    pageDocument: editStack.current.value?.kind === "page",
    conditionContext: {
      providers: {
        route: { pathname: cmsEntryTemplatePreview.value?.previewRoute ?? props.selectedRoute },
        ...(componentPreviewSession.value?.data.props
          ? { component: componentPreviewSession.value.data.props }
          : {}),
      },
    },
  })
})

const layerTree = computed(() => {
  const current = editStack.current.value
  if (!current || current.kind === "page") {
    return activeLayerTree.value
  }
  const scoped = scopeComposerLayerTreeToInstance(activeLayerTree.value, {
    hostPath: current.hostPath ?? "",
    occurrence: current.occurrence ?? 0,
    chain: current.instanceChain ?? [],
  })
  return wrapComposerLayerTreeInActiveDocument(scoped, {
    file: current.file,
    name: current.name,
    kind: current.kind,
  })
})

function filterLayerRows(rows: ComposerLayerRow[]): ComposerLayerRow[] {
  return rows.flatMap((row) => {
    if (composerOptions.hideComments.value && row.kind === "comment") return []
    const children = filterLayerRows(row.children)
    if (
      !composerOptions.showLayoutSlots.value &&
      row.synthetic &&
      row.treeKey.startsWith("slot-group:")
    ) return children.map((child) => ({ ...child, draggable: false }))
    return [{ ...row, children }]
  })
}

const visibleLayerTree = computed(() => ({
  ...layerTree.value,
  content: filterLayerRows(layerTree.value.content),
  document: composerOptions.showDocumentLayers.value
    ? filterLayerRows(layerTree.value.document)
    : [],
}))

/** Inline editing keeps the page route; standalone components use the injected route. */
const canvasRoute = computed(() =>
  editStack.isStandalone.value
    ? (componentPreviewSession.value?.route ?? null)
    : (cmsEntryTemplatePreview.value?.previewRoute ?? props.selectedRoute),
)
const translationLocaleOptions = computed(() => [
  ...new Set(translationCatalogs.value.catalogs.flatMap((catalog) => catalog.locales)),
])
const localizedCanvasRoute = computed(() => {
  const catalog = translationCatalogs.value.catalogs[0]
  if (!catalog || !activeTranslationLocale.value) return canvasRoute.value
  return applyProjectLocaleToRoute(canvasRoute.value, {
    locale: activeTranslationLocale.value,
    defaultLocale: catalog.defaultLocale,
    locales: catalog.locales,
    resolver: catalog.resolver,
  })
})
const composerPreviewHref = computed(() =>
  props.runtime?.previewUrl
    ? previewPageUrl(props.runtime.previewUrl, localizedCanvasRoute.value)
    : null,
)

watch(surfaceMode, (mode) => {
  if (mode !== "design") composerOptions.displayMode.value = "normal"
})

watch(composerOptions.hideComments, (hidden) => {
  if (!hidden || !model.value || !beacon.selectedPath.value) return
  const selected = nodeAtMarkerPath(model.value.nodes, bareMarkerPath(beacon.selectedPath.value))
  if (selected?.kind === "comment") beacon.dim()
})
const pageMtimeMs = computed(() =>
  editStack.isStandalone.value
    ? editedMtimeMs.value
    : (props.pages.find((page) => page.file === editFile.value)?.mtimeMs ?? selectedPage.value?.mtimeMs ?? null),
)
const stageReloadKey = computed(
  () => (props.reloadKey ?? 0) + hardReloadRevision.value,
)

const insertables = computed(() => [
  ...(props.components ?? []),
  ...(props.layouts ?? []),
])
const pasteAnnouncement = ref("")

function announcePaste(message: string) {
  pasteAnnouncement.value = ""
  queueMicrotask(() => {
    pasteAnnouncement.value = message
  })
}

function handleComposerPasteResult(result: ComposerPasteResult) {
  if (result.ok) {
    const message = result.insertedCount === 1
      ? "Pasted 1 element."
      : `Pasted ${result.insertedCount} elements.`
    announcePaste(message)
    if (result.warnings.length) {
      toast.success(message, {
        description: "Unsafe or editor-only clipboard data was removed.",
      })
    }
    return
  }

  if (result.code === "empty") return
  const feedback = (() => {
    switch (result.code) {
      case "unsupported-document":
        return {
          title: "Paste full page code in Code view",
          description: "Canvas paste accepts HTML or Astro template fragments.",
        }
      case "unsafe-source":
        return {
          title: "Paste runtime code in Code view",
          description: "Canvas paste does not run frontmatter or script code.",
        }
      case "unresolved-component":
      case "ambiguous-component":
        return {
          title: "Unable to resolve pasted component",
          description: result.detail ?? "Use Code view to add or correct the component import.",
        }
      case "invalid-containment":
        return {
          title: "Unable to paste here",
          description: "Select a parent that can contain every pasted element and try again.",
        }
      case "unsafe-id-collision":
        return {
          title: "Pasted IDs conflict with this page",
          description: "Rename the conflicting ID or selector in Code view and try again.",
        }
      case "persist-failed":
        return {
          title: "Unable to save pasted code",
          description: "Resolve the current Composer save error and try again.",
        }
      case "unavailable":
        return {
          title: "Paste is unavailable",
          description: "Return to an editable Canvas or Layers selection and try again.",
        }
      default:
        return {
          title: "Unable to paste code",
          description: "Copy a valid HTML or Astro fragment and try again.",
        }
    }
  })()
  toast.error(feedback.title, { description: feedback.description })
}
const componentResolutionCache = new Map<
  string,
  { file: string; kind: "component" | "layout" }
>()
watch(() => props.projectPath, () => componentResolutionCache.clear())

const {
  dirty,
  saving,
  mutationPending,
  mutateModel,
  commitModelMutation,
  withMutationLock,
  commitInspectorMutation,
  canUndo,
  canRedo,
  saveConflict,
  saveError,
  deleteSelected,
  duplicateSelected,
  copySelected,
  cutSelected,
  pasteClipboard,
  moveSelected,
  wrapSelected,
  insertElement,
  insertAriaPrimitive,
  insertComponent,
  insertLayoutSlot,
  renameLayoutSlot,
  deleteLayoutSlot,
  inspectLayoutSlotUsage,
  assignPageLayout,
  removePageLayout,
  activatePageSlot,
  assignNodesToPageSlot,
  moveNodeTo,
  moveNodesTo,
  canMoveSelected,
  undo,
  redo,
  flushSave,
  registerBeforeFlush,
  markSaved,
  resetForPage,
  shouldIgnoreExternalReload,
  onComposerKeydown,
  onIframeShortcut,
  setSelectedProp,
  renameSelectedProp,
  setSelectedText,
  setSelectedTag,
  commitStylesheetEdit,
  commitModelWithStylesheet,
  setSelectedPropWithStylesheet,
} = useComposerDocument({
  projectPath: toRef(props, "projectPath"),
  editFile,
  editedMtimeMs,
  model,
  editable: isEditable,
  designActive: isDesignMode,
  stagedSource,
  codeDirty: codeSession.dirty,
  onStagedSourceChange: codeSession.updateSourceFromVisualMutation,
  onStagedStylesheetChange: codeSession.stageStylesheetEdit,
  draftHistoryBlocked: codeSession.hasStagedStylesheets,
  previewRevision: previewCoordinator.revision,
  reservePreviewRevision: previewCoordinator.reserveRevision,
  onModelMutation: (before, after, reservedRevision) => previewCoordinator.applyModelMutation(
    before,
    after,
    { writeDraft: stagedSource.value == null, revision: reservedRevision },
  ),
  onPersisted: (result) => {
    if (result.runtimeAssetsChanged && model.value) {
      stageRef.value?.syncMotionAssets(documentHasMotion(model.value))
    }
    previewCoordinator.markPersisted(result.previewRevision, () => stageRef.value?.clearPreviewStyle())
  },
  beacon,
  availablePages: computed(() => props.pages.map((page) => ({ file: page.file }))),
  availableComponents: insertables,
  onPasteResult: handleComposerPasteResult,
})

const interactionEditable = computed(
  () => isEditable.value && !mutationPending.value,
)

useAgentComposerHost({
  projectPath: projectPathRef,
  editFile,
  editedMtimeMs,
  model,
  editable: interactionEditable,
  dirty,
  framework: frameworkCapabilities,
  knownDesignClasses: agentKnownDesignClasses,
  beacon,
  mutateModel,
  flushSave,
})

function boundedComposerOutline() {
  const output: Array<{
    path: string
    type: string
    label: string
    depth: number
  }> = []
  const visit = (rows: ComposerLayerRow[], depth: number) => {
    for (const row of rows) {
      if (output.length >= 80) return
      output.push({
        path: row.path,
        type: row.kind,
        label: row.label.slice(0, 160),
        depth,
      })
      visit(row.children, depth + 1)
    }
  }
  visit(layerTree.value.content, 0)
  visit(layerTree.value.document, 0)
  return output
}

watch(
  [
    editFile,
    editedMtimeMs,
    interactionEditable,
    dirty,
    () => beacon.selectedPath.value,
    () => editStack.current.value?.kind,
    layerTree,
    model,
    frameworkCapabilities,
  ],
  () => {
    const file = editFile.value
    if (!file) {
      clearAgentSurfaceContext(props.projectPath, "documentContext")
      return
    }
    const selectedPath = beacon.selectedPath.value
    const selectedNode =
      selectedPath && model.value
        ? nodeAtMarkerPath(model.value.nodes, bareMarkerPath(selectedPath))
        : null
    const classPeek = selectedNode && "props" in selectedNode && selectedNode.props
      ? peekAgentNodeClassTokens(selectedNode.props)
      : null
    const outline = boundedComposerOutline()
    const selectedTag =
      selectedNode && "name" in selectedNode && typeof selectedNode.name === "string"
        ? selectedNode.name
        : selectedNode?.kind ?? null
    updateAgentSurfaceContext(props.projectPath, {
      documentContext: {
        type: editStack.current.value?.kind ?? "page",
        file,
        revision:
          editedMtimeMs.value == null ? undefined : String(editedMtimeMs.value),
        mtimeMs: editedMtimeMs.value,
        editable: interactionEditable.value,
        dirty: dirty.value,
        emptyDocument: outline.length === 0,
        selectedNodePath: selectedPath,
        selectedNodeType: selectedNode?.kind ?? null,
        selectedNodeTag: selectedTag,
        selectedNodeClasses: classPeek?.dynamic
          ? ["[dynamic]"]
          : (classPeek?.tokens ?? []).slice(0, 40),
        utilityStyles: frameworkCapabilities.value
          ? {
              framework: frameworkCapabilities.value.primary,
              enabled:
                frameworkCapabilities.value.primary !== "none" &&
                frameworkCapabilities.value.confidence === "configured",
              confidence: frameworkCapabilities.value.confidence,
              sources: frameworkCapabilities.value.sources.slice(0, 20),
              diagnostics: frameworkCapabilities.value.diagnostics.slice(0, 20),
            }
          : undefined,
        outline,
      },
    })
  },
  { immediate: true },
)

watch(
  snapshot,
  (design) => {
    if (!design) {
      clearAgentSurfaceContext(props.projectPath, "designContext")
      return
    }
    updateAgentSurfaceContext(props.projectPath, {
      designContext: {
        revision: hashRevision(design, "d"),
        classCount: design.classes.length,
        paletteCount: design.colors.palettes.length,
        fontFamilyCount:
          (design.fonts?.google?.length ?? 0) +
          (design.fonts?.custom?.length ?? 0),
      },
    })
  },
  { immediate: true, deep: true },
)

onUnmounted(() => {
  clearAgentSurfaceContext(props.projectPath, "documentContext")
  clearAgentSurfaceContext(props.projectPath, "designContext")
})

provideComposerDocument({
  model,
  editable: interactionEditable,
  mutationPending,
  designActive: isDesignMode,
  saveError,
  projectPath: toRef(props, "projectPath"),
  editFile,
  availableLayouts: computed(() =>
    (props.layouts ?? []).map((layout) => ({ name: layout.name, file: layout.file })),
  ),
  pages: computed(() => props.pages),
  documentKind: computed(() => editStack.current.value?.kind ?? "page"),
  mutateModel,
  commitModelMutation,
  withMutationLock,
  commitInspectorMutation,
  flushSave,
  registerBeforeFlush,
  previewStyle: (path, cssText, relativePath) => stageRef.value?.previewStyle({ path, cssText, relativePath }),
  clearPreviewStyle: (path, relativePath) => stageRef.value?.clearPreviewStyle(path, relativePath),
  computedStyle: (payload) => stageRef.value?.computedStyle(payload) ?? Promise.resolve({}),
  popoverPreviewTargetId,
  previewPopover,
  reloadPreview: () => { hardReloadRevision.value += 1 },
  setSelectedProp,
  renameSelectedProp,
  setSelectedText,
  setSelectedTag,
  commitStylesheetEdit,
  commitModelWithStylesheet,
  setSelectedPropWithStylesheet,
  insertElement,
  insertAriaPrimitive: (id, target) => {
    const inserted = insertAriaPrimitive(id, target)
    if (inserted && id === "popover") {
      queueMicrotask(() => {
        const path = beacon.selectedPath.value
        const node = path && model.value ? nodeAtMarkerPath(model.value.nodes, path) : null
        const targetId = node?.kind === "element" && node.props.popover != null && node.props.id?.type === "string"
          ? node.props.id.value
          : null
        if (targetId) previewPopover(targetId, true)
      })
    }
    return inserted
  },
  insertComponent,
  insertLayoutSlot,
  renameLayoutSlot,
  deleteLayoutSlot,
  inspectLayoutSlotUsage,
  assignPageLayout,
  removePageLayout,
  activatePageSlot,
  assignNodesToPageSlot,
  moveNodeTo,
  moveNodesTo,
  deleteSelected,
  duplicateSelected,
  copySelected,
  cutSelected,
  pasteClipboard,
})

const canMoveUp = computed(() => canMoveSelected("up"))
const canMoveDown = computed(() => canMoveSelected("down"))
const conflictDismissed = ref(false)

watch(saveConflict, (value) => {
  if (value) conflictDismissed.value = false
})

async function reloadAfterConflict() {
  const file = editFile.value
  if (!file) return
  await resetForPage({ flush: false })
  await loadEditFile(file, { force: true })
}

/** Drop stale parse results when the user switches files mid-flight. */
let loadGen = 0

function pageDisplayName(page: ScanPage): string {
  if (page.title?.trim()) return page.title.trim()
  const base = page.file.split("/").pop() ?? page.file
  return base.replace(/\.astro$/i, "")
}

function clearPageLayoutContext() {
  pageLayoutContract.value = null
  pageLayoutModel.value = null
  pageLayoutFile.value = null
  pageLayoutOwnerFile.value = null
}

function applyPageLayoutContext(
  ownerFile: string,
  layoutRelativeFile: string,
  layoutModel: AstroDocumentModel,
) {
  pageLayoutOwnerFile.value = ownerFile
  pageLayoutFile.value = layoutRelativeFile.replace(/\\/g, "/")
  pageLayoutModel.value = layoutModel
  pageLayoutContract.value = buildComposerLayoutContract(layoutModel)
}

function pageStackFile(): string | null {
  return editStack.stack.value.find((entry) => entry.kind === "page")?.file ?? null
}

function modelHasLayoutWrapper(doc: AstroDocumentModel | null): boolean {
  return Boolean(
    doc?.nodes.some((node) => node.kind === "component" && node.id === "layout"),
  )
}

async function resolvePageLayoutContext(
  ownerFile: string,
  doc: AstroDocumentModel,
  generation?: number,
): Promise<boolean> {
  const wrapper = doc.nodes.find(
    (node) => node.kind === "component" && node.id === "layout",
  )
  if (wrapper?.kind !== "component") {
    clearPageLayoutContext()
    return false
  }
  const imported = doc.imports.find((entry) => entry.name === wrapper.name)
  if (!imported) return false
  try {
    const schema = await extractComposerPropSchema(
      props.projectPath,
      ownerFile,
      imported.path,
    )
    if (!schema.relativeFile) return false
    const layoutResult = await parseComposerPage(
      props.projectPath,
      schema.relativeFile,
    )
    if (generation !== undefined && generation !== loadGen) return false
    if (layoutResult.editable) {
      applyPageLayoutContext(ownerFile, schema.relativeFile, layoutResult.model)
      return true
    }
  } catch {
    // The page remains editable; its unresolved layout is opaque.
  }
  return false
}

async function loadEditFile(
  relativeFile: string,
  options?: {
    force?: boolean
    /** Select an opening node when first opening a component/layout. */
    selectOpening?: boolean
    collectionProps?: Record<string, AstroCollectionBinding>
  },
) {
  if (!relativeFile) {
    const gen = ++loadGen
    parseLoading.value = true
    await resetForPage({ flush: false })
    if (gen !== loadGen) return
    model.value = null
    modelFile.value = null
    editFile.value = null
    editedMtimeMs.value = null
    clearPageLayoutContext()
    bailReason.value = "Select a page"
    parseError.value = null
    parseLoading.value = false
    beacon.dim()
    beacon.clearHover()
    return
  }

  const prevFile = editFile.value
  const sameFile = prevFile === relativeFile
  if (sameFile && !options?.force && shouldIgnoreExternalReload()) {
    return
  }

  const gen = ++loadGen
  const snap = sameFile ? beacon.getSnapshot() : null

  parseLoading.value = true
  parseError.value = null
  bailReason.value = null

  if (!sameFile) {
    await resetForPage({ flush: true })
    if (gen !== loadGen) return
    modelFile.value = null
  }

  editFile.value = relativeFile

  try {
    const inheritedProps = options?.collectionProps ?? (
      editStack.current.value?.file === relativeFile
        ? editStack.current.value.collectionProps
        : undefined
    )
    const result = await parseComposerPage(props.projectPath, relativeFile, inheritedProps)
    if (!canCommitComposerDocumentLoad({
      generation: gen,
      currentGeneration: loadGen,
      requestedFile: relativeFile,
      activeFile: editFile.value,
    })) return
    editedMtimeMs.value = result.mtimeMs
    if (result.editable) {
      model.value = result.model
      modelFile.value = relativeFile
      // Page layout projection is page-scoped: leave it alone while drilling.
      if (editStack.current.value?.kind === "page") {
        if (
          shouldClearLayoutForPageLoad({
            pageFile: relativeFile,
            layoutOwnerFile: pageLayoutOwnerFile.value,
          })
        ) {
          clearPageLayoutContext()
        }
        if (!modelHasLayoutWrapper(result.model)) {
          clearPageLayoutContext()
        } else {
          await resolvePageLayoutContext(relativeFile, result.model, gen)
          if (!canCommitComposerDocumentLoad({
            generation: gen,
            currentGeneration: loadGen,
            requestedFile: relativeFile,
            activeFile: editFile.value,
          })) return
        }
      }
      if (options?.selectOpening) {
        const openPath = openingSelectionPath(result.model.nodes)
        if (openPath) {
          beacon.illuminate(openPath, { source: "api" })
        } else {
          beacon.dim()
        }
      } else if (snap?.selectedPath) {
        const stillThere = nodeAtMarkerPath(
          result.model.nodes,
          snap.selectedPath,
        )
        if (stillThere) {
          beacon.restoreSnapshot({
            ...snap,
            hoverPath: null,
            hoverOccurrence: 0,
            structureHoverPath: null,
            structureHoverOccurrence: null,
          })
        } else {
          beacon.dim()
        }
      } else if (prevFile !== relativeFile) {
        beacon.dim()
      }
    } else {
      model.value = null
      modelFile.value = null
      bailReason.value = result.reason || "File is not visually editable"
      await resetForPage({ flush: false })
      if (gen !== loadGen) return
      beacon.dim()
    }
    await codeSession.loadDocument(result, result.mtimeMs)
    if (!canCommitComposerDocumentLoad({
      generation: gen,
      currentGeneration: loadGen,
      requestedFile: relativeFile,
      activeFile: editFile.value,
    })) return
  } catch (error) {
    if (gen !== loadGen) return
    const message = error instanceof Error ? error.message : String(error)
    if (
      shouldPreserveComposerDocumentOnLoadFailure({
        sameFile,
        hasLoadedModel: Boolean(model.value && modelFile.value === relativeFile),
      })
    ) {
      toast.error("Could not reload document", { description: message })
      return
    }
    model.value = null
    modelFile.value = null
    parseError.value = message
    await resetForPage({ flush: false })
    if (gen !== loadGen) return
    beacon.dim()
  } finally {
    if (gen === loadGen) parseLoading.value = false
  }
}

function beginDocumentTransition() {
  parseLoading.value = true
  parseError.value = null
  bailReason.value = null
  modelFile.value = null
}

let layoutContextGeneration = 0
async function refreshPageLayoutContext() {
  const generation = ++layoutContextGeneration
  const activeModel = model.value
  const activeFile = editFile.value
  const action = decidePageLayoutContextAction({
    stackKind: editStack.current.value?.kind ?? null,
    activeFile,
    pageStackFile: pageStackFile(),
    hasLayoutWrapper: modelHasLayoutWrapper(activeModel),
  })
  if (action === "preserve") return
  if (action === "clear") {
    clearPageLayoutContext()
    return
  }
  if (!activeModel || !activeFile) return
  try {
    const wrapper = activeModel.nodes.find(
      (node) => node.kind === "component" && node.id === "layout",
    )
    if (wrapper?.kind !== "component") {
      clearPageLayoutContext()
      return
    }
    const imported = activeModel.imports.find((entry) => entry.name === wrapper.name)
    if (!imported) return
    const schema = await extractComposerPropSchema(
      props.projectPath,
      activeFile,
      imported.path,
    )
    if (!schema.relativeFile) return
    const parsed = await parseComposerPage(props.projectPath, schema.relativeFile)
    if (
      generation !== layoutContextGeneration ||
      model.value !== activeModel ||
      editFile.value !== activeFile
    ) return
    if (parsed.editable) {
      applyPageLayoutContext(activeFile, schema.relativeFile, parsed.model)
    }
  } catch {
    // Keep the page model editable when its layout cannot be resolved.
  }
}

watch(
  [model, editFile, () => editStack.current.value?.kind],
  () => { void refreshPageLayoutContext() },
)

async function syncToPage() {
  const page = selectedPage.value
  if (!page?.file) {
    if (editFile.value && !(await canNavigateFromActiveDocument())) return
    componentPreviewSession.value = null
    beginDocumentTransition()
    editStack.stack.value = []
    await loadEditFile("")
    return
  }
  if (editFile.value && editFile.value !== page.file) {
    if (!(await canNavigateFromActiveDocument())) return
  }
  componentPreviewSession.value = null
  cmsEntryTemplatePreview.value = null
  if (editFile.value !== page.file) beginDocumentTransition()
  editStack.resetToPage({
    kind: "page",
    name: pageDisplayName(page),
    file: page.file,
    focusPath: null,
  })
  await loadEditFile(page.file)
}

async function prepareStandalonePreview(
  file: string,
  override = readPreviewOverride(file),
): Promise<ComposerComponentPreviewSession> {
  const session = await prepareComposerComponentPreview(
    props.projectPath,
    file,
    override,
  )
  componentPreviewSession.value = session
  const previewUrl = props.runtime?.previewUrl
  if (previewUrl) {
    try {
      await waitForComposerAuthoringPreview({
        previewUrl,
        route: session.route,
        componentFile: session.componentFile,
      })
    } catch (error) {
      toast.error("Component preview is still loading", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }
  hardReloadRevision.value += 1
  return session
}

async function canNavigateFromActiveDocument(): Promise<boolean> {
  if (mutationPending.value) return false
  if (!(await guardDirtyNavigation(props.projectPath))) return false
  try {
    await flushSave()
    return !saveConflict.value
  } catch {
    return false
  }
}

async function openStandaloneComponent(
  request: Extract<ComposerDocumentLaunchRequest, { mode: "standalone-component" }>,
) {
  // Preview preparation happens before navigation state changes. A failure
  // leaves the current Composer document and breadcrumb untouched.
  if (!(await canNavigateFromActiveDocument())) return
  await prepareStandalonePreview(request.file)
  if (editFile.value !== request.file) beginDocumentTransition()
  editStack.resetToDocument({
    kind: request.kind,
    name: request.name,
    file: request.file,
    focusPath: null,
  })
  await loadEditFile(request.file, { selectOpening: true })
}

async function updateComponentPreviewData(data: ComposerComponentPreviewData) {
  const current = componentPreviewSession.value
  if (!current || !editStack.isStandalone.value) return
  writePreviewOverride(current.componentFile, data)
  try {
    await prepareStandalonePreview(current.componentFile, {
      props: data.props,
      slots: data.slots,
    })
  } catch (error) {
    componentPreviewSession.value = {
      ...current,
      data: {
        ...data,
        diagnostics: [
          ...data.diagnostics,
          {
            field: "preview",
            severity: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      },
    }
  }
}

async function openDrilledFile(
  entry: {
    kind: "component" | "layout"
    name: string
    file: string
    focusPath?: string | null
    parentFile?: string | null
    hostPath?: string | null
    occurrence?: number
    instanceChain?: ComposerComponentInstanceSegment[]
    collectionProps?: Record<string, AstroCollectionBinding>
  },
): Promise<boolean> {
  if (editFile.value && editFile.value !== entry.file) {
    if (!(await canNavigateFromActiveDocument())) return false
  }
  const parent = editStack.current.value
  const ownerFile = entry.parentFile ?? parent?.file ?? null
  const hostPath = entry.hostPath ?? null
  const occurrence = entry.occurrence ?? 0
  const instanceChain = entry.instanceChain?.length
    ? entry.instanceChain
    : ownerFile && hostPath
      ? [
          ...(parent?.instanceChain ?? []),
          { ownerFile, hostPath, occurrence },
        ]
      : []
  if (editFile.value !== entry.file) beginDocumentTransition()
  const { added, index } = editStack.push({
    kind: entry.kind,
    name: entry.name,
    file: entry.file,
    focusPath: entry.focusPath ?? null,
    parentFile: ownerFile,
    hostPath,
    occurrence,
    instanceChain,
    collectionProps: entry.collectionProps,
  })
  // Duplicate file already on the trail: stack was truncated to that entry.
  // Skip reload when it's already the open file (re-dblclick same component).
  if (!added) {
    if (editFile.value === entry.file) return true
    const next = editStack.stack.value[index]
    if (!next) return false
    await loadEditFile(next.file, {
      selectOpening: next.kind !== "page",
    })
    return true
  }
  await loadEditFile(entry.file, {
    selectOpening: true,
    collectionProps: entry.collectionProps,
  })
  return true
}

async function closeDrillLevel() {
  if (editStack.isStandalone.value && !editStack.isDrilling.value) {
    const ok = await canNavigateFromActiveDocument()
    if (ok) emit("exit-standalone")
    return
  }
  if (!editStack.isDrilling.value) return
  if (!(await canNavigateFromActiveDocument())) return
  const target = editStack.stack.value.at(-2)
  if (target && editFile.value !== target.file) beginDocumentTransition()
  const next = editStack.pop()
  if (!next) return
  await loadEditFile(next.file, {
    selectOpening: next.kind !== "page",
  })
}

async function goToStackIndex(index: number) {
  if (!(await canNavigateFromActiveDocument())) return
  const target = editStack.stack.value[index]
  if (target && editFile.value !== target.file) beginDocumentTransition()
  const next = editStack.goTo(index)
  if (!next) return
  await loadEditFile(next.file, {
    selectOpening: next.kind !== "page",
  })
}

/**
 * Resolve a component/layout tag on the current model to a project file.
 * Prefer the host file's import, then scan lists.
 */
async function resolveComponentFile(
  name: string,
): Promise<
  | { status: "resolved"; file: string; kind: "component" | "layout" }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "unresolved" }
> {
  const hostFile = editFile.value
  const imports = model.value?.imports ?? []
  const spec = imports.find((i) => i.name === name)?.path
  const cacheKey = `${hostFile ?? ""}|${name}|${spec ?? ""}`
  const cached = componentResolutionCache.get(cacheKey)
  if (cached) return { status: "resolved", ...cached }
  if (spec && hostFile) {
    try {
      const schema = await extractComposerPropSchema(
        props.projectPath,
        hostFile,
        spec,
      )
      if (schema.relativeFile && /\.astro$/i.test(schema.relativeFile)) {
        const file = schema.relativeFile.replace(/\\/g, "/")
        const kind = /\/layouts\//i.test(file) ? "layout" : "component"
        const resolved = { file, kind } as const
        componentResolutionCache.set(cacheKey, resolved)
        return { status: "resolved", ...resolved }
      }
      if (schema.relativeFile) {
        // Framework island — no Astro tree to drill into.
        return { status: "unresolved" }
      }
    } catch {
      /* fall through to scan */
    }
  }

  const fallback = resolveComposerComponentFallback({
    name,
    importSpec: spec,
    candidates: insertables.value
      .filter((candidate) => /\.astro$/i.test(candidate.file))
      .map((candidate) => ({
        name: candidate.name,
        file: candidate.file.replace(/\\/g, "/"),
        kind: /\/layouts\//i.test(candidate.file)
          ? "layout" as const
          : "component" as const,
      })),
  })
  if (fallback.status === "resolved") {
    const resolved = fallback.candidate
    componentResolutionCache.set(cacheKey, resolved)
    return { status: "resolved", ...resolved }
  }
  if (fallback.status === "ambiguous") {
    return {
      status: "ambiguous",
      candidates: fallback.candidates.map((candidate) => candidate.file),
    }
  }
  return { status: "unresolved" }
}

async function drillIntoNode(options: {
  /** Page- or scope-namespace path of the instance (for focus dimming). */
  hostPath: string
  name: string
  kindHint?: "component" | "layout"
  occurrence?: number
  parentChain?: ComposerComponentInstanceSegment[]
}): Promise<boolean> {
  const resolved = await resolveComponentFile(options.name)
  if (resolved.status !== "resolved") {
    toast.error("Could not open component", {
      description:
        resolved.status === "ambiguous"
          ? `Multiple ${options.name} components match this invocation: ${resolved.candidates.join(", ")}.`
          : `Aria could not resolve ${options.name} to an editable Astro file.`,
    })
    return false
  }

  const ownerFile = editFile.value
  if (!ownerFile) {
    toast.error("Could not open component", {
      description: "The component's owning document is not open.",
    })
    return false
  }
  const hostPath = bareMarkerPath(options.hostPath)
  const occurrence = options.occurrence ?? 0
  const parentChain = options.parentChain ?? editStack.current.value?.instanceChain ?? []
  const instanceChain: ComposerComponentInstanceSegment[] = [
    ...parentChain,
    { ownerFile, hostPath, occurrence },
  ]
  const hostNode = model.value ? nodeAtMarkerPath(model.value.nodes, hostPath) : null
  const collectionProps = hostNode
    ? astroCollectionPropsForComponent(hostNode, model.value?.collectionBindings ?? {})
    : {}

  // Outermost focus stays when nesting; page-namespace host path when first drill.
  const focusPath =
    editStack.focusPath.value ??
    (editStack.isDrilling.value
      ? null
      : bareMarkerPath(options.hostPath))

  return openDrilledFile({
    kind: options.kindHint ?? resolved.kind,
    name: options.name,
    file: resolved.file,
    focusPath,
    parentFile: ownerFile,
    hostPath,
    occurrence,
    instanceChain,
    collectionProps,
  })
}

async function onCanvasOpen(payload: { path: string; occurrence: number }) {
  if (!isDesignMode.value || !model.value) return
  const canvasPath = payload.path
  // When already drilling, open messages are scoped — resolve against open model.
  const modelPath = editStack.pathScope.value
    ? bareMarkerPath(canvasPath)
    : canvasPath
  const node = nodeAtMarkerPath(model.value.nodes, modelPath)
  if (!node || node.kind !== "component") return
  // Layout wrapper uses id "layout".
  const kindHint =
    node.id === "layout" || /layout/i.test(node.name) ? "layout" : "component"
  await drillIntoNode({
    hostPath: canvasPath,
    name: node.name,
    kindHint,
    occurrence: payload.occurrence,
  })
}

function onCanvasPaste(payload: { text: string; html: string; aria: string }) {
  void pasteClipboard(payload)
}

async function openOwnedStructureRow(row: ComposerLayerRow): Promise<boolean> {
  if (!model.value || !editFile.value) {
    toast.error("Could not open component", {
      description: "The component's owning document could not be loaded.",
    })
    return false
  }
  const address = row.address ?? { file: editFile.value, path: row.path }
  if (address.file !== editFile.value) return false
  const path = address.path
  const node = nodeAtMarkerPath(model.value.nodes, path)
  if (!node || node.kind !== "component") {
    toast.error("Could not open component", {
      description: `${row.label} is no longer available in ${address.file}.`,
    })
    return false
  }
  const kindHint =
    node.id === "layout" || /layout/i.test(node.name) ? "layout" : "component"
  return drillIntoNode({
    hostPath: path,
    name: node.name,
    kindHint,
    occurrence: 0,
    parentChain: editStack.current.value?.instanceChain ?? [],
  })
}

async function onStructureOpen(row: ComposerLayerRow) {
  const address = row.address
  if (address && address.file !== editFile.value) {
    await onStructureNavigate(row, true)
    return
  }
  await openOwnedStructureRow(row)
}

async function onStructureNavigate(row: ComposerLayerRow, open = false) {
  if (row.synthetic && row.insertTarget && row.treeKey.startsWith("slot-group:")) {
    activatePageSlot(row.slotName ?? null, row.insertTarget)
    return
  }
  const address = row.address
  if (!address || address.file === editFile.value) {
    if (open && row.kind === "component") {
      await openOwnedStructureRow(row)
      return
    }
    if (!row.synthetic) {
      beacon.illuminate(row.path, {
        occurrence: row.instance?.occurrence ?? 0,
        source: "structure",
      })
    }
    return
  }
  if (
    address.file === pageLayoutFile.value &&
    pageLayoutModel.value
  ) {
    const contextualNode = nodeAtMarkerPath(
      pageLayoutModel.value.nodes,
      address.path,
    )
    if (contextualNode) {
      if (open && contextualNode.kind === "component" && model.value) {
        const layoutPath = resolveLayoutPageContentParentPath(model.value)
        const layoutNode = layoutPath
          ? nodeAtMarkerPath(model.value.nodes, layoutPath)
          : null
        if (!layoutPath || layoutNode?.kind !== "component") {
          toast.error("Could not open component", {
            description: "The page layout invocation is no longer available.",
          })
          return
        }
        const layoutOpened = await drillIntoNode({
          hostPath: layoutPath,
          name: layoutNode.name,
          kindHint: "layout",
          occurrence: 0,
          parentChain: editStack.current.value?.instanceChain ?? [],
        })
        if (!layoutOpened || editFile.value !== address.file) return
        await openOwnedStructureRow({ ...row, contextOnly: false })
        return
      }
      const importSpec = contextualNode.kind === "component"
        ? pageLayoutModel.value.imports.find(
            (candidate) => candidate.name === contextualNode.name,
          )?.path ?? null
        : null
      beacon.inspectContext({
        file: address.file,
        path: address.path,
        label: row.label,
        node: contextualNode,
        importSpec,
      })
      return
    }
  }
  const index = editStack.stack.value.findIndex((entry) => entry.file === address.file)
  if (index < 0) {
    toast.error("Could not open component", {
      description: `${row.label} belongs to context that is not in the current editing trail.`,
    })
    return
  }
  if (!(await canNavigateFromActiveDocument())) return
  const next = editStack.goTo(index)
  if (!next) return
  await loadEditFile(next.file)
  if (open && row.kind === "component") {
    await openOwnedStructureRow({ ...row, contextOnly: false })
    return
  }
  if (nodeAtMarkerPath(model.value?.nodes ?? [], address.path)) {
    beacon.illuminate(address.path, { source: "structure" })
  }
}

async function applyDocumentLaunch(req: ComposerDocumentLaunchRequest) {
  if (req.mode === "standalone-component") {
    await openStandaloneComponent(req)
    return
  }
  if (req.mode === "page") {
    await syncToPage()
    return
  }
  if (req.mode === "cms-entry-template") {
    if (editFile.value && editFile.value !== req.file && !(await canNavigateFromActiveDocument())) return
    componentPreviewSession.value = null
    cmsEntryTemplatePreview.value = { ...req.context }
    beginDocumentTransition()
    editStack.resetToPage({
      kind: "page",
      name: req.name,
      file: req.file,
      focusPath: null,
    })
    await loadEditFile(req.file, { selectOpening: true })
    return
  }
  // Ensure page stack exists so we can return.
  if (!editStack.stack.value.length && selectedPage.value?.file) {
    editStack.resetToPage({
      kind: "page",
      name: pageDisplayName(selectedPage.value),
      file: selectedPage.value.file,
      focusPath: null,
    })
    // Load page first only if we aren't already on a file — stack reset above
    // doesn't load; openDrilledFile will load the layout/component.
    if (!editFile.value) {
      await loadEditFile(selectedPage.value.file)
    }
  }
  await openDrilledFile({
    kind: req.kind,
    name: req.name,
    file: req.file,
    focusPath: req.hostPath,
    parentFile: req.parentFile,
    hostPath: req.hostPath,
    occurrence: req.occurrence,
    instanceChain: req.instanceChain ?? [],
  })
}

function selectCmsPreviewEntry(entryId: string) {
  const context = cmsEntryTemplatePreview.value
  if (!context) return
  const entry = context.entries.find((candidate) => candidate.id === entryId)
  if (!entry) return
  cmsEntryTemplatePreview.value = {
    ...context,
    selectedEntryId: entry.id,
    previewRoute: entry.route,
  }
}

async function onSurfaceMode(mode: ComposerSurfaceMode) {
  if (mode === surfaceMode.value) return
  if (mode === "code" && !codeSession.dirty.value) {
    try {
      await flushSave()
      if (saveConflict.value) return
      if (editFile.value) await loadEditFile(editFile.value, { force: true })
    } catch {
      return
    }
  }
  surfaceMode.value = mode
  if (mode !== "code") previewMode.value = mode
  if (mode === "interactive") {
    beacon.clearHover()
    beacon.dim()
  }
}

function exitPreview() {
  void onSurfaceMode("design")
}

function onCodeLayout(layout: ComposerCodeLayout) {
  codeLayout.value = layout
  localStorage.setItem(CODE_LAYOUT_KEY, layout)
}

async function applyCode() {
  if (await codeSession.apply()) {
    markSaved()
  }
}

async function discardCode() {
  await codeSession.discard()
  markSaved()
}

const canSave = computed(() => {
  if (saving.value || mutationPending.value || codeSession.applying.value || saveConflict.value) return false
  if (codeSession.dirty.value) return codeSession.canApply.value
  if (!dirty.value) return false
  // Code mode with a clean editor must still allow document flush.
  return isEditable.value
})

async function onManualSave() {
  if (!canSave.value) return
  if (codeSession.dirty.value) {
    await applyCode()
    return
  }
  try {
    await flushSave()
  } catch {
    /* saveConflict / saveError already set — canvas banner shows it */
  }
}

const selectedCodeRange = computed(() => {
  if (codeSession.dirty.value && codeSession.analysisStatus.value !== "valid") return null
  const path = beacon.selectedPath.value
  const node = path && model.value
    ? nodeAtMarkerPath(model.value.nodes, bareMarkerPath(path))
    : null
  // Plain copy: avoid nested reactive identity so the editor can key on from/to.
  const range = node?.sourceRange
  if (!range) return null
  return { from: range.from, to: range.to }
})

/**
 * Bumps only for non-code selection sources so CodeMirror reveals/scrolls the
 * node range when layers/canvas/api change selection — without fighting the
 * caret when the user clicked in the code editor (mirrors canvasClickPath).
 */
const codeRevealNonce = ref(0)
let openingCodeForRaw = false
watch(
  () => beacon.selectedPath.value,
  (path) => {
    if (!path) return
    if (beacon.codeClickPath.value === path) {
      beacon.codeClickPath.value = null
      return
    }
    const node = model.value
      ? nodeAtMarkerPath(model.value.nodes, bareMarkerPath(path))
      : null
    if (shouldOpenCodeModeForSelection({
      nodeKind: node?.kind,
      alreadyInCode: surfaceMode.value === "code" || openingCodeForRaw,
      fromCodeEditor: false,
    })) {
      openingCodeForRaw = true
      void (async () => {
        try {
          await onSurfaceMode("code")
          codeRevealNonce.value += 1
        } finally {
          openingCodeForRaw = false
        }
      })()
      return
    }
    codeRevealNonce.value += 1
  },
)

function onCodeSelection(range: { from: number; to: number }) {
  if (!model.value || (codeSession.dirty.value && codeSession.analysisStatus.value !== "valid")) return
  const path = visibleCodeSelectionPath(model.value, range.from)
  if (path && path !== bareMarkerPath(beacon.selectedPath.value ?? "")) {
    beacon.illuminate(path, { source: "code" })
  }
}

let unregisterCodeDirty: (() => void) | null = null
let unregisterDocumentDirty: (() => void) | null = null

function dirtyDocumentLabel(
  kind: "page" | "component" | "layout" | undefined,
): string {
  if (kind === "layout") return m.dirty_navigation_composer_layout()
  if (kind === "component") return m.dirty_navigation_composer_component()
  return m.dirty_navigation_composer_document()
}

watch(
  [() => props.projectPath, editFile, () => editStack.current.value?.kind],
  ([projectPath, file]) => {
    unregisterCodeDirty?.()
    unregisterCodeDirty = null
    unregisterDocumentDirty?.()
    unregisterDocumentDirty = null
    if (!file) return
    unregisterCodeDirty = registerDirtyState(
      projectPath,
      `composer-code:${file}`,
      {
        label: `Code draft · ${file}`,
        saveLabel: m.composer_code_apply(),
        discardLabel: m.composer_code_discard(),
        isDirty: () => codeSession.dirty.value,
        save: applyCode,
        discard: discardCode,
      },
    )
    unregisterDocumentDirty = registerDirtyState(
      projectPath,
      `composer-document:${file}`,
      {
        label: dirtyDocumentLabel(editStack.current.value?.kind),
        saveLabel: m.composer_canvas_save(),
        isDirty: () =>
          dirty.value && !codeSession.dirty.value && !saveConflict.value,
        save: async () => {
          try {
            await flushSave()
          } catch {
            return false
          }
          return !dirty.value
        },
        discard: async () => {
          await resetForPage({ flush: false })
          if (editFile.value) await loadEditFile(editFile.value, { force: true })
        },
      },
    )
  },
  { immediate: true },
)

function onStructureAction(action: string) {
  switch (action) {
    case "copy":
      void copySelected()
      break
    case "paste":
      void pasteClipboard()
      break
    case "delete":
      deleteSelected()
      break
    case "duplicate":
      duplicateSelected()
      break
    case "move-up":
      moveSelected("up")
      break
    case "move-down":
      moveSelected("down")
      break
    case "wrap-section":
      wrapSelected("section")
      break
    case "wrap-container":
      wrapSelected("container")
      break
    case "wrap-div":
      wrapSelected("div")
      break
    case "inspect-motion":
      void inspectorRef.value?.activateTab("motion")
      break
    case "inspect-cms":
      void inspectorRef.value?.activateTab("props")
      break
    default:
      break
  }
}

// Route / page changes leave any drill-down and reload the page model.
// launchTicket also fires when a layout/component is opened from the quick
// switcher while Composer is already mounted (rail select is a no-op then).
watch(
  [
    pageNavigationIdentity,
    () => composerDocumentLaunchTicket(props.projectPath),
  ],
  async () => {
    const pending = takeComposerDocumentLaunchRequest(props.projectPath)
    if (pending?.mode === "standalone-component") {
      await applyDocumentLaunch(pending)
      return
    }
    await syncToPage()
    if (pending) await applyDocumentLaunch(pending)
  },
  { immediate: true },
)

// External reloads use raw source revisions. Editing-scope changes are not
// included here, so entering/leaving a component cannot reload the old file.
watch(
  () =>
    [
      props.reloadKey ?? 0,
      selectedPage.value?.mtimeMs ?? 0,
    ] as const,
  ([reloadKey, pageMtimeMs], prev) => {
    if (!prev) return
    const file = composerExternalReloadFile({
      activeFile: editFile.value,
      selectedPageFile: selectedPage.value?.file ?? null,
      drilling: editStack.isDrilling.value,
      standalone: editStack.isStandalone.value,
      reloadKey,
      previousReloadKey: prev[0],
      pageMtimeMs,
      previousPageMtimeMs: prev[1],
    })
    if (!file) return
    void loadEditFile(file)
  },
)

watch(
  () => props.selectedRoute,
  (next, prev) => {
    if (next !== prev) {
      beacon.clearHover()
    }
  },
)

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    if (surfaceMode.value === "interactive") {
      event.preventDefault()
      exitPreview()
      return
    }
    if (editStack.isDrilling.value) {
      if (!shouldCloseComposerDrillForEscape(event)) return
      event.preventDefault()
      void closeDrillLevel()
      return
    }
  }
  const mod = event.metaKey || event.ctrlKey
  if (mod && !event.shiftKey && event.key.toLowerCase() === "s") {
    event.preventDefault()
    void onManualSave()
    return
  }
  onComposerKeydown(event)
}

onMounted(() => {
  window.addEventListener("keydown", onKeyDown)
})

onUnmounted(() => {
  emit("active-document-change", null)
  emit("preview-immersive-change", false)
  unregisterCodeDirty?.()
  unregisterCodeDirty = null
  unregisterDocumentDirty?.()
  unregisterDocumentDirty = null
  window.removeEventListener("keydown", onKeyDown)
  void flushSave().catch(() => {
    /* ignore on teardown */
  })
})
</script>

<template>
  <div
    class="flex h-full min-h-0 min-w-0 flex-1"
    data-aria-composer-surface
    :data-preview-mode="surfaceMode"
    :data-drilling="editStack.isDrilling.value ? '1' : undefined"
  >
    <p
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ pasteAnnouncement }}
    </p>
    <ComposerLeftPanel
      v-show="!isPreviewImmersive"
      :tree="visibleLayerTree"
      :components="components ?? []"
      :loading="parseLoading"
      :error="parseError"
      :bail-reason="bailReason"
      :design-active="isDesignMode"
      :editable="interactionEditable"
      :can-move-up="canMoveUp"
      :can-move-down="canMoveDown"
      :edit-file="editFile"
      :project-path="projectPath"
      :agent-shell-context="agentShellContext"
      @structure-action="onStructureAction"
      @structure-open="onStructureOpen"
      @structure-navigate="onStructureNavigate"
    />

    <div class="composer-center-container relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ComposerCanvasBar
        v-show="!isPreviewImmersive"
        :mode="surfaceMode"
        :device="device"
        :dirty="dirty || codeSession.dirty.value"
        :saving="saving || mutationPending || codeSession.applying.value"
        :can-save="canSave"
        :code-layout="codeLayout"
        :code-dirty="codeSession.dirty.value"
        :code-can-apply="codeSession.canApply.value"
        :code-applying="codeSession.applying.value"
        :code-recovery-conflict="codeSession.recoveryConflict.value"
        :can-undo="canUndo"
        :can-redo="canRedo"
        :save-blocked="Boolean(saveConflict)"
        :save-conflict="conflictDismissed ? null : saveConflict"
        :save-error="saveConflict ? null : saveError"
        :edit-stack="editStack.stack.value"
        :standalone="editStack.isStandalone.value"
        :component-preview-session="componentPreviewSession"
        :cms-entry-template-preview="cmsEntryTemplatePreview"
        :cms-list-collection-label="cmsListCollectionLabel"
        :display-mode="composerOptions.displayMode.value"
        :show-selection-toolbar="composerOptions.showSelectionToolbar.value"
        :show-selection-sizing="composerOptions.showSelectionSizing.value"
        :show-layout-slots="composerOptions.showLayoutSlots.value"
        :show-document-layers="composerOptions.showDocumentLayers.value"
        :hide-comments="composerOptions.hideComments.value"
        :preview-href="composerPreviewHref"
        :translation-locales="translationLocaleOptions"
        :translation-locale="activeTranslationLocale"
        @update:mode="onSurfaceMode"
        @update:code-layout="onCodeLayout"
        @apply-code="applyCode"
        @discard-code="discardCode"
        @mark-code-merged="codeSession.markRecoveryMerged"
        @save="onManualSave"
        @undo="undo"
        @redo="redo"
        @device-change="emit('device-change', $event)"
        @reload-preview="hardReloadRevision += 1"
        @select-translation-locale="activeTranslationLocale = $event"
        @back="closeDrillLevel"
        @crumb="goToStackIndex"
        @reload-conflict="reloadAfterConflict"
        @dismiss-conflict="conflictDismissed = true"
        @update-preview-data="updateComponentPreviewData"
        @select-cms-preview-entry="selectCmsPreviewEntry"
        @update:display-mode="composerOptions.displayMode.value = $event"
        @update:show-selection-toolbar="composerOptions.showSelectionToolbar.value = $event"
        @update:show-selection-sizing="composerOptions.showSelectionSizing.value = $event"
        @update:show-layout-slots="composerOptions.showLayoutSlots.value = $event"
        @update:show-document-layers="composerOptions.showDocumentLayers.value = $event"
        @update:hide-comments="composerOptions.hideComments.value = $event"
      />
      <TooltipProvider v-if="isPreviewImmersive" :delay-duration="0" :skip-delay-duration="0">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              class="absolute top-2 right-2 z-50 shadow-lg"
              :aria-label="m.composer_mode_exit_preview()"
              data-aria-composer-exit-preview
              @click="exitPreview"
            >
              <AppIcon name="eyeOff" :size="18" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <div class="font-medium">{{ m.composer_mode_exit_preview() }}</div>
            <div class="mt-0.5 text-muted-foreground">{{ m.composer_mode_exit_preview_hint() }}</div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <ComposerCodeFallbackHost
        v-if="showCodeFallback && !isPreviewImmersive"
        :reason="bailReason"
        :enabled="true"
      />
      <div
        id="composer-work-area"
        class="composer-work-area min-h-0 min-w-0 flex-1"
        :class="{
          'composer-code-full': surfaceMode === 'code' && codeLayout === 'full',
          'composer-code-split': isCodeSplit,
        }"
        role="tabpanel"
        :aria-label="isPreviewImmersive ? m.composer_mode_interactive() : undefined"
        :aria-labelledby="isPreviewImmersive ? undefined : `composer-mode-tab-${surfaceMode}`"
      >
        <!--
          One Stage forever: design / code / layout switches must not remount
          the iframe. Preview mounts a sibling all-breakpoints board and hides
          Stage with v-show so returning to Design does not handshake again.
        -->
        <ResizablePanelGroup
          :direction="codeSplitDirection"
          :auto-save-id="isCodeSplit ? `aria.composer.code-split.${codeLayout}` : undefined"
          class="h-full min-h-0 min-w-0"
        >
          <ResizablePanel
            id="composer-stage-panel"
            :order="1"
            :default-size="stagePanelDefaultSize"
            :min-size="stagePanelMinSize"
            :max-size="showStage ? 100 : 0"
            class="min-h-0 min-w-0 overflow-hidden"
          >
            <div class="relative flex h-full min-h-0 min-w-0 flex-col">
              <Stage
                v-show="showStage && !isPreviewImmersive"
                ref="stageRef"
                class="h-full min-h-0 min-w-0"
                :project-path="projectPath"
                :selected-route="localizedCanvasRoute"
                :page-mtime-ms="pageMtimeMs"
                :device="device"
                :runtime="runtime"
                :reload-key="stageReloadKey"
                :document-model="model"
                :design-mode="true"
                :canvas-active="showStage && !isPreviewImmersive && active !== false"
                :font-stylesheet-urls="composerFontStylesheetUrlsValue"
                :path-scope="editStack.pathScope.value"
                :focus-path="editStack.focusPath.value"
                :empty-document="interactionEditable && (model?.nodes.length ?? 0) === 0"
                :display-mode="composerOptions.displayMode.value"
                :show-selection-toolbar="composerOptions.showSelectionToolbar.value"
                :show-selection-sizing="composerOptions.showSelectionSizing.value"
                @shortcut="onIframeShortcut"
                @paste="onCanvasPaste"
                @open="onCanvasOpen"
                @exit-drill="closeDrillLevel"
                @patch-result="previewCoordinator.onPatchResult"
                @reconcile-result="previewCoordinator.onReconcileResult"
                @hard-reload="hardReloadRevision += 1"
              />
              <ComposerBreakpointBoard
                v-if="showStage && isPreviewImmersive"
                class="h-full min-h-0 min-w-0 flex-1"
                :preview-url="runtime?.previewUrl ?? null"
                :selected-route="localizedCanvasRoute"
                :reload-key="stageReloadKey"
                :isolated-device="previewIsolatedDevice ?? null"
              />
            </div>
          </ResizablePanel>
          <ResizableHandle v-if="isCodeSplit" with-handle />
          <ResizablePanel
            id="composer-code-panel"
            :order="2"
            :default-size="codePanelDefaultSize"
            :min-size="codePanelMinSize"
            :max-size="showCodePanel ? 100 : 0"
            class="min-h-0 min-w-0 overflow-hidden"
          >
            <ComposerCodeSurface
              v-show="showCodePanel"
              class="h-full min-h-0 min-w-0"
              :source="codeSession.workingSource.value"
              :project-path="projectPath"
              :file="editFile"
              :status="codeSession.analysisStatus.value"
              :message="codeSession.statusMessage.value"
              :selection-range="selectedCodeRange"
              :selection-reveal-nonce="codeRevealNonce"
              @update:source="codeSession.updateSource"
              @select="onCodeSelection"
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>

    <ComposerInspectorHost v-show="!isPreviewImmersive" ref="inspectorRef" />
  </div>
</template>

<style scoped>
.composer-center-container {
  container-type: inline-size;
}

.composer-work-area {
  display: flex;
  min-height: 0;
}

.composer-code-full,
.composer-code-split {
  display: block;
  min-height: 0;
}
</style>
