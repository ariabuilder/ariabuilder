// @vitest-environment jsdom

import { createApp, h, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  beginPointerScrub,
  useInspectorLiveStyleSession,
} from "../workspace/composer/inspector/useInspectorLiveStyleSession"

describe("Inspector live style sessions", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("batches canvas previews and restores the original value on Escape", () => {
    const queued: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queued.push(callback)
      return 1
    })
    vi.stubGlobal("cancelAnimationFrame", () => undefined)
    const preview = vi.fn()
    const clear = vi.fn()
    const cancel = vi.fn()
    let session!: ReturnType<typeof useInspectorLiveStyleSession>
    const app = createApp({
      setup() {
        session = useInspectorLiveStyleSession({
          path: ref("node-1"),
          preview,
          clear,
          onCancel: cancel,
        })
        return () => h("div")
      },
    })
    const host = document.createElement("div")
    app.mount(host)

    session.preview("opacity: 0.5", "opacity: 1")
    session.preview("opacity: 0.25", "opacity: 1")
    expect(preview).not.toHaveBeenCalled()
    expect(queued).toHaveLength(1)
    queued[0]!(0)
    expect(preview).toHaveBeenCalledOnce()
    expect(preview).toHaveBeenCalledWith("node-1", "opacity: 0.25")

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(clear).toHaveBeenCalledWith("node-1")
    expect(cancel).toHaveBeenCalledWith("opacity: 1")
    app.unmount()
  })

  it("lets an explicitly owned input restore its draft before cancelling", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1))
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    const clear = vi.fn()
    const cancel = vi.fn()
    let session!: ReturnType<typeof useInspectorLiveStyleSession>
    const app = createApp({
      setup() {
        session = useInspectorLiveStyleSession({
          path: ref("node-1"),
          preview: vi.fn(),
          clear,
          onCancel: cancel,
        })
        return () => h("textarea", {
          "data-inspector-escape-owner": "",
          onKeydown: (event: KeyboardEvent) => {
            if (event.key === "Escape") session.cancel()
          },
        })
      },
    })
    const host = document.createElement("div")
    document.body.append(host)
    app.mount(host)
    session.preview("filter: blur(8px)", "filter: blur(2px)")

    host.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "Escape",
    }))

    expect(clear).toHaveBeenCalledWith("node-1")
    expect(cancel).toHaveBeenCalledWith("filter: blur(2px)")
    app.unmount()
    host.remove()
  })

  it("waits for two pixels and commits once when a scrub ends", () => {
    const preview = vi.fn()
    const commit = vi.fn()
    beginPointerScrub({
      event: new MouseEvent("pointerdown", {
        button: 0,
        clientX: 100,
      }) as PointerEvent,
      value: 10,
      pixelsPerStep: 2,
      onPreview: preview,
      onCommit: commit,
    })

    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 101 }))
    expect(preview).not.toHaveBeenCalled()
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 104 }))
    expect(preview).toHaveBeenLastCalledWith(12)
    window.dispatchEvent(new MouseEvent("pointerup"))
    expect(commit).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith(12)
  })

  it("keeps committed preview CSS painted without leaving Escape active", () => {
    const preview = vi.fn()
    const clear = vi.fn()
    let session!: ReturnType<typeof useInspectorLiveStyleSession>
    const app = createApp({
      setup() {
        session = useInspectorLiveStyleSession({
          path: ref("node-1"),
          preview,
          clear,
        })
        return () => h("div")
      },
    })
    const host = document.createElement("div")
    app.mount(host)

    session.commit("opacity: 0.4")
    expect(preview).toHaveBeenCalledWith("node-1", "opacity: 0.4")
    expect(clear).not.toHaveBeenCalled()
    expect(session.active.value).toBe(false)

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(clear).not.toHaveBeenCalled()
    app.unmount()
    expect(clear).toHaveBeenCalledWith("node-1")
  })

  it("cancels an active scrub without committing", () => {
    const commit = vi.fn()
    const cancel = vi.fn()
    beginPointerScrub({
      event: new MouseEvent("pointerdown", {
        button: 0,
        clientX: 20,
      }) as PointerEvent,
      value: 4,
      onPreview: vi.fn(),
      onCommit: commit,
      onCancel: cancel,
    })

    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 24 }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(commit).not.toHaveBeenCalled()
  })

  it("does not restore an empty origin when cancel is requested without a preview", () => {
    const clear = vi.fn()
    const cancel = vi.fn()
    let session!: ReturnType<typeof useInspectorLiveStyleSession>
    const app = createApp({
      setup() {
        session = useInspectorLiveStyleSession({
          path: ref("node-1"),
          preview: vi.fn(),
          clear,
          onCancel: cancel,
        })
        return () => h("div")
      },
    })
    const host = document.createElement("div")
    app.mount(host)

    session.cancel()
    expect(clear).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    app.unmount()
  })
})
