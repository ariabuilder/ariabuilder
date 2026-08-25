import { describe, expect, it } from "vitest"
import { canvasTextMirrorPaths, resolveCanvasTextTarget } from "./canvasText"
import { ARIA_MSG, isAriaIframeToHostMessage, isAriaProtocolMessage } from "./protocol"
import type { AstroDocumentModel } from "./types"
import { parseAstro } from "./parseAstro"
import { locateAtPath } from "./mutate"
import { patchComposerModelSource } from "./sourcePatches"

function model(nodes: AstroDocumentModel["nodes"]): AstroDocumentModel {
  return {
    imports: [], extraFrontmatter: "", nodes,
    propSchema: [], slots: [], extendsTag: null,
  }
}

describe("resolveCanvasTextTarget", () => {
  it("resolves an element with one literal child to the child source path", () => {
    const target = resolveCanvasTextTarget(model([{
      id: "heading", kind: "element", name: "h1", props: {},
      children: [{ id: "text", kind: "text", value: "Welcome" }],
    }]), "0")
    expect(target).toEqual({
      kind: "static", path: "0.0", visibleOwnerPath: "0", value: "Welcome",
    })
  })

  it("keeps mixed rich text Inspector-only", () => {
    const target = resolveCanvasTextTarget(model([{
      id: "paragraph", kind: "element", name: "p", props: {}, children: [
        { id: "one", kind: "text", value: "Read " },
        { id: "link", kind: "element", name: "a", props: {}, children: [{ id: "two", kind: "text", value: "more" }] },
      ],
    }]), "0")
    expect(target).toBeNull()
  })

  it("recognizes CMS and translation owners before detaching expressions", () => {
    const cms = resolveCanvasTextTarget(model([{
      id: "loop", kind: "map", head: "entries.map((entry) => (", children: [{
        id: "heading", kind: "element", name: "h2", props: {},
        children: [{ id: "cms", kind: "expr", value: "{entry.data.title}" }],
      }],
    }]), "0.0", "Rendered title")
    expect(cms).toMatchObject({ kind: "cms", path: "0.0.0", field: "title" })

    const lockedCms = resolveCanvasTextTarget(model([{
      id: "loop", kind: "map", head: "entries.map((entry) => (", children: [{
        id: "heading", kind: "element", name: "h2", props: {},
        children: [{ id: "cms", kind: "expr", value: "{/* @aria-content:locked */ entry.data.title}" }],
      }],
    }]), "0.0", "Rendered title")
    expect(lockedCms).toMatchObject({ kind: "cms", contentExposure: "locked" })

    const translation = resolveCanvasTextTarget(model([{
      id: "heading", kind: "element", name: "h1", props: {},
      children: [{ id: "translation", kind: "expr", value: "{t?.[\"hero\"]?.title ?? /* @aria-translation-fallback */ \"Hero\"}" }],
    }]), "0", "Localized hero")
    expect(translation).toMatchObject({
      kind: "translation", namespace: "t", keyPath: ["hero", "title"],
    })
  })

  it("requires detach confirmation for arbitrary expressions", () => {
    expect(resolveCanvasTextTarget(model([{
      id: "heading", kind: "element", name: "h1", props: {},
      children: [{ id: "expression", kind: "expr", value: "{formatTitle(title)}" }],
    }]), "0", "Formatted")).toMatchObject({ kind: "detach-required" })
  })

  it("finds every matching bound expression in the open document", () => {
    const document = model([
      { id: "one", kind: "element", name: "h1", props: {}, children: [{ id: "a", kind: "expr", value: "{t?.title}" }] },
      { id: "two", kind: "element", name: "p", props: {}, children: [{ id: "b", kind: "expr", value: "{t?.title}" }] },
      { id: "three", kind: "element", name: "p", props: {}, children: [{ id: "c", kind: "expr", value: "{t?.summary}" }] },
    ])
    const target = resolveCanvasTextTarget(document, "0.0", "Title")
    if (!target) throw new Error("target missing")
    expect(canvasTextMirrorPaths(document, target)).toEqual(["0.0", "1.0"])
  })

  it("does not mirror a matching key from another translation context", () => {
    const document = model([
      { id: "one", kind: "element", name: "h1", props: {}, children: [{ id: "a", kind: "expr", value: "{site?.title}" }] },
      { id: "two", kind: "element", name: "p", props: {}, children: [{ id: "b", kind: "expr", value: "{admin?.title}" }] },
    ])
    const target = resolveCanvasTextTarget(document, "0.0", "Title")
    if (!target) throw new Error("target missing")
    expect(canvasTextMirrorPaths(document, target)).toEqual(["0.0"])
  })
})

describe("canvas text bridge validation", () => {
  it("accepts complete inline session messages and rejects malformed payloads", () => {
    expect(isAriaIframeToHostMessage({
      type: ARIA_MSG.inlineTextRequest,
      requestId: "request-1",
      path: "0.0",
      occurrence: 0,
      mode: "replace",
      initialInput: "A",
      renderedValue: "Before",
    })).toBe(true)
    expect(isAriaIframeToHostMessage({
      type: ARIA_MSG.inlineTextStartResult,
      requestId: "request-1",
      sessionId: "session-1",
      ok: true,
    })).toBe(true)
    expect(isAriaIframeToHostMessage({
      type: ARIA_MSG.inlineTextChange,
      sessionId: "session-1",
      path: "0.0",
      occurrence: 0,
      sequence: 1,
      value: "After",
    })).toBe(true)
    expect(isAriaProtocolMessage({
      type: ARIA_MSG.inlineTextChange,
      sessionId: "session-1",
      path: "0.0",
      occurrence: 0,
      sequence: "newest",
      value: "After",
    })).toBe(false)
    expect(isAriaProtocolMessage({
      type: ARIA_MSG.inlineTextFinish,
      sessionId: "session-1",
      path: "0.0",
      occurrence: -1,
      sequence: 2,
      value: "After",
      action: "commit",
    })).toBe(false)
  })
})

describe("canvas expression detachment", () => {
  it("replaces one expression with static text without rewriting surrounding Astro", async () => {
    const source = `---\nconst title = "Connected"\n---\n<section data-keep='exact'><h1>{title}</h1></section>`
    const parsed = await parseAstro(source)
    if (!parsed.editable) throw new Error(parsed.reason)
    const next = structuredClone(parsed.model)
    const location = locateAtPath(next.nodes, "0.0.0")
    if (!location || location.node.kind !== "expr") throw new Error("expression missing")
    location.list[location.index] = {
      kind: "text",
      id: location.node.id,
      sourceRange: location.node.sourceRange,
      value: "Static title",
    }
    const patched = patchComposerModelSource(source, parsed.model, next)
    expect(patched.ok, patched.ok ? "" : patched.reason).toBe(true)
    if (!patched.ok) return
    expect(patched.source).toContain("<section data-keep='exact'><h1>Static title</h1></section>")
    expect(patched.source).toContain('const title = "Connected"')

    const longer = structuredClone(next)
    const text = locateAtPath(longer.nodes, "0.0.0")?.node
    if (!text || text.kind !== "text") throw new Error("detached text missing")
    text.value = "A longer static title"
    const patchedAgain = patchComposerModelSource(patched.source, next, longer)
    expect(patchedAgain.ok, patchedAgain.ok ? "" : patchedAgain.reason).toBe(true)
    if (patchedAgain.ok) {
      expect(patchedAgain.source).toContain("<h1>A longer static title</h1>")
      expect(patchedAgain.source).toContain("<section data-keep='exact'>")
    }
  })
})
