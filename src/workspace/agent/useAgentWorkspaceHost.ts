import { onMounted, onUnmounted, watch, type Ref } from "vue"
import type {
  AgentRendererToolRequest,
  AgentToolResult,
} from "../../../shared/agent"
import {
  onAgentRendererToolRequest,
  registerAgentRendererHost,
  resolveAgentRendererTool,
} from "@/lib/agent"

export function useAgentWorkspaceHost(input: {
  projectPath: Ref<string>
  openInComposer: (args: unknown) => Promise<AgentToolResult>
}) {
  const registrationId = crypto.randomUUID()
  let mounted = false
  let unlisten: (() => void) | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let generation = 0

  function clearRetry() {
    if (!retryTimer) return
    clearTimeout(retryTimer)
    retryTimer = null
  }

  function register(projectPath: string, attempt = 0) {
    clearRetry()
    const currentGeneration = ++generation
    void registerAgentRendererHost({
      projectPath,
      scope: "workspace",
      registrationId,
      active: true,
    })
      .then((result) => {
        if (result.registered) {
          if (
            mounted &&
            input.projectPath.value === projectPath &&
            generation === currentGeneration
          ) return
          void registerAgentRendererHost({
            projectPath,
            scope: "workspace",
            registrationId,
            active: false,
          }).catch(() => undefined)
          return
        }
        if (
          !mounted ||
          input.projectPath.value !== projectPath ||
          generation !== currentGeneration ||
          attempt >= 7
        ) return
        retryTimer = setTimeout(
          () => register(projectPath, attempt + 1),
          Math.min(100 * 2 ** attempt, 1_000),
        )
      })
      .catch(() => {
        if (
          !mounted ||
          input.projectPath.value !== projectPath ||
          generation !== currentGeneration ||
          attempt >= 7
        ) return
        retryTimer = setTimeout(
          () => register(projectPath, attempt + 1),
          Math.min(100 * 2 ** attempt, 1_000),
        )
      })
  }

  function unregister(projectPath: string) {
    generation += 1
    clearRetry()
    void registerAgentRendererHost({
      projectPath,
      scope: "workspace",
      registrationId,
      active: false,
    }).catch(() => undefined)
  }

  async function handleRequest(request: AgentRendererToolRequest) {
    if (
      request.projectPath !== input.projectPath.value ||
      request.toolName !== "open_in_composer"
    ) return
    const result = await input.openInComposer(request.args)
    await resolveAgentRendererTool({
      requestId: request.requestId,
      projectPath: request.projectPath,
      result,
    }).catch(() => undefined)
  }

  onMounted(() => {
    mounted = true
    unlisten = onAgentRendererToolRequest((request) => {
      void handleRequest(request)
    })
    register(input.projectPath.value)
  })

  watch(input.projectPath, (next, previous) => {
    if (previous) unregister(previous)
    if (mounted && next) register(next)
  })

  onUnmounted(() => {
    mounted = false
    unlisten?.()
    unlisten = null
    unregister(input.projectPath.value)
  })
}
