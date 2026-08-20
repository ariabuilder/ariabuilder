import { ref, watch } from "vue"

export type ComposerDisplayMode = "normal" | "outlines" | "wireframe"

type StoredComposerOptions = {
  showSelectionToolbar: boolean
  showSelectionSizing: boolean
  showLayoutSlots: boolean
  showDocumentLayers: boolean
  hideComments: boolean
}

const STORAGE_KEY = "aria.composer.options"
const defaults: StoredComposerOptions = {
  showSelectionToolbar: true,
  showSelectionSizing: true,
  showLayoutSlots: true,
  showDocumentLayers: true,
  hideComments: false,
}

function readStoredOptions(): StoredComposerOptions {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredComposerOptions> | null
    if (!parsed || typeof parsed !== "object") return { ...defaults }
    return {
      showSelectionToolbar: typeof parsed.showSelectionToolbar === "boolean" ? parsed.showSelectionToolbar : defaults.showSelectionToolbar,
      showSelectionSizing: typeof parsed.showSelectionSizing === "boolean" ? parsed.showSelectionSizing : defaults.showSelectionSizing,
      showLayoutSlots: typeof parsed.showLayoutSlots === "boolean" ? parsed.showLayoutSlots : defaults.showLayoutSlots,
      showDocumentLayers: typeof parsed.showDocumentLayers === "boolean" ? parsed.showDocumentLayers : defaults.showDocumentLayers,
      hideComments: typeof parsed.hideComments === "boolean" ? parsed.hideComments : defaults.hideComments,
    }
  } catch {
    return { ...defaults }
  }
}

export function useComposerOptions() {
  const stored = readStoredOptions()
  const displayMode = ref<ComposerDisplayMode>("normal")
  const showSelectionToolbar = ref(stored.showSelectionToolbar)
  const showSelectionSizing = ref(stored.showSelectionSizing)
  const showLayoutSlots = ref(stored.showLayoutSlots)
  const showDocumentLayers = ref(stored.showDocumentLayers)
  const hideComments = ref(stored.hideComments)

  watch(
    [showSelectionToolbar, showSelectionSizing, showLayoutSlots, showDocumentLayers, hideComments],
    () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          showSelectionToolbar: showSelectionToolbar.value,
          showSelectionSizing: showSelectionSizing.value,
          showLayoutSlots: showLayoutSlots.value,
          showDocumentLayers: showDocumentLayers.value,
          hideComments: hideComments.value,
        } satisfies StoredComposerOptions))
      } catch {
        /* Editor preferences are best-effort. */
      }
    },
  )

  return {
    displayMode,
    showSelectionToolbar,
    showSelectionSizing,
    showLayoutSlots,
    showDocumentLayers,
    hideComments,
  }
}
