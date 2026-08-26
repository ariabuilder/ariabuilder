import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import type { ParseAstroResult } from "../../../shared/composer"
import {
  composerSourcesEquivalent,
  normalizeComposerSource,
  useComposerCodeSession,
} from "./useComposerCodeSession"

vi.mock("@/lib/composer", () => ({
  analyzeComposerSource: vi.fn(async (_project: string, _file: string, source: string) =>
    editableResult(source),
  ),
  clearComposerPreviewDraft: vi.fn(async () => undefined),
  commitComposerEditTransaction: vi.fn(),
  setComposerPreviewDraft: vi.fn(async () => undefined),
}))

function editableResult(source: string): ParseAstroResult {
  return {
    editable: true,
    compilerValid: true,
    source,
    model: {
      imports: [],
      extraFrontmatter: "",
      nodes: [],
      propSchema: [],
      slots: [],
      extendsTag: null,
    },
  }
}

function installLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  })
}

describe("normalizeComposerSource", () => {
  it("treats CRLF and LF as equivalent", () => {
    expect(normalizeComposerSource("a\r\nb\r\n")).toBe("a\nb\n")
    expect(composerSourcesEquivalent("a\r\nb", "a\nb")).toBe(true)
    expect(composerSourcesEquivalent("a\nb", "a\nx")).toBe(false)
  })
})

describe("useComposerCodeSession dirty baseline", () => {
  const projectPath = ref("/tmp/project")
  const editFile = ref<string | null>("src/pages/index.astro")
  const editedMtimeMs = ref<number | null>(1000)

  beforeEach(() => {
    installLocalStorage()
    localStorage.clear()
    projectPath.value = "/tmp/project"
    editFile.value = "src/pages/index.astro"
    editedMtimeMs.value = 1000
  })

  function session() {
    return useComposerCodeSession({
      projectPath,
      editFile,
      editedMtimeMs,
      onProjection: () => undefined,
    })
  }

  it("stays clean after loadDocument with no recovery", async () => {
    const code = session()
    const source = "---\n---\n\n<h1>Astro</h1>\n"
    await code.loadDocument(editableResult(source), 1000)
    expect(code.dirty.value).toBe(false)
    expect(code.canApply.value).toBe(false)
  })

  it("clears equivalent CRLF recovery drafts instead of marking dirty", async () => {
    const sourceLf = "---\n---\n\n<h1>Astro</h1>\n"
    const sourceCrlf = sourceLf.replace(/\n/g, "\r\n")
    localStorage.setItem(
      `aria.composer.code-draft:${projectPath.value}:${editFile.value}`,
      JSON.stringify({
        baseSource: sourceCrlf,
        source: sourceCrlf,
        baseMtimeMs: 1000,
        updatedAt: Date.now(),
        stylesheets: [],
      }),
    )
    const code = session()
    await code.loadDocument(editableResult(sourceLf), 1000)
    expect(code.dirty.value).toBe(false)
    expect(code.canApply.value).toBe(false)
    expect(
      localStorage.getItem(
        `aria.composer.code-draft:${projectPath.value}:${editFile.value}`,
      ),
    ).toBeNull()
  })

  it("does not mark dirty when CodeMirror normalizes line endings only", async () => {
    const code = session()
    const sourceCrlf = "---\r\n---\r\n\r\n<h1>Astro</h1>\r\n"
    await code.loadDocument(editableResult(sourceCrlf), 1000)
    code.updateSource(sourceCrlf.replace(/\r\n/g, "\n"))
    expect(code.dirty.value).toBe(false)
    expect(code.canApply.value).toBe(false)
  })

  it("marks dirty when recovery draft content really diverges", async () => {
    const disk = "---\n---\n\n<h1>Astro</h1>\n"
    const draft = "---\n---\n\n<h1>Changed</h1>\n"
    localStorage.setItem(
      `aria.composer.code-draft:${projectPath.value}:${editFile.value}`,
      JSON.stringify({
        baseSource: disk,
        source: draft,
        baseMtimeMs: 1000,
        updatedAt: Date.now(),
        stylesheets: [],
      }),
    )
    const code = session()
    await code.loadDocument(editableResult(disk), 1000)
    expect(code.dirty.value).toBe(true)
    expect(code.workingSource.value).toBe(draft)
  })

  it("keeps analysis valid when a visual inspector mutation updates source", async () => {
    const code = session()
    await code.loadDocument(editableResult("---\n---\n\n<h1>Astro</h1>\n"), 1000)
    expect(code.analysisStatus.value).toBe("valid")

    vi.useFakeTimers()
    try {
      code.updateSourceFromVisualMutation("---\n---\n\n<h1>Changed</h1>\n")
      expect(code.dirty.value).toBe(true)
      expect(code.analysisStatus.value).toBe("valid")

      await vi.advanceTimersByTimeAsync(250)
      expect(code.analysisStatus.value).toBe("valid")
    } finally {
      vi.useRealTimers()
    }
  })

  it("advances the clean Code baseline after an exact visual write", async () => {
    const code = session()
    const before = "---\n---\n\n<h1>Astro</h1>\n"
    const after = "---\n---\n\n<h1 title=\"Greeting\">Astro</h1>\n"
    await code.loadDocument(editableResult(before), 1000)

    code.markVisualSourcePersisted(after)

    expect(code.appliedSource.value).toBe(after)
    expect(code.workingSource.value).toBe(after)
    expect(code.dirty.value).toBe(false)
  })

  it("marks analysis checking when the code editor updates source", async () => {
    const code = session()
    await code.loadDocument(editableResult("---\n---\n\n<h1>Astro</h1>\n"), 1000)
    code.updateSource("---\n---\n\n<h1>Typed</h1>\n")
    expect(code.analysisStatus.value).toBe("checking")
  })
})
