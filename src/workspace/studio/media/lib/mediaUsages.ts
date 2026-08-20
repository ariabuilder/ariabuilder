import type { MediaAssetUsage } from "@/lib/media"

export type MediaUsageGroup = {
  file: string
  name: string
  directory: string
  lines: number[]
  references: string[]
}

const CMS_ENTRIES_PREFIX = ".aria/cms/entries/"

function posixPath(file: string): string {
  return file.replaceAll("\\", "/")
}

/**
 * Usage list is for authoring references (pages, components, layouts, content).
 * Aria config such as site-settings.json is bookkeeping, not a site usage.
 */
export function isVisibleMediaUsageFile(file: string): boolean {
  const posix = posixPath(file)
  if (posix.startsWith(CMS_ENTRIES_PREFIX)) return true
  return posix !== ".aria" && !posix.startsWith(".aria/")
}

/** Collapse raw scan hits into one row per file, with sorted line numbers. */
export function groupMediaUsages(
  usages: readonly MediaAssetUsage[],
): MediaUsageGroup[] {
  const groups = new Map<string, MediaUsageGroup>()
  for (const usage of usages) {
    const file = posixPath(usage.file)
    if (!isVisibleMediaUsageFile(file)) continue
    let group = groups.get(file)
    if (!group) {
      const parts = file.split("/")
      const name = parts.pop() ?? file
      group = {
        file,
        name,
        directory: parts.join("/"),
        lines: [],
        references: [],
      }
      groups.set(file, group)
    }
    if (!group.lines.includes(usage.line)) group.lines.push(usage.line)
    if (!group.references.includes(usage.reference)) {
      group.references.push(usage.reference)
    }
  }
  for (const group of groups.values()) {
    group.lines.sort((a, b) => a - b)
  }
  return [...groups.values()]
}

/** Compact trailing label: exact lines when few, otherwise the hit count. */
export function formatUsageLineLabel(lines: readonly number[]): string {
  if (lines.length === 0) return ""
  if (lines.length <= 4) return lines.join(", ")
  return String(lines.length)
}

export function mediaUsageRowTitle(group: MediaUsageGroup): string {
  return group.lines.map((line) => `${group.file}:${line}`).join("\n")
}
