export type { GlobalSearchResponse, GlobalSearchResult } from "../../shared/search"

export function searchProject(
  projectPath: string,
  input: { query: string; limit?: number },
) {
  if (!window.aria) throw new Error("Aria desktop bridge is unavailable")
  return window.aria.search.project(projectPath, input)
}
