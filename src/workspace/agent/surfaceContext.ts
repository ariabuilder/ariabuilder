import { computed, reactive, type ComputedRef } from "vue"
import type { AgentShellContext } from "../../../shared/agent"

type SurfaceContext = Pick<
  AgentShellContext,
  "contextSequence" | "documentContext" | "cmsContext" | "designContext"
>

const contexts = reactive(new Map<string, SurfaceContext>())

export function updateAgentSurfaceContext(
  projectPath: string,
  patch: Omit<SurfaceContext, "contextSequence">,
): void {
  const current = contexts.get(projectPath)
  contexts.set(projectPath, {
    ...current,
    ...patch,
    contextSequence: (current?.contextSequence ?? 0) + 1,
  })
}

export function clearAgentSurfaceContext(
  projectPath: string,
  key: "documentContext" | "cmsContext" | "designContext",
): void {
  const current = contexts.get(projectPath)
  if (!current) return
  contexts.set(projectPath, {
    ...current,
    [key]: undefined,
    contextSequence: (current.contextSequence ?? 0) + 1,
  })
}

export function useAgentSurfaceContext(
  projectPath: () => string,
): ComputedRef<SurfaceContext | undefined> {
  return computed(() => contexts.get(projectPath()))
}
