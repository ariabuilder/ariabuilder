import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import {
  encodeComposerClipboard,
  nodeAtMarkerPath,
  parseAstro,
  serializeAstro,
} from "../../../shared/composer"
import type { AstroDocumentModel } from "../../../shared/composer/types"
import { createComposerBeacon } from "./selection/useComposerBeacon"
import { useComposerDocument } from "./useComposerDocument"

const commitComposerEditTransaction = vi.fn()
const readComposerClipboard = vi.fn()
const writeComposerClipboard = vi.fn()
const listStylesheets = vi.fn()
const readStylesheet = vi.fn()

vi.mock("@/lib/composer", () => ({
  commitComposerEditTransaction: (...args: unknown[]) => commitComposerEditTransaction(...args),
  parseComposerPage: vi.fn(),
}))
vi.mock("@/lib/design", () => ({
  listStylesheets: (...args: unknown[]) => listStylesheets(...args),
  readStylesheet: (...args: unknown[]) => readStylesheet(...args),
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
  readStylesheet.mockReset()
  commitComposerEditTransaction.mockResolvedValue({
    ok: true,
    revisions: [{ relativeFile: "src/layouts/BaseLayout.astro", mtimeMs: 2000 }],
  })
})

describe("useComposerDocument clipboard", () => {
  it("copies a reactive component immediately and pastes a fresh component instance", async () => {
    let finishStylesheetScan: (value: never[]) => void = () => undefined
    listStylesheets.mockImplementationOnce(() => new Promise((resolve) => {
      finishStylesheetScan = resolve
    }))
    const model = ref<AstroDocumentModel | null>({
      imports: [{ name: "Card", path: "../components/Card.astro" }],
      extraFrontmatter: "",
      nodes: [{
        id: "card-instance",
        kind: "component",
        name: "Card",
        props: { title: { type: "string", value: "Hello" } },
        children: [{ id: "card-copy", kind: "text", value: "Card content" }],
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

    await expect(doc.copySelected()).resolves.toBe(true)
    expect(writeComposerClipboard).toHaveBeenCalledTimes(1)
    const copied = writeComposerClipboard.mock.calls[0]![0] as {
      aria: string
      html: string
      text: string
    }
    expect(copied.text).toBe("Card content")
    expect(copied.html).toContain("<Card")
    expect(() => structuredClone(JSON.parse(copied.aria))).not.toThrow()

    readComposerClipboard.mockResolvedValue(copied)
    await expect(doc.pasteClipboard()).resolves.toMatchObject({
      ok: true,
      source: "aria",
      insertedCount: 1,
    })
    const source = model.value?.nodes[0]
    expect(source).toMatchObject({ kind: "component", name: "Card" })
    const pasted = source?.kind === "component" ? source.children?.[1] : null
    expect(pasted).toMatchObject({
      kind: "component",
      name: "Card",
      props: { title: { type: "string", value: "Hello" } },
    })
    expect(pasted?.id).not.toBe("card-instance")
    await doc.flushSave()
    finishStylesheetScan([])
    await Promise.resolve()
  })

  it("copies and pastes a section with its complete subtree", async () => {
    const model = ref<AstroDocumentModel | null>({
      imports: [],
      extraFrontmatter: "",
      nodes: [{
        id: "main",
        kind: "element",
        name: "main",
        props: {},
        children: [{
          id: "about",
          kind: "element",
          name: "section",
          props: { class: { type: "string", value: "about" } },
          children: [{
            id: "about-heading",
            kind: "element",
            name: "h2",
            props: {},
            children: [{ id: "about-text", kind: "text", value: "About" }],
          }],
        }],
      }],
      propSchema: [],
      slots: [],
      extendsTag: null,
    })
    const beacon = createComposerBeacon()
    beacon.illuminate("0.0")
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

    await expect(doc.copySelected()).resolves.toBe(true)
    const copied = writeComposerClipboard.mock.calls[0]![0]
    readComposerClipboard.mockResolvedValue(copied)
    beacon.illuminate("0")
    await expect(doc.pasteClipboard()).resolves.toMatchObject({
      ok: true,
      source: "aria",
      insertedCount: 1,
    })

    const main = model.value?.nodes[0]
    const pasted = main?.kind === "element" ? main.children?.[1] : null
    expect(pasted).toMatchObject({
      kind: "element",
      name: "section",
      props: { class: { type: "string", value: "about" } },
      children: [{
        kind: "element",
        name: "h2",
        children: [{ kind: "text", value: "About" }],
      }],
    })
    expect(pasted?.id).not.toBe("about")
    await doc.flushSave()
  })

  it("pastes a multi-root Astro forest, rewrites colliding IDs, and selects every root", async () => {
    const parsed = await parseAstro('<main><div id="panel"></div></main>')
    if (!parsed.editable) throw new Error(parsed.reason)
    const model = ref<AstroDocumentModel | null>(parsed.model)
    const beacon = createComposerBeacon()
    beacon.illuminate("0")
    const results: unknown[] = []
    const doc = useComposerDocument({
      projectPath: ref("/tmp/project"),
      editFile: ref<string | null>("src/pages/index.astro"),
      editedMtimeMs: ref<number | null>(1000),
      model,
      editable: ref(true),
      designActive: ref(true),
      beacon,
      onPasteResult: (result) => results.push(result),
    })

    const result = await doc.pasteClipboard({
      text: '<button aria-controls="panel">Open</button><section id="panel">Panel</section>',
    })

    expect(result).toMatchObject({ ok: true, source: "source", insertedCount: 2 })
    expect(results).toEqual([result])
    const main = model.value?.nodes[0]
    const button = main?.kind === "element" ? main.children?.[1] : null
    const section = main?.kind === "element" ? main.children?.[2] : null
    const replacement = section?.kind === "element" && section.props.id?.type === "string"
      ? section.props.id.value
      : null
    expect(replacement).toMatch(/^panel-copy-c\d+$/)
    expect(button).toMatchObject({
      kind: "element",
      props: { "aria-controls": { type: "string", value: replacement } },
    })
    expect(beacon.selections.value.map((selection) => selection.path)).toEqual(["0.1", "0.2"])
    expect(JSON.stringify([button, section])).not.toContain("sourceRange")

    const beforeUnsafeStyle = serializeAstro(model.value!)
    await expect(doc.pasteClipboard({
      text: "<style>#panel { color: red; }</style><aside id=\"panel\">Panel</aside>",
    })).resolves.toMatchObject({
      ok: false,
      code: "unsafe-id-collision",
    })
    expect(serializeAstro(model.value!)).toBe(beforeUnsafeStyle)
  })

  it("adds an unambiguous project component import and rejects unresolved tags", async () => {
    const parsed = await parseAstro("<main></main>")
    if (!parsed.editable) throw new Error(parsed.reason)
    const model = ref<AstroDocumentModel | null>(parsed.model)
    const beacon = createComposerBeacon()
    beacon.illuminate("0")
    const doc = useComposerDocument({
      projectPath: ref("/tmp/project"),
      editFile: ref<string | null>("src/pages/index.astro"),
      editedMtimeMs: ref<number | null>(1000),
      model,
      editable: ref(true),
      designActive: ref(true),
      beacon,
      availableComponents: ref([
        { name: "Card", file: "src/components/Card.astro" },
        { name: "Hero", file: "src/components/marketing/Hero.astro" },
        { name: "Hero", file: "src/components/product/Hero.astro" },
      ]),
    })

    await expect(doc.pasteClipboard({ text: '<Card title="Hello" />' })).resolves.toMatchObject({
      ok: true,
      source: "source",
    })
    expect(model.value?.imports).toEqual([
      { name: "Card", path: "../components/Card.astro" },
    ])
    expect(serializeAstro(model.value!)).toContain('<Card title="Hello" />')
    await expect(doc.pasteClipboard({ text: '<Card title="Again" />' })).resolves.toMatchObject({
      ok: true,
      source: "source",
    })
    const existingImportPaste = nodeAtMarkerPath(
      model.value?.nodes ?? [],
      beacon.selectedPath.value ?? "",
    )
    expect(existingImportPaste).toMatchObject({
      kind: "component",
      name: "Card",
      dynamicTag: false,
    })
    await expect(doc.pasteClipboard({ text: "<Hero />" })).resolves.toMatchObject({
      ok: false,
      code: "ambiguous-component",
    })

    const before = serializeAstro(model.value!)
    await expect(doc.pasteClipboard({ text: "<Missing />" })).resolves.toMatchObject({
      ok: false,
      code: "unresolved-component",
    })
    expect(serializeAstro(model.value!)).toBe(before)
  })

  it("patches an active Code draft without persisting behind it", async () => {
    const source = "<main><h1>Draft</h1></main>"
    const parsed = await parseAstro(source)
    if (!parsed.editable) throw new Error(parsed.reason)
    const model = ref<AstroDocumentModel | null>(parsed.model)
    const stagedSource = ref<string | null>(source)
    const beacon = createComposerBeacon()
    beacon.illuminate("0")
    const doc = useComposerDocument({
      projectPath: ref("/tmp/project"),
      editFile: ref<string | null>("src/pages/index.astro"),
      editedMtimeMs: ref<number | null>(1000),
      model,
      editable: ref(true),
      designActive: ref(true),
      stagedSource,
      onStagedSourceChange: (next) => { stagedSource.value = next },
      beacon,
    })

    await expect(doc.pasteClipboard({ text: "<p>From Canvas</p>" })).resolves.toMatchObject({
      ok: true,
      staged: true,
    })
    expect(stagedSource.value).toContain("<p>From Canvas</p>")
    expect(commitComposerEditTransaction).not.toHaveBeenCalled()
  })

  it("keeps the acknowledged model unchanged when persistence fails", async () => {
    const parsed = await parseAstro("<main></main>")
    if (!parsed.editable) throw new Error(parsed.reason)
    const model = ref<AstroDocumentModel | null>(parsed.model)
    const before = serializeAstro(model.value!)
    const beacon = createComposerBeacon()
    beacon.illuminate("0")
    commitComposerEditTransaction.mockResolvedValueOnce({
      ok: false,
      code: "mtime_conflict",
      message: "Page changed on disk",
      conflicts: [],
    })
    const doc = useComposerDocument({
      projectPath: ref("/tmp/project"),
      editFile: ref<string | null>("src/pages/index.astro"),
      editedMtimeMs: ref<number | null>(1000),
      model,
      editable: ref(true),
      designActive: ref(true),
      beacon,
    })

    await expect(doc.pasteClipboard({ text: "<section>New</section>" })).resolves.toMatchObject({
      ok: false,
      code: "persist-failed",
    })
    expect(serializeAstro(model.value!)).toBe(before)
  })

  it("commits pasted Aria nodes and their copied class rule in one transaction", async () => {
    const destination = await parseAstro("<main></main>")
    const copied = await parseAstro('<section class="card">Card</section>')
    if (!destination.editable) throw new Error(destination.reason)
    if (!copied.editable) throw new Error(copied.reason)
    const model = ref<AstroDocumentModel | null>(destination.model)
    const beacon = createComposerBeacon()
    beacon.illuminate("0")
    listStylesheets.mockResolvedValueOnce([
      { relativePath: "src/styles/global.css", isEntry: true },
    ])
    readStylesheet.mockResolvedValueOnce({
      relativePath: "src/styles/global.css",
      content: "",
      mtimeMs: 50,
    })
    commitComposerEditTransaction.mockResolvedValueOnce({
      ok: true,
      revisions: [
        { relativeFile: "src/pages/index.astro", mtimeMs: 2000 },
        { relativeFile: "src/styles/global.css", mtimeMs: 2001 },
      ],
    })
    const doc = useComposerDocument({
      projectPath: ref("/tmp/project"),
      editFile: ref<string | null>("src/pages/index.astro"),
      editedMtimeMs: ref<number | null>(1000),
      model,
      editable: ref(true),
      designActive: ref(true),
      beacon,
    })

    const result = await doc.pasteClipboard({
      aria: encodeComposerClipboard({
        version: 1,
        sourceProject: "/tmp/project",
        sourceFile: "src/pages/other.astro",
        nodes: copied.model.nodes,
        imports: [],
        classes: [{
          name: "card",
          css: ".card { color: red; }",
          sourceFile: "src/styles/global.css",
        }],
        copiedAt: 1,
      }),
    })

    expect(result).toMatchObject({ ok: true, source: "aria", insertedCount: 1 })
    expect(commitComposerEditTransaction).toHaveBeenCalledTimes(1)
    expect(commitComposerEditTransaction.mock.calls[0]![0]).toMatchObject({
      page: { relativeFile: "src/pages/index.astro" },
      stylesheets: [{
        relativeFile: "src/styles/global.css",
        content: ".card { color: red; }\n",
      }],
    })
    expect(beacon.selectedPath.value).toBe("0.0")
  })
})
