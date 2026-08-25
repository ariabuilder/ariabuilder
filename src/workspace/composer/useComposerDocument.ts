/**
 * Composer document session: history + debounced/immediate write-back.
 *
 * Discrete edits (delete / reorder / duplicate / toggles) save immediately.
 * Typing-like prop edits pass `immediate: false` (300ms debounce).
 */

import { computed, onUnmounted, ref, shallowRef, toRaw, type Ref } from "vue"
import type { AstroDocumentModel, EditableNode, PropValue } from "../../../shared/composer/types"
import type {
  ComposerFileRevision,
  ComposerStylesheetEdit,
} from "../../../shared/composer/transaction"
import type { InsertTarget } from "../../../shared/composer/mutate"
import type { CanvasTextPatchOrigin } from "../../../shared/composer/canvasText"
import {
  canReorder,
  cloneNodesWithNewIds,
  collectStaticDomIds,
  deleteNodeAtPath,
  duplicateNodeAtPath,
  ensureComponentImport,
  insertComponentAt,
  insertElementAt,
  insertNodesAt,
  locateAtPath,
  parentAcceptsChildAtPath,
  renamePropAtPath,
  reorderNodeAtPath,
  reparentNodeAtPath,
  reparentNodesAtPaths,
  resolveInsertTarget,
  setPropAtPath,
  setTextAtPath,
  setTagAtPath,
  wrapNodesAtPaths,
  type ReorderDirection,
} from "../../../shared/composer/mutate"
import {
  insertComposerLayoutSlot,
  assignComposerPageLayout,
  assignComposerPageNodesToSlot,
  composerPageUsesLayoutFile,
  deleteComposerLayoutSlot,
  removeComposerPageLayout,
  renameComposerPageSlotAssignments,
  normalizeComposerPageSlotGroup,
  renameComposerLayoutSlot,
  unwrapComposerPageSlotAssignments,
  type ComposerLayoutSlotDefinition,
} from "../../../shared/composer/layoutAuthoring"
import {
  ariaPrimitiveDef,
  createAriaPrimitiveNode,
  insertAriaPrimitiveAt,
  isAriaPrimitiveId,
  type AriaPrimitiveId,
} from "../../../shared/composer/ariaPrimitives"
import { chooseImportPath, importPathsFor } from "../../../shared/composer/importPath"
import { nodeAtMarkerPath } from "../../../shared/composer/paths"
import {
  clipboardPlainText,
  decodeComposerClipboard,
  encodeComposerClipboard,
  serializeClipboardHtml,
  type ComposerClipboardFormats,
  type ComposerClipboardPayloadV1,
} from "../../../shared/composer/clipboard"
import {
  importExternalComposerClipboard,
  type ComposerClipboardImportKind,
  type ComposerClipboardImportWarning,
} from "../../../shared/composer/clipboardImport"
import {
  uniqueSelectionPaths,
  type SelectionRef,
} from "../../../shared/composer/selection"
import {
  extractClassRuleCss,
  staticClassListTokens,
  splitClassNames,
} from "../../../shared/composer"
import { commitComposerEditTransaction, parseComposerPage } from "@/lib/composer"
import { listStylesheets, readStylesheet } from "@/lib/design"
import {
  readComposerClipboard,
  writeComposerClipboard,
} from "@/lib/composerClipboard"
import { isEditableKeyboardTarget } from "@/lib/keyboardShortcuts"
import { patchComposerModelSource } from "../../../shared/composer/sourcePatches"
import type { ComposerBeacon } from "./selection/useComposerBeacon"

const SAVE_DEBOUNCE_MS = 300
const INSPECTOR_SAVE_DEBOUNCE_MS = 750
const HISTORY_COALESCE_MS = 800
const MAX_HISTORY = 100

/** Vue refs expose reactive Proxies; clone their raw data for history writes. */
function cloneComposerValue<T>(value: T): T {
  return structuredClone(toRaw(value))
}

function cloneSelections(
  selections: readonly SelectionRef[],
): SelectionRef[] {
  return selections.map(({ path, occurrence }) => ({ path, occurrence }))
}

function sameSelectionPaths(
  current: readonly SelectionRef[],
  next: readonly SelectionRef[],
): boolean {
  return (
    current.length === next.length &&
    current.every((selection, index) => selection.path === next[index]?.path)
  )
}

type HistoryEntry = {
  kind: "model"
  model: AstroDocumentModel
  selectedPath: string | null
  selections: import("../../../shared/composer/selection").SelectionRef[]
  stylesheets: ComposerStylesheetSnapshot[]
  documents: ComposerDocumentSnapshot[]
}

type ComposerDocumentSnapshot = {
  relativeFile: string
  model: AstroDocumentModel
  source: string
  mtimeMs: number
}

type ComposerStylesheetSnapshot = {
  relativeFile: string
  content: string
  mtimeMs: number
}

type ComposerModelMutationResult = {
  selectPath?: string | null
  selectPaths?: string[]
  ok?: boolean
  reason?: string
} | void

export type ComposerMutationLockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false }

export type ComposerInsertComponent = {
  name: string
  /** Project-relative posix path (`src/components/Card.astro`). */
  file: string
}

export type ComposerPasteFailureCode =
  | "empty"
  | "invalid-source"
  | "unsupported-document"
  | "unsafe-source"
  | "unresolved-component"
  | "ambiguous-component"
  | "invalid-containment"
  | "unsafe-id-collision"
  | "persist-failed"
  | "unavailable"

export type ComposerPasteResult =
  | {
      ok: true
      source: "aria" | ComposerClipboardImportKind
      insertedCount: number
      warnings: ComposerClipboardImportWarning[]
      staged: boolean
    }
  | {
      ok: false
      code: ComposerPasteFailureCode
      detail?: string
    }

export type ComposerDocumentApi = {
  /** Current Astro document model; Inspector reads local `<style>` rules from it. */
  model: Ref<AstroDocumentModel | null>
  dirty: Ref<boolean>
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
  saving: Ref<boolean>
  mutationPending: Ref<boolean>
  saveError: Ref<string | null>
  saveConflict: Ref<string | null>
  mutateModel: (
    fn: (model: AstroDocumentModel) => ComposerModelMutationResult,
    options?: {
      immediate?: boolean
      coalesceKey?: string | null
      saveDelayMs?: number
    },
  ) => boolean
  commitModelMutation: (
    fn: (model: AstroDocumentModel) => ComposerModelMutationResult,
  ) => Promise<boolean>
  withMutationLock: <T>(
    fn: () => Promise<T>,
  ) => Promise<ComposerMutationLockResult<T>>
  commitInspectorMutation: (
    label: string,
    fn: (model: AstroDocumentModel) => {
      selectPath?: string | null
      selectPaths?: string[]
      ok?: boolean
      reason?: string
    } | void,
    options?: { immediate?: boolean; coalesceKey?: string | null },
  ) => boolean
  setSelectedProp: (
    propName: string,
    value: PropValue | undefined,
    options?: { immediate?: boolean },
  ) => boolean
  renameSelectedProp: (oldName: string, newName: string) => boolean
  setSelectedText: (
    value: string,
    options?: { immediate?: boolean },
  ) => boolean
  beginCanvasTextEdit: (input: {
    sessionId: string
    path: string
    occurrence: number
    detachExpression?: boolean
    renderedValue?: string
  }) => { ok: true; value: string } | { ok: false; reason: string }
  updateCanvasTextEdit: (input: CanvasTextPatchOrigin & { value: string }) => boolean
  finishCanvasTextEdit: (
    sessionId: string,
    action: "commit" | "cancel",
  ) => Promise<{ ok: boolean; value: string; reason?: string }>
  setSelectedTag: (tag: string) => boolean
  commitStylesheetEdit: (
    edit: ComposerStylesheetEdit & { beforeContent: string },
    options?: { coalesceKey?: string | null },
  ) => Promise<ComposerFileRevision | null>
  commitModelWithStylesheet: (
    fn: Parameters<ComposerDocumentApi["mutateModel"]>[0],
    edit: ComposerStylesheetEdit & { beforeContent: string },
  ) => Promise<ComposerFileRevision[] | null>
  setSelectedPropWithStylesheet: (
    propName: string,
    value: PropValue | undefined,
    edit: ComposerStylesheetEdit & { beforeContent: string },
    targetPath?: string,
  ) => Promise<ComposerFileRevision[] | null>
  deleteSelected: () => boolean
  duplicateSelected: () => boolean
  copySelected: () => Promise<boolean>
  cutSelected: () => Promise<boolean>
  pasteClipboard: (formats?: ComposerClipboardFormats) => Promise<ComposerPasteResult>
  moveSelected: (direction: ReorderDirection) => boolean
  wrapSelected: (id: "section" | "container" | "div") => boolean
  /** @deprecated Prefer insertElement */
  insertDebugAtSelection: (tag?: string) => boolean
  insertElement: (tag: string, target?: InsertTarget | null) => boolean
  insertAriaPrimitive: (
    id: AriaPrimitiveId | string,
    target?: InsertTarget | null,
  ) => boolean
  insertComponent: (
    component: ComposerInsertComponent,
    target?: InsertTarget | null,
  ) => boolean
  insertLayoutSlot: (
    name: string | null,
    target?: InsertTarget | null,
  ) => boolean
  renameLayoutSlot: (
    slot: ComposerLayoutSlotDefinition,
    nextName: string,
  ) => Promise<{ affectedPages: number } | null>
  deleteLayoutSlot: (
    slot: ComposerLayoutSlotDefinition,
  ) => Promise<{ affectedPages: number; fallbackNodes: number } | null>
  inspectLayoutSlotUsage: (
    slot: ComposerLayoutSlotDefinition,
  ) => Promise<{ affectedPages: number; fallbackNodes: number } | null>
  assignPageLayout: (
    layout: ComposerInsertComponent,
    props?: import("../../../shared/composer/types").AstroPropMap,
  ) => boolean
  removePageLayout: () => boolean
  activatePageSlot: (name: string | null, target: InsertTarget) => void
  assignNodesToPageSlot: (
    paths: readonly string[],
    name: string | null,
    targetIndex?: number,
  ) => boolean
  moveNodeTo: (path: string, target: InsertTarget) => boolean
  moveNodesTo: (paths: readonly string[], target: InsertTarget) => boolean
  canMoveSelected: (direction: ReorderDirection) => boolean
  undo: () => Promise<void>
  redo: () => Promise<void>
  flushSave: () => Promise<void>
  registerBeforeFlush: (
    hook: () => void | Promise<void>,
  ) => () => void
  /** Mark an externally-applied Code draft as the new saved baseline. */
  markSaved: () => void
  /** Drop history when switching pages; optionally flush first. */
  resetForPage: (options?: { flush?: boolean }) => Promise<void>
  /** Skip external mtime reload while dirty / saving our own write. */
  shouldIgnoreExternalReload: () => boolean
  onComposerKeydown: (event: KeyboardEvent) => void
  /** Handle shortcut forwarded from the design iframe. */
  onIframeShortcut: (payload: {
    key: string
    meta: boolean
    shift: boolean
  }) => void
}

export function useComposerDocument(options: {
  projectPath: Ref<string>
  editFile: Ref<string | null>
  editedMtimeMs: Ref<number | null>
  model: Ref<AstroDocumentModel | null>
  editable: Ref<boolean>
  designActive: Ref<boolean>
  /** Exact source loaded from disk for formatting-preserving visual writes. */
  exactSource?: Ref<string | null>
  /** Advance the Code session baseline after an exact visual write persists. */
  onExactSourcePersisted?: (source: string) => void
  /** Exact staged Code source; non-null means visual mutations must patch it. */
  stagedSource?: Ref<string | null>
  /**
   * When true, a dirty Code draft owns the on-disk source — document flush must
   * wait for Apply Code. Code mode alone (clean editor) must not block flush.
   */
  codeDirty?: Ref<boolean>
  onStagedSourceChange?: (source: string) => void
  onStagedStylesheetChange?: (
    edit: ComposerStylesheetEdit & { beforeContent: string },
  ) => void
  draftHistoryBlocked?: Ref<boolean>
  previewRevision?: Ref<number>
  reservePreviewRevision?: () => number
  onModelMutation?: (
    before: AstroDocumentModel,
    after: AstroDocumentModel,
    reservedRevision?: number,
    exactSource?: string,
    inlineTextOrigin?: CanvasTextPatchOrigin,
  ) => void
  onPersisted?: (result: Extract<import("../../../shared/composer/transaction").ComposerEditTransactionResult, { ok: true }>) => void
  beacon: ComposerBeacon
  availablePages?: Ref<readonly { file: string }[]>
  availableComponents?: Ref<readonly ComposerInsertComponent[]>
  onPasteResult?: (result: ComposerPasteResult) => void
}): ComposerDocumentApi {
  const dirty = ref(false)
  const saving = ref(false)
  const mutationPending = ref(false)
  const saveError = ref<string | null>(null)
  const saveConflict = ref<string | null>(null)

  const past = shallowRef<HistoryEntry[]>([])
  const future = shallowRef<HistoryEntry[]>([])
  const stylesheetState = new Map<string, ComposerStylesheetSnapshot>()
  const documentState = new Map<string, ComposerDocumentSnapshot>()
  /** Undo/redo only while the page is visually editable (bail is read-only). */
  const canUndo = computed(
    () =>
      options.editable.value &&
      !mutationPending.value &&
      !options.draftHistoryBlocked?.value &&
      past.value.length > 0,
  )
  const canRedo = computed(
    () =>
      options.editable.value &&
      !mutationPending.value &&
      !options.draftHistoryBlocked?.value &&
      future.value.length > 0,
  )
  let lastPush = 0
  let lastKey: string | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let saveChain: Promise<void> = Promise.resolve()
  /** Unsaved visual mutations patched into the exact loaded source. */
  let pendingSource: string | null = null
  let pendingSourceRevision = 0
  let canvasTextSession: null | {
    sessionId: string
    path: string
    occurrence: number
    detachExpression: boolean
    originalValue: string
    baselineModel: AstroDocumentModel
    baselinePendingSource: string | null
    baselinePendingRevision: number
    baselineStagedSource: string | null
    baselineDirty: boolean
    baselinePast: HistoryEntry[]
    baselineFuture: HistoryEntry[]
    lastSequence: number
    changed: boolean
  } = null
  const beforeFlushHooks = new Set<() => void | Promise<void>>()
  /** After our write, ignore one external mtime bump for this file. */
  let suppressReloadUntil = 0
  let activePageSlot: { name: string | null; target: InsertTarget } | null = null

  function activatePageSlot(name: string | null, target: InsertTarget) {
    activePageSlot = {
      name,
      target: { parentPath: target.parentPath, index: target.index },
    }
  }

  function assignNodesToPageSlot(
    paths: readonly string[],
    name: string | null,
    targetIndex?: number,
  ): boolean {
    if (!options.designActive.value) return false
    return mutateModel(
      (model) => assignComposerPageNodesToSlot(model, paths, name, targetIndex),
      { immediate: true },
    )
  }

  function activeInsertTarget(
    model: AstroDocumentModel,
    fallback: InsertTarget,
  ): InsertTarget {
    if (!activePageSlot) return fallback
    if (activePageSlot.name == null) {
      const parentPath = activePageSlot.target.parentPath
      const parent = parentPath ? nodeAtMarkerPath(model.nodes, parentPath) : null
      if (
        parent &&
        (parent.kind === "component" ||
          parent.kind === "element" ||
          parent.kind === "fragment" ||
          parent.kind === "slot" ||
          parent.kind === "map")
      ) {
        return { parentPath, index: parent.children?.length ?? 0 }
      }
      return { ...activePageSlot.target }
    }
    const normalized = normalizeComposerPageSlotGroup(model, activePageSlot.name)
    if (!normalized.ok || !normalized.selectPath) return fallback
    const fragment = nodeAtMarkerPath(model.nodes, normalized.selectPath)
    return {
      parentPath: normalized.selectPath,
      index: fragment?.kind === "fragment" ? fragment.children.length : 0,
    }
  }

  function snapshotOf(): HistoryEntry | null {
    const model = options.model.value
    if (!model) return null
    return {
      kind: "model",
      model: cloneComposerValue(model),
      selectedPath: options.beacon.selectedPath.value,
      selections: cloneSelections(options.beacon.selections.value),
      stylesheets: cloneComposerValue([...stylesheetState.values()]),
      documents: cloneComposerValue([...documentState.values()]),
    }
  }

  /** @returns whether a new history entry was pushed (vs coalesced). */
  function pushHistory(coalesceKey: string | null = null): boolean {
    const snap = snapshotOf()
    if (!snap) return false
    const now = Date.now()
    const coalesce =
      coalesceKey != null &&
      coalesceKey === lastKey &&
      now - lastPush < HISTORY_COALESCE_MS &&
      past.value.length > 0
    if (!coalesce) {
      const next = [...past.value, snap]
      if (next.length > MAX_HISTORY) next.shift()
      past.value = next
    }
    future.value = []
    lastKey = coalesceKey
    lastPush = now
    return !coalesce
  }

  function applySnapshotLocally(entry: HistoryEntry, exactSource?: string) {
    const nextModel = cloneComposerValue(entry.model)
    if (options.model.value) {
      options.onModelMutation?.(
        options.model.value,
        nextModel,
        undefined,
        exactSource,
      )
    }
    options.model.value = nextModel
    stylesheetState.clear()
    for (const sheet of entry.stylesheets) {
      stylesheetState.set(sheet.relativeFile, cloneComposerValue(sheet))
    }
    documentState.clear()
    for (const document of entry.documents) {
      documentState.set(document.relativeFile, cloneComposerValue(document))
    }
    if (entry.selections.length) {
      options.beacon.setSelections(cloneSelections(entry.selections), {
        source: "api",
        reveal: "none",
      })
    } else if (entry.selectedPath) {
      options.beacon.illuminate(entry.selectedPath, {
        source: "api",
        reveal: "none",
      })
    } else {
      options.beacon.dim()
    }
  }

  function setConflict(error: unknown): void {
    saveError.value = error instanceof Error ? error.message : String(error)
    const code = (error as { code?: unknown })?.code
    if (code === "mtime_conflict" || /changed on disk/i.test(saveError.value)) {
      saveConflict.value = saveError.value
    }
  }

  function conflictError(result: {
    code: string
    message: string
  }): Error & { code: string } {
    const error = new Error(result.message) as Error & { code: string }
    error.code = result.code
    return error
  }

  function patchVisualSource(
    before: AstroDocumentModel,
    after: AstroDocumentModel,
  ): string | null | false {
    const staged = options.stagedSource?.value
    const source = staged ?? pendingSource ?? options.exactSource?.value
    if (source == null) {
      if (options.exactSource) {
        saveError.value = "The exact Astro source is unavailable. Reload before editing."
        return false
      }
      return null
    }
    const patched = patchComposerModelSource(source, before, after)
    if (!patched.ok) {
      saveError.value = patched.reason
      return false
    }
    if (staged != null) options.onStagedSourceChange?.(patched.source)
    else {
      pendingSource = patched.source
      pendingSourceRevision += 1
    }
    return patched.source
  }

  async function performFlushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const file = options.editFile.value
    const model = options.model.value
    if (!file || !model || !dirty.value || saveConflict.value) return
    if (!options.editable.value) return
    // Dirty Code drafts own the file; clean code-mode must still flush the model.
    if (options.codeDirty?.value) return

    saving.value = true
    saveError.value = null
    try {
      const source = pendingSource
      const sourceRevision = pendingSourceRevision
      if (source == null && options.exactSource) {
        throw new Error("The exact Astro source is unavailable. Reload before saving.")
      }
      const result = await commitComposerEditTransaction({
        projectPath: options.projectPath.value,
        previewRevision: options.previewRevision?.value,
        ...(source != null
          ? {
              sources: [{
                relativeFile: file,
                source,
                expectedSource: options.exactSource?.value ?? undefined,
                expectedMtimeMs: options.editedMtimeMs.value,
              }],
            }
          : {
              // Legacy fallback for callers that do not provide exact source.
              // Vue deep refs are Proxies; Electron IPC cannot clone them.
              page: {
                relativeFile: file,
                model: cloneComposerValue(model),
                expectedMtimeMs: options.editedMtimeMs.value,
              },
            }),
      })
      if (!result.ok) throw conflictError(result)
      const revision = result.revisions.find(
        (item) => item.relativeFile === file,
      ) ?? result.revisions[0]
      if (revision) options.editedMtimeMs.value = revision.mtimeMs
      if (source != null) {
        const hasNewerSource = pendingSourceRevision !== sourceRevision
          || pendingSource !== source
        if (!hasNewerSource) pendingSource = null
        options.onExactSourcePersisted?.(source)
        dirty.value = hasNewerSource
        if (hasNewerSource) scheduleSave(true)
      } else {
        dirty.value = false
      }
      options.onPersisted?.(result)
      // Watcher self-write + short client suppress for scan race.
      suppressReloadUntil = Date.now() + 1600
    } catch (error) {
      setConflict(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  function registerBeforeFlush(
    hook: () => void | Promise<void>,
  ): () => void {
    beforeFlushHooks.add(hook)
    return () => beforeFlushHooks.delete(hook)
  }

  async function runBeforeFlushHooks() {
    for (const hook of [...beforeFlushHooks]) await hook()
  }

  function flushSave(): Promise<void> {
    const next = saveChain.catch(() => undefined).then(async () => {
      await runBeforeFlushHooks()
      await performFlushSave()
    })
    saveChain = next
    return next
  }

  function scheduleSave(immediate = false, delayMs = SAVE_DEBOUNCE_MS) {
    if (saveConflict.value) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(
      () => {
        saveTimer = null
        void flushSave().catch(() => {
          /* saveError already set */
        })
      },
      immediate ? 0 : delayMs,
    )
  }

  function adoptModelMutation(
    current: AstroDocumentModel,
    next: AstroDocumentModel,
    result: Exclude<ComposerModelMutationResult, void>,
    reservedRevision?: number,
    exactSource?: string,
    inlineTextOrigin?: CanvasTextPatchOrigin,
  ): void {
    const selectedResultPath = result.selectPaths?.[0]
      ?? (result.selectPath === undefined
        ? options.beacon.selectedPath.value
        : result.selectPath)
    const nodeSignature = (model: AstroDocumentModel, path: string | null | undefined) => {
      if (!path) return null
      const node = nodeAtMarkerPath(model.nodes, path)
      if (!node) return null
      const tag = "name" in node && typeof node.name === "string" ? node.name : ""
      return `${node.id}:${node.kind}:${tag}`
    }
    const selectionIdentityChanged = Boolean(
      selectedResultPath
      && options.beacon.selectedPath.value === selectedResultPath
      && nodeSignature(current, selectedResultPath)
        !== nodeSignature(next, selectedResultPath),
    )
    options.onModelMutation?.(
      current,
      next,
      reservedRevision,
      exactSource,
      inlineTextOrigin,
    )
    options.model.value = next
    if (result.selectPath !== undefined || result.selectPaths?.length) {
      if (result.selectPaths?.length) {
        const nextSelections = result.selectPaths.map((path) => ({
          path,
          occurrence: 0,
        }))
        if (
          selectionIdentityChanged
          || !sameSelectionPaths(options.beacon.selections.value, nextSelections)
        ) {
          options.beacon.setSelections(nextSelections, {
            source: "api",
            reveal: selectionIdentityChanged ? "none" : "if-needed",
          })
        }
      } else if (result.selectPath) {
        if (
          selectionIdentityChanged
          || options.beacon.selections.value[0]?.path !== result.selectPath
        ) {
          options.beacon.illuminate(result.selectPath, {
            source: "api",
            reveal: selectionIdentityChanged ? "none" : "if-needed",
          })
        }
      } else {
        options.beacon.dim()
      }
    } else if (selectionIdentityChanged) {
      // The marker path can stay stable while wrap/unwrap/tag conversion swaps
      // the model identity underneath it. Re-publish the same selection so
      // Canvas, Layers, Inspector, and overlays resolve the new node together.
      options.beacon.setSelections([...options.beacon.selections.value], {
        source: "api",
        reveal: "none",
      })
    }
  }

  function mutateModelInternal(
    fn: (model: AstroDocumentModel) => ComposerModelMutationResult,
    mutateOptions?: {
      immediate?: boolean
      coalesceKey?: string | null
      saveDelayMs?: number
    },
    allowDuringMutationLock = false,
  ): boolean {
    if (
      !options.editable.value
      || !options.model.value
      || (mutationPending.value && !allowDuringMutationLock)
    ) return false
    const pushed = pushHistory(mutateOptions?.coalesceKey ?? null)
    const next = cloneComposerValue(options.model.value)
    const result = fn(next) ?? { ok: true }
    if (result.ok === false) {
      if (pushed) {
        past.value = past.value.slice(0, -1)
      }
      return false
    }
    const patchedSource = patchVisualSource(options.model.value, next)
    if (patchedSource === false) {
      if (pushed) past.value = past.value.slice(0, -1)
      return false
    }
    adoptModelMutation(
      options.model.value,
      next,
      result,
      undefined,
      patchedSource ?? undefined,
    )
    dirty.value = true
    if (options.stagedSource?.value == null) {
      scheduleSave(
        mutateOptions?.immediate ?? true,
        mutateOptions?.saveDelayMs,
      )
    }
    return true
  }

  function mutateModel(
    fn: (model: AstroDocumentModel) => ComposerModelMutationResult,
    mutateOptions?: {
      immediate?: boolean
      coalesceKey?: string | null
      saveDelayMs?: number
    },
  ): boolean {
    return mutateModelInternal(fn, mutateOptions)
  }

  async function withMutationLock<T>(
    fn: () => Promise<T>,
  ): Promise<ComposerMutationLockResult<T>> {
    if (mutationPending.value) return { acquired: false }
    mutationPending.value = true
    try {
      return { acquired: true, value: await fn() }
    } finally {
      mutationPending.value = false
    }
  }

  /** Persist a model mutation before exposing it as the acknowledged state. */
  async function commitModelMutation(
    fn: (model: AstroDocumentModel) => ComposerModelMutationResult,
  ): Promise<boolean> {
    if (!options.editable.value || saveConflict.value || mutationPending.value) return false
    if (options.stagedSource?.value != null) {
      return mutateModel(fn, { immediate: true, coalesceKey: null })
    }
    const locked = await withMutationLock(async () => {
      try {
        await flushSave()
      } catch {
        return false
      }

      const file = options.editFile.value
      const current = options.model.value
      if (!file || !current || saveConflict.value) return false
      const pushed = pushHistory(null)
      const next = cloneComposerValue(current)
      const mutation = fn(next) ?? { ok: true }
      if (mutation.ok === false) {
        if (pushed) past.value = past.value.slice(0, -1)
        if (mutation.reason) saveError.value = mutation.reason
        return false
      }

      const exactSource = options.exactSource?.value
      if (exactSource == null && options.exactSource) {
        if (pushed) past.value = past.value.slice(0, -1)
        saveError.value = "The exact Astro source is unavailable. Reload before saving."
        return false
      }
      const patched = exactSource == null
        ? null
        : patchComposerModelSource(exactSource, current, next)
      if (patched && !patched.ok) {
        if (pushed) past.value = past.value.slice(0, -1)
        saveError.value = patched.reason
        return false
      }

      saving.value = true
      saveError.value = null
      const reservedPreviewRevision = options.reservePreviewRevision?.() ?? options.previewRevision?.value
      try {
        const result = await commitComposerEditTransaction({
          projectPath: options.projectPath.value,
          previewRevision: reservedPreviewRevision,
          ...(patched?.ok
            ? {
                sources: [{
                  relativeFile: file,
                  source: patched.source,
                  expectedSource: exactSource ?? undefined,
                  expectedMtimeMs: options.editedMtimeMs.value,
                }],
              }
            : {
                page: {
                  relativeFile: file,
                  model: next,
                  expectedMtimeMs: options.editedMtimeMs.value,
                },
              }),
        })
        if (!result.ok) throw conflictError(result)
        adoptModelMutation(
          current,
          next,
          mutation,
          reservedPreviewRevision,
          patched?.ok ? patched.source : undefined,
        )
        options.onPersisted?.(result)
        const revision = result.revisions.find(
          (item) => item.relativeFile === file,
        ) ?? result.revisions[0]
        if (revision) options.editedMtimeMs.value = revision.mtimeMs
        if (patched?.ok) options.onExactSourcePersisted?.(patched.source)
        dirty.value = false
        future.value = []
        suppressReloadUntil = Date.now() + 1600
        return true
      } catch (error) {
        if (pushed) past.value = past.value.slice(0, -1)
        setConflict(error)
        return false
      } finally {
        saving.value = false
      }
    })
    return locked.acquired ? locked.value : false
  }

  function commitInspectorMutation(
    _label: string,
    fn: Parameters<ComposerDocumentApi["mutateModel"]>[0],
    inspectorOptions?: { immediate?: boolean; coalesceKey?: string | null },
  ): boolean {
    const immediate = inspectorOptions?.immediate ?? false
    const coalesceKey =
      inspectorOptions?.coalesceKey === undefined
        ? immediate
          ? null
          : "inspector"
        : inspectorOptions.coalesceKey
    return mutateModel(fn, {
      immediate,
      coalesceKey,
      saveDelayMs: immediate ? undefined : INSPECTOR_SAVE_DEBOUNCE_MS,
    })
  }

  function trackStylesheetBefore(
    edit: ComposerStylesheetEdit & { beforeContent: string },
  ): void {
    if (stylesheetState.has(edit.relativeFile)) return
    const snapshot: ComposerStylesheetSnapshot = {
      relativeFile: edit.relativeFile,
      content: edit.beforeContent,
      mtimeMs: Math.floor(edit.expectedMtimeMs ?? 0),
    }
    stylesheetState.set(edit.relativeFile, snapshot)
    // Older page-only entries predate our first touch of this stylesheet, but
    // their correct state is the captured pre-edit source.
    past.value = past.value.map((entry) => ({
      ...entry,
      stylesheets: entry.stylesheets.some(
        (sheet) => sheet.relativeFile === edit.relativeFile,
      )
        ? entry.stylesheets
        : [...entry.stylesheets, cloneComposerValue(snapshot)],
    }))
  }

  async function commitStylesheetEdit(
    edit: ComposerStylesheetEdit & { beforeContent: string },
    commitOptions?: { coalesceKey?: string | null },
  ): Promise<ComposerFileRevision | null> {
    if (!options.editable.value || saveConflict.value) return null
    if (options.stagedSource?.value != null) {
      trackStylesheetBefore(edit)
      pushHistory(commitOptions?.coalesceKey ?? null)
      options.onStagedStylesheetChange?.(edit)
      stylesheetState.set(edit.relativeFile, {
        relativeFile: edit.relativeFile,
        content: edit.content,
        mtimeMs: Math.floor(edit.expectedMtimeMs ?? 0),
      })
      dirty.value = true
      return {
        relativeFile: edit.relativeFile,
        mtimeMs: Math.floor(edit.expectedMtimeMs ?? 0),
      }
    }
    if (edit.beforeContent === edit.content) {
      return {
        relativeFile: edit.relativeFile,
        mtimeMs: Math.floor(edit.expectedMtimeMs ?? 0),
      }
    }
    trackStylesheetBefore(edit)
    const pushed = pushHistory(commitOptions?.coalesceKey ?? null)
    saving.value = true
    mutationPending.value = true
    saveError.value = null
    try {
      const result = await commitComposerEditTransaction({
        projectPath: options.projectPath.value,
        previewRevision: options.previewRevision?.value,
        stylesheets: [edit],
      })
      if (!result.ok) throw conflictError(result)
      const revision = result.revisions[0]!
      stylesheetState.set(edit.relativeFile, {
        relativeFile: edit.relativeFile,
        content: edit.content,
        mtimeMs: revision.mtimeMs,
      })
      suppressReloadUntil = Date.now() + 1600
      return revision
    } catch (error) {
      if (pushed) past.value = past.value.slice(0, -1)
      setConflict(error)
      return null
    } finally {
      saving.value = false
      mutationPending.value = false
    }
  }

  async function setSelectedPropWithStylesheet(
    propName: string,
    value: PropValue | undefined,
    edit: ComposerStylesheetEdit & { beforeContent: string },
    targetPath?: string,
  ): Promise<ComposerFileRevision[] | null> {
    const path = targetPath ?? options.beacon.selectedPath.value
    if (!path) return null
    return commitModelWithStylesheet(
      (model) => setPropAtPath(model, path, propName, value),
      edit,
    )
  }

  /** Persist one Astro model mutation and one stylesheet edit atomically. */
  async function commitModelWithStylesheet(
    fn: Parameters<ComposerDocumentApi["mutateModel"]>[0],
    edit: ComposerStylesheetEdit & { beforeContent: string },
  ): Promise<ComposerFileRevision[] | null> {
    const file = options.editFile.value
    const current = options.model.value
    if (!file || !current || !options.editable.value) return null
    if (options.stagedSource?.value != null) {
      const changed = mutateModelInternal(fn, { immediate: true }, true)
      if (!changed) return null
      trackStylesheetBefore(edit)
      options.onStagedStylesheetChange?.(edit)
      stylesheetState.set(edit.relativeFile, {
        relativeFile: edit.relativeFile,
        content: edit.content,
        mtimeMs: Math.floor(edit.expectedMtimeMs ?? 0),
      })
      return [
        { relativeFile: file, mtimeMs: Math.floor(options.editedMtimeMs.value ?? 0) },
        { relativeFile: edit.relativeFile, mtimeMs: Math.floor(edit.expectedMtimeMs ?? 0) },
      ]
    }
    trackStylesheetBefore(edit)
    const pushed = pushHistory(null)
    const next = cloneComposerValue(current)
    const mutation = fn(next)
    if (mutation?.ok === false) {
      if (pushed) past.value = past.value.slice(0, -1)
      return null
    }
    const sourceBefore = pendingSource ?? options.exactSource?.value ?? null
    if (sourceBefore == null && options.exactSource) {
      if (pushed) past.value = past.value.slice(0, -1)
      saveError.value = "The exact Astro source is unavailable. Reload before saving."
      return null
    }
    const patched = sourceBefore == null
      ? null
      : patchComposerModelSource(sourceBefore, current, next)
    if (patched && !patched.ok) {
      if (pushed) past.value = past.value.slice(0, -1)
      saveError.value = patched.reason
      return null
    }
    saving.value = true
    mutationPending.value = true
    saveError.value = null
    const reservedPreviewRevision = options.reservePreviewRevision?.() ?? options.previewRevision?.value
    try {
      const result = await commitComposerEditTransaction({
        projectPath: options.projectPath.value,
        previewRevision: reservedPreviewRevision,
        ...(patched?.ok
          ? {
              sources: [{
                relativeFile: file,
                source: patched.source,
                expectedSource: options.exactSource?.value ?? undefined,
                expectedMtimeMs: options.editedMtimeMs.value,
              }],
            }
          : {
              page: {
                relativeFile: file,
                model: next,
                expectedMtimeMs: options.editedMtimeMs.value,
              },
            }),
        stylesheets: [edit],
      })
      if (!result.ok) throw conflictError(result)
      adoptModelMutation(
        current,
        next,
        mutation ?? { ok: true },
        reservedPreviewRevision,
        patched?.ok ? patched.source : undefined,
      )
      options.onPersisted?.(result)
      const pageRevision = result.revisions.find(
        (revision) => revision.relativeFile === file,
      )
      if (pageRevision) options.editedMtimeMs.value = pageRevision.mtimeMs
      if (patched?.ok) {
        pendingSource = null
        options.onExactSourcePersisted?.(patched.source)
      }
      const cssRevision = result.revisions.find(
        (revision) => revision.relativeFile === edit.relativeFile,
      )
      if (cssRevision) {
        stylesheetState.set(edit.relativeFile, {
          relativeFile: edit.relativeFile,
          content: edit.content,
          mtimeMs: cssRevision.mtimeMs,
        })
      }
      dirty.value = false
      future.value = []
      suppressReloadUntil = Date.now() + 1600
      return result.revisions
    } catch (error) {
      if (pushed) past.value = past.value.slice(0, -1)
      setConflict(error)
      return null
    } finally {
      saving.value = false
      mutationPending.value = false
    }
  }

  function deleteSelected(): boolean {
    const paths = selectedSourcePaths()
    if (!paths.length) return false
    return mutateModel((model) => {
      for (const path of [...paths].sort(comparePathsForDelete)) {
        const result = deleteNodeAtPath(model, path)
        if (!result.ok) return result
      }
      return { ok: true, selectPath: null }
    }, {
      immediate: true,
    })
  }

  function selectedSourcePaths(): string[] {
    const selections = options.beacon.selections.value
    if (selections.length) return uniqueSelectionPaths(selections)
    return options.beacon.selectedPath.value
      ? [options.beacon.selectedPath.value]
      : []
  }

  /** Delete descendants and later siblings first so marker paths stay valid. */
  function comparePathsForDelete(a: string, b: string): number {
    const aa = a.split(".")
    const bb = b.split(".")
    if (aa.length !== bb.length) return bb.length - aa.length
    for (let i = 0; i < aa.length; i++) {
      const av = /^\d+$/.test(aa[i]!)
        ? Number(aa[i])
        : aa[i] === "t"
          ? -1
          : -2
      const bv = /^\d+$/.test(bb[i]!)
        ? Number(bb[i])
        : bb[i] === "t"
          ? -1
          : -2
      if (av !== bv) return Number(bv) - Number(av)
    }
    return 0
  }

  function selectedNodes(): import("../../../shared/composer/types").EditableNode[] {
    const current = options.model.value
    if (!current) return []
    return selectedSourcePaths()
      .map((path) => nodeAtMarkerPath(current.nodes, path))
      .filter(
        (node): node is import("../../../shared/composer/types").EditableNode =>
          Boolean(node),
      )
  }

  function visitNodeTree(
    nodes: import("../../../shared/composer/types").EditableNode[],
    visit: (node: import("../../../shared/composer/types").EditableNode) => void,
  ) {
    for (const node of nodes) {
      visit(node)
      if (node.kind === "conditional") {
        visitNodeTree(node.consequent, visit)
        if (node.alternate) visitNodeTree(node.alternate, visit)
      } else if (node.kind === "map" || node.kind === "fragment") {
        visitNodeTree(node.children, visit)
      } else if (
        (node.kind === "element" ||
          node.kind === "component" ||
          node.kind === "slot") &&
        node.children
      ) {
        visitNodeTree(node.children, visit)
      }
    }
  }

  function referencedComponentNames(
    nodes: import("../../../shared/composer/types").EditableNode[],
  ): Set<string> {
    const names = new Set<string>()
    visitNodeTree(nodes, (node) => {
      if (node.kind === "component") names.add(node.name)
    })
    return names
  }

  function referencedClassNames(
    nodes: import("../../../shared/composer/types").EditableNode[],
  ): Set<string> {
    const names = new Set<string>()
    visitNodeTree(nodes, (node) => {
      if (
        node.kind !== "element" &&
        node.kind !== "component" &&
        node.kind !== "fragment" &&
        node.kind !== "slot" &&
        node.kind !== "raw"
      ) return
      const classValue = node.props?.class
      if (classValue?.type === "string") {
        for (const name of splitClassNames(classValue.value)) names.add(name)
      }
      for (const name of staticClassListTokens(node.props?.["class:list"])) {
        names.add(name)
      }
    })
    return names
  }

  async function referencedClassRules(
    nodes: import("../../../shared/composer/types").EditableNode[],
  ): Promise<ComposerClipboardPayloadV1["classes"]> {
    const remaining = referencedClassNames(nodes)
    if (!remaining.size) return []
    const rules: ComposerClipboardPayloadV1["classes"] = []
    try {
      const sheets = await listStylesheets(options.projectPath.value)
      for (const sheet of sheets) {
        if (!remaining.size) break
        const source = await readStylesheet(
          options.projectPath.value,
          sheet.relativePath,
        )
        for (const name of [...remaining]) {
          const css = extractClassRuleCss(source.content, name)
          if (!css) continue
          rules.push({ name, css, sourceFile: source.relativePath })
          remaining.delete(name)
        }
      }
    } catch {
      // Clipboard still carries clean nodes and imports if CSS inventory fails.
    }
    return rules
  }

  async function copySelected(): Promise<boolean> {
    const selected = selectedNodes()
    const file = options.editFile.value
    if (!selected.length || !file || !options.model.value) return false
    // `selectedNodes()` returns nested Vue proxies. Unwrap each selected root
    // before structured cloning; wrapping the proxies in a new array and only
    // calling `toRaw()` on that array leaves the nested proxies intact.
    const nodes = selected.map((node) => cloneComposerValue(node))
    const componentNames = referencedComponentNames(nodes)
    const payload: ComposerClipboardPayloadV1 = {
      version: 1,
      sourceProject: options.projectPath.value,
      sourceFile: file,
      nodes,
      imports: options.model.value.imports
        .filter((entry) => componentNames.has(entry.name))
        .map((entry) => cloneComposerValue(entry)),
      classes: [],
      copiedAt: Date.now(),
    }
    const aria = encodeComposerClipboard(payload)
    const formats = {
      aria,
      html: serializeClipboardHtml(nodes),
      text: clipboardPlainText(nodes),
    }

    // Replace the OS clipboard before scanning project stylesheets. Otherwise
    // a quick Paste can observe whatever was copied before this layer.
    await writeComposerClipboard(formats)

    // Enrich cross-page/project copies with referenced class rules in the
    // background. Never overwrite a newer clipboard item when the scan ends.
    void (async () => {
      const classes = await referencedClassRules(nodes)
      if (!classes.length) return
      const current = await readComposerClipboard()
      if (current.aria !== aria) return
      await writeComposerClipboard({
        ...formats,
        aria: encodeComposerClipboard({ ...payload, classes }),
      })
    })().catch(() => {
      // The copied nodes remain usable even when optional CSS enrichment fails.
    })
    return true
  }

  async function cutSelected(): Promise<boolean> {
    if (!(await copySelected())) return false
    return deleteSelected()
  }

  function resolveProjectImport(sourceFile: string, importPath: string): string {
    if (!importPath.startsWith(".")) return importPath
    const parts = sourceFile.split("/")
    parts.pop()
    for (const segment of importPath.split("/")) {
      if (!segment || segment === ".") continue
      if (segment === "..") parts.pop()
      else parts.push(segment)
    }
    return parts.join("/").replace(/\.(?:[cm]?[jt]sx?)$/i, "")
  }

  function renameComponents(
    nodes: import("../../../shared/composer/types").EditableNode[],
    from: string,
    to: string,
  ) {
    const visit = (
      list: import("../../../shared/composer/types").EditableNode[],
    ) => {
      for (const node of list) {
        if (node.kind === "component" && node.name === from) node.name = to
        if (node.kind === "conditional") {
          visit(node.consequent)
          if (node.alternate) visit(node.alternate)
        } else if (node.kind === "map" || node.kind === "fragment") {
          visit(node.children)
        } else if (
          (node.kind === "element" ||
            node.kind === "component" ||
            node.kind === "slot") &&
          node.children
        ) {
          visit(node.children)
        }
      }
    }
    visit(nodes)
  }

  function mergeClipboardImports(
    model: AstroDocumentModel,
    nodes: import("../../../shared/composer/types").EditableNode[],
    payload: ComposerClipboardPayloadV1,
  ) {
    const targetFile = options.editFile.value ?? payload.sourceFile
    for (const imported of payload.imports) {
      let nextPath = imported.path
      if (
        payload.sourceProject === options.projectPath.value &&
        imported.path.startsWith(".")
      ) {
        const projectFile = resolveProjectImport(
          payload.sourceFile,
          imported.path,
        )
        nextPath = chooseImportPath(
          model,
          importPathsFor(targetFile, projectFile),
        )
      }
      const collision = model.imports.find(
        (entry) => entry.name === imported.name,
      )
      if (!collision || collision.path === nextPath) {
        ensureComponentImport(model, imported.name, nextPath)
        continue
      }
      let suffix = 2
      let alias = `${imported.name}${suffix}`
      while (model.imports.some((entry) => entry.name === alias)) {
        suffix += 1
        alias = `${imported.name}${suffix}`
      }
      renameComponents(nodes, imported.name, alias)
      ensureComponentImport(model, alias, nextPath)
    }
  }

  function renameClassReferences(
    nodes: import("../../../shared/composer/types").EditableNode[],
    from: string,
    to: string,
  ) {
    const quoted = new RegExp(
      `(["'])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`,
      "g",
    )
    visitNodeTree(nodes, (node) => {
      if (
        node.kind !== "element" &&
        node.kind !== "component" &&
        node.kind !== "fragment" &&
        node.kind !== "slot" &&
        node.kind !== "raw"
      ) return
      const plain = node.props?.class
      if (plain?.type === "string") {
        plain.value = splitClassNames(plain.value)
          .map((name) => (name === from ? to : name))
          .join(" ")
      }
      const list = node.props?.["class:list"]
      if (list?.type === "expr") {
        list.value = list.value.replace(quoted, (_match, quote: string) =>
          `${quote}${to}${quote}`,
        )
      } else if (list?.type === "string") {
        list.value = splitClassNames(list.value)
          .map((name) => (name === from ? to : name))
          .join(" ")
      }
    })
  }

  function renameClassRuleCss(css: string, from: string, to: string): string {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return css.replace(new RegExp(`\\.${escaped}(?=[:\\s,{])`, "g"), `.${to}`)
  }

  function resolveRelativeSource(sourceFile: string, value: string): string {
    const [pathname, suffix = ""] = value.split(/(?=[?#])/s, 2)
    const segments = sourceFile.split("/")
    segments.pop()
    for (const segment of pathname!.split("/")) {
      if (!segment || segment === ".") continue
      if (segment === "..") segments.pop()
      else segments.push(segment)
    }
    return `${segments.join("/")}${suffix}`
  }

  function relativeReference(fromFile: string, projectFile: string): string {
    const from = fromFile.split("/")
    from.pop()
    const target = projectFile.split("/")
    let common = 0
    while (from[common] === target[common] && common < from.length) common += 1
    const value = [
      ...Array.from({ length: from.length - common }, () => ".."),
      ...target.slice(common),
    ].join("/")
    return value.startsWith(".") ? value : `./${value}`
  }

  function rewriteRelativeAssetReferences(
    nodes: import("../../../shared/composer/types").EditableNode[],
    sourceFile: string,
    targetFile: string,
  ) {
    if (sourceFile === targetFile) return
    visitNodeTree(nodes, (node) => {
      if (
        node.kind !== "element" &&
        node.kind !== "component" &&
        node.kind !== "fragment" &&
        node.kind !== "slot" &&
        node.kind !== "raw"
      ) return
      for (const propName of ["src", "href", "poster"]) {
        const value = node.props?.[propName]
        if (
          value?.type !== "string" ||
          !value.value.startsWith(".") ||
          /^(?:\.\/)?#/.test(value.value)
        ) continue
        const projectFile = resolveRelativeSource(sourceFile, value.value)
        value.value = relativeReference(targetFile, projectFile)
      }
    })
  }

  async function prepareClipboardStylesheet(
    payload: ComposerClipboardPayloadV1,
    nodes: import("../../../shared/composer/types").EditableNode[],
  ): Promise<(ComposerStylesheetEdit & { beforeContent: string }) | null> {
    if (!payload.classes.length) return null
    try {
      const sheets = await listStylesheets(options.projectPath.value)
      const preferred =
        (payload.sourceProject === options.projectPath.value
          ? sheets.find((sheet) =>
              payload.classes.some(
                (rule) => rule.sourceFile === sheet.relativePath,
              ),
            )
          : null) ??
        sheets.find((sheet) => sheet.isEntry) ??
        sheets[0]
      if (!preferred) return null
      const target = await readStylesheet(
        options.projectPath.value,
        preferred.relativePath,
      )
      let content = target.content
      for (const rule of payload.classes) {
        let name = rule.name
        const existing = extractClassRuleCss(content, name)
        if (existing && existing.replace(/\s+/g, " ").trim() === rule.css.replace(/\s+/g, " ").trim()) {
          continue
        }
        if (existing) {
          let suffix = 2
          name = `${rule.name}-copy`
          while (extractClassRuleCss(content, name)) {
            name = `${rule.name}-copy-${suffix}`
            suffix += 1
          }
          renameClassReferences(nodes, rule.name, name)
        }
        const css = renameClassRuleCss(rule.css, rule.name, name).trim()
        const trimmed = content.replace(/\s+$/, "")
        content = `${trimmed}${trimmed ? "\n\n" : ""}${css}\n`
      }
      if (content === target.content) return null
      return {
        relativeFile: target.relativePath,
        content,
        beforeContent: target.content,
        expectedMtimeMs: target.mtimeMs,
      }
    } catch {
      return null
    }
  }

  function finishPaste(result: ComposerPasteResult): ComposerPasteResult {
    options.onPasteResult?.(result)
    return result
  }

  function childTagsForPaste(node: EditableNode): Array<string | null> {
    if (node.kind === "element" || node.kind === "raw") {
      return [node.name.toLowerCase()]
    }
    if (node.kind === "conditional") {
      return [
        ...node.consequent.flatMap(childTagsForPaste),
        ...(node.alternate ?? []).flatMap(childTagsForPaste),
      ]
    }
    if (node.kind === "map" || node.kind === "fragment") {
      return node.children.flatMap(childTagsForPaste)
    }
    return [null]
  }

  function targetAcceptsForest(
    model: AstroDocumentModel,
    target: InsertTarget,
    nodes: readonly EditableNode[],
  ): boolean {
    return nodes.every((node) =>
      childTagsForPaste(node).every((tag) =>
        parentAcceptsChildAtPath(model, target.parentPath, tag),
      ),
    )
  }

  /** Find one placement that is legal for every root in the pasted forest. */
  function resolveForestInsertTarget(
    model: AstroDocumentModel,
    selectedPath: string | null,
    nodes: readonly EditableNode[],
  ): InsertTarget | null {
    const tags = [...new Set(nodes.flatMap(childTagsForPaste))]
    if (activePageSlot) {
      const fallback = resolveInsertTarget(
        model,
        selectedPath,
        tags[0] ?? null,
      )
      const target = activeInsertTarget(model, fallback)
      return targetAcceptsForest(model, target, nodes) ? target : null
    }

    const candidates: InsertTarget[] = []
    for (const selected of [selectedPath, null]) {
      for (const tag of tags.length ? tags : [null]) {
        // Target discovery may open a selected self-closing parent. Probe on a
        // clone so rejected candidates cannot alter the actual transaction.
        const probe = cloneComposerValue(model)
        const candidate = resolveInsertTarget(probe, selected, tag)
        if (
          !candidates.some(
            (entry) =>
              entry.parentPath === candidate.parentPath &&
              entry.index === candidate.index,
          )
        ) {
          candidates.push(candidate)
        }
      }
    }
    return candidates.find((target) => targetAcceptsForest(model, target, nodes)) ?? null
  }

  type ExternalComponentResolution = { name: string; file: string | null }
  type ExternalComponentResolutionResult =
    | { ok: true; components: ExternalComponentResolution[] }
    | { ok: false; code: "unresolved-component" | "ambiguous-component"; detail: string }

  function resolveExternalComponents(
    model: AstroDocumentModel,
    nodes: EditableNode[],
  ): ExternalComponentResolutionResult {
    const names = referencedComponentNames(nodes)
    const components: ExternalComponentResolution[] = []
    for (const name of names) {
      if (name === "Fragment" || !/^[A-Z]/.test(name)) continue
      if (model.imports.some((entry) => entry.name === name)) {
        components.push({ name, file: null })
        continue
      }
      const matches = [
        ...new Map(
          (options.availableComponents?.value ?? [])
            .filter((candidate) => {
              const basename = candidate.file.split("/").at(-1)?.replace(/\.astro$/i, "")
              return candidate.name === name || basename === name
            })
            .map((candidate) => [candidate.file, candidate]),
        ).values(),
      ]
      if (matches.length === 0) {
        return {
          ok: false,
          code: "unresolved-component",
          detail: `No project component resolves <${name}>.`,
        }
      }
      if (matches.length > 1) {
        return {
          ok: false,
          code: "ambiguous-component",
          detail: `<${name}> matches ${matches.length} project components.`,
        }
      }
      components.push({ name, file: matches[0]!.file })
    }
    return { ok: true, components }
  }

  function mergeExternalComponentImports(
    model: AstroDocumentModel,
    nodes: EditableNode[],
    components: readonly ExternalComponentResolution[],
  ): void {
    const targetFile = options.editFile.value
    if (!targetFile) return
    for (const component of components) {
      if (component.file) {
        const importPath = chooseImportPath(
          model,
          importPathsFor(targetFile, component.file),
        )
        ensureComponentImport(model, component.name, importPath)
      }
      visitNodeTree(nodes, (node) => {
        if (node.kind === "component" && node.name === component.name) {
          node.dynamicTag = false
        }
      })
    }
  }

  function rawStylesReferenceRewrittenIds(
    nodes: EditableNode[],
    replacements: ReadonlyMap<string, string>,
  ): boolean {
    if (!replacements.size) return false
    let unsafe = false
    visitNodeTree(nodes, (node) => {
      if (unsafe || node.kind !== "raw" || node.name.toLowerCase() !== "style") return
      for (const id of replacements.keys()) {
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        if (new RegExp(`(^|[^\\w-])#${escaped}(?=[^\\w-]|$)`, "m").test(node.inner)) {
          unsafe = true
          return
        }
      }
    })
    return unsafe
  }

  async function pasteClipboard(
    supplied?: ComposerClipboardFormats,
  ): Promise<ComposerPasteResult> {
    if (!options.designActive.value || !options.editable.value) {
      return finishPaste({ ok: false, code: "unavailable" })
    }

    let formats: ComposerClipboardFormats
    try {
      formats = supplied ?? (await readComposerClipboard())
    } catch {
      return finishPaste({ ok: false, code: "unavailable" })
    }

    const payload = decodeComposerClipboard(formats.aria)
    let source: "aria" | ComposerClipboardImportKind = "aria"
    let warnings: ComposerClipboardImportWarning[] = []
    let sourceNodes: EditableNode[]
    if (payload?.nodes?.length) {
      sourceNodes = payload.nodes
    } else {
      const imported = await importExternalComposerClipboard(formats)
      if (!imported.ok) return finishPaste(imported)
      source = imported.kind
      warnings = imported.warnings
      sourceNodes = imported.nodes
    }

    const current = options.model.value
    if (!current || !options.editFile.value) {
      return finishPaste({ ok: false, code: "unavailable" })
    }
    const componentResolution = payload
      ? { ok: true as const, components: [] }
      : resolveExternalComponents(current, sourceNodes)
    if (!componentResolution.ok) return finishPaste(componentResolution)

    const cloned = cloneNodesWithNewIds(sourceNodes, {
      rewriteDomIds: true,
      existingDomIds: collectStaticDomIds(current),
    })
    const nodes = cloned.nodes
    if (rawStylesReferenceRewrittenIds(nodes, cloned.rewrittenDomIds)) {
      return finishPaste({
        ok: false,
        code: "unsafe-id-collision",
        detail: "A pasted style selector references an ID already used on this page.",
      })
    }
    if (payload) {
      rewriteRelativeAssetReferences(
        nodes,
        payload.sourceFile,
        options.editFile.value,
      )
    }
    const stylesheetEdit = payload
      ? await prepareClipboardStylesheet(payload, nodes)
      : null
    const selected = options.beacon.selectedPath.value
    let mutationFailure: ComposerPasteResult | null = null
    const mutation = (model: AstroDocumentModel) => {
      if (payload) mergeClipboardImports(model, nodes, payload)
      else mergeExternalComponentImports(model, nodes, componentResolution.components)
      const target = resolveForestInsertTarget(model, selected, nodes)
      if (!target) {
        mutationFailure = {
          ok: false,
          code: "invalid-containment",
          detail: "The selected location cannot contain every pasted root element.",
        }
        return { ok: false, selectPath: selected, reason: mutationFailure.detail }
      }
      return insertNodesAt(model, nodes, target)
    }

    const committed = stylesheetEdit
      ? Boolean(await commitModelWithStylesheet(mutation, stylesheetEdit))
      : await commitModelMutation(mutation)
    if (!committed) {
      return finishPaste(
        mutationFailure ?? { ok: false, code: "persist-failed" },
      )
    }
    return finishPaste({
      ok: true,
      source,
      insertedCount: nodes.length,
      warnings,
      staged: options.stagedSource?.value != null,
    })
  }

  function duplicateSelected(): boolean {
    const path = options.beacon.selectedPath.value
    if (!path) return false
    return mutateModel((model) => duplicateNodeAtPath(model, path), {
      immediate: true,
    })
  }

  function canMoveSelected(direction: ReorderDirection): boolean {
    const path = options.beacon.selectedPath.value
    const model = options.model.value
    if (!path || !model || !options.editable.value) return false
    return canReorder(model, path, direction)
  }

  function moveSelected(direction: ReorderDirection): boolean {
    const path = options.beacon.selectedPath.value
    if (!path) return false
    return mutateModel((model) => reorderNodeAtPath(model, path, direction), {
      immediate: true,
    })
  }

  function wrapSelected(id: "section" | "container" | "div"): boolean {
    if (!options.designActive.value) return false
    const path = options.beacon.selectedPath.value
    if (!path) return false
    const paths = options.beacon.selections.value.map((selection) => selection.path)
    return mutateModel(
      (model) => wrapNodesAtPaths(
        model,
        paths,
        path,
        createAriaPrimitiveNode(id),
      ),
      { immediate: true },
    )
  }

  function insertElement(
    tag: string,
    target: InsertTarget | null = null,
  ): boolean {
    if (!options.designActive.value) return false
    const path = options.beacon.selectedPath.value
    return mutateModel(
      (model) => {
        const fallback = resolveInsertTarget(
          model,
          path,
          tag.trim().toLowerCase() || null,
        )
        const t = target ?? activeInsertTarget(model, fallback)
        return insertElementAt(model, tag, t)
      },
      { immediate: true },
    )
  }

  function insertAriaPrimitive(
    id: AriaPrimitiveId | string,
    target: InsertTarget | null = null,
  ): boolean {
    if (!options.designActive.value) return false
    if (!isAriaPrimitiveId(id)) return false
    const path = options.beacon.selectedPath.value
    const definition = ariaPrimitiveDef(id)
    const childTag = definition ? definition.tag : "div"
    return mutateModel(
      (model) => {
        const t = target ?? activeInsertTarget(
          model,
          resolveInsertTarget(model, path, childTag),
        )
        return insertAriaPrimitiveAt(model, id, t)
      },
      { immediate: true },
    )
  }

  function insertComponent(
    component: ComposerInsertComponent,
    target: InsertTarget | null = null,
  ): boolean {
    if (!options.designActive.value) return false
    const page = options.editFile.value
    if (!page) return false
    const path = options.beacon.selectedPath.value
    return mutateModel(
      (model) => {
        const paths = importPathsFor(page, component.file)
        const importPath = chooseImportPath(model, paths)
        const t = target ?? activeInsertTarget(
          model,
          resolveInsertTarget(model, path, null),
        )
        return insertComponentAt(
          model,
          { name: component.name, importPath },
          t,
        )
      },
      { immediate: true },
    )
  }

  function insertLayoutSlot(
    name: string | null,
    target: InsertTarget | null = null,
  ): boolean {
    if (!options.designActive.value) return false
    const selected = options.beacon.selectedPath.value
    return mutateModel(
      (model) => {
        const resolved = target ?? resolveInsertTarget(model, selected, null)
        return insertComposerLayoutSlot(model, name, resolved)
      },
      { immediate: true },
    )
  }

  async function mutateLayoutSlotContract(
    slot: ComposerLayoutSlotDefinition,
    action: { type: "rename"; nextName: string } | { type: "delete" },
  ): Promise<{ affectedPages: number; fallbackNodes: number } | null> {
    const layoutFile = options.editFile.value
    const currentLayout = options.model.value
    if (!layoutFile || !currentLayout || !options.editable.value) return null
    if (slot.name == null) return null
    try {
      await flushSave()
    } catch {
      return null
    }
    const layout = cloneComposerValue(options.model.value!)
    const layoutMutation = action.type === "rename"
      ? renameComposerLayoutSlot(layout, slot.path, action.nextName)
      : deleteComposerLayoutSlot(layout, slot.path)
    if (!layoutMutation.ok) return null

    let consumers: Array<{
      file: string
      mtimeMs: number
      source: string
      before: AstroDocumentModel
      after: AstroDocumentModel
    } | null>
    try {
      consumers = await Promise.all(
        (options.availablePages?.value ?? []).map(async ({ file }) => {
          const parsed = await parseComposerPage(options.projectPath.value, file)
          if (!parsed.editable || parsed.mtimeMs == null) {
            throw new Error(
              `Cannot safely update ${file}; its Astro source is not editable.`,
            )
          }
          if (!composerPageUsesLayoutFile(parsed.model, file, layoutFile)) return null
          const before = cloneComposerValue(parsed.model)
          const after = cloneComposerValue(parsed.model)
          const changed = action.type === "rename"
            ? renameComposerPageSlotAssignments(after, slot.name!, action.nextName)
            : unwrapComposerPageSlotAssignments(after, slot.name!)
          return changed > 0
            ? {
                file,
                mtimeMs: Math.floor(parsed.mtimeMs),
                source: parsed.source,
                before,
                after,
              }
            : null
        }),
      )
    } catch (error) {
      setConflict(error)
      return null
    }
    const affected = consumers.filter(
      (consumer): consumer is NonNullable<typeof consumer> => consumer !== null,
    )
    for (const consumer of affected) {
      documentState.set(consumer.file, {
        relativeFile: consumer.file,
        model: consumer.before,
        source: consumer.source,
        mtimeMs: consumer.mtimeMs,
      })
    }
    const pushed = pushHistory(null)
    saving.value = true
    saveError.value = null
    try {
      const layoutSource = pendingSource ?? options.exactSource?.value
      if (layoutSource == null) {
        throw new Error("The exact layout source is unavailable. Reload before editing slots.")
      }
      const patchedLayout = patchComposerModelSource(
        layoutSource,
        currentLayout,
        layout,
      )
      if (!patchedLayout.ok) throw new Error(patchedLayout.reason)
      const patchedConsumers = affected.map((consumer) => {
        const patched = patchComposerModelSource(
          consumer.source,
          consumer.before,
          consumer.after,
        )
        if (!patched.ok) throw new Error(`${consumer.file}: ${patched.reason}`)
        return {
          relativeFile: consumer.file,
          source: patched.source,
          expectedSource: consumer.source,
          expectedMtimeMs: consumer.mtimeMs,
        }
      })
      const result = await commitComposerEditTransaction({
        projectPath: options.projectPath.value,
        previewRevision: options.previewRevision?.value,
        sources: [
          {
            relativeFile: layoutFile,
            source: patchedLayout.source,
            expectedSource: options.exactSource?.value ?? undefined,
            expectedMtimeMs: options.editedMtimeMs.value,
          },
          ...patchedConsumers,
        ],
      })
      if (!result.ok) throw conflictError(result)
      if (options.model.value) {
        options.onModelMutation?.(
          options.model.value,
          layout,
          undefined,
          patchedLayout.source,
        )
      }
      options.model.value = layout
      pendingSource = null
      options.onExactSourcePersisted?.(patchedLayout.source)
      options.onPersisted?.(result)
      for (const revision of result.revisions) {
        if (revision.relativeFile === layoutFile) {
          options.editedMtimeMs.value = revision.mtimeMs
          continue
        }
        const consumer = affected.find((item) => item.file === revision.relativeFile)
        if (consumer) {
          documentState.set(consumer.file, {
            relativeFile: consumer.file,
            model: consumer.after,
            source: patchedConsumers.find(
              (item) => item.relativeFile === consumer.file,
            )?.source ?? consumer.source,
            mtimeMs: revision.mtimeMs,
          })
        }
      }
      dirty.value = false
      future.value = []
      suppressReloadUntil = Date.now() + 1600
      if (action.type === "delete") options.beacon.dim()
      else if (layoutMutation.selectPath) {
        options.beacon.illuminate(layoutMutation.selectPath, { source: "api" })
      }
      return {
        affectedPages: affected.length,
        fallbackNodes: slot.fallbackNodes.length,
      }
    } catch (error) {
      if (pushed) past.value = past.value.slice(0, -1)
      for (const consumer of affected) documentState.delete(consumer.file)
      setConflict(error)
      return null
    } finally {
      saving.value = false
    }
  }

  function renameLayoutSlot(
    slot: ComposerLayoutSlotDefinition,
    nextName: string,
  ) {
    return mutateLayoutSlotContract(slot, { type: "rename", nextName })
  }

  function deleteLayoutSlot(slot: ComposerLayoutSlotDefinition) {
    return mutateLayoutSlotContract(slot, { type: "delete" })
  }

  async function inspectLayoutSlotUsage(
    slot: ComposerLayoutSlotDefinition,
  ): Promise<{ affectedPages: number; fallbackNodes: number } | null> {
    const layoutFile = options.editFile.value
    if (!layoutFile || !slot.name) return null
    saveError.value = null
    try {
      const usages = await Promise.all(
        (options.availablePages?.value ?? []).map(async ({ file }) => {
          const parsed = await parseComposerPage(options.projectPath.value, file)
          if (!parsed.editable) {
            throw new Error(
              `Cannot safely inspect ${file}; its Astro source is not editable.`,
            )
          }
          if (!composerPageUsesLayoutFile(parsed.model, file, layoutFile)) return false
          const probe = cloneComposerValue(parsed.model)
          return renameComposerPageSlotAssignments(
            probe,
            slot.name!,
            "__aria-slot-usage__",
          ) > 0
        }),
      )
      return {
        affectedPages: usages.filter(Boolean).length,
        fallbackNodes: slot.fallbackNodes.length,
      }
    } catch (error) {
      setConflict(error)
      return null
    }
  }

  function assignPageLayout(
    layout: ComposerInsertComponent,
    props: import("../../../shared/composer/types").AstroPropMap = {},
  ): boolean {
    const page = options.editFile.value
    if (!page || !options.designActive.value) return false
    return mutateModel(
      (model) =>
        assignComposerPageLayout(model, {
          name: layout.name,
          importPath: chooseImportPath(model, importPathsFor(page, layout.file)),
          props,
        }),
      { immediate: true },
    )
  }

  function removePageLayout(): boolean {
    if (!options.designActive.value) return false
    return mutateModel((model) => removeComposerPageLayout(model), {
      immediate: true,
    })
  }

  function moveNodeTo(path: string, target: InsertTarget): boolean {
    if (!options.designActive.value) return false
    return mutateModel((model) => reparentNodeAtPath(model, path, target), {
      immediate: true,
    })
  }

  function moveNodesTo(paths: readonly string[], target: InsertTarget): boolean {
    if (!options.designActive.value) return false
    return mutateModel((model) => reparentNodesAtPaths(model, paths, target), {
      immediate: true,
    })
  }

  /** Append / sibling insert at selection (palette double-click + context menu). */
  function insertDebugAtSelection(tag = "div"): boolean {
    return insertElement(tag, null)
  }

  function setSelectedProp(
    propName: string,
    value: PropValue | undefined,
    mutateOptions?: { immediate?: boolean },
  ): boolean {
    const path = options.beacon.selectedPath.value
    if (!path) return false
    const immediate = mutateOptions?.immediate ?? false
    return mutateModel(
      (model) => setPropAtPath(model, path, propName, value),
      {
        immediate,
        coalesceKey: immediate ? null : `prop:${path}:${propName}`,
        saveDelayMs: immediate ? undefined : INSPECTOR_SAVE_DEBOUNCE_MS,
      },
    )
  }

  function renameSelectedProp(oldName: string, newName: string): boolean {
    const path = options.beacon.selectedPath.value
    if (!path) return false
    return mutateModel(
      (model) => renamePropAtPath(model, path, oldName, newName),
      {
        immediate: false,
        coalesceKey: `prop-rename:${path}`,
        saveDelayMs: INSPECTOR_SAVE_DEBOUNCE_MS,
      },
    )
  }

  function beginCanvasTextEdit(input: {
    sessionId: string
    path: string
    occurrence: number
    detachExpression?: boolean
    renderedValue?: string
  }): { ok: true; value: string } | { ok: false; reason: string } {
    if (!options.editable.value || !options.model.value || mutationPending.value) {
      return { ok: false, reason: "This document is not currently editable." }
    }
    if (canvasTextSession) {
      return { ok: false, reason: "Finish the current text edit first." }
    }
    const node = nodeAtMarkerPath(options.model.value.nodes, input.path)
    if (!node || (node.kind !== "text" && node.kind !== "expr")) {
      return { ok: false, reason: "Select a plain heading or text element." }
    }
    if (node.kind === "expr" && !input.detachExpression) {
      return { ok: false, reason: "This text is connected to a live value." }
    }
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const baselinePast = cloneComposerValue(past.value)
    const baselineFuture = cloneComposerValue(future.value)
    const baselineModel = cloneComposerValue(options.model.value)
    pushHistory(null)
    const originalValue = input.renderedValue ?? node.value
    canvasTextSession = {
      sessionId: input.sessionId,
      path: input.path,
      occurrence: input.occurrence,
      detachExpression: Boolean(input.detachExpression),
      originalValue,
      baselineModel,
      baselinePendingSource: pendingSource,
      baselinePendingRevision: pendingSourceRevision,
      baselineStagedSource: options.stagedSource?.value ?? null,
      baselineDirty: dirty.value,
      baselinePast,
      baselineFuture,
      lastSequence: 0,
      changed: false,
    }
    return { ok: true, value: originalValue }
  }

  function updateCanvasTextEdit(
    input: CanvasTextPatchOrigin & { value: string },
  ): boolean {
    const session = canvasTextSession
    const current = options.model.value
    if (
      !session || !current || input.sessionId !== session.sessionId ||
      input.path !== session.path || input.occurrence !== session.occurrence ||
      input.sequence <= session.lastSequence
    ) return false
    const next = cloneComposerValue(current)
    const location = locateAtPath(next.nodes, session.path)
    if (!location || (location.node.kind !== "text" && location.node.kind !== "expr")) {
      saveError.value = "The selected text is no longer available."
      return false
    }
    if (location.node.kind === "expr") {
      if (!session.detachExpression) return false
      location.list[location.index] = {
        kind: "text",
        id: location.node.id,
        sourceRange: location.node.sourceRange,
        value: input.value,
      }
    } else {
      location.node.value = input.value
    }
    const patchedSource = patchVisualSource(current, next)
    if (patchedSource === false) return false
    session.lastSequence = input.sequence
    session.changed = true
    adoptModelMutation(
      current,
      next,
      { ok: true },
      undefined,
      patchedSource ?? undefined,
      input,
    )
    dirty.value = true
    return true
  }

  async function finishCanvasTextEdit(
    sessionId: string,
    action: "commit" | "cancel",
  ): Promise<{ ok: boolean; value: string; reason?: string }> {
    const session = canvasTextSession
    if (!session || session.sessionId !== sessionId) {
      return { ok: false, value: "", reason: "This text editing session is stale." }
    }
    canvasTextSession = null
    if (action === "cancel" || !session.changed) {
      const current = options.model.value
      const restoreSource = session.baselineStagedSource
        ?? session.baselinePendingSource
        ?? options.exactSource?.value
        ?? undefined
      if (current && session.changed) {
        options.onModelMutation?.(
          current,
          cloneComposerValue(session.baselineModel),
          undefined,
          restoreSource,
          {
            sessionId,
            path: session.path,
            occurrence: session.occurrence,
            sequence: session.lastSequence + 1,
          },
        )
      }
      options.model.value = cloneComposerValue(session.baselineModel)
      if (options.stagedSource && session.baselineStagedSource != null) {
        options.onStagedSourceChange?.(session.baselineStagedSource)
      }
      pendingSource = session.baselinePendingSource
      pendingSourceRevision = session.baselinePendingRevision
      past.value = session.baselinePast
      future.value = session.baselineFuture
      dirty.value = session.baselineDirty
      saveError.value = null
      if (session.baselineDirty && options.stagedSource?.value == null) {
        scheduleSave(false)
      }
      return { ok: true, value: session.originalValue }
    }
    if (options.stagedSource?.value == null) scheduleSave(false)
    const node = options.model.value
      ? nodeAtMarkerPath(options.model.value.nodes, session.path)
      : null
    return {
      ok: true,
      value: node?.kind === "text" ? node.value : session.originalValue,
    }
  }

  function setSelectedText(
    value: string,
    mutateOptions?: { immediate?: boolean },
  ): boolean {
    const path = options.beacon.selectedPath.value
    if (!path) return false
    const immediate = mutateOptions?.immediate ?? false
    return mutateModel((model) => setTextAtPath(model, path, value), {
      immediate,
      coalesceKey: immediate ? null : `text:${path}`,
      saveDelayMs: immediate ? undefined : INSPECTOR_SAVE_DEBOUNCE_MS,
    })
  }

  function setSelectedTag(tag: string): boolean {
    const path = options.beacon.selectedPath.value
    if (!path) return false
    return mutateModel((model) => setTagAtPath(model, path, tag), {
      immediate: false,
      coalesceKey: `tag:${path}`,
      saveDelayMs: INSPECTOR_SAVE_DEBOUNCE_MS,
    })
  }

  async function restoreSnapshot(entry: HistoryEntry): Promise<boolean> {
    const file = options.editFile.value
    if (!file || !options.model.value || saveConflict.value) return false
    if (options.stagedSource?.value != null) {
      const targetModel = cloneComposerValue(entry.model)
      const patched = patchComposerModelSource(
        options.stagedSource.value,
        options.model.value,
        targetModel,
      )
      if (!patched.ok) {
        saveError.value = patched.reason
        return false
      }
      options.onStagedSourceChange?.(patched.source)
      applySnapshotLocally({ ...entry, model: targetModel }, patched.source)
      dirty.value = true
      return true
    }
    const targetModel = cloneComposerValue(entry.model)
    const sourceBefore = pendingSource ?? options.exactSource?.value ?? null
    if (sourceBefore == null && options.exactSource) {
      saveError.value = "The exact Astro source is unavailable. Reload before restoring history."
      return false
    }
    const patched = sourceBefore == null
      ? null
      : patchComposerModelSource(
          sourceBefore,
          options.model.value,
          targetModel,
        )
    if (patched && !patched.ok) {
      saveError.value = patched.reason
      return false
    }
    const targetSheets = new Map(
      entry.stylesheets.map((sheet) => [sheet.relativeFile, sheet]),
    )
    const stylesheetEdits: ComposerStylesheetEdit[] = []
    for (const [relativeFile, target] of targetSheets) {
      const current = stylesheetState.get(relativeFile)
      if (!current || current.content === target.content) continue
      stylesheetEdits.push({
        relativeFile,
        content: target.content,
        expectedMtimeMs: current.mtimeMs,
      })
    }
    saving.value = true
    saveError.value = null
    try {
      const externalSources = entry.documents.map((document) => {
        const current = documentState.get(document.relativeFile)
        if (!current) {
          throw new Error(`The source state for ${document.relativeFile} is unavailable.`)
        }
        const patchedDocument = patchComposerModelSource(
          current.source,
          current.model,
          document.model,
        )
        if (!patchedDocument.ok) {
          throw new Error(`${document.relativeFile}: ${patchedDocument.reason}`)
        }
        return {
          relativeFile: document.relativeFile,
          source: patchedDocument.source,
          expectedSource: current.source,
          expectedMtimeMs: current.mtimeMs,
        }
      })
      const result = await commitComposerEditTransaction({
        projectPath: options.projectPath.value,
        previewRevision: options.previewRevision?.value,
        ...(patched?.ok
          ? {
              sources: [{
                relativeFile: file,
                source: patched.source,
                expectedSource: options.exactSource?.value ?? undefined,
                expectedMtimeMs: options.editedMtimeMs.value,
              }, ...externalSources.filter((source) => source.relativeFile !== file)],
            }
          : {
              pages: [
                {
                  relativeFile: file,
                  model: targetModel,
                  expectedMtimeMs: options.editedMtimeMs.value,
                },
                ...entry.documents
                  .filter((page) => page.relativeFile !== file)
                  .map((page) => ({
                    relativeFile: page.relativeFile,
                    model: page.model,
                    expectedMtimeMs: page.mtimeMs,
                  })),
              ],
            }),
        stylesheets: stylesheetEdits,
      })
      if (!result.ok) throw conflictError(result)
      const revisions = new Map(
        result.revisions.map((revision) => [revision.relativeFile, revision]),
      )
      const restored = cloneComposerValue({ ...entry, model: targetModel })
      for (const sheet of restored.stylesheets) {
        const revision = revisions.get(sheet.relativeFile)
        if (revision) {
          sheet.mtimeMs = revision.mtimeMs
        } else {
          const current = stylesheetState.get(sheet.relativeFile)
          if (current?.content === sheet.content) sheet.mtimeMs = current.mtimeMs
        }
      }
      const pageRevision = revisions.get(file)
      if (pageRevision) options.editedMtimeMs.value = pageRevision.mtimeMs
      if (patched?.ok) {
        pendingSource = null
        options.onExactSourcePersisted?.(patched.source)
      }
      applySnapshotLocally(restored, patched?.ok ? patched.source : undefined)
      for (const document of restored.documents) {
        const revision = revisions.get(document.relativeFile)
        if (revision) document.mtimeMs = revision.mtimeMs
        const source = externalSources.find(
          (item) => item.relativeFile === document.relativeFile,
        )?.source
        if (source) document.source = source
        documentState.set(document.relativeFile, cloneComposerValue(document))
      }
      dirty.value = false
      options.onPersisted?.(result)
      suppressReloadUntil = Date.now() + 1600
      return true
    } catch (error) {
      setConflict(error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function undo(): Promise<void> {
    if (
      !options.editable.value ||
      mutationPending.value ||
      options.draftHistoryBlocked?.value ||
      !past.value.length ||
      saving.value
    ) return
    const current = snapshotOf()
    const entry = past.value[past.value.length - 1]!
    if (!(await restoreSnapshot(entry))) return
    past.value = past.value.slice(0, -1)
    if (current) future.value = [...future.value, current]
    lastKey = null
    lastPush = 0
  }

  async function redo(): Promise<void> {
    if (
      !options.editable.value ||
      mutationPending.value ||
      options.draftHistoryBlocked?.value ||
      !future.value.length ||
      saving.value
    ) return
    const current = snapshotOf()
    const entry = future.value[future.value.length - 1]!
    if (!(await restoreSnapshot(entry))) return
    future.value = future.value.slice(0, -1)
    if (current) past.value = [...past.value, current]
    lastKey = null
    lastPush = 0
  }

  async function resetForPage(resetOptions?: { flush?: boolean }) {
    if (resetOptions?.flush !== false && dirty.value) {
      try {
        await flushSave()
      } catch {
        /* keep going — page switch shouldn't trap */
      }
    }
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    past.value = []
    future.value = []
    stylesheetState.clear()
    documentState.clear()
    activePageSlot = null
    pendingSource = null
    pendingSourceRevision = 0
    lastKey = null
    lastPush = 0
    dirty.value = false
    saveError.value = null
    saveConflict.value = null
  }

  function shouldIgnoreExternalReload(): boolean {
    if (dirty.value || saving.value || mutationPending.value) return true
    if (Date.now() < suppressReloadUntil) return true
    return false
  }

  function markSaved(): void {
    pendingSource = null
    pendingSourceRevision = 0
    dirty.value = false
    saveError.value = null
    saveConflict.value = null
    suppressReloadUntil = Date.now() + 1600
  }

  function handleModHistory(event: {
    key: string
    shift: boolean
    preventDefault?: () => void
  }): boolean {
    const key = event.key.toLowerCase()
    if (key !== "z" && key !== "y") return false
    const wantsRedo = key === "y" || event.shift
    if (!(wantsRedo ? future.value.length : past.value.length)) return false
    event.preventDefault?.()
    if (wantsRedo) void redo()
    else void undo()
    return true
  }

  function onComposerKeydown(event: KeyboardEvent) {
    if (!options.designActive.value || !options.editable.value || mutationPending.value) return
    const mod = event.metaKey || event.ctrlKey

    if (isEditableKeyboardTarget(event.target)) return

    if (
      mod &&
      (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")
    ) {
      handleModHistory({
        key: event.key,
        shift: event.shiftKey,
        preventDefault: () => event.preventDefault(),
      })
      return
    }

    if (mod && !event.shiftKey) {
      const key = event.key.toLowerCase()
      if (key === "c" || key === "x" || key === "v") {
        event.preventDefault()
        if (key === "c") void copySelected()
        else if (key === "x") void cutSelected()
        else void pasteClipboard()
        return
      }
    }

    const path = options.beacon.selectedPath.value
    if (!path) return

    if (!mod && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault()
      deleteSelected()
      return
    }
    if (mod && !event.shiftKey && event.key.toLowerCase() === "d") {
      event.preventDefault()
      duplicateSelected()
    }
  }

  function onIframeShortcut(payload: {
    key: string
    meta: boolean
    shift: boolean
  }) {
    if (!options.designActive.value || !options.editable.value || mutationPending.value) return
    if (payload.meta) {
      if (
        handleModHistory({
          key: payload.key,
          shift: payload.shift,
        })
      ) {
        return
      }
      if (!payload.shift && payload.key.toLowerCase() === "d") {
        duplicateSelected()
      }
      if (!payload.shift && payload.key.toLowerCase() === "c") {
        void copySelected()
      }
      if (!payload.shift && payload.key.toLowerCase() === "x") {
        void cutSelected()
      }
      if (!payload.shift && payload.key.toLowerCase() === "v") {
        void pasteClipboard()
      }
      return
    }
    if (payload.key === "Delete" || payload.key === "Backspace") {
      deleteSelected()
    }
  }

  onUnmounted(() => {
    if (saveTimer) clearTimeout(saveTimer)
  })

  return {
    model: options.model,
    dirty,
    canUndo,
    canRedo,
    saving,
    mutationPending,
    saveError,
    saveConflict,
    mutateModel,
    commitModelMutation,
    withMutationLock,
    commitInspectorMutation,
    setSelectedProp,
    renameSelectedProp,
    setSelectedText,
    beginCanvasTextEdit,
    updateCanvasTextEdit,
    finishCanvasTextEdit,
    setSelectedTag,
    commitStylesheetEdit,
    commitModelWithStylesheet,
    setSelectedPropWithStylesheet,
    deleteSelected,
    duplicateSelected,
    copySelected,
    cutSelected,
    pasteClipboard,
    moveSelected,
    wrapSelected,
    insertDebugAtSelection,
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
  }
}
