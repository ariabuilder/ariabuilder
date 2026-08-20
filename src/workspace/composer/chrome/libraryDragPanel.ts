export type ComposerLibraryTab = "add-elements" | "layers"

export type ComposerLeftTab = ComposerLibraryTab | "agent"

export type ComposerLibraryPanelState = "active" | "drag-source" | "hidden"

/**
 * Native HTML dragging is cancelled when the source is removed from layout.
 * Keep a palette panel rendered while Layers is exposed for the active drag.
 */
export function composerLibraryPanelState(
  tab: ComposerLibraryTab,
  activeTab: ComposerLeftTab,
  dragSource: ComposerLibraryTab | null,
): ComposerLibraryPanelState {
  if (tab === activeTab) return "active"
  if (tab === dragSource) return "drag-source"
  return "hidden"
}
