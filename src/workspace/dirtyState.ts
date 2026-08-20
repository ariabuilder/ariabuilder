import { computed, ref, shallowRef } from "vue"

export type DirtyStateHandler = {
  label: string
  saveLabel?: string
  discardLabel?: string
  isDirty: () => boolean
  save: () => boolean | void | Promise<boolean | void>
  discard: () => void | Promise<void>
}

export type DirtyDecision = "save" | "discard" | "cancel"

type DirtyPrompt = {
  labels: string[]
  saveLabel?: string
  discardLabel?: string
  resolve: (decision: DirtyDecision) => void
}

const handlers = new Map<string, Map<string, DirtyStateHandler>>()
const revision = ref(0)
const prompt = shallowRef<DirtyPrompt | null>(null)

function projectHandlers(projectPath: string) {
  let project = handlers.get(projectPath)
  if (!project) {
    project = new Map()
    handlers.set(projectPath, project)
  }
  return project
}

export function registerDirtyState(
  projectPath: string,
  id: string,
  handler: DirtyStateHandler,
): () => void {
  const project = projectHandlers(projectPath)
  project.set(id, handler)
  revision.value += 1
  return () => {
    if (project.get(id) !== handler) return
    project.delete(id)
    if (project.size === 0) handlers.delete(projectPath)
    revision.value += 1
  }
}

export function hasDirtyState(projectPath: string): boolean {
  revision.value
  return [...(handlers.get(projectPath)?.values() ?? [])].some((handler) =>
    handler.isDirty(),
  )
}

function askDirtyDecision(dirty: DirtyStateHandler[]): Promise<DirtyDecision> {
  return new Promise((resolve) => {
    if (prompt.value) prompt.value.resolve("cancel")
    const saveLabels = [
      ...new Set(
        dirty
          .map((handler) => handler.saveLabel)
          .filter((label): label is string => Boolean(label)),
      ),
    ]
    const discardLabels = [
      ...new Set(
        dirty
          .map((handler) => handler.discardLabel)
          .filter((label): label is string => Boolean(label)),
      ),
    ]
    prompt.value = {
      labels: dirty.map((handler) => handler.label),
      ...(saveLabels.length === 1 ? { saveLabel: saveLabels[0] } : {}),
      ...(discardLabels.length === 1 ? { discardLabel: discardLabels[0] } : {}),
      resolve,
    }
  })
}

export async function guardDirtyNavigation(projectPath: string): Promise<boolean> {
  const dirty = [...(handlers.get(projectPath)?.values() ?? [])].filter((handler) =>
    handler.isDirty(),
  )
  if (dirty.length === 0) return true
  const decision = await askDirtyDecision(dirty)
  if (decision === "cancel") return false
  if (decision === "discard") {
    for (const handler of dirty) await handler.discard()
    revision.value += 1
    return true
  }
  for (const handler of dirty) {
    const saved = await handler.save()
    if (saved === false || handler.isDirty()) return false
  }
  revision.value += 1
  return true
}

export function useDirtyPromptState() {
  const open = computed(() => Boolean(prompt.value))
  const labels = computed(() => prompt.value?.labels ?? [])
  const saveLabel = computed(() => prompt.value?.saveLabel ?? null)
  const discardLabel = computed(() => prompt.value?.discardLabel ?? null)
  function settle(decision: DirtyDecision) {
    const current = prompt.value
    if (!current) return
    prompt.value = null
    current.resolve(decision)
  }
  function onOpenChange(next: boolean) {
    if (!next) settle("cancel")
  }
  return { open, labels, saveLabel, discardLabel, settle, onOpenChange }
}
