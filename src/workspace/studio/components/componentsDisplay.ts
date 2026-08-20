import { humanizeSlug } from "@/workspace/studio/core"

export { formatStudioUpdated as formatComponentUpdated } from "@/workspace/studio/core"

/** Display title from a component name or project-relative file path. */
export function componentDisplayName(name: string, file?: string): string {
  const trimmed = name.trim()
  if (trimmed) return trimmed
  if (!file) return "Component"
  const base = file.split("/").pop() ?? file
  return humanizeSlug(base.replace(/\.(astro|vue|tsx?|jsx?)$/i, ""))
}
