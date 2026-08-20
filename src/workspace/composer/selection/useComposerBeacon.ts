/**
 * Composer selection bus — Beacon-shaped API adapted to marker path ids.
 *
 * Identity is `path` (serializeAstroMarked / data-aria-p) + `occurrence`
 * (loop instance index), not DSL block ids or ephemeral parse node ids.
 */

import { computed, inject, provide, ref, type InjectionKey, type Ref } from "vue"
import {
  sameSelection,
  toggleSelection,
  type SelectionRef,
} from "../../../../shared/composer/selection"
import type { EditableNode } from "../../../../shared/composer/types"

export type ComposerSelectionSource =
  | "canvas"
  | "structure"
  | "code"
  | "api"
  | "keyboard"

export type ComposerRevealPolicy = "none" | "if-needed" | "center"

export type ComposerRevealRequest = {
  selection: SelectionRef
  policy: Exclude<ComposerRevealPolicy, "none">
  nonce: number
}

export type ComposerBeaconSnapshot = {
  selectedPath: string | null
  selectedOccurrence: number
  hoverPath: string | null
  hoverOccurrence: number
  /** Hover originating from structure. */
  structureHoverPath: string | null
  structureHoverOccurrence: number | null
  selections: SelectionRef[]
}

export type ComposerContextSelection = {
  file: string
  path: string
  label: string
  node: EditableNode
  /** Import specifier resolved in the context file, when the node is a component. */
  importSpec?: string | null
}

export type ComposerBeacon = {
  selectedPath: Ref<string | null>
  selectedOccurrence: Ref<number>
  hoverPath: Ref<string | null>
  hoverOccurrence: Ref<number>
  structureHoverPath: Ref<string | null>
  structureHoverOccurrence: Ref<number | null>
  /** Last selection that came from a canvas click (skip scroll-into-view). */
  canvasClickPath: Ref<string | null>
  /**
   * Last selection that came from the code editor (skip pushing the node
   * source range back into CodeMirror — the user already placed the caret).
   */
  codeClickPath: Ref<string | null>
  /** Primary first, followed by secondary rendered selections. */
  selections: Ref<SelectionRef[]>
  /** Explicit canvas reveal intent, separate from selection state changes. */
  revealRequest: Ref<ComposerRevealRequest | null>
  /** Read-only node projected from a related source file, such as a page layout. */
  contextSelection: Ref<ComposerContextSelection | null>
  hasSelection: Ref<boolean>
  /** Illuminate / select by marker path. */
  illuminate: (
    path: string | null,
    options?: {
      occurrence?: number
      source?: ComposerSelectionSource
      reveal?: ComposerRevealPolicy
    },
  ) => void
  select: (
    selection: SelectionRef | null,
    options?: {
      source?: ComposerSelectionSource
      additive?: boolean
      toggle?: boolean
      reveal?: ComposerRevealPolicy
    },
  ) => void
  setSelections: (
    selections: SelectionRef[],
    options?: {
      source?: ComposerSelectionSource
      reveal?: ComposerRevealPolicy
    },
  ) => void
  inspectContext: (selection: ComposerContextSelection) => void
  clearContextInspection: () => void
  dim: () => void
  setCanvasHover: (path: string | null, occurrence?: number) => void
  setStructureHover: (path: string | null, occurrence?: number | null) => void
  clearHover: () => void
  getSnapshot: () => ComposerBeaconSnapshot
  restoreSnapshot: (snapshot: ComposerBeaconSnapshot) => void
}

const COMPOSER_BEACON_KEY: InjectionKey<ComposerBeacon> =
  Symbol("aria.composer.beacon")

function defaultRevealPolicy(
  source: ComposerSelectionSource,
): ComposerRevealPolicy {
  return source === "canvas" || source === "code" ? "none" : "if-needed"
}

export function createComposerBeacon(): ComposerBeacon {
  const selectedPath = ref<string | null>(null)
  const selectedOccurrence = ref(0)
  const hoverPath = ref<string | null>(null)
  const hoverOccurrence = ref(0)
  const structureHoverPath = ref<string | null>(null)
  const structureHoverOccurrence = ref<number | null>(null)
  const canvasClickPath = ref<string | null>(null)
  const codeClickPath = ref<string | null>(null)
  const selections = ref<SelectionRef[]>([])
  const revealRequest = ref<ComposerRevealRequest | null>(null)
  const contextSelection = ref<ComposerContextSelection | null>(null)
  let revealNonce = 0

  const hasSelection = computed(() =>
    Boolean(selectedPath.value || contextSelection.value),
  )

  function illuminate(
    path: string | null,
    options?: {
      occurrence?: number
      source?: ComposerSelectionSource
      reveal?: ComposerRevealPolicy
    },
  ) {
    const source = options?.source ?? "api"
    const nextPath = path || null
    select(
      nextPath
        ? { path: nextPath, occurrence: options?.occurrence ?? 0 }
        : null,
      { source, reveal: options?.reveal },
    )
  }

  function syncLegacySelection() {
    const primary = selections.value[0] ?? null
    selectedPath.value = primary?.path ?? null
    selectedOccurrence.value = primary?.occurrence ?? 0
  }

  function select(
    selection: SelectionRef | null,
    options?: {
      source?: ComposerSelectionSource
      additive?: boolean
      toggle?: boolean
      reveal?: ComposerRevealPolicy
    },
  ) {
    contextSelection.value = null
    const source = options?.source ?? "api"
    canvasClickPath.value = source === "canvas" ? selection?.path ?? null : null
    codeClickPath.value = source === "code" ? selection?.path ?? null : null
    if (!selection) {
      selections.value = []
      syncLegacySelection()
      return
    }
    if (options?.toggle) {
      selections.value = toggleSelection(selections.value, selection)
    } else if (options?.additive) {
      if (!selections.value.some((item) => sameSelection(item, selection))) {
        selections.value = [...selections.value, selection]
      }
    } else {
      selections.value = [selection]
    }
    syncLegacySelection()
    const primary = selections.value[0]
    const reveal = options?.reveal ?? defaultRevealPolicy(source)
    if (primary && reveal !== "none") {
      revealRequest.value = {
        selection: { path: primary.path, occurrence: primary.occurrence },
        policy: reveal,
        nonce: ++revealNonce,
      }
    }
  }

  function setSelections(
    next: SelectionRef[],
    options?: {
      source?: ComposerSelectionSource
      reveal?: ComposerRevealPolicy
    },
  ) {
    contextSelection.value = null
    const deduped: SelectionRef[] = []
    for (const selection of next) {
      if (!deduped.some((item) => sameSelection(item, selection))) {
        deduped.push(selection)
      }
    }
    selections.value = deduped
    canvasClickPath.value =
      options?.source === "canvas" ? deduped[0]?.path ?? null : null
    codeClickPath.value =
      options?.source === "code" ? deduped[0]?.path ?? null : null
    syncLegacySelection()
    const primary = selections.value[0]
    const reveal = options?.reveal ?? defaultRevealPolicy(options?.source ?? "api")
    if (primary && reveal !== "none") {
      revealRequest.value = {
        selection: { path: primary.path, occurrence: primary.occurrence },
        policy: reveal,
        nonce: ++revealNonce,
      }
    }
  }

  function inspectContext(next: ComposerContextSelection) {
    selections.value = []
    syncLegacySelection()
    canvasClickPath.value = null
    codeClickPath.value = null
    contextSelection.value = next
  }

  function clearContextInspection() {
    contextSelection.value = null
  }

  function dim() {
    select(null)
  }

  function setCanvasHover(path: string | null, occurrence = 0) {
    hoverPath.value = path
    hoverOccurrence.value = occurrence
  }

  function setStructureHover(path: string | null, occurrence: number | null = null) {
    structureHoverPath.value = path
    structureHoverOccurrence.value = path ? occurrence : null
  }

  function clearHover() {
    hoverPath.value = null
    hoverOccurrence.value = 0
    structureHoverPath.value = null
    structureHoverOccurrence.value = null
  }

  // Vue wraps ref arrays and their entries in reactive Proxies. Browser
  // structuredClone rejects those Proxies, but SelectionRef is deliberately
  // shallow primitive data, so copy it explicitly at the boundary.
  function cloneSelections(value: readonly SelectionRef[]): SelectionRef[] {
    return value.map(({ path, occurrence }) => ({ path, occurrence }))
  }

  function getSnapshot(): ComposerBeaconSnapshot {
    return {
      selectedPath: selectedPath.value,
      selectedOccurrence: selectedOccurrence.value,
      hoverPath: hoverPath.value,
      hoverOccurrence: hoverOccurrence.value,
      structureHoverPath: structureHoverPath.value,
      structureHoverOccurrence: structureHoverOccurrence.value,
      selections: cloneSelections(selections.value),
    }
  }

  function restoreSnapshot(snapshot: ComposerBeaconSnapshot) {
    contextSelection.value = null
    selections.value = snapshot.selections?.length
      ? cloneSelections(snapshot.selections)
      : snapshot.selectedPath
        ? [{ path: snapshot.selectedPath, occurrence: snapshot.selectedOccurrence }]
        : []
    syncLegacySelection()
    hoverPath.value = snapshot.hoverPath
    hoverOccurrence.value = snapshot.hoverOccurrence
    structureHoverPath.value = snapshot.structureHoverPath
    structureHoverOccurrence.value = snapshot.structureHoverOccurrence ?? null
    canvasClickPath.value = null
    codeClickPath.value = null
  }

  return {
    selectedPath,
    selectedOccurrence,
    hoverPath,
    hoverOccurrence,
    structureHoverPath,
    structureHoverOccurrence,
    canvasClickPath,
    codeClickPath,
    selections,
    revealRequest,
    contextSelection,
    hasSelection,
    illuminate,
    select,
    setSelections,
    inspectContext,
    clearContextInspection,
    dim,
    setCanvasHover,
    setStructureHover,
    clearHover,
    getSnapshot,
    restoreSnapshot,
  }
}

export function provideComposerBeacon(
  beacon: ComposerBeacon = createComposerBeacon(),
): ComposerBeacon {
  provide(COMPOSER_BEACON_KEY, beacon)
  return beacon
}

export function useComposerBeacon(): ComposerBeacon {
  const beacon = inject(COMPOSER_BEACON_KEY, null)
  if (!beacon) {
    throw new Error(
      "useComposerBeacon() requires provideComposerBeacon() in an ancestor",
    )
  }
  return beacon
}

/** Optional inject for components that may render outside Composer. */
export function tryUseComposerBeacon(): ComposerBeacon | null {
  return inject(COMPOSER_BEACON_KEY, null)
}
