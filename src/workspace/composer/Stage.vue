<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import type { DevicePreview } from "@/workspace/types"
import { STAGE_DEVICE_WIDTH } from "./devicePreview"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/ui/app-icon"
import { Spinner } from "@/components/ui/spinner"
import { captureThumbs } from "@/lib/thumbs"
import { m } from "@/paraglide/messages.js"
import { cn } from "@/lib/utils"
import {
  installSessionDeps,
  replaceExternalSessionRuntime,
  restartSessionRuntime,
  startSessionRuntime,
  type ProjectRuntimeSession,
} from "@/lib/sessions"
import { confirm } from "@/composables/useConfirm"
import { isPreviewMessageOrigin, previewPageUrl, previewWindowMatchesOrigin } from "@/lib/preview"
import {
  ARIA_BRIDGE_ID,
  ARIA_MSG,
  ARIA_PROTOCOL_VERSION,
  isAriaIframeToHostMessage,
  type AriaClickMessage,
  type AriaComputedStyleResponseMessage,
  type AriaHoverMessage,
  type AriaDropHitMessage,
  type AriaOpenMessage,
  type AriaPasteMessage,
  type AriaPatchResultMessage,
  type AriaReadyMessage,
  type AriaReloadReason,
  type AriaReconcileResultMessage,
  type AriaRect,
  type AriaRectsMessage,
  type AriaShortcutMessage,
  type AriaViewportMessage,
} from "../../../shared/composer/protocol"
import type { AstroDocumentModel } from "../../../shared/composer/types"
import {
  composerOverlayRects,
  visualAffordanceRect,
} from "../../../shared/composer/overlays"
import { resolveCanvasDropTarget } from "../../../shared/composer/mutate"
import { composerRichTextOwnerPath } from "../../../shared/composer/richText"
import {
  bareMarkerPath,
  isMarkerPathInScope,
  isUnderFocusPath,
  nodeAtMarkerPath,
  overlayInfoForPath,
  scopedMarkerPath,
} from "../../../shared/composer/paths"
import FlickeringGrid from "@/components/welcome/FlickeringGrid.vue"
import StageCanvasPreloader from "./StageCanvasPreloader.vue"
import StageOverlays, {
  type OverlayBox,
} from "./overlays/StageOverlays.vue"
import { tryUseComposerBeacon } from "./selection/useComposerBeacon"
import { tryUseComposerBridgeClasses } from "./useComposerBridgeClasses"
import { tryUseComposerDocument } from "./useComposerDocumentSession"
import {
  clearComposerDrag,
  COMPOSER_DRAG_CHANGE_EVENT,
  dragChildTag,
  getComposerDrag,
} from "./dragState"
import type { ComposerDisplayMode } from "./chrome/useComposerOptions"
import { composerPreviewRouteMismatch } from "./previewRouteState"

const props = defineProps<{
  projectPath: string
  selectedRoute: string | null
  /** Scan mtime for the selected page — used to invalidate page thumbs. */
  pageMtimeMs?: number | null
  device: DevicePreview
  runtime: ProjectRuntimeSession | null
  /** Bump to remount the preview iframe without restarting Astro. */
  reloadKey?: number
  /** Parsed editable model for overlay labels (from ComposerSurface). */
  documentModel?: AstroDocumentModel | null
  /**
   * Always load the design-instrumented preview (`#aria-design`). Preview mode
   * toggles interaction via postMessage instead of remounting the iframe.
   */
  designMode?: boolean
  /**
   * Marker namespace while drilling into a component/layout
   * (`src/components/Card.astro|`). Empty on the page.
   */
  pathScope?: string
  /**
   * Page-namespace path of the instance being edited — dims everything else.
   */
  focusPath?: string | null
  /** Active Astro file has no authored roots; render an editor-only target. */
  emptyDocument?: boolean
  displayMode?: ComposerDisplayMode
  showSelectionToolbar?: boolean
  showSelectionSizing?: boolean
  /**
   * False while Code-full hides the canvas. Stage stays mounted; host uses this
   * to refresh geometry when the canvas becomes visible again.
   */
  canvasActive?: boolean
  /** Editor-owned font CSS synchronized into the preview document. */
  fontStylesheetUrls?: string[]
}>()

const emit = defineEmits<{
  /** Design iframe forwarded an edit chord (Delete / ⌘Z / ⌘D …). */
  shortcut: [payload: { key: string; meta: boolean; shift: boolean }]
  paste: [payload: { text: string; html: string; aria: string }]
  /** Double-click a canvas node — host may drill into that component. */
  open: [payload: { path: string; occurrence: number }]
  /** Click outside the focused instance while drilling — host pops the stack. */
  "exit-drill": []
  "hard-reload": [payload: { revision: number; reason: string }]
  "patch-result": [payload: AriaPatchResultMessage]
  "reconcile-result": [payload: AriaReconcileResultMessage]
}>()

const busy = ref(false)
const bootRequested = ref(false)
const actionError = ref<string | null>(null)
const iframeAEl = ref<HTMLIFrameElement | null>(null)
const iframeBEl = ref<HTMLIFrameElement | null>(null)
const activeFrameSlot = ref<"a" | "b">("a")
const frameASrc = ref<string | null>(null)
const frameBSrc = ref<string | null>(null)
const frameAToken = ref("")
const frameBToken = ref("")
const previewPopoverId = ref<string | null>(null)
const iframeEl = computed(() => activeFrameSlot.value === "a" ? iframeAEl.value : iframeBEl.value)
const controlledReload = ref(false)
const controlledReloadError = ref(false)
const controlledReloadReason = ref("")
type BridgeState = "idle" | "connecting" | "ready" | "stale" | "failed"
const bridgeState = ref<BridgeState>("idle")
const bridgeDetail = ref("")
const bridgeRestarting = ref(false)
let bridgeHandshakeTimer: ReturnType<typeof setTimeout> | null = null
let controlledReloadRevision = 0
let controlledReloadTimer: ReturnType<typeof setTimeout> | null = null
let latestReconcileRevision = 0

function clearControlledReloadTimer() {
  if (controlledReloadTimer) clearTimeout(controlledReloadTimer)
  controlledReloadTimer = null
}

function clearBridgeHandshakeTimer() {
  if (bridgeHandshakeTimer) clearTimeout(bridgeHandshakeTimer)
  bridgeHandshakeTimer = null
}

function beginInitialBridgeHandshake(slot: "a" | "b") {
  if (previewTargetOrigin.value || slot !== activeFrameSlot.value) return
  clearBridgeHandshakeTimer()
  bridgeState.value = "connecting"
  bridgeDetail.value = ""
  const expectedToken = slot === "a" ? frameAToken.value : frameBToken.value
  bridgeHandshakeTimer = setTimeout(() => {
    bridgeHandshakeTimer = null
    const currentToken = slot === "a" ? frameAToken.value : frameBToken.value
    if (
      slot === activeFrameSlot.value &&
      currentToken === expectedToken &&
      !previewTargetOrigin.value
    ) {
      bridgeState.value = "failed"
      bridgeDetail.value = "The preview loaded, but its selection bridge did not respond."
    }
  }, 10_000)
}

function beginControlledReload(payload: { revision: number; reason: string }) {
  clearControlledReloadTimer()
  controlledReload.value = true
  controlledReloadError.value = false
  controlledReloadReason.value = payload.reason
  controlledReloadRevision = payload.revision
  controlledReloadTimer = setTimeout(() => {
    controlledReloadTimer = null
    controlledReloadError.value = true
  }, 10_000)
  startWarmFrame(payload.revision)
}

function retryControlledReload() {
  beginControlledReload({
    revision: controlledReloadRevision,
    reason: controlledReloadReason.value || "controlled-reload-retry",
  })
}
const canvasFrameEl = ref<HTMLDivElement | null>(null)
/** Actual recipient origin announced by the current iframe bridge. */
const previewTargetOrigin = ref<string | null>(null)
const renderedPathname = ref<string | null>(null)
const computedStyleRequests = new Map<string, {
  resolve: (values: Record<string, string>) => void
  timeout: ReturnType<typeof setTimeout>
}>()
let computedStyleRequestSequence = 0
let trackingRevision = 0
let viewportSnapshot: {
  identity: string
  x: number
  y: number
} | null = null
let lastSentRevealNonce = 0

const beacon = tryUseComposerBeacon()
const doc = tryUseComposerDocument()
const canvasDragActive = ref(false)
const dropHit = ref<AriaDropHitMessage | null>(null)

/** Design instrumentation + host overlays; hidden Stage stays design-armed. */
const isDesignMode = computed(() => props.designMode !== false)
const isCanvasActive = computed(() => props.canvasActive !== false)

const activeScope = computed(() => props.pathScope?.trim() || "")
const activeFocusPath = computed(() => props.focusPath || null)

/** Beacon holds bare model paths; iframe rects / track use scoped keys when drilling. */
function toCanvasPath(bareOrScoped: string | null | undefined): string | null {
  if (!bareOrScoped) return null
  return scopedMarkerPath(bareOrScoped, activeScope.value || null)
}

function toModelPath(canvasPath: string | null | undefined): string | null {
  if (!canvasPath) return null
  if (activeScope.value && canvasPath.startsWith(activeScope.value)) {
    return bareMarkerPath(canvasPath)
  }
  return bareMarkerPath(canvasPath)
}

function toVisibleModelPath(canvasPath: string | null | undefined): string | null {
  const path = toModelPath(canvasPath)
  return props.documentModel
    ? composerRichTextOwnerPath(props.documentModel, path)
    : path
}

/** Rects from the design iframe (`aria:rects`) — host paints overlays only. */
const rects = ref<Record<string, AriaRect[] | null>>({})

/** Live classList per path/occurrence from `aria:rects.classes` (expr class readout). */
const bridgeClasses = tryUseComposerBridgeClasses()

const showBridgeDebug = computed(() => {
  if (!import.meta.env.DEV) return false
  try {
    return localStorage.getItem("aria.composer.debugBridge") === "1"
  } catch {
    return false
  }
})

defineExpose({
  iframeEl,
  selectedPath: computed(() => beacon?.selectedPath.value ?? null),
  previewStyle: onResizePreview,
  clearPreviewStyle: onResizeClear,
  syncMotionAssets,
  patchNodes: sendNodePatches,
  reconcile: requestReconcile,
  computedStyle: requestComputedStyle,
  previewPopover: setPopoverPreview,
})

const status = computed(() => props.runtime?.status ?? "stopped")
const needsInstall = computed(
  () => status.value === "needs_install" || status.value === "installing",
)
const isInstalling = computed(() => status.value === "installing")
const isLive = computed(
  () =>
    status.value === "live" &&
    props.runtime?.authoringState === "ready" &&
    Boolean(props.runtime?.previewUrl),
)
const isStarting = computed(() => status.value === "starting")
const showPreloader = computed(() => isStarting.value || bootRequested.value)
const canStartServer = computed(
  () =>
    !needsInstall.value &&
    !showPreloader.value &&
    props.runtime?.recoveryAction !== "replace_external" &&
    (status.value === "stopped" ||
      status.value === "failed" ||
      status.value === "stopping"),
)
const canReplaceExternal = computed(
  () =>
    props.runtime?.authoringState === "blocked_external" &&
    props.runtime.recoveryAction === "replace_external" &&
    Boolean(props.runtime.externalPreview),
)

const emptyTitle = computed(() => {
  if (canReplaceExternal.value) return "Preview already running"
  if (status.value === "failed") return "Preview failed"
  if (status.value === "starting") return m.stage_starting_title()
  if (needsInstall.value) return m.stage_needs_install_title()
  return m.stage_offline_title()
})

const emptyBody = computed(() => {
  if (canReplaceExternal.value) {
    return "This Astro version cannot run Composer beside the existing preview. Replace that preview to enable selection and editing."
  }
  if (props.runtime?.error && (status.value === "failed" || status.value === "needs_install")) {
    return props.runtime.error
  }
  if (status.value === "starting") {
    return props.runtime?.error ?? m.stage_offline_body()
  }
  if (isInstalling.value) return m.workspace_preview_installing()
  if (needsInstall.value) return m.stage_needs_install_body()
  return m.stage_offline_body()
})

const previewUrl = () =>
  props.runtime?.previewUrl
    ? previewPageUrl(props.runtime.previewUrl, props.selectedRoute, {
        // Keep the design bridge mounted; browse mode is a soft toggle.
        designMode: true,
      })
    : null

function frameUrl(source: string, token: string, revision: number): string {
  const url = new URL(source)
  url.searchParams.set("aria-frame", token)
  if (revision > 0) url.searchParams.set("aria-reload", String(revision))
  return url.href
}

function startWarmFrame(revision = 0) {
  const source = previewUrl()
  if (!source) return
  if (!controlledReload.value) {
    clearControlledReloadTimer()
    controlledReload.value = true
    controlledReloadError.value = false
    controlledReloadReason.value = "preview-refresh"
    controlledReloadRevision = revision
    controlledReloadTimer = setTimeout(() => {
      controlledReloadTimer = null
      controlledReloadError.value = true
    }, 10_000)
  }
  const token = globalThis.crypto.randomUUID()
  const src = frameUrl(source, token, revision || Date.now())
  if (activeFrameSlot.value === "a") {
    frameBToken.value = token
    frameBSrc.value = src
  } else {
    frameAToken.value = token
    frameASrc.value = src
  }
}

function initializeFirstFrame(source: string) {
  clearBridgeHandshakeTimer()
  previewTargetOrigin.value = null
  renderedPathname.value = null
  bridgeState.value = "connecting"
  bridgeDetail.value = ""
  const token = globalThis.crypto.randomUUID()
  frameAToken.value = token
  frameASrc.value = frameUrl(source, token, 0)
  activeFrameSlot.value = "a"
}

function normalizedPreviewHref(value: string | null): string {
  if (!value) return ""
  try {
    return new URL(value).href
  } catch {
    return value
  }
}

const previewIdentity = computed(() => normalizedPreviewHref(previewUrl()))
watch(previewIdentity, () => {
  latestReconcileRevision = 0
})
const selectedPreviewPathname = computed(() => {
  const value = previewUrl()
  if (!value) return null
  try {
    return new URL(value).pathname
  } catch {
    return null
  }
})
const previewRouteMismatch = computed(() => composerPreviewRouteMismatch({
  selectedPath: selectedPreviewPathname.value,
  renderedPath: renderedPathname.value,
}))
const canvasInteractionEnabled = computed(
  () =>
    isDesignMode.value &&
    isCanvasActive.value &&
    bridgeState.value === "ready" &&
    previewRouteMismatch.value === null,
)

const bridgeIssue = computed(() =>
  isDesignMode.value && (bridgeState.value === "failed" || bridgeState.value === "stale"),
)

async function restartPreviewBridge() {
  if (bridgeRestarting.value) return
  bridgeRestarting.value = true
  actionError.value = null
  bridgeState.value = "connecting"
  bridgeDetail.value = ""
  clearBridgeHandshakeTimer()
  try {
    await restartSessionRuntime(props.projectPath)
  } catch (error) {
    bridgeState.value = "failed"
    actionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    bridgeRestarting.value = false
  }
}

async function replaceExternalPreview() {
  const external = props.runtime?.externalPreview
  if (!external || busy.value) return
  const accepted = await confirm({
    title: "Replace the existing Astro preview?",
    description: `Aria will stop the preview at ${external.url} and start a Composer-ready preview. Any terminal using that preview will disconnect.`,
    confirmLabel: "Replace preview",
    cancelLabel: "Cancel",
    destructive: true,
  })
  if (!accepted) return
  busy.value = true
  actionError.value = null
  try {
    await replaceExternalSessionRuntime(props.projectPath)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
    try {
      await restartSessionRuntime(props.projectPath)
    } catch {
      // Preserve the replacement error; the refreshed runtime state remains actionable.
    }
  } finally {
    busy.value = false
  }
}
const redirectWarning = computed(() => {
  const mismatch = previewRouteMismatch.value
  return mismatch
    ? m.composer_preview_redirected({
        selectedPath: mismatch.selectedPath,
        renderedPath: mismatch.renderedPath,
      })
    : null
})

/**
 * Hardcoded device presets (Stacki-style) — not project CSS breakpoints.
 * Desktop is an explicit `100%` so width can tween with `.t-resize`
 * (flex-1 ↔ fixed px cannot be interpolated).
 */
const deviceWidth = STAGE_DEVICE_WIDTH

const hasDeviceWidth = computed(() => props.device !== "desktop")

const deviceFrameStyle = computed(() => ({
  width: deviceWidth[props.device],
  maxWidth: "100%" as const,
}))

/**
 * Device chrome only when constrained. A permanent border on desktop stacks
 * against the composer dashed panel edges and reads as a thicker solid frame.
 */
const deviceFrameChromeClass = computed(() =>
  hasDeviceWidth.value ? "border border-border/60" : "border-0",
)

/** Live preview frame: always explicit width + flex-none for smooth viewport tweens. */
const liveDeviceFrameClass = computed(() =>
  cn(
    "t-resize relative mx-auto h-full min-h-0 flex-none overflow-hidden bg-background dark:bg-sidebar",
    deviceFrameChromeClass.value,
  ),
)

/** Offline / empty stage frame — same sizing rules, sidebar fill. */
const offlineDeviceFrameClass = computed(() =>
  cn(
    "t-resize relative mx-auto flex h-full min-h-0 flex-none flex-col overflow-hidden bg-sidebar",
    deviceFrameChromeClass.value,
  ),
)

const nodes = computed(() => props.documentModel?.nodes ?? [])

const effectiveHoverPath = computed(() => {
  if (!beacon) return null
  return beacon.structureHoverPath.value || beacon.hoverPath.value
})

/** Component-source Layers target the entered instance; page rows may target all. */
const effectiveHoverOcc = computed((): number | null => {
  if (!beacon) return null
  if (beacon.structureHoverPath.value) {
    return beacon.structureHoverOccurrence.value
  }
  return beacon.hoverOccurrence.value
})

const overlayBoxes = computed((): OverlayBox[] => {
  if (!canvasInteractionEnabled.value) return []
  const boxes: OverlayBox[] = []
  const selPath = beacon?.selectedPath.value ?? null
  const hoverPath = effectiveHoverPath.value
  const hoverOcc = effectiveHoverOcc.value

  const rectsForOverlayPath = (
    modelPath: string,
    canvasPath: string,
  ): AriaRect[] | null => {
    const node = nodeAtMarkerPath(nodes.value, modelPath)
    const frame = iframeEl.value
    return composerOverlayRects(
      node,
      rects.value[canvasPath],
      frame ? { width: frame.clientWidth, height: frame.clientHeight } : null,
    )
  }

  const pushBoxes = (
    modelPath: string,
    type: "sel" | "secondary" | "hover",
    occ: number | null,
  ) => {
    const canvasPath = toCanvasPath(modelPath) ?? modelPath
    const all = rectsForOverlayPath(modelPath, canvasPath)
    if (!all?.length) return
    const info =
      overlayInfoForPath(nodes.value, modelPath) ?? {
        path: modelPath,
        label: modelPath,
        kind: "other" as const,
      }
    const list =
      occ == null ? all : all[occ] ? [all[occ]!] : all.slice(0, 1)
    list.forEach((rect, i) => {
      boxes.push({
        key: `${type}-${canvasPath}-${i}`,
        type,
        rect: visualAffordanceRect(rect),
        info,
      })
    })
  }

  if (hoverPath && hoverPath !== selPath) {
    pushBoxes(hoverPath, "hover", hoverOcc)
  }
  const selections = beacon?.selections.value ?? []
  for (const [index, selection] of selections.entries()) {
    const canvasPath = toCanvasPath(selection.path) ?? selection.path
    const all = rectsForOverlayPath(selection.path, canvasPath)
    if (!all?.length) continue
    const info =
      overlayInfoForPath(nodes.value, selection.path) ?? {
        path: selection.path,
        label: selection.path,
        kind: "other" as const,
      }
    all.forEach((rect, occurrence) => {
      boxes.push({
        key: `${index === 0 ? "sel" : "secondary"}-${canvasPath}-${occurrence}`,
        type:
          occurrence === selection.occurrence
            ? index === 0
              ? "sel"
              : "secondary"
            : "ghost",
        rect: visualAffordanceRect(rect),
        info,
        path: selection.path,
        occurrence,
      })
    })
  }
  return boxes
})

const focusRects = computed((): AriaRect[] => {
  if (!canvasInteractionEnabled.value) return []
  const fp = activeFocusPath.value
  if (!fp) return []
  return rects.value[fp] ?? []
})

function postToPreview(message: unknown) {
  const win = iframeEl.value?.contentWindow
  const origin = previewTargetOrigin.value
  if (!win || !origin || !previewWindowMatchesOrigin(win, origin)) return
  try {
    win.postMessage(message, origin)
  } catch {
    /* ignore */
  }
}

function activeFrameToken(): string {
  return activeFrameSlot.value === "a" ? frameAToken.value : frameBToken.value
}

function postBridgePing() {
  const win = iframeEl.value?.contentWindow
  const token = activeFrameToken()
  if (!win || !token) return
  let origin = previewTargetOrigin.value
  if (!origin) {
    try {
      const candidate = new URL(iframeEl.value?.src ?? "").origin
      if (isPreviewMessageOrigin(candidate)) origin = candidate
    } catch {
      return
    }
  }
  if (!origin || !previewWindowMatchesOrigin(win, origin)) return
  try {
    win.postMessage({ type: ARIA_MSG.bridgePing, frameToken: token }, origin)
  } catch {
    /* ignore */
  }
}

let lastBridgeRearmAt = 0
function rearmPreviewBridge(force = false) {
  if (!isLive.value || !isCanvasActive.value) return
  const now = Date.now()
  if (!force && now - lastBridgeRearmAt < 250) return
  lastBridgeRearmAt = now
  if (!previewTargetOrigin.value) beginInitialBridgeHandshake(activeFrameSlot.value)
  postBridgePing()
  if (!previewTargetOrigin.value) return
  sendDesignInteraction()
  if (canvasInteractionEnabled.value) {
    sendDisplayOptions()
    sendTrack()
  }
}

function onHostFocus() {
  rearmPreviewBridge()
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") rearmPreviewBridge()
}

function sendNodePatches(payload: {
  revision: number
  patches: import("../../../shared/composer/previewDiff").ComposerDomPatch[]
}) {
  if (!canvasInteractionEnabled.value) return
  const scopeTree = (
    node: import("../../../shared/composer/previewDiff").ComposerCanvasTreeNode,
  ): import("../../../shared/composer/previewDiff").ComposerCanvasTreeNode => ({
    ...node,
    path: toCanvasPath(node.path) ?? node.path,
    ...(node.kind === "element"
      ? { children: node.children.map(scopeTree) }
      : {}),
  })
  postToPreview({
    type: ARIA_MSG.patchNodes,
    revision: payload.revision,
    patches: payload.patches.map((patch) => patch.kind === "properties"
      ? { ...patch, path: toCanvasPath(patch.path) ?? patch.path }
      : {
          ...patch,
          boundaries: patch.boundaries.map((boundary) => ({
            ...boundary,
            path: boundary.path === "$document"
              ? (activeFocusPath.value ?? "$document")
              : (toCanvasPath(boundary.path) ?? boundary.path),
            before: boundary.before.map(scopeTree),
            after: boundary.after.map(scopeTree),
          })),
        }),
  })
}

function requestReconcile(payload: {
  revision: number
  paths: string[]
  reloadReason?: AriaReloadReason
}) {
  if (!canvasInteractionEnabled.value) return
  latestReconcileRevision = Math.max(latestReconcileRevision, payload.revision)
  postToPreview({
    type: ARIA_MSG.reconcile,
    revision: payload.revision,
    ...(payload.reloadReason ? { reloadReason: payload.reloadReason } : {}),
    paths: payload.paths.map((path) =>
      path === "$document"
        ? (activeFocusPath.value ?? "$document")
        : (toCanvasPath(path) ?? path),
    ),
  })
}

function requestComputedStyle(payload: {
  path: string
  relativePath?: string
  properties: string[]
}): Promise<Record<string, string>> {
  const path = toCanvasPath(payload.path) ?? payload.path
  if (
    !canvasInteractionEnabled.value ||
    !iframeEl.value?.contentWindow ||
    !previewTargetOrigin.value
  ) {
    return Promise.resolve({})
  }
  const requestId = `style-${++computedStyleRequestSequence}`
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      computedStyleRequests.delete(requestId)
      resolve({})
    }, 1_000)
    computedStyleRequests.set(requestId, { resolve, timeout })
    postToPreview({
      type: ARIA_MSG.computedStyleRequest,
      requestId,
      path,
      occurrence: beacon?.selectedOccurrence.value ?? 0,
      relativePath: payload.relativePath ?? "",
      properties: payload.properties,
    })
  })
}

function sendDisplayOptions() {
  if (!isDesignMode.value) return
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim()
  postToPreview({
    type: ARIA_MSG.displayOptions,
    mode: props.displayMode ?? "normal",
    accent,
  })
}

function sendDesignInteraction() {
  postToPreview({
    type: ARIA_MSG.designInteraction,
    enabled: canvasInteractionEnabled.value,
  })
  if (canvasInteractionEnabled.value && previewPopoverId.value) {
    postToPreview({
      type: ARIA_MSG.popoverPreview,
      targetId: previewPopoverId.value,
      open: true,
    })
  }
}

function setPopoverPreview(targetId: string | null, open = true) {
  previewPopoverId.value = open ? targetId : null
  postToPreview({
    type: ARIA_MSG.popoverPreview,
    targetId,
    open: Boolean(open && targetId && canvasInteractionEnabled.value),
  })
}

function onResizePreview(payload: { path: string; cssText: string; relativePath?: string }) {
  if (!canvasInteractionEnabled.value) return
  postToPreview({
    type: ARIA_MSG.previewStyle,
    path: toCanvasPath(payload.path) ?? payload.path,
    ...(payload.relativePath ? { relativePath: payload.relativePath } : {}),
    cssText: payload.cssText,
  })
}

function onResizeClear(path?: string, relativePath?: string) {
  if (!canvasInteractionEnabled.value) return
  postToPreview({
    type: ARIA_MSG.clearPreviewStyle,
    ...(path ? { path: toCanvasPath(path) ?? path } : {}),
    ...(relativePath ? { relativePath } : {}),
  })
}

function syncMotionAssets(enabled: boolean) {
  postToPreview({ type: ARIA_MSG.syncMotionAssets, enabled })
}

function syncFontStylesheet() {
  postToPreview({
    type: ARIA_MSG.syncFontStylesheet,
    urls: (props.fontStylesheetUrls ?? []).filter((url) => url.trim()),
  })
}

function syncCanvasDrag() {
  canvasDragActive.value = canvasInteractionEnabled.value && Boolean(getComposerDrag())
  if (!canvasDragActive.value) dropHit.value = null
}

function onCanvasDragOver(event: DragEvent) {
  if (!canvasInteractionEnabled.value || !canvasDragActive.value || !canvasFrameEl.value) return
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = getComposerDrag()?.kind === "node" ? "move" : "copy"
  }
  const bounds = canvasFrameEl.value.getBoundingClientRect()
  postToPreview({
    type: ARIA_MSG.dragOver,
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  })
}

function clearCanvasDrop() {
  dropHit.value = null
  if (canvasInteractionEnabled.value) postToPreview({ type: ARIA_MSG.dragLeave })
}

function onCanvasDrop(event: DragEvent) {
  event.preventDefault()
  if (!canvasInteractionEnabled.value) {
    clearComposerDrag()
    dropHit.value = null
    return
  }
  const drag = getComposerDrag()
  const hit = dropHit.value
  const model = doc?.model.value
  if (!drag || !model || !doc) {
    clearComposerDrag()
    clearCanvasDrop()
    return
  }
  const target = hit
    ? resolveCanvasDropTarget(
        model,
        toModelPath(hit.path),
        hit.mode,
        dragChildTag(drag),
      )
    : props.emptyDocument
      ? { parentPath: null, index: model.nodes.length }
      : null
  if (!target) {
    clearComposerDrag()
    clearCanvasDrop()
    return
  }
  if (drag.kind === "node") doc.moveNodeTo(drag.path, target)
  else if (drag.kind === "primitive") doc.insertAriaPrimitive(drag.id, target)
  else if (drag.kind === "element") doc.insertElement(drag.tag, target)
  else doc.insertComponent({ name: drag.name, file: drag.file }, target)
  clearComposerDrag()
  clearCanvasDrop()
}

function sendTrack() {
  if (!canvasInteractionEnabled.value) return
  trackingRevision += 1
  if (!beacon) {
    postToPreview({
      type: ARIA_MSG.track,
      trackingRevision,
      paths: [],
      scope: "",
    })
    return
  }
  const scope = activeScope.value
  const paths = [
    ...new Set(
      [
        ...beacon.selections.value.map((selection) =>
          toCanvasPath(selection.path),
        ),
        toCanvasPath(effectiveHoverPath.value),
        activeFocusPath.value,
      ].filter((p): p is string => Boolean(p)),
    ),
  ]
  postToPreview({
    type: ARIA_MSG.track,
    trackingRevision,
    paths,
    scope,
  })
}

function sendRevealRequest() {
  const request = beacon?.revealRequest.value
  if (!request || request.nonce === lastSentRevealNonce) return
  if (!isLive.value || !canvasInteractionEnabled.value || !previewTargetOrigin.value) return
  postToPreview({
    type: ARIA_MSG.scrollTo,
    path: toCanvasPath(request.selection.path) ?? request.selection.path,
    occ: request.selection.occurrence,
    policy: request.policy,
  })
  lastSentRevealNonce = request.nonce
}

function onPreviewMessage(event: MessageEvent) {
  const sourceSlot = event.source === iframeAEl.value?.contentWindow
    ? "a"
    : event.source === iframeBEl.value?.contentWindow
      ? "b"
      : null
  if (!sourceSlot) return
  if (!isPreviewMessageOrigin(event.origin)) return
  const rawReady = event.data && typeof event.data === "object"
    ? event.data as Record<string, unknown>
    : null
  if (rawReady?.type === ARIA_MSG.ready) {
    const expectedToken = sourceSlot === "a" ? frameAToken.value : frameBToken.value
    if (rawReady.frameToken !== expectedToken) return
    if (
      rawReady.version !== ARIA_PROTOCOL_VERSION ||
      rawReady.bridgeId !== ARIA_BRIDGE_ID
    ) {
      if (sourceSlot !== activeFrameSlot.value && previewTargetOrigin.value) {
        clearControlledReloadTimer()
        controlledReloadError.value = true
        return
      }
      clearBridgeHandshakeTimer()
      bridgeState.value = "stale"
      bridgeDetail.value =
        `The preview is using bridge ${String(rawReady.bridgeId ?? rawReady.version ?? "unknown")}; ` +
        `${ARIA_BRIDGE_ID} is required.`
      previewTargetOrigin.value = null
      return
    }
  }
  if (!isAriaIframeToHostMessage(event.data)) return
  if (event.data.type === ARIA_MSG.ready) {
    const ready = event.data as AriaReadyMessage
    const expectedToken = sourceSlot === "a" ? frameAToken.value : frameBToken.value
    if (ready.frameToken !== expectedToken) return
    const wasWarming = sourceSlot !== activeFrameSlot.value
    if (wasWarming) {
      const previousSlot = activeFrameSlot.value
      const previousToken = previousSlot === "a" ? frameAToken.value : frameBToken.value
      const previousFrame = previousSlot === "a" ? iframeAEl.value : iframeBEl.value
      const restoreFrameFocus = document.activeElement === previousFrame
      activeFrameSlot.value = sourceSlot
      if (restoreFrameFocus) {
        requestAnimationFrame(() => {
          const nextFrame = sourceSlot === "a" ? iframeAEl.value : iframeBEl.value
          nextFrame?.focus({ preventScroll: true })
        })
      }
      window.setTimeout(() => {
        if (activeFrameSlot.value === previousSlot) return
        const currentToken = previousSlot === "a" ? frameAToken.value : frameBToken.value
        if (currentToken !== previousToken) return
        if (previousSlot === "a") {
          frameASrc.value = null
          frameAToken.value = ""
        } else {
          frameBSrc.value = null
          frameBToken.value = ""
        }
      }, 160)
    }
    previewTargetOrigin.value = event.origin
    clearBridgeHandshakeTimer()
    bridgeState.value = "ready"
    bridgeDetail.value = ""
    renderedPathname.value = ready.pathname
    const recoveredReloadRevision = controlledReload.value && wasWarming
      ? controlledReloadRevision
      : 0
    clearControlledReloadTimer()
    if (wasWarming) {
      controlledReload.value = false
      controlledReloadError.value = false
    }
    if (recoveredReloadRevision > 0) {
      emit("reconcile-result", {
        type: ARIA_MSG.reconcileResult,
        revision: recoveredReloadRevision,
        ok: true,
        paths: ["$document"],
      })
    }
    if (!canvasInteractionEnabled.value) {
      rects.value = {}
      dropHit.value = null
      canvasDragActive.value = false
      if (bridgeClasses) bridgeClasses.pathClasses.value = {}
      beacon?.clearHover()
    }
    const savedViewport =
      viewportSnapshot?.identity === previewIdentity.value
        ? viewportSnapshot
        : null
    if (savedViewport) {
      postToPreview({
        type: ARIA_MSG.restoreViewport,
        x: savedViewport.x,
        y: savedViewport.y,
      })
    }
    sendDesignInteraction()
    syncFontStylesheet()
    // Immersive preview: keep the bridge alive but ignore edit traffic.
    if (!canvasInteractionEnabled.value) return
    sendDisplayOptions()
    sendTrack()
    if (!savedViewport) sendRevealRequest()
    return
  }
  if (sourceSlot !== activeFrameSlot.value || !canvasInteractionEnabled.value) return
  if (event.data.type === ARIA_MSG.viewport) {
    const msg = event.data as AriaViewportMessage
    if (
      typeof msg.href === "string" &&
      normalizedPreviewHref(msg.href) === previewIdentity.value &&
      Number.isFinite(msg.x) &&
      Number.isFinite(msg.y)
    ) {
      viewportSnapshot = {
        identity: previewIdentity.value,
        x: Math.max(0, msg.x),
        y: Math.max(0, msg.y),
      }
    }
    return
  }
  if (event.data.type === ARIA_MSG.computedStyleResponse) {
    const msg = event.data as AriaComputedStyleResponseMessage
    const pending = computedStyleRequests.get(msg.requestId)
    if (pending) {
      clearTimeout(pending.timeout)
      computedStyleRequests.delete(msg.requestId)
      pending.resolve(msg.values ?? {})
    }
    return
  }
  if (event.data.type === ARIA_MSG.reconcileResult) {
    const msg = event.data as AriaReconcileResultMessage
    if (msg.revision < latestReconcileRevision) return
    emit("reconcile-result", msg)
    if (!msg.ok && msg.hardReload) {
      beginControlledReload({
        revision: msg.revision,
        reason: msg.reason || "reconciliation-failed",
      })
    }
    return
  }
  if (event.data.type === ARIA_MSG.patchResult) {
    emit("patch-result", event.data as AriaPatchResultMessage)
    return
  }
  // Interactive browse: ignore design-bridge geometry / selection traffic.
  if (!isDesignMode.value) return

  if (event.data.type === ARIA_MSG.rects) {
    const msg = event.data as AriaRectsMessage
    if (msg.trackingRevision !== trackingRevision) return
    rects.value = msg.rects ?? {}
    if (bridgeClasses) {
      // Remap scoped class keys → bare model paths for the inspector.
      const raw = msg.classes ?? {}
      const mapped: Record<string, string[][]> = {}
      for (const [key, value] of Object.entries(raw)) {
        mapped[toModelPath(key) ?? key] = value
      }
      bridgeClasses.pathClasses.value = mapped
    }
  } else if (event.data.type === ARIA_MSG.hover) {
    const msg = event.data as AriaHoverMessage
    const canvasPath = msg.path
    if (activeScope.value) {
      if (canvasPath && isMarkerPathInScope(canvasPath, activeScope.value)) {
        beacon?.setCanvasHover(toVisibleModelPath(canvasPath), msg.occurrence ?? 0)
      } else {
        beacon?.setCanvasHover(null, 0)
      }
    } else {
      beacon?.setCanvasHover(toVisibleModelPath(canvasPath), msg.occurrence ?? 0)
    }
    if (import.meta.env.DEV && showBridgeDebug.value) {
      console.debug("[aria:composer] hover", msg.path, msg.occurrence)
    }
  } else if (event.data.type === ARIA_MSG.click) {
    const msg = event.data as AriaClickMessage
    const canvasPath = msg.path
    const scope = activeScope.value
    const focus = activeFocusPath.value

    if (scope) {
      // Drilling: scoped markers address the open file; outside the focus exits.
      if (canvasPath && isMarkerPathInScope(canvasPath, scope)) {
        beacon?.illuminate(toVisibleModelPath(canvasPath), {
          occurrence: msg.occurrence ?? 0,
          source: "canvas",
        })
        return
      }
      if (focus) {
        if (isUnderFocusPath(canvasPath, focus)) {
          // Click on the lit instance chrome — stay put.
          return
        }
        emit("exit-drill")
        return
      }
      // Scoped edit without a focus cutout (Layouts rail): ignore out-of-scope.
      return
    }

    beacon?.select(
      canvasPath
        ? { path: toVisibleModelPath(canvasPath)!, occurrence: msg.occurrence ?? 0 }
        : null,
      {
        source: "canvas",
        toggle: Boolean(msg.shift || msg.meta),
      },
    )
    if (import.meta.env.DEV && showBridgeDebug.value) {
      console.debug("[aria:composer] click", msg.path, msg.occurrence)
    }
  } else if (event.data.type === ARIA_MSG.open) {
    const msg = event.data as AriaOpenMessage
    // Open uses the page-namespace path when not already inside a scoped file.
    emit("open", {
      path: msg.path,
      occurrence: msg.occurrence ?? 0,
    })
  } else if (event.data.type === ARIA_MSG.shortcut) {
    const msg = event.data as AriaShortcutMessage
    emit("shortcut", {
      key: msg.key,
      meta: Boolean(msg.meta),
      shift: Boolean(msg.shift),
    })
  } else if (event.data.type === ARIA_MSG.paste) {
    const msg = event.data as AriaPasteMessage
    emit("paste", {
      text: msg.text || "",
      html: msg.html || "",
      aria: msg.aria || "",
    })
  } else if (event.data.type === ARIA_MSG.dropHit) {
    dropHit.value = event.data as AriaDropHitMessage
  }
}

function onIframeLoad(slot: "a" | "b") {
  if (import.meta.env.DEV) {
    try {
      const key = "aria.composer.diagnostics"
      const current = JSON.parse(localStorage.getItem(key) || "{}") as { iframeLoads?: number }
      localStorage.setItem(key, JSON.stringify({ ...current, iframeLoads: (current.iframeLoads ?? 0) + 1 }))
    } catch { /* local diagnostics are best effort */ }
  }
  if (slot !== activeFrameSlot.value) return
  requestAnimationFrame(() => {
    if (slot === activeFrameSlot.value) rearmPreviewBridge(true)
  })
  scheduleCapture()
  // Clear stale geometry until fresh rects arrive; keep selection path.
  rects.value = {}
  if (bridgeClasses) bridgeClasses.pathClasses.value = {}
  if (!isDesignMode.value) {
    beacon?.clearHover()
    return
  }
  // The bridge sends aria:ready with its actual origin; that handshake then
  // drives tracking and reselect-by-path without posting to a stale dev port.
}

let lastFrameRequest = ""
watch(
  () => [isLive.value, previewIdentity.value, props.reloadKey ?? 0] as const,
  ([live, identity, reloadKey]) => {
    if (!live || !identity) {
      clearBridgeHandshakeTimer()
      bridgeState.value = "idle"
      bridgeDetail.value = ""
      previewTargetOrigin.value = null
      renderedPathname.value = null
      frameASrc.value = null
      frameBSrc.value = null
      lastFrameRequest = ""
      return
    }
    const request = `${identity}:${reloadKey}`
    if (request === lastFrameRequest) return
    lastFrameRequest = request
    if (!frameASrc.value && !frameBSrc.value) initializeFirstFrame(identity)
    else startWarmFrame(reloadKey)
  },
  { immediate: true },
)

async function install() {
  if (busy.value || isInstalling.value) return
  busy.value = true
  actionError.value = null
  try {
    await installSessionDeps(props.projectPath)
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function startServer() {
  if (busy.value || !canStartServer.value) return
  busy.value = true
  bootRequested.value = true
  actionError.value = null
  try {
    await startSessionRuntime(props.projectPath)
  } catch (error) {
    bootRequested.value = false
    actionError.value =
      error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

watch(
  () => status.value,
  (next) => {
    if (next === "starting" || next === "live" || next === "failed") {
      if (next !== "starting") bootRequested.value = false
    }
    if (next === "stopped" || next === "failed" || next === "needs_install") {
      bootRequested.value = false
    }
  },
)

watch(
  () => [props.displayMode ?? "normal", isDesignMode.value] as const,
  () => sendDisplayOptions(),
)

watch(
  () => (props.fontStylesheetUrls ?? []).join("\n"),
  () => syncFontStylesheet(),
)

watch(
  () => props.selectedRoute,
  () => {
    viewportSnapshot = null
    lastSentRevealNonce = beacon?.revealRequest.value?.nonce ?? 0
    rects.value = {}
    renderedPathname.value = null
    beacon?.clearHover()
  },
)

watch(
  () => props.reloadKey ?? 0,
  () => {
    previewTargetOrigin.value = null
    rects.value = {}
    renderedPathname.value = null
    beacon?.clearHover()
  },
)

watch(
  () => props.runtime?.previewUrl ?? "",
  () => {
    viewportSnapshot = null
    lastSentRevealNonce = beacon?.revealRequest.value?.nonce ?? 0
    renderedPathname.value = null
  },
)

watch(
  () => [props.runtime?.previewUrl ?? "", props.selectedRoute] as const,
  () => {
    previewTargetOrigin.value = null
  },
)

watch(
  () => isDesignMode.value,
  (design) => {
    rects.value = {}
    sendDesignInteraction()
    if (!design) {
      beacon?.clearHover()
      return
    }
    if (isLive.value && isCanvasActive.value) {
      sendDisplayOptions()
      sendTrack()
    }
  },
)

watch(
  () => isCanvasActive.value,
  (active) => {
    if (!isLive.value) return
    if (!active) {
      sendDesignInteraction()
      beacon?.clearHover()
      return
    }
    // Layout just restored after Code-full — refresh bridge geometry.
    requestAnimationFrame(() => {
      if (!isCanvasActive.value || !isLive.value) return
      rearmPreviewBridge(true)
    })
  },
)

// Keep iframe tracking in sync with selection / hover / drill scope.
watch(
  () =>
    [
      beacon?.selectedPath.value ?? null,
      beacon?.selections.value.map((selection) => `${selection.path}#${selection.occurrence}`).join(",") ?? "",
      effectiveHoverPath.value,
      activeScope.value,
      activeFocusPath.value,
      props.documentModel,
      isLive.value,
      canvasInteractionEnabled.value,
    ] as const,
  (next, previous) => {
    const scopeChanged = previous && next[3] !== previous[3]
    const documentChanged = previous && next[5] !== previous[5]
    if (scopeChanged || documentChanged) {
      rects.value = {}
      if (bridgeClasses) bridgeClasses.pathClasses.value = {}
    }
    if (isLive.value && canvasInteractionEnabled.value) sendTrack()
  },
)

// Selection state and reveal intent are deliberately separate: Inspector
// mutations retain selection without moving the user's canvas viewport.
watch(
  () => beacon?.revealRequest.value?.nonce ?? 0,
  () => sendRevealRequest(),
)

const SETTLE_MS = 2500
/** Retry delay when chrome (switchers, menus) covers the preview. */
const OCCLUDED_RETRY_MS = 600
const MIN_CAPTURE_PX = 100
/**
 * Portaled overlays that can hang over the stage from the header/chrome.
 * Point sampling alone misses these when they only cover the top of the iframe.
 */
const OVERLAY_SELECTOR = [
  '[data-slot="popover-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dropdown-menu-sub-content"]',
  '[data-slot="context-menu-content"]',
  '[data-slot="context-menu-sub-content"]',
  '[data-slot="dialog-overlay"]',
  '[data-slot="dialog-content"]',
  '[data-slot="alert-dialog-overlay"]',
  '[data-slot="alert-dialog-content"]',
].join(", ")

let captureTimer: ReturnType<typeof setTimeout> | null = null
let captureGen = 0

function clearCaptureTimer() {
  if (captureTimer) {
    clearTimeout(captureTimer)
    captureTimer = null
  }
}

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  )
}

/** True when a floating overlay overlaps the band we would capture. */
function overlayOccludesCapture(capture: {
  left: number
  top: number
  right: number
  bottom: number
}): boolean {
  const nodes = document.querySelectorAll(OVERLAY_SELECTOR)
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    // Ignore Presence leftovers mid close-animation / unmount.
    if (node.getAttribute("data-state") === "closed") continue
    const r = node.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (rectsIntersect(capture, r)) return true
  }
  return false
}

function previewIsOccluded(iframeRect: DOMRect, captureHeight: number): boolean {
  const capture = {
    left: iframeRect.left,
    top: iframeRect.top,
    right: iframeRect.right,
    bottom: iframeRect.top + captureHeight,
    width: iframeRect.width,
    height: captureHeight,
  }

  if (overlayOccludesCapture(capture)) return true

  // Include top-of-band samples — header switchers hang here, not mid-frame.
  const samples = [
    [0.2, 0.08],
    [0.5, 0.08],
    [0.8, 0.08],
    [0.25, 0.35],
    [0.5, 0.4],
    [0.75, 0.35],
  ] as const
  for (const [fx, fy] of samples) {
    const x = capture.left + capture.width * fx
    const y = capture.top + capture.height * fy
    const el = document.elementFromPoint(x, y)
    if (!el) continue
    if (iframeEl.value && (el === iframeEl.value || iframeEl.value.contains(el))) {
      continue
    }
    // Anything else sitting on the preview counts as occlusion.
    return true
  }
  return false
}

async function runCapture(gen: number) {
  if (gen !== captureGen) return
  if (!isLive.value || !iframeEl.value || (props.displayMode ?? "normal") !== "normal") return

  const el = iframeEl.value
  const rect = el.getBoundingClientRect()
  if (rect.width < MIN_CAPTURE_PX || rect.height < MIN_CAPTURE_PX) return

  const height = Math.min(rect.height, rect.width * 0.75)
  if (previewIsOccluded(rect, height)) {
    // Menu mid-selection — retry until chrome clears instead of baking it in.
    scheduleCapture(OCCLUDED_RETRY_MS)
    return
  }

  // Re-check after occlusion work — server may have stopped mid-settle.
  if (gen !== captureGen || !isLive.value) return

  try {
    await captureThumbs({
      projectPath: props.projectPath,
      route: props.selectedRoute ?? "/",
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height,
      },
      mtimeMs: props.pageMtimeMs ?? null,
    })
  } catch {
    /* non-fatal — thumbs are best-effort */
  }
}

function scheduleCapture(delayMs: number = SETTLE_MS) {
  clearCaptureTimer()
  if (!isLive.value || !isCanvasActive.value) {
    // Invalidate any in-flight runCapture so a dying preview cannot finish
    // after we already left live.
    captureGen += 1
    return
  }
  const gen = ++captureGen
  captureTimer = setTimeout(() => {
    captureTimer = null
    void runCapture(gen)
  }, delayMs)
}

watch(
  () =>
    [
      isLive.value,
      isCanvasActive.value,
      props.selectedRoute,
      props.reloadKey ?? 0,
      props.runtime?.previewUrl ?? "",
      props.device,
      props.displayMode ?? "normal",
    ] as const,
  () => {
    scheduleCapture()
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener("message", onPreviewMessage)
  window.addEventListener("focus", onHostFocus)
  document.addEventListener("visibilitychange", onVisibilityChange)
  window.addEventListener(COMPOSER_DRAG_CHANGE_EVENT, syncCanvasDrag)
  syncCanvasDrag()
})

onUnmounted(() => {
  window.removeEventListener("message", onPreviewMessage)
  window.removeEventListener("focus", onHostFocus)
  document.removeEventListener("visibilitychange", onVisibilityChange)
  window.removeEventListener(COMPOSER_DRAG_CHANGE_EVENT, syncCanvasDrag)
  clearControlledReloadTimer()
  clearBridgeHandshakeTimer()
  captureGen += 1
  clearCaptureTimer()
  for (const pending of computedStyleRequests.values()) {
    clearTimeout(pending.timeout)
    pending.resolve({})
  }
  computedStyleRequests.clear()
})
</script>

<template>
  <div
    class="relative flex min-h-0 flex-1 items-stretch justify-center bg-background transition-[background-color] duration-(--resize-dur) ease-(--resize-ease) motion-reduce:transition-none dark:bg-sidebar"
  >
    <div
      v-if="isLive"
      ref="canvasFrameEl"
      :class="liveDeviceFrameClass"
      :style="deviceFrameStyle"
      @pointerenter="rearmPreviewBridge()"
    >
      <!-- Absolute fill: iframes ignore flex-1 sizing (intrinsic ~150px). -->
      <iframe
        v-if="frameASrc"
        ref="iframeAEl"
        class="absolute inset-0 h-full w-full border-0 bg-white motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-out"
        :class="activeFrameSlot === 'a' ? 'z-1 opacity-100' : 'pointer-events-none z-0 opacity-0'"
        :src="frameASrc"
        :title="selectedRoute ? `Preview ${selectedRoute}` : 'Astro preview'"
        :aria-hidden="activeFrameSlot !== 'a'"
        :tabindex="activeFrameSlot === 'a' ? undefined : -1"
        referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-forms allow-same-origin"
        @load="onIframeLoad('a')"
      />
      <iframe
        v-if="frameBSrc"
        ref="iframeBEl"
        class="absolute inset-0 h-full w-full border-0 bg-white motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-out"
        :class="activeFrameSlot === 'b' ? 'z-1 opacity-100' : 'pointer-events-none z-0 opacity-0'"
        :src="frameBSrc"
        :title="selectedRoute ? `Preview ${selectedRoute}` : 'Astro preview'"
        :aria-hidden="activeFrameSlot !== 'b'"
        :tabindex="activeFrameSlot === 'b' ? undefined : -1"
        referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-forms allow-same-origin"
        @load="onIframeLoad('b')"
      />
      <div
        v-if="controlledReloadError"
        class="absolute bottom-3 right-3 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur-sm"
        role="status"
        aria-live="polite"
      >
        <AppIcon name="warning" :size="20" class="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-sm font-medium text-foreground">Preview update paused</p>
          <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            The Astro preview did not become ready. Your source changes are still preserved.
          </p>
          <Button type="button" variant="outline" size="sm" class="mt-3" @click="retryControlledReload">
            Retry canvas
          </Button>
        </div>
      </div>
      <div
        v-else-if="bridgeIssue"
        class="absolute bottom-3 right-3 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur-sm"
        role="status"
        aria-live="polite"
      >
        <AppIcon name="warning" :size="20" class="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-sm font-medium text-foreground">Selection unavailable</p>
          <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {{ bridgeDetail || "The preview selection bridge is not ready." }}
          </p>
          <p
            v-if="actionError"
            class="mt-1 text-xs leading-relaxed text-destructive"
            role="alert"
          >
            {{ actionError }}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="mt-3"
            :disabled="bridgeRestarting"
            :aria-busy="bridgeRestarting || undefined"
            @click="restartPreviewBridge"
          >
            <Spinner v-if="bridgeRestarting" />
            Restart preview
          </Button>
        </div>
      </div>
      <span
        v-if="bridgeState === 'connecting' && !controlledReload"
        class="sr-only"
        role="status"
        aria-live="polite"
      >Connecting selection controls</span>
      <span v-if="controlledReload && !controlledReloadError" class="sr-only" role="status" aria-live="polite">Updating preview</span>
      <!-- Host-side selection chrome — never painted into the site DOM -->
      <StageOverlays
        v-if="isDesignMode"
        :boxes="overlayBoxes"
        :focus-rects="focusRects"
        :drop-hit="dropHit"
        :show-selection-toolbar="showSelectionToolbar !== false"
        :show-selection-sizing="showSelectionSizing !== false"
        @resize-preview="onResizePreview"
        @resize-clear="onResizeClear"
        @open="emit('open', $event)"
      />
      <div
        v-if="isDesignMode && emptyDocument"
        class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-8"
      >
        <div
          class="flex min-h-40 w-full max-w-xl flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary/30 bg-background/90 px-8 text-center shadow-sm backdrop-blur-sm"
          :class="canvasDragActive && 'border-primary bg-primary/5'"
          role="status"
        >
          <AppIcon name="plus" :size="24" class="text-primary" aria-hidden="true" />
          <p class="mt-3 text-sm font-medium text-foreground">Empty component</p>
          <p class="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Add an element from the left panel, or drag one here to create the first root.
          </p>
        </div>
      </div>
      <div
        v-if="isDesignMode && canvasDragActive"
        class="absolute inset-0 z-20 cursor-copy"
        aria-label="Canvas drop target"
        @dragover="onCanvasDragOver"
        @dragleave="clearCanvasDrop"
        @drop="onCanvasDrop"
      />
    </div>
    <div
      v-else
      :class="offlineDeviceFrameClass"
      :style="deviceFrameStyle"
    >
      <FlickeringGrid />

      <div
        class="relative z-10 flex min-h-0 flex-1 items-center justify-center px-6 text-center"
      >
        <div class="relative flex flex-col items-center">
          <div
            class="stage-offline-copy absolute bottom-full mb-8 flex w-max max-w-lg flex-col items-center px-4 transition-[opacity,transform] duration-400 ease-out"
            :class="
              showPreloader
                ? 'pointer-events-none -translate-y-2 opacity-0'
                : 'translate-y-0 opacity-100'
            "
          >
            <p class="text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
              {{ emptyTitle }}
            </p>
            <p class="mt-3 max-w-md whitespace-pre-line text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
              {{ emptyBody }}
            </p>
            <p
              v-if="actionError"
              class="mt-3 max-w-md text-sm text-destructive"
              role="alert"
            >
              {{ actionError }}
            </p>
            <Button
              v-if="canReplaceExternal"
              type="button"
              class="mt-8"
              size="lg"
              :disabled="busy"
              :aria-busy="busy || undefined"
              @click="replaceExternalPreview"
            >
              <Spinner v-if="busy" />
              <AppIcon v-else name="refresh" />
              Replace preview
            </Button>
            <Button
              v-else-if="needsInstall"
              type="button"
              class="mt-8"
              size="lg"
              :disabled="busy || isInstalling"
              :aria-busy="busy || isInstalling || undefined"
              @click="install"
            >
              <Spinner v-if="busy || isInstalling" />
              <AppIcon v-else name="download" />
              {{ m.stage_install_deps() }}
            </Button>
            <pre
              v-if="status === 'failed' && runtime?.logs.length"
              class="mt-6 max-h-40 max-w-full overflow-auto rounded bg-muted p-3 text-left text-xs text-muted-foreground"
            >{{ runtime.logs.slice(-12).join('\n') }}</pre>
            <pre
              v-else-if="isInstalling && (runtime?.logs.length ?? 0) > 0"
              class="mt-6 max-h-40 max-w-full overflow-auto rounded bg-muted p-3 text-left font-mono text-xs text-muted-foreground"
            >{{ runtime!.logs.slice(-12).join('\n') }}</pre>
          </div>

          <div
            class="relative flex h-32 w-32 items-center justify-center"
            :class="!canStartServer && !showPreloader ? 'hidden' : undefined"
          >
            <Transition name="stage-mark" mode="out-in">
              <Button
                v-if="canStartServer"
                key="play"
                type="button"
                variant="outline"
                size="icon-lg"
                class="size-16 cursor-pointer rounded-full border-border/60 text-foreground shadow-none hover:bg-muted/60 hover:text-foreground"
                :disabled="busy"
                :aria-label="m.workspace_start_server()"
                :aria-busy="busy || undefined"
                @click="startServer"
              >
                <Spinner v-if="busy" class="size-7" />
                <AppIcon v-else name="play" :size="28" class="translate-x-px" />
              </Button>
              <StageCanvasPreloader
                v-else-if="showPreloader"
                key="logo"
                :active="showPreloader"
              />
            </Transition>
          </div>
        </div>
      </div>
    </div>

    <!-- Optional Phase 1 bridge debug (enable: localStorage aria.composer.debugBridge=1) -->
    <div
      v-if="isLive && isDesignMode && (redirectWarning || (showBridgeDebug && (beacon?.selectedPath.value || beacon?.hoverPath.value)))"
      class="pointer-events-none absolute bottom-3 left-3 z-20 max-w-md rounded-md border border-border/60 bg-background/90 px-2.5 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground shadow-sm backdrop-blur-sm"
      data-aria-composer-bridge
    >
      <p v-if="redirectWarning" class="text-amber-600 dark:text-amber-400">
        {{ redirectWarning }}
      </p>
      <template v-if="showBridgeDebug">
        <p v-if="beacon?.hoverPath.value">
          hover: {{ beacon.hoverPath.value }}#{{ beacon.hoverOccurrence.value }}
        </p>
        <p v-if="beacon?.selectedPath.value">
          sel: {{ beacon.selectedPath.value }}#{{ beacon.selectedOccurrence.value }}
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.stage-mark-enter-active,
.stage-mark-leave-active {
  transition:
    opacity 280ms ease,
    transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.stage-mark-enter-from {
  opacity: 0;
  transform: scale(0.62);
}

.stage-mark-leave-to {
  opacity: 0;
  transform: scale(1.12);
}

@media (prefers-reduced-motion: reduce) {
  .stage-offline-copy {
    transition: none;
  }

  .stage-mark-enter-active,
  .stage-mark-leave-active {
    transition: opacity 120ms ease;
  }

  .stage-mark-enter-from,
  .stage-mark-leave-to {
    transform: none;
  }
}
</style>
