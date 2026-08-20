import type { ComposerLayerRow } from "../../../../shared/composer/layers"

export function composerLayerPresentationRows(input: {
  layout: readonly ComposerLayerRow[]
  content: readonly ComposerLayerRow[]
  document: readonly ComposerLayerRow[]
  showDocument: boolean
  expanded: ReadonlySet<string>
}): ComposerLayerRow[] {
  const output: ComposerLayerRow[] = []
  const visit = (rows: readonly ComposerLayerRow[]) => {
    for (const row of rows) {
      output.push(row)
      if (row.children.length && input.expanded.has(row.treeKey)) visit(row.children)
    }
  }
  visit(input.layout)
  visit(input.content)
  if (input.showDocument) visit(input.document)
  return output
}

export function nextRenderedChildLimit(input: {
  current: number
  total: number
  expanded: boolean
  dragging: boolean
  initial?: number
  batch?: number
}): number {
  if (input.dragging) return input.total
  const current = Math.min(input.total, Math.max(0, input.current))
  if (!input.expanded) return current
  const floor = Math.min(input.total, input.initial ?? 24)
  return Math.min(input.total, Math.max(current, floor) + (input.batch ?? 32))
}
