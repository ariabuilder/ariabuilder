import { beforeEach, describe, expect, it, vi } from "vitest"
import { isProxy, isReactive, ref } from "vue"
import type { AstroDocumentModel } from "../../../shared/composer/types"
import { parseAstro } from "../../../shared/composer/parseAstro"
import { createComposerBeacon } from "./selection/useComposerBeacon"
import { useComposerDocument } from "./useComposerDocument"
import { blankModel } from "./useComposerDocument.fixture"

const commitComposerEditTransaction = vi.fn()
const readComposerClipboard = vi.fn()
const writeComposerClipboard = vi.fn()
const listStylesheets = vi.fn()

vi.mock("@/lib/composer", () => ({
  commitComposerEditTransaction: (...args: unknown[]) => commitComposerEditTransaction(...args),
  parseComposerPage: vi.fn(),
}))
vi.mock("@/lib/design", () => ({
  listStylesheets: (...args: unknown[]) => listStylesheets(...args),
  readStylesheet: vi.fn(),
}))
vi.mock("@/lib/composerClipboard", () => ({
  readComposerClipboard: (...args: unknown[]) => readComposerClipboard(...args),
  writeComposerClipboard: (...args: unknown[]) => writeComposerClipboard(...args),
}))
vi.mock("@/lib/keyboardShortcuts", () => ({ isEditableKeyboardTarget: () => false }))

beforeEach(() => {
  commitComposerEditTransaction.mockReset()
  readComposerClipboard.mockReset()
  readComposerClipboard.mockResolvedValue({})
  writeComposerClipboard.mockReset()
  writeComposerClipboard.mockResolvedValue(undefined)
  listStylesheets.mockReset()
  listStylesheets.mockResolvedValue([])
  commitComposerEditTransaction.mockResolvedValue({
    ok: true,
    revisions: [{ relativeFile: "src/layouts/BaseLayout.astro", mtimeMs: 2000 }],
  })
})

describe("useComposerDocument persistence", () => {
  it("fails closed when an existing document has no exact source", () => {
    const model = ref<AstroDocumentModel | null>(blankModel())
    const doc = useComposerDocument({
      projectPath: ref("/tmp/project"),
      editFile: ref<string | null>("src/pages/index.astro"),
      editedMtimeMs: ref<number | null>(1000),
      model,
      editable: ref(true),
      designActive: ref(true),
      exactSource: ref<string | null>(null),
      codeDirty: ref(false),
      beacon: createComposerBeacon(),
    })

    expect(doc.mutateModel((next) => {
      next.extraFrontmatter = "const changed = true"
      return { ok: true }
    })).toBe(false)
    expect(doc.saveError.value).toContain("exact Astro source is unavailable")
    expect(commitComposerEditTransaction).not.toHaveBeenCalled()
  })

  it("leaves the model and disk transaction untouched when an expression range is unsafe", async () => {
    const source = `<main><h1>{heroCopy?.data?.["heading"]}</h1><p>Keep</p></main>`
    const parsed = await parseAstro(source)
    if (!parsed.editable) throw new Error(parsed.reason)
    const expression = parsed.model.nodes[0]?.kind === "element"
      && parsed.model.nodes[0].children?.[0]?.kind === "element"
      ? parsed.model.nodes[0].children[0].children?.[0]
      : null
    if (!expression || expression.kind !== "expr" || !expression.sourceRange) {
      throw new Error("expression missing")
    }
    expression.sourceRange.to += "</h1><p>".length
    const model = ref<AstroDocumentModel | null>(parsed.model)
    const beacon = createComposerBeacon()
    beacon.illuminate("0.0.0")
    const doc = useComposerDocument({
      projectPath: ref("/tmp/project"),
      editFile: ref<string | null>("src/pages/index.astro"),
      editedMtimeMs: ref<number | null>(1000),
      model,
      editable: ref(true),
      designActive: ref(true),
      exactSource: ref<string | null>(source),
      codeDirty: ref(false),
      beacon,
    })

    expect(doc.setSelectedText('{heroCopy?.data?.["title"]}')).toBe(false)
    expect(model.value).toEqual(parsed.model)
    expect(doc.saveError.value).toBe("The changed node has no safe source range.")
    expect(commitComposerEditTransaction).not.toHaveBeenCalled()
  })

  it("persists repeated Props edits as an exact-source patch", async () => {
    const source = `---\nconst untouched =  true\n---\n<section   data-note='keep'>\n  <!-- preserve -->\n  <Card title="Builder" />\n</section>\n`
    const parsed = await parseAstro(source)
    if (!parsed.editable) throw new Error(parsed.reason)
    const model = ref<AstroDocumentModel | null>(parsed.model)
    const exactSource = ref<string | null>(source)
    const beacon = createComposerBeacon()
    beacon.illuminate("0.1", { source: "structure" })
    const onExactSourcePersisted = vi.fn((next: string) => {
      exactSource.value = next
    })
    const doc = useComposerDocument({
      projectPath: ref("/tmp/project"),
      editFile: ref<string | null>("src/pages/index.astro"),
      editedMtimeMs: ref<number | null>(1000),
      model,
      editable: ref(true),
      designActive: ref(true),
      exactSource,
      onExactSourcePersisted,
      codeDirty: ref(false),
      beacon,
    })

    expect(
      doc.setSelectedProp("title", { type: "string", value: "Builde" }),
      doc.saveError.value ?? "",
    ).toBe(true)
    expect(doc.setSelectedProp("title", { type: "string", value: "Build" })).toBe(true)
    await doc.flushSave()

    const transaction = commitComposerEditTransaction.mock.calls[0]![0] as {
      page?: unknown
      sources?: Array<{ source: string; expectedSource?: string }>
    }
    expect(transaction.page).toBeUndefined()
    expect(transaction.sources).toEqual([{
      relativeFile: "src/pages/index.astro",
      source: expect.stringContaining('<Card title="Build" />'),
      expectedSource: source,
      expectedMtimeMs: 1000,
    }])
    expect(transaction.sources?.[0]?.source).toContain("const untouched =  true")
    expect(transaction.sources?.[0]?.source).toContain("<section   data-note='keep'>")
    expect(transaction.sources?.[0]?.source).toContain("  <!-- preserve -->")
    expect(onExactSourcePersisted).toHaveBeenCalledWith(transaction.sources?.[0]?.source)
    expect(doc.dirty.value).toBe(false)
  })

  it("keeps and flushes a newer exact-source revision after an overlapping save", async () => {
    const source = `---\nconst untouched =  true\n---\n<div title="One"></div>\n`
    const parsed = await parseAstro(source)
    if (!parsed.editable) throw new Error(parsed.reason)
    const model = ref<AstroDocumentModel | null>(parsed.model)
    const exactSource = ref<string | null>(source)
    const onExactSourcePersisted = vi.fn((next: string) => {
      exactSource.value = next
    })
    let finishFirst: (value: unknown) => void = () => undefined
    commitComposerEditTransaction
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishFirst = resolve
      }))
      .mockResolvedValueOnce({
        ok: true,
        revisions: [{ relativeFile: "src/pages/index.astro", mtimeMs: 3000 }],
      })
    const beacon = createComposerBeacon()
    beacon.illuminate("0")
    const doc = useComposerDocument({
      projectPath: ref("/tmp/project"),
      editFile: ref<string | null>("src/pages/index.astro"),
      editedMtimeMs: ref<number | null>(1000),
      model,
      editable: ref(true),
      designActive: ref(true),
      exactSource,
      onExactSourcePersisted,
      codeDirty: ref(false),
      beacon,
    })

    expect(
      doc.setSelectedProp("title", { type: "string", value: "Two" }),
      doc.saveError.value ?? "",
    ).toBe(true)
    const firstFlush = doc.flushSave()
    await vi.waitFor(() => expect(commitComposerEditTransaction).toHaveBeenCalledTimes(1))
    expect(doc.setSelectedProp("title", { type: "string", value: "Three" })).toBe(true)
    finishFirst({
      ok: true,
      revisions: [{ relativeFile: "src/pages/index.astro", mtimeMs: 2000 }],
    })
    await firstFlush
    await vi.waitFor(() => expect(commitComposerEditTransaction).toHaveBeenCalledTimes(2))

    const second = commitComposerEditTransaction.mock.calls[1]![0] as {
      sources: Array<{ source: string; expectedSource: string }>
    }
    expect(second.sources[0]?.source).toContain('title="Three"')
    expect(second.sources[0]?.expectedSource).toContain('title="Two"')
    await vi.waitFor(() => expect(doc.dirty.value).toBe(false))
  })

  it("clones the reactive model so Electron IPC structured-clone succeeds", async () => {
    const projectPath = ref("/tmp/project")
    const editFile = ref<string | null>("src/layouts/BaseLayout.astro")
    const editedMtimeMs = ref<number | null>(1000)
    const model = ref<AstroDocumentModel | null>(blankModel())
    const editable = ref(true)
    const designActive = ref(true)
    const codeDirty = ref(false)

    expect(isReactive(model.value)).toBe(true)

    const doc = useComposerDocument({
      projectPath,
      editFile,
      editedMtimeMs,
      model,
      editable,
      designActive,
      codeDirty,
      beacon: createComposerBeacon(),
    })

    const ok = doc.mutateModel((next) => {
      const body = next.nodes[0]
      if (body?.kind !== "element" || !body.children) return { ok: false }
      body.children.push({
        id: "slot-sidebar",
        kind: "slot",
        props: { name: { type: "string", value: "sidebar" } },
        children: null,
      })
      return { ok: true }
    })
    expect(ok).toBe(true)
    expect(doc.dirty.value).toBe(true)

    await doc.flushSave()

    expect(commitComposerEditTransaction).toHaveBeenCalledTimes(1)
    const transaction = commitComposerEditTransaction.mock.calls[0]![0] as {
      page: { model: AstroDocumentModel }
    }
    const payloadModel = transaction.page.model
    expect(isProxy(payloadModel)).toBe(false)
    expect(() => structuredClone(payloadModel)).not.toThrow()
    expect(doc.dirty.value).toBe(false)
    expect(doc.saveError.value).toBeNull()
  })

  it("debounces Inspector persistence without re-revealing the selected node", async () => {
    vi.useFakeTimers()
    try {
      const beacon = createComposerBeacon()
      beacon.illuminate("0", { source: "structure", occurrence: 2 })
      const revealNonce = beacon.revealRequest.value?.nonce
      const model = ref<AstroDocumentModel | null>(blankModel())
      const beforeFlush = vi.fn()
      const doc = useComposerDocument({
        projectPath: ref("/tmp/project"),
        editFile: ref<string | null>("src/layouts/BaseLayout.astro"),
        editedMtimeMs: ref<number | null>(1000),
        model,
        editable: ref(true),
        designActive: ref(true),
        codeDirty: ref(false),
        beacon,
      })
      doc.registerBeforeFlush(beforeFlush)

      expect(
        doc.setSelectedProp(
          "style",
          { type: "string", value: "opacity: 0.4" },
          { immediate: false },
        ),
      ).toBe(true)
      expect(beacon.revealRequest.value?.nonce).toBe(revealNonce)
      expect(beacon.selectedOccurrence.value).toBe(2)
      expect(commitComposerEditTransaction).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(749)
      expect(commitComposerEditTransaction).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(commitComposerEditTransaction).toHaveBeenCalledTimes(1)
      expect(beforeFlush).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it("refreshes a same-path selection when its model identity changes", () => {
    vi.useFakeTimers()
    try {
      const model = ref<AstroDocumentModel | null>({
        imports: [], extraFrontmatter: "", propSchema: [], slots: [], extendsTag: null,
        nodes: [{ id: "old-node", kind: "element", name: "div", props: {}, children: [] }],
      })
      const beacon = createComposerBeacon()
      beacon.illuminate("0", { source: "canvas", occurrence: 2 })
      const refresh = vi.spyOn(beacon, "setSelections")
      const doc = useComposerDocument({
        projectPath: ref("/tmp/project"),
        editFile: ref<string | null>("src/pages/index.astro"),
        editedMtimeMs: ref<number | null>(1000),
        model,
        editable: ref(true),
        designActive: ref(true),
        codeDirty: ref(false),
        beacon,
      })

      expect(doc.mutateModel((next) => {
        next.nodes[0] = {
          id: "replacement-node", kind: "element", name: "section", props: {}, children: [],
        }
        return { ok: true }
      })).toBe(true)

      expect(refresh).toHaveBeenCalledWith(
        [{ path: "0", occurrence: 2 }],
        { source: "api", reveal: "none" },
      )
      expect(beacon.selectedPath.value).toBe("0")
      expect(beacon.selectedOccurrence.value).toBe(2)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it("still flushes when stagedSource is set but the code draft is clean", async () => {
    const projectPath = ref("/tmp/project")
    const editFile = ref<string | null>("src/layouts/BaseLayout.astro")
    const editedMtimeMs = ref<number | null>(1000)
    const model = ref<AstroDocumentModel | null>(blankModel())
    const editable = ref(true)
    const designActive = ref(true)
    const codeDirty = ref(false)
    const stagedSource = ref<string | null>(null)

    const doc = useComposerDocument({
      projectPath,
      editFile,
      editedMtimeMs,
      model,
      editable,
      designActive,
      stagedSource,
      codeDirty,
      beacon: createComposerBeacon(),
    })

    expect(
      doc.mutateModel((next) => {
        const body = next.nodes[0]
        if (body?.kind !== "element" || !body.children) return { ok: false }
        body.children.push({
          id: "slot-aside",
          kind: "slot",
          props: { name: { type: "string", value: "aside" } },
          children: null,
        })
        return { ok: true }
      }),
    ).toBe(true)
    expect(doc.dirty.value).toBe(true)

    // Simulate entering code mode with a clean editor after the document edit.
    stagedSource.value = "---\n---\n<body><slot /><slot name=\"aside\" /></body>\n"
    commitComposerEditTransaction.mockClear()

    await doc.flushSave()
    expect(commitComposerEditTransaction).toHaveBeenCalledTimes(1)
    expect(doc.dirty.value).toBe(false)
  })

  it("does not flush while a dirty code draft owns the source", async () => {
    const projectPath = ref("/tmp/project")
    const editFile = ref<string | null>("src/layouts/BaseLayout.astro")
    const editedMtimeMs = ref<number | null>(1000)
    const model = ref<AstroDocumentModel | null>(blankModel())
    const editable = ref(true)
    const designActive = ref(true)
    const codeDirty = ref(true)
    const stagedSource = ref<string | null>("---\n---\n<body><slot /></body>\n")

    const doc = useComposerDocument({
      projectPath,
      editFile,
      editedMtimeMs,
      model,
      editable,
      designActive,
      stagedSource,
      codeDirty,
      beacon: createComposerBeacon(),
    })

    // Force dirty without going through staged patch scheduling.
    model.value = {
      ...blankModel(),
      nodes: [
        {
          id: "body",
          kind: "element",
          name: "body",
          props: {},
          children: [],
        },
      ],
    }
    // mutateModel with staged source still marks dirty when patch succeeds;
    // if patch fails we still need dirty — set via a disk-path mutation first.
    codeDirty.value = false
    stagedSource.value = null
    doc.mutateModel((next) => {
      next.nodes = blankModel().nodes
      return { ok: true }
    })
    expect(doc.dirty.value).toBe(true)
    codeDirty.value = true
    stagedSource.value = "---\n---\n<body><slot /></body>\n"
    commitComposerEditTransaction.mockClear()

    await doc.flushSave()
    expect(commitComposerEditTransaction).not.toHaveBeenCalled()
    expect(doc.dirty.value).toBe(true)
  })

  it("keeps a canvas text session off disk and records the full edit as one undo", async () => {
    const source = `<main><h1>Builder</h1><p>Keep</p></main>`
    const parsed = await parseAstro(source)
    if (!parsed.editable) throw new Error(parsed.reason)
    const model = ref<AstroDocumentModel | null>(parsed.model)
    const exactSource = ref<string | null>(source)
    const doc = useComposerDocument({
      projectPath: ref("/tmp/project"),
      editFile: ref<string | null>("src/pages/index.astro"),
      editedMtimeMs: ref<number | null>(1000),
      model,
      editable: ref(true),
      designActive: ref(true),
      exactSource,
      onExactSourcePersisted: (next) => { exactSource.value = next },
      beacon: createComposerBeacon(),
    })

    expect(doc.beginCanvasTextEdit({ sessionId: "text-1", path: "0.0.0", occurrence: 0 })).toEqual({ ok: true, value: "Builder" })
    expect(doc.updateCanvasTextEdit({ sessionId: "text-1", path: "0.0.0", occurrence: 0, sequence: 1, value: "B" })).toBe(true)
    expect(doc.updateCanvasTextEdit({ sessionId: "text-1", path: "0.0.0", occurrence: 0, sequence: 2, value: "Built" })).toBe(true)
    expect(commitComposerEditTransaction).not.toHaveBeenCalled()
    expect(doc.canUndo.value).toBe(true)

    expect(await doc.finishCanvasTextEdit("text-1", "commit")).toMatchObject({ ok: true, value: "Built" })
    await doc.flushSave()
    expect(commitComposerEditTransaction).toHaveBeenCalledTimes(1)
    expect(commitComposerEditTransaction.mock.calls[0]?.[0].sources[0].source).toBe(
      `<main><h1>Built</h1><p>Keep</p></main>`,
    )
  })

  it("restores model, exact source history, and dirty state when canvas text is canceled", async () => {
    const source = `<h1>Builder</h1>`
    const parsed = await parseAstro(source)
    if (!parsed.editable) throw new Error(parsed.reason)
    const model = ref<AstroDocumentModel | null>(parsed.model)
    const doc = useComposerDocument({
      projectPath: ref("/tmp/project"),
      editFile: ref<string | null>("src/pages/index.astro"),
      editedMtimeMs: ref<number | null>(1000),
      model,
      editable: ref(true),
      designActive: ref(true),
      exactSource: ref<string | null>(source),
      beacon: createComposerBeacon(),
    })

    doc.beginCanvasTextEdit({ sessionId: "text-2", path: "0.0", occurrence: 0 })
    doc.updateCanvasTextEdit({ sessionId: "text-2", path: "0.0", occurrence: 0, sequence: 1, value: "B" })
    doc.updateCanvasTextEdit({ sessionId: "text-2", path: "0.0", occurrence: 0, sequence: 2, value: "Longer heading" })
    expect(await doc.finishCanvasTextEdit("text-2", "cancel")).toEqual({ ok: true, value: "Builder" })
    expect(model.value?.nodes[0]?.kind === "element" && model.value.nodes[0].children?.[0]?.kind === "text"
      ? model.value.nodes[0].children[0].value
      : null).toBe("Builder")
    expect(doc.dirty.value).toBe(false)
    expect(doc.canUndo.value).toBe(false)
    await doc.flushSave()
    expect(commitComposerEditTransaction).not.toHaveBeenCalled()
  })
})
