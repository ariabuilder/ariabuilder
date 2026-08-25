import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import { parseAstro, serializeAstro, setElementLinkAtPath } from "../../../shared/composer"
import type { AstroDocumentModel } from "../../../shared/composer/types"
import { createComposerBeacon } from "./selection/useComposerBeacon"
import { useComposerDocument } from "./useComposerDocument"

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

describe("useComposerDocument history", () => {
  it("changes a heading tag without losing content and restores it through undo and redo", async () => {
    const projectPath = ref("/tmp/project")
    const editFile = ref<string | null>("src/pages/index.astro")
    const editedMtimeMs = ref<number | null>(1000)
    const model = ref<AstroDocumentModel | null>({
      imports: [],
      extraFrontmatter: "",
      nodes: [{
        id: "heading",
        kind: "element",
        name: "h2",
        props: { id: { type: "string", value: "title" } },
        children: [{ id: "heading-text", kind: "text", value: "Hello" }],
      }],
      propSchema: [],
      slots: [],
      extendsTag: null,
    })
    const beacon = createComposerBeacon()
    beacon.illuminate("0")
    const doc = useComposerDocument({
      projectPath,
      editFile,
      editedMtimeMs,
      model,
      editable: ref(true),
      designActive: ref(true),
      codeDirty: ref(false),
      beacon,
    })

    expect(doc.setSelectedTag("h3")).toBe(true)
    expect(serializeAstro(model.value!)).toContain('<h3 id="title">Hello</h3>')
    await doc.flushSave()

    await doc.undo()
    expect(serializeAstro(model.value!)).toContain('<h2 id="title">Hello</h2>')
    await doc.redo()
    expect(serializeAstro(model.value!)).toContain('<h3 id="title">Hello</h3>')
  })

  it("keeps discrete Inspector resets as separate undo entries", async () => {
    const model = ref<AstroDocumentModel | null>({
      imports: [],
      extraFrontmatter: "",
      nodes: [{
        id: "heading",
        kind: "element",
        name: "h2",
        props: {
          id: { type: "string", value: "title" },
          title: { type: "string", value: "Greeting" },
        },
        children: [{ id: "heading-text", kind: "text", value: "Hello" }],
      }],
      propSchema: [],
      slots: [],
      extendsTag: null,
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
      codeDirty: ref(false),
      beacon,
    })

    const resetProp = (name: "id" | "title") => doc.commitInspectorMutation(
      `Reset ${name}`,
      (next) => {
        const heading = next.nodes[0]
        if (heading?.kind !== "element") return { ok: false }
        delete heading.props[name]
        return { ok: true, selectPath: "0" }
      },
      { immediate: true, coalesceKey: null },
    )

    expect(resetProp("id")).toBe(true)
    expect(resetProp("title")).toBe(true)
    expect(serializeAstro(model.value!)).toContain("<h2>Hello</h2>")

    await doc.undo()
    expect(serializeAstro(model.value!)).toContain('<h2 title="Greeting">Hello</h2>')
    await doc.undo()
    expect(serializeAstro(model.value!)).toContain('<h2 id="title" title="Greeting">Hello</h2>')
  })

  it("unwraps a linked heading through history and persists the restored selection", async () => {
    const parsed = await parseAstro('<section><a href="/"><h2>Hello</h2></a></section>')
    expect(parsed.editable).toBe(true)
    if (!parsed.editable) throw new Error("expected editable Astro")
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
      codeDirty: ref(false),
      beacon,
    })

    expect(doc.commitInspectorMutation("Remove link", (next) => setElementLinkAtPath(next, "0.0.0", null))).toBe(true)
    expect(serializeAstro(model.value!)).toContain("<h2>Hello</h2>")
    expect(serializeAstro(model.value!)).not.toContain("<a")
    expect(beacon.selectedPath.value).toBe("0.0")
    await doc.flushSave()
    expect(commitComposerEditTransaction).toHaveBeenCalledTimes(1)

    await doc.undo()
    expect(serializeAstro(model.value!)).toContain('<a href="/">')
    await doc.redo()
    expect(serializeAstro(model.value!)).not.toContain("<a")
  })

  it("restores the primary Astro source byte-for-byte through undo and redo", async () => {
    const source = `<section   data-note='keep'>\n  <h1>{heroCopy?.data?.["heading"]}</h1>\n  <p>Keep</p>\n</section>\n`
    const parsed = await parseAstro(source)
    if (!parsed.editable) throw new Error(parsed.reason)
    const model = ref<AstroDocumentModel | null>(parsed.model)
    const exactSource = ref<string | null>(source)
    const beacon = createComposerBeacon()
    beacon.illuminate("0.0.0")
    const doc = useComposerDocument({
      projectPath: ref("/tmp/project"),
      editFile: ref<string | null>("src/pages/index.astro"),
      editedMtimeMs: ref<number | null>(1000),
      model,
      editable: ref(true),
      designActive: ref(true),
      exactSource,
      onExactSourcePersisted: (next) => { exactSource.value = next },
      codeDirty: ref(false),
      beacon,
    })

    const changedExpression = '{heroCopy?.data?.["title"]}'
    expect(doc.setSelectedText(changedExpression)).toBe(true)
    await doc.flushSave()
    const changedSource = source.replace(
      '{heroCopy?.data?.["heading"]}',
      changedExpression,
    )
    expect(exactSource.value).toBe(changedSource)

    await doc.undo()
    expect(exactSource.value).toBe(source)
    expect(commitComposerEditTransaction.mock.calls[1]?.[0].sources[0]).toMatchObject({
      source,
      expectedSource: changedSource,
    })

    await doc.redo()
    expect(exactSource.value).toBe(changedSource)
    expect(commitComposerEditTransaction.mock.calls[2]?.[0].sources[0]).toMatchObject({
      source: changedSource,
      expectedSource: source,
    })
  })
})
