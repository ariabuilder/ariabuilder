import {
  computed,
  ref,
  toValue,
  type MaybeRefOrGetter,
  type Ref,
} from "vue"

type WorkspaceTerminalState = {
  open: Ref<boolean>
  pendingCommand: Ref<string | null>
}

const states = new Map<string, WorkspaceTerminalState>()

function stateFor(projectPath: string): WorkspaceTerminalState {
  let state = states.get(projectPath)
  if (!state) {
    state = {
      open: ref(false),
      pendingCommand: ref<string | null>(null),
    }
    states.set(projectPath, state)
  }
  return state
}

/**
 * Shared bridge so design/settings surfaces can open the workspace rail
 * terminal and optionally run a command.
 */
export function useWorkspaceTerminal(
  projectPath: MaybeRefOrGetter<string>,
) {
  const currentState = () => stateFor(toValue(projectPath))
  const open = computed({
    get: () => currentState().open.value,
    set: (value: boolean) => {
      currentState().open.value = value
    },
  })
  const pendingCommand = computed(() => currentState().pendingCommand.value)

  function openTerminal() {
    open.value = true
  }

  function closeTerminal() {
    open.value = false
  }

  function openAndRun(command: string) {
    const trimmed = command.trim()
    if (!trimmed) {
      open.value = true
      return
    }
    currentState().pendingCommand.value = trimmed
    open.value = true
  }

  function takePendingCommand(): string | null {
    const state = currentState()
    const next = state.pendingCommand.value
    state.pendingCommand.value = null
    return next
  }

  return {
    open,
    pendingCommand,
    openTerminal,
    closeTerminal,
    openAndRun,
    takePendingCommand,
  }
}
