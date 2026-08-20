import { describe, expect, it } from "vitest"
import {
  clampCodeSourceRange,
  codeSourceRangeKey,
  initialCodeEditorSelection,
  plainCodeSourceRange,
  shouldOpenCodeModeForSelection,
  visibleCodeSelectionPath,
} from "./codeEditorSelection"
import { parseAstro } from "../../../../shared/composer/parseAstro"

describe("Composer Code selection", () => {
  it("opens with the selected node's exact source range", () => {
    const selection = initialCodeEditorSelection({ from: 48, to: 91 }, 200)
    expect(selection.main.from).toBe(48)
    expect(selection.main.to).toBe(91)
  })

  it("clamps stale source ranges to the current document", () => {
    expect(clampCodeSourceRange({ from: 80, to: 140 }, 100)).toEqual({
      from: 80,
      to: 100,
    })
  })

  it("copies source ranges so nested reactive objects do not share identity", () => {
    const nested = { from: 10, to: 40 }
    const plain = plainCodeSourceRange(nested)
    expect(plain).toEqual({ from: 10, to: 40 })
    expect(plain).not.toBe(nested)
    expect(plainCodeSourceRange(null)).toBeNull()
  })

  it("keys ranges by from/to for reliable selection watches", () => {
    expect(codeSourceRangeKey({ from: 12, to: 48 })).toBe("12:48")
    expect(codeSourceRangeKey(null)).toBeNull()
    expect(codeSourceRangeKey({ from: 12, to: 48 })).toBe(
      codeSourceRangeKey({ from: 12, to: 48 }),
    )
  })

  it("promotes code selections inside formatted text to the visible heading", async () => {
    const source = '<h1>Real Projects. <strong>Real Results.</strong></h1>'
    const parsed = await parseAstro(source)
    if (!parsed.editable) throw new Error(parsed.reason)

    expect(
      visibleCodeSelectionPath(parsed.model, source.indexOf("Real Results") + 2),
    ).toBe("0")
  })

  it("opens Code mode for script and style layers selected outside the editor", () => {
    expect(shouldOpenCodeModeForSelection({
      nodeKind: "raw",
      alreadyInCode: false,
      fromCodeEditor: false,
    })).toBe(true)
    expect(shouldOpenCodeModeForSelection({
      nodeKind: "raw",
      alreadyInCode: true,
      fromCodeEditor: false,
    })).toBe(false)
    expect(shouldOpenCodeModeForSelection({
      nodeKind: "raw",
      alreadyInCode: false,
      fromCodeEditor: true,
    })).toBe(false)
    expect(shouldOpenCodeModeForSelection({
      nodeKind: "element",
      alreadyInCode: false,
      fromCodeEditor: false,
    })).toBe(false)
  })
})
