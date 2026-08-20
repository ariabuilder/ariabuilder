import { ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AstroDocumentModel } from "../../../shared/composer"
import { ARIA_MSG } from "../../../shared/composer/protocol"

const { setDraft, clearDraft } = vi.hoisted(() => ({
  setDraft: vi.fn(async () => ({ ok: true as const, revision: 1 })),
  clearDraft: vi.fn(async () => ({ ok: true as const, cleared: true })),
}))
vi.mock("@/lib/composer", () => ({
  setComposerPreviewDraft: setDraft,
  clearComposerPreviewDraft: clearDraft,
}))

import { useComposerPreviewCoordinator } from "./useComposerPreviewCoordinator"

const model = (): AstroDocumentModel => ({
  imports: [], extraFrontmatter: "", propSchema: [], slots: [], extendsTag: null,
  nodes: [{ id: "root", kind: "element", name: "div", props: {}, children: [{ id: "text", kind: "text", value: "A" }] }],
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("useComposerPreviewCoordinator", () => {
  it("patches immediately and coalesces preview draft writes", async () => {
    vi.useFakeTimers()
    const patches = vi.fn()
    const reconcile = vi.fn()
    const coordinator = useComposerPreviewCoordinator({
      projectPath: ref("/project"), editFile: ref("src/pages/index.astro"),
      patchNodes: patches, reconcile,
    })
    const first = model()
    const second = structuredClone(first)
    if (second.nodes[0]?.kind !== "element") throw new Error()
    second.nodes[0].props.class = { type: "string", value: "one" }
    coordinator.applyModelMutation(first, second)
    const third = structuredClone(second)
    if (third.nodes[0]?.kind !== "element") throw new Error()
    third.nodes[0].props.class = { type: "string", value: "two" }
    coordinator.applyModelMutation(second, third)
    coordinator.onPatchResult({
      type: ARIA_MSG.patchResult, revision: 1, status: "applied", paths: ["0"],
    })
    coordinator.onPatchResult({
      type: ARIA_MSG.patchResult, revision: 2, status: "applied", paths: ["0"],
    })

    expect(patches).toHaveBeenCalledTimes(2)
    expect(reconcile).not.toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(120)
    expect(setDraft).toHaveBeenCalledTimes(1)
      const draftCall = setDraft.mock.calls[0] as unknown as [string, string, string]
      expect(draftCall[2]).toContain('class="two"')
  })

  it("registers reconciliation before publishing a dynamic draft", async () => {
    vi.useFakeTimers()
    const reconcile = vi.fn()
    const coordinator = useComposerPreviewCoordinator({
      projectPath: ref("/project"), editFile: ref("src/pages/index.astro"),
      patchNodes: vi.fn(), reconcile,
    })
    const before = model()
    const after = structuredClone(before)
    if (after.nodes[0]?.kind !== "element") throw new Error()
    after.nodes[0].props.title = { type: "expr", value: "Astro.props.title" }
    coordinator.applyModelMutation(before, after)

    expect(reconcile).toHaveBeenCalledWith({ revision: 1, paths: ["0"] })
    await vi.advanceTimersByTimeAsync(0)
    expect(setDraft).toHaveBeenCalledWith(
      "/project", "src/pages/index.astro", expect.any(String),
      coordinator.leaseId, 1,
    )
  })

  it("uses a reserved transaction revision without incrementing it again", () => {
    const patches = vi.fn()
    const coordinator = useComposerPreviewCoordinator({
      projectPath: ref("/project"), editFile: ref("src/pages/index.astro"),
      patchNodes: patches, reconcile: vi.fn(),
    })
    const reserved = coordinator.reserveRevision()
    const before = model()
    const after = structuredClone(before)
    if (after.nodes[0]?.kind !== "element") throw new Error()
    after.nodes[0].props.title = { type: "string", value: "reserved" }
    coordinator.applyModelMutation(before, after, { revision: reserved })

    expect(reserved).toBe(1)
    expect(coordinator.revision.value).toBe(1)
    expect(patches).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }))
  })

  it("does not treat an early source-ready signal as a completed server morph", () => {
    const authoritative = vi.fn()
    const coordinator = useComposerPreviewCoordinator({
      projectPath: ref("/project"), editFile: ref("src/pages/index.astro"),
      patchNodes: vi.fn(), reconcile: vi.fn(),
    })
    const before = model()
    const after = structuredClone(before)
    if (after.nodes[0]?.kind !== "element") throw new Error()
    after.nodes[0].props.title = { type: "expr", value: "Astro.props.title" }
    coordinator.applyModelMutation(before, after)
    coordinator.markPersisted(1, authoritative)
    coordinator.onReconcileResult({
      type: ARIA_MSG.reconcileResult, revision: 1, ok: true, status: "patched", paths: [],
    })
    expect(authoritative).not.toHaveBeenCalled()
    coordinator.onReconcileResult({
      type: ARIA_MSG.reconcileResult, revision: 1, ok: true, status: "morphed", paths: ["0"],
    })
    expect(authoritative).toHaveBeenCalledOnce()
  })

  it("waits for an import draft before requesting a controlled reload", () => {
    vi.useFakeTimers()
    const reconcile = vi.fn()
    const coordinator = useComposerPreviewCoordinator({
      projectPath: ref("/project"), editFile: ref("src/pages/index.astro"),
      patchNodes: vi.fn(), reconcile,
    })
    const before = model()
    const after = structuredClone(before)
    after.imports.push({ name: "Card", path: "../components/Card.astro" })

    expect(coordinator.applyModelMutation(before, after).kind).toBe("hard-reload")
    expect(reconcile).toHaveBeenCalledWith({
      revision: 1,
      paths: ["$document"],
      reloadReason: "imports-changed",
    })
  })

  it("recovers a rejected patch through the latest Astro draft before resuming", async () => {
    vi.useFakeTimers()
    const patches = vi.fn()
    const reconcile = vi.fn()
    const coordinator = useComposerPreviewCoordinator({
      projectPath: ref("/project"), editFile: ref("src/pages/index.astro"),
      patchNodes: patches, reconcile,
    })
    const before = model()
    const first = structuredClone(before)
    if (first.nodes[0]?.kind !== "element") throw new Error()
    first.nodes[0].props.class = { type: "string", value: "first" }
    coordinator.applyModelMutation(before, first)
    coordinator.onPatchResult({
      type: ARIA_MSG.patchResult,
      revision: 1,
      status: "rejected",
      reason: "dom-shape-mismatch",
      paths: ["0"],
    })

    expect(coordinator.optimisticDesynced.value).toBe(true)
    expect(reconcile).toHaveBeenLastCalledWith({ revision: 1, paths: ["0"] })
    await vi.advanceTimersByTimeAsync(0)
    expect(setDraft).toHaveBeenLastCalledWith(
      "/project", "src/pages/index.astro", expect.stringContaining('class="first"'),
      coordinator.leaseId, 1,
    )

    const second = structuredClone(first)
    if (second.nodes[0]?.kind !== "element") throw new Error()
    second.nodes[0].props.class = { type: "string", value: "latest" }
    coordinator.applyModelMutation(first, second)
    expect(patches).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenLastCalledWith({ revision: 2, paths: ["0"] })
    coordinator.onReconcileResult({
      type: ARIA_MSG.reconcileResult, revision: 1, ok: true, paths: ["0"],
    })
    expect(coordinator.optimisticDesynced.value).toBe(true)
    coordinator.onReconcileResult({
      type: ARIA_MSG.reconcileResult, revision: 2, ok: true, paths: ["0"],
    })
    expect(coordinator.optimisticDesynced.value).toBe(false)

    const third = structuredClone(second)
    if (third.nodes[0]?.kind !== "element") throw new Error()
    third.nodes[0].props.class = { type: "string", value: "resumed" }
    coordinator.applyModelMutation(second, third)
    expect(patches).toHaveBeenCalledTimes(2)
  })

  it("treats a missing patch acknowledgement as desynchronization after 500 ms", async () => {
    vi.useFakeTimers()
    const reconcile = vi.fn()
    const coordinator = useComposerPreviewCoordinator({
      projectPath: ref("/project"), editFile: ref("src/pages/index.astro"),
      patchNodes: vi.fn(), reconcile,
    })
    const before = model()
    const after = structuredClone(before)
    if (after.nodes[0]?.kind !== "element") throw new Error()
    after.nodes[0].props.title = { type: "string", value: "fast" }
    coordinator.applyModelMutation(before, after)

    await vi.advanceTimersByTimeAsync(499)
    expect(coordinator.optimisticDesynced.value).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(coordinator.optimisticDesynced.value).toBe(true)
    expect(reconcile).toHaveBeenCalledWith({ revision: 1, paths: ["0"] })
  })

  it("does not let persistence bypass pending canvas recovery", async () => {
    vi.useFakeTimers()
    const authoritative = vi.fn()
    const coordinator = useComposerPreviewCoordinator({
      projectPath: ref("/project"), editFile: ref("src/pages/index.astro"),
      patchNodes: vi.fn(), reconcile: vi.fn(),
    })
    const before = model()
    const after = structuredClone(before)
    if (after.nodes[0]?.kind !== "element") throw new Error()
    after.nodes[0].props.class = { type: "string", value: "saved" }
    coordinator.applyModelMutation(before, after)
    coordinator.markPersisted(authoritative)

    await vi.advanceTimersByTimeAsync(500)
    expect(coordinator.optimisticDesynced.value).toBe(true)
    expect(authoritative).not.toHaveBeenCalled()
    expect(clearDraft).not.toHaveBeenCalled()

    coordinator.onReconcileResult({
      type: ARIA_MSG.reconcileResult, revision: 1, ok: true, paths: ["0"],
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(authoritative).toHaveBeenCalledOnce()
    expect(clearDraft).toHaveBeenCalledOnce()
  })
})
