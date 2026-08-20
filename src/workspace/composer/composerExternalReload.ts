export type ComposerExternalReloadInput = {
  activeFile: string | null
  selectedPageFile: string | null
  drilling: boolean
  standalone: boolean
  reloadKey: number
  previousReloadKey: number
  pageMtimeMs: number
  previousPageMtimeMs: number
}

/**
 * Resolve an actual external refresh to the file Composer should reload.
 * Drill state is deliberately not a watched value: changing editing scope is
 * navigation, not evidence that any source changed on disk.
 */
export function composerExternalReloadFile(
  input: ComposerExternalReloadInput,
): string | null {
  if (!input.activeFile) return null
  if (input.reloadKey !== input.previousReloadKey) return input.activeFile
  if (
    input.pageMtimeMs !== input.previousPageMtimeMs &&
    !input.drilling &&
    !input.standalone &&
    input.selectedPageFile === input.activeFile
  ) {
    return input.activeFile
  }
  return null
}

export function canCommitComposerDocumentLoad(input: {
  generation: number
  currentGeneration: number
  requestedFile: string
  activeFile: string | null
}): boolean {
  return (
    input.generation === input.currentGeneration &&
    input.requestedFile === input.activeFile
  )
}

/**
 * A same-file reload that fails (IPC clone, disk race) must not wipe an
 * already-projected document. First-open failures still clear the tree.
 */
export function shouldPreserveComposerDocumentOnLoadFailure(input: {
  sameFile: boolean
  hasLoadedModel: boolean
}): boolean {
  return input.sameFile && input.hasLoadedModel
}
