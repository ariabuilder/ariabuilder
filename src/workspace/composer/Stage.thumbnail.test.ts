// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ProjectRuntimeSession } from "@/lib/sessions"
import { captureThumbs } from "@/lib/thumbs"
import Stage from "./Stage.vue"

vi.mock("@/lib/thumbs", () => ({ captureThumbs: vi.fn() }))
vi.mock("@/lib/preview", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/preview")>()
  return {
    ...original,
    previewWindowMatchesOrigin: () => true,
  }
})

let unmount: (() => void) | null = null

afterEach(() => {
  unmount?.()
  unmount = null
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("Stage page thumbnails", () => {
  it("requests a clean page capture using the iframe viewport", async () => {
    vi.useFakeTimers()
    vi.mocked(captureThumbs).mockResolvedValue({ ok: true })
    const host = document.createElement("div")
    document.body.append(host)
    const runtime: ProjectRuntimeSession = {
      path: "/project",
      name: "Project",
      live: true,
      previewUrl: "http://127.0.0.1:4321",
      status: "live",
      error: null,
      logs: [],
      openedAt: Date.now(),
      authoringState: "ready",
      recoveryAction: "none",
      externalPreview: null,
    }
    const app = createApp({
      render: () => h(Stage, {
        projectPath: "/project",
        selectedRoute: "/",
        device: "desktop",
        runtime,
        designMode: true,
        canvasActive: true,
      }),
    })
    app.mount(host)
    unmount = () => {
      app.unmount()
      host.remove()
    }
    await nextTick()

    const frame = host.querySelector("iframe") as HTMLIFrameElement
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
      x: 41,
      y: 72,
      width: 768,
      height: 1024,
      top: 72,
      right: 809,
      bottom: 1096,
      left: 41,
      toJSON: () => ({}),
    })
    const overlay = document.createElement("div")
    overlay.setAttribute("data-slot", "popover-content")
    host.append(overlay)

    await vi.advanceTimersByTimeAsync(2_500)

    expect(captureThumbs).toHaveBeenCalledWith({
      projectPath: "/project",
      baseUrl: "http://127.0.0.1:4321",
      route: "/",
      viewport: { width: 768, height: 1024 },
      captureHeight: 576,
      mtimeMs: null,
    })
  })
})
