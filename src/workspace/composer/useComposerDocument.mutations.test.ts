import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import { serializeAstro } from "../../../shared/composer"
import type { AstroDocumentModel } from "../../../shared/composer/types"
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

describe("useComposerDocument mutations", () => {
  it("commits an automatic class attachment and inline-style removal atomically", async () => {
    commitComposerEditTransaction.mockResolvedValueOnce({
      ok: true,
      revisions: [
        { relativeFile: "src/pages/index.astro", mtimeMs: 2000 },
        { relativeFile: "src/styles/global.css", mtimeMs: 3000 },
      ],
    })
    const model = ref<AstroDocumentModel | null>({
      ...blankModel(),
      nodes: [{
        id: "container",
        kind: "element",
        name: "div",
        props: { style: { type: "string", value: "margin: 2rem" } },
        children: [],
      }],
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

    await expect(doc.commitModelWithStylesheet((next) => {
      const node = next.nodes[0]
      if (node?.kind !== "element") return { ok: false }
      node.props.class = { type: "string", value: "aria-container" }
      delete node.props.style
      return { ok: true, selectPath: "0" }
    }, {
      relativeFile: "src/styles/global.css",
      beforeContent: "",
      content: ".aria-container {\n  margin: 2rem;\n}\n",
      expectedMtimeMs: 1500,
    })).resolves.toHaveLength(2)

    const transaction = commitComposerEditTransaction.mock.calls[0]![0] as {
      page: { model: AstroDocumentModel }
      stylesheets: Array<{ relativeFile: string; content: string }>
    }
    const saved = transaction.page.model.nodes[0]
    expect(saved?.kind === "element" ? saved.props : {}).toEqual({
      class: { type: "string", value: "aria-container" },
    })
    expect(transaction.stylesheets[0]).toMatchObject({
      relativeFile: "src/styles/global.css",
      content: ".aria-container {\n  margin: 2rem;\n}\n",
    })
    expect(model.value?.nodes[0]).toEqual(saved)
  })

  it("adopts an acknowledged model mutation only after persistence succeeds", async () => {
    let finishCommit: (result: unknown) => void = () => undefined
    commitComposerEditTransaction.mockImplementationOnce(() => new Promise((resolve) => {
      finishCommit = resolve
    }))
    const model = ref<AstroDocumentModel | null>({
      ...blankModel(),
      nodes: [{
        id: "card",
        kind: "element",
        name: "div",
        props: { style: { type: "string", value: "opacity: 1" } },
        children: [],
      }, {
        id: "sibling",
        kind: "element",
        name: "section",
        props: {},
        children: [],
      }],
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

    const pending = doc.commitModelMutation((next) => {
      const node = next.nodes[0]
      if (node?.kind !== "element") return { ok: false }
      node.props.style = { type: "string", value: "opacity: 0.44" }
      return { ok: true }
    })
    await vi.waitFor(() => {
      expect(commitComposerEditTransaction).toHaveBeenCalledOnce()
    })

    expect(serializeAstro(model.value!)).toContain('style="opacity: 1"')
    expect(doc.mutationPending.value).toBe(true)
    expect(doc.canUndo.value).toBe(false)
    expect(doc.mutateModel((next) => {
      const sibling = next.nodes[1]
      if (sibling?.kind !== "element") return { ok: false }
      sibling.props.title = { type: "string", value: "Must not be lost" }
      return { ok: true }
    })).toBe(false)
    beacon.illuminate("1")
    finishCommit({
      ok: true,
      revisions: [{ relativeFile: "src/pages/index.astro", mtimeMs: 2000 }],
    })
    await expect(pending).resolves.toBe(true)
    expect(serializeAstro(model.value!)).toContain('style="opacity: 0.44"')
    expect(serializeAstro(model.value!)).not.toContain("Must not be lost")
    expect(beacon.selectedPath.value).toBe("1")
    expect(doc.mutationPending.value).toBe(false)
    expect(doc.canUndo.value).toBe(true)
    expect(doc.dirty.value).toBe(false)
  })

  it("keeps the acknowledged model and history unchanged when persistence fails", async () => {
    commitComposerEditTransaction.mockResolvedValueOnce({
      ok: false,
      code: "write_failed",
      message: "Could not save opacity",
    })
    const model = ref<AstroDocumentModel | null>({
      ...blankModel(),
      nodes: [{
        id: "card",
        kind: "element",
        name: "div",
        props: { style: { type: "string", value: "opacity: 1" } },
        children: [],
      }],
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

    await expect(doc.commitModelMutation((next) => {
      const node = next.nodes[0]
      if (node?.kind !== "element") return { ok: false }
      node.props.style = { type: "string", value: "opacity: 0.44" }
      return { ok: true }
    })).resolves.toBe(false)

    expect(serializeAstro(model.value!)).toContain('style="opacity: 1"')
    expect(doc.canUndo.value).toBe(false)
    expect(doc.dirty.value).toBe(false)
    expect(doc.saveError.value).toBe("Could not save opacity")
  })
})
