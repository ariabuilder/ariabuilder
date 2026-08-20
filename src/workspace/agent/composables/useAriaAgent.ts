import { computed, ref, type Ref } from "vue"
import type {
  AgentAvailability,
  AgentChatMessage,
  AgentComposerMode,
  AgentSessionPrefs,
  AgentShellContext,
  AgentStreamEvent,
  AgentToolStep,
} from "../../../../shared/agent"
import {
  AGENT_MAX_MESSAGES,
  AgentConfirmationCategorySchema,
  AgentToolErrorCodeSchema,
  conversationSummaries,
  deleteConversationFromStore,
  type AgentConversationSummary,
  type LocalChatHistory,
} from "../../../../shared/agent"
import {
  cancelAgentChat,
  getAgentAvailability,
  onAgentStream,
  startAgentChat,
} from "@/lib/agent"
import { useAgentSessionPrefs } from "./useAgentSessionPrefs"
import {
  readLocalChatHistory,
  readLocalChatStore,
  writeLocalChatHistory,
  writeLocalChatStore,
} from "./useLocalChatHistory"
import {
  resolvedToolName,
  toolDisplayName,
} from "../lib/toolDisplayNames"

type AgentController = {
  messages: Ref<AgentChatMessage[]>
  conversations: Readonly<Ref<AgentConversationSummary[]>>
  activeId: Ref<string>
  isStreaming: Ref<boolean>
  error: Ref<string | null>
  activity: Ref<string | null>
  availability: Ref<AgentAvailability | null>
  prefs: Ref<AgentSessionPrefs>
  updatePrefs: (patch: Partial<AgentSessionPrefs>) => void
  canSend: Readonly<Ref<boolean>>
  send: (text: string, shellContext?: AgentShellContext) => Promise<void>
  stop: () => Promise<void>
  clearChat: () => void
  createConversation: () => void
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  refreshAvailability: () => Promise<void>
  resolveConfirmation: (
    messageId: string,
    stepId: string,
    approved: boolean,
  ) => Promise<void>
}

const controllers = new Map<string, AgentController>()

function sanitizeError(message: string): string {
  return message
    .replace(/sk-[a-zA-Z0-9]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
}

function toolResultFailed(result: unknown): {
  failed: boolean
  error?: AgentToolStep["error"]
} {
  if (!result || typeof result !== "object") return { failed: false }
  const record = result as Record<string, unknown>
  if (record.ok !== false && record.success !== false) return { failed: false }

  const rawError = record.error
  if (rawError && typeof rawError === "object") {
    const error = rawError as Record<string, unknown>
    const code = AgentToolErrorCodeSchema.safeParse(error.code)
    const confirmationCategory = AgentConfirmationCategorySchema.safeParse(
      error.confirmationCategory,
    )
    return {
      failed: true,
      error: {
        code: code.success ? code.data : "INTERNAL",
        message:
          typeof error.message === "string" ? error.message : "Tool failed",
        suggestedFix:
          typeof error.suggestedFix === "string"
            ? error.suggestedFix
            : undefined,
        approvalId:
          typeof error.approvalId === "string"
            ? error.approvalId
            : undefined,
        confirmationCategory: confirmationCategory.success
          ? confirmationCategory.data
          : undefined,
      },
    }
  }

  return {
    failed: true,
    error: {
      code: "INTERNAL",
      message:
        typeof rawError === "string"
          ? rawError
          : typeof record.message === "string"
            ? record.message
            : "Tool failed",
    },
  }
}

function createAgentController(projectPath: string): AgentController {
  const chatStore = ref<LocalChatHistory>(readLocalChatStore(projectPath))
  const activeId = ref(chatStore.value.activeId)
  const messages = ref<AgentChatMessage[]>(readLocalChatHistory(projectPath))
  const conversations = computed(() => conversationSummaries(chatStore.value))
  const isStreaming = ref(false)
  const error = ref<string | null>(null)
  const availability = ref<AgentAvailability | null>(null)
  const activity = ref<string | null>(null)
  const { prefs, updatePrefs } = useAgentSessionPrefs(projectPath)

  let activeStreamId: string | null = null
  let activeAssistantId: string | null = null
  let streamWaitResolve: (() => void) | null = null
  let streamUnlisten: (() => void) | null = null
  let lastShellContext: AgentShellContext | undefined
  let activePendingToolCalls: NonNullable<AgentChatMessage["toolCalls"]> = []

  function persistHistory() {
    chatStore.value = writeLocalChatHistory(
      projectPath,
      activeId.value,
      messages.value,
    )
  }

  function applyStore(
    next: LocalChatHistory,
    nextMessages?: AgentChatMessage[],
  ) {
    chatStore.value = writeLocalChatStore(projectPath, next)
    activeId.value = chatStore.value.activeId
    messages.value =
      nextMessages ??
      chatStore.value.conversations.find(
        (conversation) => conversation.id === chatStore.value.activeId,
      )?.messages ??
      []
  }

  function appendMessage(message: AgentChatMessage) {
    messages.value = [...messages.value, message].slice(-AGENT_MAX_MESSAGES)
  }

  function createConversation() {
    if (isStreaming.value) return
    if (messages.value.length === 0) return
    persistHistory()
    activeId.value = crypto.randomUUID()
    messages.value = []
    error.value = null
    persistHistory()
  }

  function selectConversation(id: string) {
    if (isStreaming.value || id === activeId.value) return
    persistHistory()
    const next = chatStore.value.conversations.find(
      (conversation) => conversation.id === id,
    )
    if (!next) return
    activeId.value = next.id
    messages.value = [...next.messages]
    error.value = null
    persistHistory()
  }

  function deleteConversation(id: string) {
    if (isStreaming.value && id === activeId.value) return
    const wasActive = id === activeId.value
    applyStore(deleteConversationFromStore(chatStore.value, id))
    if (wasActive) error.value = null
  }

  function clearChat() {
    createConversation()
  }

  function finishStreamWait() {
    streamWaitResolve?.()
    streamWaitResolve = null
  }

  async function refreshAvailability() {
    availability.value = await getAgentAvailability(projectPath)
  }

  function patchToolStep(stepId: string, patch: Partial<AgentToolStep>) {
    messages.value = messages.value.map((message) => {
      if (!message.toolSteps?.some((step) => step.id === stepId)) return message
      return {
        ...message,
        toolSteps: message.toolSteps.map((step) =>
          step.id === stepId ? { ...step, ...patch } : step,
        ),
      }
    })
  }

  function hasToolResult(toolCallId: string): boolean {
    return messages.value.some(
      (message) =>
        message.role === "tool" && message.toolCallId === toolCallId,
    )
  }

  function appendToolResult(toolCallId: string, result: unknown): void {
    if (hasToolResult(toolCallId)) return
    messages.value = [
      ...messages.value,
      {
        id: crypto.randomUUID(),
        role: "tool",
        content: JSON.stringify(result ?? null),
        createdAt: new Date().toISOString(),
        toolCallId,
      },
    ]
  }

  function terminateUnresolvedTools(
    calls: AgentChatMessage["toolCalls"],
    message: string,
  ): void {
    for (const call of calls ?? []) {
      if (hasToolResult(call.id)) continue
      const result = {
        ok: false as const,
        error: {
          code: "INTERNAL" as const,
          message,
          suggestedFix: "Retry the operation from the latest content state.",
        },
      }
      appendToolResult(call.id, result)
      patchToolStep(call.id, {
        status: "error",
        summary: `Interrupted ${call.toolName}`,
        error: result.error,
      })
    }
  }

  async function runChat(
    requestMessages: AgentChatMessage[],
    assistantId: string,
    shellContext?: AgentShellContext,
    inheritedToolCalls: NonNullable<AgentChatMessage["toolCalls"]> = [],
  ): Promise<void> {
    activeAssistantId = assistantId
    isStreaming.value = true
    activity.value = "Thinking…"

    const currentAssistant = messages.value.find(
      (message) => message.id === assistantId,
    )
    let toolSteps: AgentToolStep[] = currentAssistant?.toolSteps ?? []
    let toolCalls = [
      ...(currentAssistant?.toolCalls ?? []),
      ...inheritedToolCalls,
    ].filter(
      (call, index, calls) =>
        calls.findIndex((candidate) => candidate.id === call.id) === index,
    )
    activePendingToolCalls = toolCalls
    let approvalRequests = currentAssistant?.approvalRequests ?? []
    let finalContent = currentAssistant?.content ?? ""
    let reasoning = currentAssistant?.reasoning ?? ""

    const updateAssistant = (patch: Partial<AgentChatMessage>) => {
      messages.value = messages.value.map((message) =>
        message.id === assistantId ? { ...message, ...patch } : message,
      )
    }

    const handleEvent = (event: AgentStreamEvent) => {
      if (event.type === "text-delta") {
        finalContent = `${finalContent}${event.delta}`.slice(0, 64_000)
        updateAssistant({ content: finalContent, toolSteps })
        activity.value = "Writing…"
        return
      }
      if (event.type === "reasoning") {
        reasoning = `${reasoning}${event.delta}`.slice(0, 16_000)
        updateAssistant({ reasoning, toolSteps })
        activity.value = "Thinking…"
        return
      }
      if (event.type === "tool-call") {
        const effectiveToolName = resolvedToolName(event.toolName, event.args)
        const isReadTool = /(?:list|get|read|search|describe|query|compare)/.test(
          effectiveToolName,
        )
        toolCalls = [
          ...toolCalls.filter((call) => call.id !== event.toolCallId),
          {
            id: event.toolCallId,
            toolName: event.toolName,
            input: event.args,
          },
        ]
        activePendingToolCalls = toolCalls
        toolSteps = [
          ...toolSteps.filter((step) => step.id !== event.toolCallId),
          {
            id: event.toolCallId,
            toolName: effectiveToolName,
            status: "running",
            summary: "Running",
            isReadTool,
          },
        ]
        updateAssistant({ toolCalls, toolSteps })
        activity.value = `Using ${toolDisplayName(effectiveToolName, isReadTool)}…`
        return
      }
      if (event.type === "tool-approval-request") {
        approvalRequests = [
          ...approvalRequests.filter(
            (request) => request.approvalId !== event.approvalId,
          ),
          {
            approvalId: event.approvalId,
            toolCallId: event.toolCallId,
            ...(event.signature ? { signature: event.signature } : {}),
          },
        ]
        toolSteps = toolSteps.map((step) =>
          step.id === event.toolCallId
            ? {
                ...step,
                status: "error",
                summary: "Waiting for confirmation",
                error: {
                  code: "CONFIRMATION_REQUIRED",
                  message: event.summary,
                  approvalId: event.approvalId,
                  confirmationCategory: event.confirmationCategory,
                },
              }
            : step,
        )
        updateAssistant({ approvalRequests, toolSteps })
        activity.value = "Waiting for confirmation…"
        return
      }
      if (event.type === "tool-result") {
        appendToolResult(event.toolCallId, event.result)
        const failure = toolResultFailed(event.result)
        const patch: Partial<AgentToolStep> = {
          status: failure.failed ? "error" : "success",
          summary: failure.failed ? "Failed" : "Finished",
          error: failure.error,
        }
        toolSteps = toolSteps.map((step) =>
          step.id === event.toolCallId ? { ...step, ...patch } : step,
        )
        patchToolStep(event.toolCallId, patch)
        updateAssistant({ toolSteps, approvalRequests })
        return
      }
      if (event.type === "error") {
        const message = sanitizeError(event.error)
        error.value = message
        updateAssistant({ content: finalContent || message, toolSteps })
        terminateUnresolvedTools(toolCalls, `Tool execution failed: ${message}`)
      }
    }

    const streamId = crypto.randomUUID()
    activeStreamId = streamId

    try {
      await new Promise<void>((resolve, reject) => {
        streamWaitResolve = resolve
        streamUnlisten = onAgentStream((payload) => {
          if (payload.streamId !== streamId) return
          handleEvent(payload.event)
          if (payload.event.type === "finished") {
            streamUnlisten?.()
            streamUnlisten = null
            finishStreamWait()
          }
        })

        void startAgentChat(projectPath, streamId, {
          messages: requestMessages,
          composerMode: prefs.value.composerMode as AgentComposerMode,
          sessionModel: {
            inferenceProvider: prefs.value.inferenceProvider,
            modelId: prefs.value.modelId,
          },
          shellContext,
        }).catch((cause) => {
          streamUnlisten?.()
          streamUnlisten = null
          reject(cause)
        })
      })
    } catch (cause) {
      const message = sanitizeError(
        cause instanceof Error ? cause.message : String(cause),
      )
      error.value = message
      updateAssistant({ content: finalContent || message, toolSteps })
      terminateUnresolvedTools(toolCalls, `Tool execution was interrupted: ${message}`)
    } finally {
      streamUnlisten?.()
      streamUnlisten = null
      if (activeStreamId === streamId) activeStreamId = null
      if (activeAssistantId === assistantId) {
        activeAssistantId = null
        activePendingToolCalls = []
      }
      isStreaming.value = false
      activity.value = null
      if (
        !finalContent &&
        toolSteps.length > 0 &&
        approvalRequests.length === 0 &&
        !error.value
      ) {
        updateAssistant({ content: "Done.", toolSteps })
      }
      persistHistory()
      finishStreamWait()
    }
  }

  async function resolveConfirmation(
    messageId: string,
    stepId: string,
    approved: boolean,
  ): Promise<void> {
    const message = messages.value.find((item) => item.id === messageId)
    const step = message?.toolSteps?.find((item) => item.id === stepId)
    const approvalId = step?.error?.approvalId
    const approvalRequest = message?.approvalRequests?.find(
      (request) =>
        request.approvalId === approvalId && request.toolCallId === stepId,
    )
    if (
      !step ||
      !approvalId ||
      !approvalRequest ||
      step.error?.code !== "CONFIRMATION_REQUIRED" ||
      isStreaming.value
    ) return

    patchToolStep(stepId, {
      status: approved ? "running" : "success",
      summary: approved
        ? "Applying confirmed change…"
        : "Canceled — no changes made",
      error: undefined,
    })

    const responseMessage: AgentChatMessage = {
      id: crypto.randomUUID(),
      role: "tool",
      content: "",
      createdAt: new Date().toISOString(),
      approvalResponses: [
        {
          approvalId,
          approved,
          ...(approved ? {} : { reason: "User canceled the operation." }),
        },
      ],
    }
    appendMessage(responseMessage)

    const approvedToolCall = message?.toolCalls?.find(
      (call) => call.id === stepId,
    )
    if (!approved) {
      appendToolResult(stepId, {
        ok: false,
        error: {
          code: "CONFIRMATION_DENIED",
          message: "User canceled the operation. No changes were made.",
        },
      })
    }

    const assistantId = crypto.randomUUID()
    const assistant: AgentChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      toolSteps: [],
    }
    appendMessage(assistant)
    persistHistory()
    await runChat(
      messages.value.filter((item) => item.id !== assistantId),
      assistantId,
      lastShellContext,
      approved && approvedToolCall ? [approvedToolCall] : [],
    )
  }

  async function stop() {
    const streamId = activeStreamId
    const assistantId = activeAssistantId
    if (streamId) {
      await cancelAgentChat(projectPath, streamId).catch(() => undefined)
    }
    streamUnlisten?.()
    streamUnlisten = null
    activeStreamId = null
    if (assistantId) {
      const assistant = messages.value.find(
        (message) => message.id === assistantId,
      )
      terminateUnresolvedTools(
        activePendingToolCalls.length > 0
          ? activePendingToolCalls
          : assistant?.toolCalls,
        "Tool execution was canceled before it returned a result.",
      )
      messages.value = messages.value.map((message) =>
        message.id === assistantId ? { ...message, stopped: true } : message,
      )
      persistHistory()
    }
    activeAssistantId = null
    activePendingToolCalls = []
    isStreaming.value = false
    activity.value = null
    finishStreamWait()
  }

  async function send(
    text: string,
    shellContext?: AgentShellContext,
  ): Promise<void> {
    const content = text.trim()
    if (!content || isStreaming.value) return

    error.value = null
    lastShellContext = shellContext
    const userMessage: AgentChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    }
    appendMessage(userMessage)

    const assistantId = crypto.randomUUID()
    const assistant: AgentChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      toolSteps: [],
    }
    appendMessage(assistant)

    persistHistory()
    await runChat(
      messages.value.filter((message) => message.id !== assistantId),
      assistantId,
      shellContext,
    )
  }

  return {
    messages,
    conversations,
    activeId,
    isStreaming,
    error,
    activity,
    availability,
    prefs,
    updatePrefs,
    canSend: computed(
      () =>
        Boolean(availability.value?.siteEnabled) &&
        availability.value?.effectiveInferenceBackend !== "unavailable",
    ),
    send,
    stop,
    clearChat,
    createConversation,
    selectConversation,
    deleteConversation,
    refreshAvailability,
    resolveConfirmation,
  }
}

export function resetAriaAgentControllersForTests(): void {
  controllers.clear()
}

/** Project-scoped controller shared only by chrome belonging to that project. */
export function useAriaAgent(projectPath: () => string): AgentController {
  const key = projectPath().trim()
  let controller = controllers.get(key)
  if (!controller) {
    controller = createAgentController(key)
    controllers.set(key, controller)
  }
  return controller
}
