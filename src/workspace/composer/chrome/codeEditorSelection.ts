import { EditorSelection } from "@codemirror/state"
import type { AstroDocumentModel } from "../../../../shared/composer/types"
import { markerPathAtSourceOffset } from "../../../../shared/composer/paths"
import { composerRichTextOwnerPath } from "../../../../shared/composer/richText"

export type CodeSourceRange = { from: number; to: number }

/** Maps a CodeMirror cursor to the structural layer that owns any inline text. */
export function visibleCodeSelectionPath(
  model: AstroDocumentModel,
  sourceOffset: number,
): string | null {
  return composerRichTextOwnerPath(
    model,
    markerPathAtSourceOffset(model.nodes, sourceOffset),
  )
}

export function clampCodeSourceRange(
  range: CodeSourceRange,
  documentLength: number,
): CodeSourceRange {
  const from = Math.min(Math.max(0, range.from), documentLength)
  const to = Math.min(Math.max(from, range.to), documentLength)
  return { from, to }
}

/** Plain copy so Vue prop watches are not tied to nested reactive model state. */
export function plainCodeSourceRange(
  range: CodeSourceRange | null | undefined,
): CodeSourceRange | null {
  if (!range) return null
  return { from: range.from, to: range.to }
}

/** Stable identity for selection-range watches (from/to primitives). */
export function codeSourceRangeKey(
  range: CodeSourceRange | null | undefined,
): string | null {
  if (!range) return null
  return `${range.from}:${range.to}`
}

/** Initial CodeMirror selection when Code mode opens on a selected node. */
export function initialCodeEditorSelection(
  range: CodeSourceRange | null | undefined,
  documentLength: number,
): EditorSelection {
  if (!range) return EditorSelection.create([EditorSelection.cursor(0)])
  const clamped = clampCodeSourceRange(range, documentLength)
  return EditorSelection.create([
    EditorSelection.range(clamped.from, clamped.to),
  ])
}

/** Open the file Code panel for `<script>` / `<style>` selected outside the editor. */
export function shouldOpenCodeModeForSelection(options: {
  nodeKind: string | undefined
  alreadyInCode: boolean
  fromCodeEditor: boolean
}): boolean {
  if (options.fromCodeEditor || options.alreadyInCode) return false
  return options.nodeKind === "raw"
}
