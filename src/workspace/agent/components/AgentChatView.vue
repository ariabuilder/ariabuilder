<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
import { toast } from "vue-sonner"
import AgentMessageList from "./AgentMessageList.vue"
import AgentEmptyState from "./AgentEmptyState.vue"
import AgentSetupEmptyState from "./AgentSetupEmptyState.vue"
import AgentComposer from "./AgentComposer.vue"
import AgentConversationList from "./AgentConversationList.vue"
import { useAriaAgent } from "../composables/useAriaAgent"
import { useAgentPanel } from "../composables/useAgentPanel"
import type {
  AgentShellContext,
  InferenceBackendId,
} from "../../../../shared/agent"
import { getAgentSettings } from "@/lib/agent"

const props = defineProps<{
  projectPath: string
  shellContext?: AgentShellContext
  compact?: boolean
}>()

const panel = useAgentPanel()
const agentApi = useAriaAgent(() => props.projectPath)
const {
  messages,
  conversations,
  activeId,
  isStreaming,
  error,
  activity,
  availability,
  prefs,
  updatePrefs,
  canSend,
  send,
  stop,
  createConversation,
  selectConversation,
  deleteConversation,
  refreshAvailability,
  resolveConfirmation,
} = agentApi

const historyOpen = ref(false)

const rootRef = ref<HTMLElement | null>(null)
const draft = ref("")
const composerRef = ref<InstanceType<typeof AgentComposer> | null>(null)
const modelOptions = ref<
  Array<{ provider: InferenceBackendId; modelId: string; label: string }>
>([])

const showSetup = computed(
  () =>
    !availability.value?.siteEnabled ||
    availability.value.effectiveInferenceBackend === "unavailable",
)

async function refreshModels() {
  const settings = await getAgentSettings(props.projectPath)
  const options: Array<{
    provider: InferenceBackendId
    modelId: string
    label: string
  }> = []
  for (const instance of Object.values(settings.inference.providerInstances)) {
    if (!instance.enabled) continue
    for (const modelId of instance.enabledModelIds) {
      options.push({
        provider: instance.backend,
        modelId,
        label: modelId,
      })
    }
  }
  modelOptions.value = options

  // Prefer an explicit session selection; otherwise fall back to site default,
  // then the first enabled model — same behavior as demo resolveEffectiveSelection.
  const siteDefault = settings.inference.default
  const siteInstance = siteDefault
    ? settings.inference.providerInstances[siteDefault.instanceId]
    : undefined
  const preferred =
    (prefs.value.inferenceProvider &&
    prefs.value.modelId &&
    options.find(
      (option) =>
        option.provider === prefs.value.inferenceProvider &&
        option.modelId === prefs.value.modelId,
    )) ||
    (siteInstance?.enabled &&
    siteDefault &&
    options.find(
      (option) =>
        option.provider === siteInstance.backend &&
        option.modelId === siteDefault.modelId,
    )) ||
    options[0]

  if (
    preferred &&
    (prefs.value.inferenceProvider !== preferred.provider ||
      prefs.value.modelId !== preferred.modelId)
  ) {
    updatePrefs({
      inferenceProvider: preferred.provider,
      modelId: preferred.modelId,
    })
  }
}

async function applyPendingPanelOpen() {
  if (!panel.open.value) return
  await refreshAvailability()
  await refreshModels()

  const seed = panel.consumeSeedPrompt()
  const shouldAutoSend = panel.consumeAutoSend()
  const requestedComposerMode = panel.consumeRequestedComposerMode()
  if (requestedComposerMode) {
    updatePrefs({ composerMode: requestedComposerMode })
  }
  if (seed) draft.value = seed

  if (
    shouldAutoSend &&
    canSend.value &&
    !isStreaming.value &&
    draft.value.trim()
  ) {
    await handleSend()
    return
  }

  if (panel.shouldFocusComposer.value) {
    await nextTick(() => composerRef.value?.focusInput())
  }
}

watch(
  () => panel.openRequestId.value,
  () => {
    void applyPendingPanelOpen()
  },
  { immediate: true },
)

watch(
  () => props.projectPath,
  () => {
    void refreshModels()
  },
)

onMounted(() => {
  void refreshModels()
  void refreshAvailability()
  window.addEventListener("keydown", handleEscapeKey, true)
})

onUnmounted(() => {
  window.removeEventListener("keydown", handleEscapeKey, true)
})

async function handleSend() {
  const value = draft.value
  draft.value = ""
  await send(value, props.shellContext)
}

function handleStop() {
  void stop()
}

async function handleSelectPrompt(prompt: string) {
  if (showSetup.value || isStreaming.value || !canSend.value) return
  draft.value = ""
  await send(prompt, props.shellContext)
}

function formatConversationAsMarkdown(): string {
  if (messages.value.length === 0) return ""
  const parts: string[] = ["# Aria Engineer — Conversation\n"]
  for (const message of messages.value) {
    if (message.role === "user") {
      parts.push(`### You\n${message.content}\n`)
    } else if (message.role === "assistant") {
      parts.push(`### Assistant\n${message.content.trim()}\n`)
    }
  }
  return parts.join("\n")
}

async function handleCopyConversation() {
  const markdown = formatConversationAsMarkdown()
  if (!markdown) {
    toast.error("No messages to copy")
    return
  }
  try {
    await navigator.clipboard.writeText(markdown)
    toast.success("Conversation copied")
  } catch {
    toast.error("Could not copy conversation")
  }
}

function handleClose() {
  panel.closePanel()
}

function handleEscapeKey(event: KeyboardEvent) {
  if (event.key !== "Escape") return
  if (historyOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    historyOpen.value = false
    return
  }
  if (!panel.open.value) return
  const target = event.target as HTMLElement
  if (
    target.tagName === "TEXTAREA" &&
    rootRef.value?.contains(target) &&
    isStreaming.value
  ) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  handleClose()
}

function handleNewConversation() {
  if (isStreaming.value) return
  createConversation()
  historyOpen.value = false
}

function toggleHistory() {
  historyOpen.value = !historyOpen.value
}

function handleSelectConversation(id: string) {
  selectConversation(id)
  historyOpen.value = false
}

function handleDeleteConversation(id: string) {
  deleteConversation(id)
}

function onModelUpdate(provider: InferenceBackendId, modelId: string) {
  updatePrefs({ inferenceProvider: provider, modelId })
}

defineExpose({
  copyConversation: handleCopyConversation,
  clearChat: handleNewConversation,
  close: handleClose,
  toggleHistory,
  focusInput: () => composerRef.value?.focusInput(),
  isStreaming,
})
</script>

<template>
  <div ref="rootRef" class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
    <AgentConversationList
      v-if="historyOpen"
      class="absolute inset-0 z-10"
      :conversations="conversations"
      :active-id="activeId"
      :disabled="isStreaming"
      @select="handleSelectConversation"
      @delete="handleDeleteConversation"
    />
    <AgentSetupEmptyState
      v-if="showSetup"
      class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
    />
    <AgentEmptyState
      v-else-if="messages.length === 0"
      class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
      :composer-mode="prefs.composerMode"
      :shell-context="shellContext"
      :compact="compact"
      @select-prompt="void handleSelectPrompt($event)"
    />
    <AgentMessageList
      v-else
      class="min-h-0 flex-1"
      :messages="messages"
      :is-streaming="isStreaming"
      :activity="activity"
      @resolve-confirmation="resolveConfirmation"
    />
    <AgentComposer
      v-if="!showSetup"
      ref="composerRef"
      :draft="draft"
      :disabled="!canSend"
      :streaming="isStreaming"
      :error="error"
      :compact="compact"
      :composer-mode="prefs.composerMode"
      :inference-provider="prefs.inferenceProvider"
      :model-id="prefs.modelId"
      :models="modelOptions"
      @update:draft="draft = $event"
      @send="void handleSend()"
      @stop="handleStop()"
      @update:composer-mode="(mode) => updatePrefs({ composerMode: mode })"
      @update:model="onModelUpdate"
    />
  </div>
</template>
