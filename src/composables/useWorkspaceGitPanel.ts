import {
  computed,
  ref,
  toValue,
  type MaybeRefOrGetter,
  type Ref,
} from "vue"

const states = new Map<string, Ref<boolean>>()

function stateFor(projectPath: string): Ref<boolean> {
  let state = states.get(projectPath)
  if (!state) {
    state = ref(false)
    states.set(projectPath, state)
  }
  return state
}

/** Shared state for opening the workspace Git popover from rail or commands. */
export function useWorkspaceGitPanel(
  projectPath: MaybeRefOrGetter<string>,
) {
  const open = computed({
    get: () => stateFor(toValue(projectPath)).value,
    set: (value: boolean) => {
      stateFor(toValue(projectPath)).value = value
    },
  })

  function openGitPanel() {
    open.value = true
  }

  function closeGitPanel() {
    open.value = false
  }

  return { open, openGitPanel, closeGitPanel }
}
