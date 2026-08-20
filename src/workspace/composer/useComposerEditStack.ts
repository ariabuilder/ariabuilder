/**
 * Composer edit stack — Stacki-shaped page → component/layout drill trail.
 *
 * The canvas keeps showing the page route. Drilling loads another `.astro`
 * model while marker paths are namespaced (`file|0.1`) and the design client
 * scopes hover/click to that prefix. `focusPath` is the page-level instance
 * that stays lit while the rest of the canvas dims.
 */

import { computed, markRaw, ref, type Ref } from "vue"
import { markerScopeForFile } from "../../../shared/composer/paths"
import type { ComposerComponentInstanceSegment } from "../../../shared/composer/componentAuthoring"
import type { AstroCollectionBinding } from "../../../shared/composer/types"

export type ComposerEditKind = "page" | "component" | "layout"

export type ComposerEditStackEntry = {
  kind: ComposerEditKind
  /** Display name (component/layout tag or page title). */
  name: string
  /** Project-relative posix path of the file being edited. */
  file: string
  /**
   * Page-namespace marker path of the instance being focused (dimming cutout).
   * Null when opened without a canvas instance (e.g. Layouts rail).
   */
  focusPath?: string | null
  /** File/path that owns this rendered invocation when editing inline. */
  parentFile?: string | null
  hostPath?: string | null
  occurrence?: number
  instanceChain?: ComposerComponentInstanceSegment[]
  collectionProps?: Record<string, AstroCollectionBinding>
}

export type ComposerEditStackApi = {
  stack: Ref<ComposerEditStackEntry[]>
  /** Top of stack — the file whose model is loaded. */
  current: Ref<ComposerEditStackEntry | null>
  /** True while editing a component/layout with the page still on canvas. */
  isDrilling: Ref<boolean>
  isStandalone: Ref<boolean>
  /** Vite marker namespace for the open file (`src/…/Card.astro|` or ""). */
  pathScope: Ref<string>
  focusPath: Ref<string | null>
  /** Reset to a single page entry (route switch / leave drill). */
  resetToPage: (entry: ComposerEditStackEntry) => void
  resetToDocument: (entry: ComposerEditStackEntry) => void
  /**
   * Push a drill entry. If `file` is already on the stack, truncates to that
   * entry (no duplicate nesting) and returns its index — caller should load
   * that file so pathScope and model stay paired.
   */
  push: (entry: ComposerEditStackEntry) => { index: number; added: boolean }
  /** Pop one level; returns the new top or null. */
  pop: () => ComposerEditStackEntry | null
  /** Jump to stack index (breadcrumb). */
  goTo: (index: number) => ComposerEditStackEntry | null
}

function snapshotCollectionProps(
  props: Record<string, AstroCollectionBinding> | undefined,
): Record<string, AstroCollectionBinding> | undefined {
  if (!props) return undefined
  return markRaw(
    JSON.parse(JSON.stringify(props)) as Record<string, AstroCollectionBinding>,
  )
}

function withPlainCollectionProps(
  entry: ComposerEditStackEntry,
): ComposerEditStackEntry {
  return {
    ...entry,
    collectionProps: snapshotCollectionProps(entry.collectionProps),
  }
}

export function useComposerEditStack(): ComposerEditStackApi {
  const stack = ref<ComposerEditStackEntry[]>([])

  const current = computed(() => {
    const s = stack.value
    return s.length ? s[s.length - 1]! : null
  })

  const isDrilling = computed(() => {
    const s = stack.value
    return s.length > 1 && s[s.length - 1]?.kind !== "page"
  })

  const isStandalone = computed(() => {
    const root = stack.value[0]
    return Boolean(root && root.kind !== "page")
  })

  const pathScope = computed(() => {
    const cur = current.value
    if (!cur || cur.kind === "page") return ""
    return markerScopeForFile(cur.file)
  })

  const focusPath = computed(() => {
    if (!isDrilling.value) return null
    return current.value?.focusPath ?? null
  })

  function resetToPage(entry: ComposerEditStackEntry) {
    stack.value = [{
      ...withPlainCollectionProps(entry),
      kind: "page",
      focusPath: null,
    }]
  }

  function resetToDocument(entry: ComposerEditStackEntry) {
    const next = withPlainCollectionProps(entry)
    stack.value = [{ ...next, focusPath: next.focusPath ?? null }]
  }

  function push(entry: ComposerEditStackEntry): {
    index: number
    added: boolean
  } {
    const s = stack.value
    const existing = s.findIndex((e) => e.file === entry.file)
    if (existing >= 0) {
      // Re-opening an ancestor (or the current file): drop deeper levels so
      // pathScope always matches the loaded model.
      if (existing < s.length - 1) {
        stack.value = s.slice(0, existing + 1)
      }
      return { index: existing, added: false }
    }
    // Nested drill keeps the outermost focus cutout.
    const next = withPlainCollectionProps(entry)
    const focusPath =
      next.focusPath ?? s[s.length - 1]?.focusPath ?? null
    stack.value = [...s, { ...next, focusPath }]
    return { index: stack.value.length - 1, added: true }
  }

  function pop(): ComposerEditStackEntry | null {
    const s = stack.value
    if (s.length < 2) return s[0] ?? null
    const next = s.slice(0, -1)
    stack.value = next
    return next[next.length - 1] ?? null
  }

  function goTo(index: number): ComposerEditStackEntry | null {
    const s = stack.value
    if (index < 0 || index >= s.length) return current.value
    if (index === s.length - 1) return current.value
    const next = s.slice(0, index + 1)
    stack.value = next
    return next[next.length - 1] ?? null
  }

  return {
    stack,
    current,
    isDrilling,
    isStandalone,
    pathScope,
    focusPath,
    resetToPage,
    resetToDocument,
    push,
    pop,
    goTo,
  }
}
