import { describe, expect, it } from "vitest"
import type { ComposerLayerRow } from "../../../../shared/composer/layers"
import {
  composerLayerPresentationRows,
  nextRenderedChildLimit,
} from "./layerPresentation"

function row(treeKey: string, children: ComposerLayerRow[] = []): ComposerLayerRow {
  return {
    path: treeKey,
    treeKey,
    id: treeKey,
    kind: "element",
    region: treeKey.startsWith("document") ? "document" : "content",
    semanticType: "container",
    label: treeKey,
    sourceLabel: `<${treeKey}>`,
    searchText: treeKey,
    children,
    isDocumentShell: false,
    draggable: true,
    deletable: true,
    canAcceptChildren: true,
  }
}

describe("Layers presentation", () => {
  it("keeps layout, complete content, and Document in reading order", () => {
    const contentChildren = Array.from({ length: 64 }, (_, index) => row(`content-${index}`))
    const layout = row("layout")
    const content = row("content", contentChildren)
    const document = row("document-head")
    const rows = composerLayerPresentationRows({
      layout: [layout],
      content: [content],
      document: [document],
      showDocument: true,
      expanded: new Set([content.treeKey]),
    })
    expect(rows[0]).toBe(layout)
    expect(rows.slice(1, -1)).toEqual([content, ...contentChildren])
    expect(rows.at(-1)).toBe(document)
    expect(new Set(rows.map((entry) => entry.treeKey)).size).toBe(rows.length)
  })

  it("mounts every child in stable batches and mounts all while dragging", () => {
    let limit = 24
    limit = nextRenderedChildLimit({ current: limit, total: 80, expanded: true, dragging: false })
    expect(limit).toBe(56)
    limit = nextRenderedChildLimit({ current: limit, total: 80, expanded: true, dragging: false })
    expect(limit).toBe(80)
    expect(nextRenderedChildLimit({
      current: 24,
      total: 80,
      expanded: false,
      dragging: false,
    })).toBe(24)
    expect(nextRenderedChildLimit({
      current: 24,
      total: 80,
      expanded: true,
      dragging: true,
    })).toBe(80)
  })
})
