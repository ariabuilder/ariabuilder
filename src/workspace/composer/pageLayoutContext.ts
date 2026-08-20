/**
 * Page layout projection (slot groups / layout component name) must survive component
 * drills. Breadcrumb-back briefly flips stack kind to "page" while the loaded
 * file is still the drilled component — clearing layout in that window leaves
 * Layers as a flat Document → Section tree.
 */

export type ComposerStackKind = "page" | "component" | "layout"

export type PageLayoutContextAction = "preserve" | "clear" | "refresh"

export type PageLayoutContextInput = {
  /** Top-of-stack kind; null when the edit stack is empty. */
  stackKind: ComposerStackKind | null
  /** Currently loaded edit file (may lag the stack during transitions). */
  activeFile: string | null
  /** File of the page entry on the edit stack, if any. */
  pageStackFile: string | null
  /** True when the active model has a layout wrapper (`id === "layout"`). */
  hasLayoutWrapper: boolean
}

/**
 * Decide how page layout refs should change for the current stack/model pair.
 *
 * - preserve: leave existing contract in place (drill, or post-pop race)
 * - clear: page has no layout wrapper — drop projection
 * - refresh: resolve/replace layout from the active page model
 */
export function decidePageLayoutContextAction(
  input: PageLayoutContextInput,
): PageLayoutContextAction {
  const { stackKind, activeFile, pageStackFile, hasLayoutWrapper } = input

  // Layout refs are page-scoped presentation state. While editing a
  // component/layout they are unused by Layers — keep them for return.
  if (stackKind !== "page") return "preserve"

  // pop()/goTo() flip kind to page before loadEditFile swaps the model.
  if (pageStackFile && activeFile && activeFile !== pageStackFile) {
    return "preserve"
  }

  if (!activeFile) return "preserve"

  if (!hasLayoutWrapper) return "clear"

  return "refresh"
}

/** Whether an incoming page load should drop layout bound to a different page. */
export function shouldClearLayoutForPageLoad(input: {
  pageFile: string
  layoutOwnerFile: string | null
}): boolean {
  return Boolean(input.layoutOwnerFile && input.layoutOwnerFile !== input.pageFile)
}
