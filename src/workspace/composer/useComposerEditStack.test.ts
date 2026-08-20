import { describe, expect, it, vi } from "vitest"
import { isProxy, isReactive, reactive } from "vue"
import { parseComposerPage } from "@/lib/composer"
import type { AstroCollectionBinding } from "../../../shared/composer"
import { useComposerEditStack } from "./useComposerEditStack"

describe("useComposerEditStack nested component identity", () => {
  it("keeps the outer canvas focus while preserving the full nested chain", () => {
    const stack = useComposerEditStack()
    const parentSegment = {
      ownerFile: "src/pages/index.astro",
      hostPath: "0.0",
      occurrence: 0,
    }
    const childSegment = {
      ownerFile: "src/components/Parent.astro",
      hostPath: "0.0",
      occurrence: 0,
    }

    stack.resetToPage({
      kind: "page",
      name: "Home",
      file: "src/pages/index.astro",
    })
    stack.push({
      kind: "component",
      name: "Parent",
      file: "src/components/Parent.astro",
      parentFile: parentSegment.ownerFile,
      hostPath: parentSegment.hostPath,
      occurrence: parentSegment.occurrence,
      focusPath: parentSegment.hostPath,
      instanceChain: [parentSegment],
    })
    stack.push({
      kind: "component",
      name: "Child",
      file: "src/components/Child.astro",
      parentFile: childSegment.ownerFile,
      hostPath: childSegment.hostPath,
      occurrence: childSegment.occurrence,
      instanceChain: [parentSegment, childSegment],
    })

    expect(stack.stack.value.map((entry) => entry.name)).toEqual([
      "Home",
      "Parent",
      "Child",
    ])
    expect(stack.focusPath.value).toBe(parentSegment.hostPath)
    expect(stack.current.value?.instanceChain).toEqual([
      parentSegment,
      childSegment,
    ])
    expect(stack.pathScope.value).toBe("src/components/Child.astro|")
  })

  it("returns to an existing ancestor instead of duplicating a cycle", () => {
    const stack = useComposerEditStack()
    stack.resetToPage({ kind: "page", name: "Home", file: "src/pages/index.astro" })
    stack.push({
      kind: "component",
      name: "Parent",
      file: "src/components/Parent.astro",
      focusPath: "0.0",
    })
    stack.push({
      kind: "component",
      name: "Child",
      file: "src/components/Child.astro",
    })

    expect(stack.push({
      kind: "component",
      name: "Parent",
      file: "src/components/Parent.astro",
    })).toEqual({ index: 1, added: false })
    expect(stack.stack.value.map((entry) => entry.name)).toEqual(["Home", "Parent"])
  })

  it("stores a plain collection-props snapshot that survives stack reactivity", () => {
    const stack = useComposerEditStack()
    const props = reactive({
      item: { collections: ["posts"], cardinality: "one" as const },
    })

    stack.resetToPage({ kind: "page", name: "Home", file: "src/pages/index.astro" })
    stack.push({
      kind: "component",
      name: "Card",
      file: "src/components/Card.astro",
      collectionProps: props,
    })

    const stored = stack.current.value?.collectionProps
    expect(stored).toEqual(props)
    expect(stored).not.toBe(props)
    expect(isReactive(stored)).toBe(false)
    expect(isProxy(stored)).toBe(false)
    expect(() => structuredClone(stored)).not.toThrow()
  })

  it("can reload the drilled file from stack collection props without cloning proxies", async () => {
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

    const stack = useComposerEditStack()
    stack.resetToPage({ kind: "page", name: "faq", file: "src/pages/faq.astro" })
    stack.push({
      kind: "component",
      name: "Card",
      file: "src/components/Card.astro",
      collectionProps: reactive({
        item: { collections: ["posts"], cardinality: "one" as const },
      }),
    })

    await parseComposerPage(
      "/project",
      stack.current.value!.file,
      stack.current.value?.collectionProps,
    )

    const payload = parsePage.mock.calls[0]?.[2]
    expect(payload).toEqual({
      item: { collections: ["posts"], cardinality: "one" },
    })
    expect(isProxy(payload)).toBe(false)
    expect(() => structuredClone(payload)).not.toThrow()
  })
})
