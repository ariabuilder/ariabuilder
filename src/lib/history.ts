import type { HistoryRestoreDirection } from "../../shared/history"

function api() {
  if (!window.aria) throw new Error("Aria desktop bridge is unavailable")
  return window.aria.history
}

export function listProjectHistory(projectPath: string) {
  return api().list(projectPath)
}

export function undoProjectHistory(projectPath: string) {
  return api().undo(projectPath)
}

export function redoProjectHistory(projectPath: string) {
  return api().redo(projectPath)
}

export function restoreProjectHistory(
  projectPath: string,
  recordId: string,
  direction: HistoryRestoreDirection,
) {
  return api().restore(projectPath, recordId, direction)
}
