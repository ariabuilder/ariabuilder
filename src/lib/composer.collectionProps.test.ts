import { describe, expect, it, vi } from "vitest"
import { isProxy, reactive } from "vue"
import type { AstroCollectionBinding } from "../../shared/composer"
import { analyzeComposerSource, parseComposerPage } from "./composer"

const collectionProps = {
  item: {
    collections: ["posts"],
    cardinality: "one",
  },
} satisfies Record<string, AstroCollectionBinding>

describe("composer collection prop IPC payloads", () => {
  it("serializes reactive collection props before parsePage", async () => {
    const parsePage = vi.fn(async (
      _projectPath: string,
      _relativeFile: string,
      _collectionProps?: Record<string, AstroCollectionBinding>,
    ) => ({
      editable: false,
      compilerValid: false,
      reason: "stub",
      source: "",
      relativeFile: "src/components/Card.astro",
      mtimeMs: null,
    }))
    vi.stubGlobal("window", {
      aria: { composer: { parsePage } },
    })

    const props = reactive(collectionProps)
    await parseComposerPage("/project", "src/components/Card.astro", props)

    const payload = parsePage.mock.calls[0]?.[2]
    expect(payload).toEqual(collectionProps)
    expect(isProxy(payload)).toBe(false)
    expect(() => structuredClone(payload)).not.toThrow()
    expect(payload).not.toBe(props)
    expect(payload?.item).not.toBe(props.item)
  })

  it("serializes reactive collection props before analyzeSource", async () => {
    const analyzeSource = vi.fn(async (
      _projectPath: string,
      _relativeFile: string,
      _source: string,
      _collectionProps?: Record<string, AstroCollectionBinding>,
    ) => ({
      editable: false,
      compilerValid: false,
      reason: "stub",
      source: "",
    }))
    vi.stubGlobal("window", {
      aria: { composer: { analyzeSource } },
    })

    const props = reactive(collectionProps)
    await analyzeComposerSource(
      "/project",
      "src/components/Card.astro",
      "---\n---\n<div />",
      props,
    )

    const payload = analyzeSource.mock.calls[0]?.[3]
    expect(payload).toEqual(collectionProps)
    expect(isProxy(payload)).toBe(false)
    expect(() => structuredClone(payload)).not.toThrow()
    expect(payload).not.toBe(props)
  })

  it("omits collection props when they were not provided", async () => {
    const parsePage = vi.fn(async (
      _projectPath: string,
      _relativeFile: string,
      _collectionProps?: Record<string, AstroCollectionBinding>,
    ) => ({
      editable: false,
      compilerValid: false,
      reason: "stub",
      source: "",
      relativeFile: "src/pages/index.astro",
      mtimeMs: null,
    }))
    vi.stubGlobal("window", {
      aria: { composer: { parsePage } },
    })

    await parseComposerPage("/project", "src/pages/index.astro")

    expect(parsePage.mock.calls[0]?.[2]).toBeUndefined()
  })
})
