import { humanizeSlug } from "@/workspace/studio/core"

export { formatStudioUpdated as formatPageUpdated } from "@/workspace/studio/core"

/** Display title from a project-relative page file path. */
export function pageDisplayName(file: string): string {
  const base = file.split("/").pop() ?? file
  const withoutExt = base.replace(/\.(astro|md|mdx)$/i, "")
  if (withoutExt === "index") {
    const parts = file.split("/")
    const parent = parts.length >= 2 ? parts[parts.length - 2] : ""
    return parent ? humanizeSlug(parent) : "Home"
  }
  return humanizeSlug(withoutExt)
}
