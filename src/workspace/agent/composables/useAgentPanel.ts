import { computed, ref } from "vue"
import type { AgentComposerMode } from "../../../../shared/agent"
import type { SettingsTabId } from "@/workspace/settings/types"

const DOCK_STORAGE_KEY = "aria.agent.docked"

function readDockedPreference(): boolean {
  try {
    const raw = localStorage.getItem(DOCK_STORAGE_KEY)
    if (raw === "0") return false
    if (raw === "1") return true
  } catch {
    // ignore
  }
  return true
}

const open = ref(false)
const docked = ref(readDockedPreference())
const openRequestId = ref(0)
const shouldFocusComposer = ref(false)
const seedPrompt = ref<string | null>(null)
const autoSend = ref(false)
const requestedComposerMode = ref<AgentComposerMode | null>(null)
const requestedSettingsTab = ref<SettingsTabId | null>(null)

export function useAgentPanel() {
  function openPanel(options?: {
    seedPrompt?: string
    autoSend?: boolean
    focusComposer?: boolean
    composerMode?: AgentComposerMode
  }) {
    if (options?.seedPrompt) seedPrompt.value = options.seedPrompt
    if (options?.autoSend) autoSend.value = true
    if (options?.composerMode) requestedComposerMode.value = options.composerMode
    shouldFocusComposer.value = options?.focusComposer !== false
    open.value = true
    openRequestId.value += 1
  }

  function closePanel() {
    open.value = false
  }

  function togglePanel() {
    if (open.value) closePanel()
    else openPanel()
  }

  function setDocked(next: boolean) {
    docked.value = next
    try {
      localStorage.setItem(DOCK_STORAGE_KEY, next ? "1" : "0")
    } catch {
      // ignore
    }
  }

  function dock() {
    setDocked(true)
    open.value = true
  }

  function undock() {
    setDocked(false)
    open.value = true
  }

  function consumeSeedPrompt(): string | null {
    const value = seedPrompt.value
    seedPrompt.value = null
    return value
  }

  function consumeAutoSend(): boolean {
    const value = autoSend.value
    autoSend.value = false
    return value
  }

  function consumeRequestedComposerMode(): AgentComposerMode | null {
    const value = requestedComposerMode.value
    requestedComposerMode.value = null
    return value
  }

  function openAgentSettings() {
    requestSettingsTab("agent")
  }

  function requestSettingsTab(tab: SettingsTabId) {
    requestedSettingsTab.value = tab
  }

  function consumeRequestedSettingsTab(): SettingsTabId | null {
    const value = requestedSettingsTab.value
    requestedSettingsTab.value = null
    return value
  }

  return {
    open,
    docked,
    isOpen: computed(() => open.value),
    openRequestId,
    shouldFocusComposer,
    requestedSettingsTab,
    openPanel,
    closePanel,
    togglePanel,
    setDocked,
    dock,
    undock,
    consumeSeedPrompt,
    consumeAutoSend,
    consumeRequestedComposerMode,
    openAgentSettings,
    requestSettingsTab,
    consumeRequestedSettingsTab,
  }
}
