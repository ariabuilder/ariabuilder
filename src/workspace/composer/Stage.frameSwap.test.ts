// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ProjectRuntimeSession } from "@/lib/sessions"
import type { AstroDocumentModel } from "../../../shared/composer/types"
import { ARIA_BRIDGE_ID, ARIA_MSG, ARIA_PROTOCOL_VERSION } from "../../../shared/composer/protocol"
import { captureThumbs } from "@/lib/thumbs"
import Stage from "./Stage.vue"
import { provideComposerBeacon } from "./selection/useComposerBeacon"

vi.mock("@/lib/thumbs", () => ({ captureThumbs: vi.fn() }))
vi.mock("@/lib/preview", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/preview")>()
  return {
    ...original,
    previewWindowMatchesOrigin: () => true,
  }
})
const { confirmPreviewReplacement, replaceExternalSessionRuntime, restartSessionRuntime } = vi.hoisted(() => ({
  confirmPreviewReplacement: vi.fn(async () => true),
  replaceExternalSessionRuntime: vi.fn(async () => undefined),
  restartSessionRuntime: vi.fn(async () => undefined),
}))
vi.mock("@/composables/useConfirm", () => ({ confirm: confirmPreviewReplacement }))
vi.mock("@/lib/sessions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/sessions")>()
  return {
    ...original,
    replaceExternalSessionRuntime,
    restartSessionRuntime,
  }
})

const mounted: Array<() => void> = []

function ready(frame: HTMLIFrameElement) {
  const url = new URL(frame.src)
  window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow,
    origin: url.origin,
    data: {
      type: ARIA_MSG.ready,
      version: ARIA_PROTOCOL_VERSION,
      bridgeId: ARIA_BRIDGE_ID,
      pathname: url.pathname,
      frameToken: url.searchParams.get("aria-frame") ?? "",
    },
  }))
}

function mountStage(
  designMode = false,
  runtimeOverrides: Partial<ProjectRuntimeSession> = {},
) {
  const host = document.createElement("div")
  document.body.append(host)
  const reloadKey = ref(0)
  const canvasActive = ref(true)
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
    ...runtimeOverrides,
  }
  const app = createApp({
    render: () => h(Stage, {
      projectPath: "/project",
      selectedRoute: "/",
      device: "desktop",
      runtime,
      reloadKey: reloadKey.value,
      designMode,
      canvasActive: canvasActive.value,
    }),
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, reloadKey, canvasActive }
}

function trackedModel(label: string): AstroDocumentModel {
  return {
    imports: [],
    extraFrontmatter: "",
    nodes: [{
      id: "0",
      kind: "element",
      name: "section",
      props: { "aria-label": { type: "string", value: label } },
      children: [],
    }],
    propSchema: [],
    slots: [],
    extendsTag: null,
  }
}

function richTextModel(): AstroDocumentModel {
  return {
    imports: [],
    extraFrontmatter: "",
    nodes: [{
      id: "0",
      kind: "element",
      name: "p",
      props: {},
      children: [{ id: "1", kind: "text", value: "Selected copy" }],
    }],
    propSchema: [],
    slots: [],
    extendsTag: null,
  }
}

function mountTrackedStage(options: {
  model?: AstroDocumentModel
  selectedPath?: string | null
} = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const pathScope = ref("src/components/First.astro|")
  const documentModel = ref<AstroDocumentModel>(options.model ?? trackedModel("First"))
  let beacon!: ReturnType<typeof provideComposerBeacon>
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
  const app = createApp(defineComponent({
    setup() {
      beacon = provideComposerBeacon()
      if (options.selectedPath !== null) {
        beacon.illuminate(options.selectedPath ?? "0", { source: "api", reveal: "none" })
      }
      return () => h(Stage, {
        projectPath: "/project",
        selectedRoute: "/",
        device: "desktop",
        runtime,
        designMode: true,
        canvasActive: true,
        showSelectionToolbar: true,
        showSelectionSizing: true,
        documentModel: documentModel.value,
        pathScope: pathScope.value,
        focusPath: "0.4",
      })
    },
  }))
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, pathScope, documentModel, beacon }
}

function latestTrackMessage(calls: readonly (readonly unknown[])[]) {
  return calls
    .map((call) => call[0])
    .filter((message): message is Record<string, unknown> =>
      Boolean(message && typeof message === "object" && (message as Record<string, unknown>).type === ARIA_MSG.track),
    )
    .at(-1)
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("Stage warm frame swap", () => {
  it("uses the same rich-text owner box for hover and selection", async () => {
    const { host, beacon } = mountTrackedStage({
      model: richTextModel(),
      selectedPath: null,
    })
    await nextTick()
    const frame = host.querySelector("iframe") as HTMLIFrameElement
    frame.dispatchEvent(new Event("load"))
    await nextTick()
    ready(frame)
    await nextTick()

    const origin = new URL(frame.src).origin
    const textPath = "src/components/First.astro|0.0"
    window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow,
      origin,
      data: {
        type: ARIA_MSG.hover,
        path: textPath,
        occurrence: 0,
      },
    }))
    await nextTick()
    expect(beacon.hoverPath.value).toBe("0")

    window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow,
      origin,
      data: {
        type: ARIA_MSG.click,
        path: textPath,
        occurrence: 0,
      },
    }))
    await nextTick()
    expect(beacon.selectedPath.value).toBe("0")
    expect(beacon.hoverPath.value).toBe(beacon.selectedPath.value)
  })

  it("requests a clean page capture using the iframe viewport", async () => {
    vi.useFakeTimers()
    vi.mocked(captureThumbs).mockResolvedValue({ ok: true })
    const { host } = mountStage(true)
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

  it("keeps the visible iframe until its replacement bridge is ready", async () => {
    vi.useFakeTimers()
    const { host, reloadKey } = mountStage()
    await nextTick()
    const first = host.querySelector("iframe") as HTMLIFrameElement
    ready(first)

    reloadKey.value = 1
    await nextTick()
    const warming = [...host.querySelectorAll("iframe")].find((frame) => frame !== first)!
    expect(first.getAttribute("aria-hidden")).toBe("false")
    expect(warming.getAttribute("aria-hidden")).toBe("true")

    ready(warming)
    await nextTick()
    expect(first.getAttribute("aria-hidden")).toBe("true")
    expect(warming.getAttribute("aria-hidden")).toBe("false")

    await vi.advanceTimersByTimeAsync(160)
    expect(host.querySelectorAll("iframe")).toHaveLength(1)
    expect(host.querySelector("iframe")).toBe(warming)
  })

  it("retains the old canvas and offers retry when warming times out", async () => {
    vi.useFakeTimers()
    const { host, reloadKey } = mountStage()
    await nextTick()
    const first = host.querySelector("iframe") as HTMLIFrameElement
    ready(first)
    reloadKey.value = 1
    await nextTick()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(first.getAttribute("aria-hidden")).toBe("false")
    expect(host.textContent).toContain("Preview update paused")
    expect(host.querySelector("button")?.textContent).toContain("Retry canvas")
  })

  it("does not let delayed cleanup erase a newly reused frame slot", async () => {
    vi.useFakeTimers()
    const { host, reloadKey } = mountStage()
    await nextTick()
    const first = host.querySelector("iframe") as HTMLIFrameElement
    ready(first)

    reloadKey.value = 1
    await nextTick()
    const second = [...host.querySelectorAll("iframe")].find((frame) => frame !== first)!
    ready(second)
    await nextTick()

    reloadKey.value = 2
    await nextTick()
    const reusedFirst = [...host.querySelectorAll("iframe")].find((frame) => frame !== second)!
    const reusedSrc = reusedFirst.src

    await vi.advanceTimersByTimeAsync(160)
    expect(host.querySelectorAll("iframe")).toHaveLength(2)
    expect(reusedFirst.src).toBe(reusedSrc)

    ready(reusedFirst)
    await vi.advanceTimersByTimeAsync(160)
    expect(host.querySelectorAll("iframe")).toHaveLength(1)
    expect(host.querySelector("iframe")).toBe(reusedFirst)
  })

  it("surfaces an initial bridge timeout with a restart action", async () => {
    vi.useFakeTimers()
    const { host } = mountStage(true)
    await nextTick()
    const frame = host.querySelector("iframe") as HTMLIFrameElement
    frame.dispatchEvent(new Event("load"))

    await vi.advanceTimersByTimeAsync(10_100)
    expect(host.textContent).toContain("Selection unavailable")
    expect(host.textContent).toContain("Restart preview")

    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Restart preview"),
    ) as HTMLButtonElement
    button.click()
    await nextTick()
    expect(restartSessionRuntime).toHaveBeenCalledWith("/project")
  })

  it("offers one confirmed replacement action for a blocked external preview", async () => {
    const { host } = mountStage(true, {
      live: false,
      previewUrl: null,
      previewOwnership: "external",
      status: "failed",
      error: "Another Astro preview is using this project.",
      authoringState: "blocked_external",
      recoveryAction: "replace_external",
      externalPreview: { pid: 4321, url: "http://127.0.0.1:4321" },
    })
    await nextTick()

    expect(host.textContent).toContain("Preview already running")
    expect(host.textContent).toContain("Replace preview")
    expect(host.textContent).not.toContain("Restart preview")
    const button = [...host.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Replace preview"),
    ) as HTMLButtonElement
    button.click()
    await nextTick()
    await Promise.resolve()
    expect(confirmPreviewReplacement).toHaveBeenCalledWith(expect.objectContaining({
      confirmLabel: "Replace preview",
      destructive: true,
    }))
    expect(replaceExternalSessionRuntime).toHaveBeenCalledWith("/project")
    expect(restartSessionRuntime).not.toHaveBeenCalled()
  })

  it("reports an incompatible ready bridge instead of ignoring it", async () => {
    const { host } = mountStage(true)
    await nextTick()
    const frame = host.querySelector("iframe") as HTMLIFrameElement
    const url = new URL(frame.src)
    window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow,
      origin: url.origin,
      data: {
        type: ARIA_MSG.ready,
        version: ARIA_PROTOCOL_VERSION,
        bridgeId: "aria-composer-bridge-old",
        pathname: url.pathname,
        frameToken: url.searchParams.get("aria-frame") ?? "",
      },
    }))
    await nextTick()

    expect(host.textContent).toContain("Selection unavailable")
    expect(host.textContent).toContain("aria-composer-bridge-old")
  })

  it("re-arms the existing iframe when a background workspace becomes active", async () => {
    vi.useFakeTimers()
    const { host, canvasActive } = mountStage(true)
    await nextTick()
    const frame = host.querySelector("iframe") as HTMLIFrameElement
    ready(frame)
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage")
    postMessage.mockClear()

    canvasActive.value = false
    await nextTick()
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: ARIA_MSG.designInteraction, enabled: false }),
      new URL(frame.src).origin,
    )

    postMessage.mockClear()
    canvasActive.value = true
    await nextTick()
    await vi.runAllTimersAsync()
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ARIA_MSG.bridgePing,
        frameToken: new URL(frame.src).searchParams.get("aria-frame"),
      }),
      new URL(frame.src).origin,
    )
  })

  it("keeps first-entry overlays bound to the newest component scope", async () => {
    const { host, pathScope, documentModel } = mountTrackedStage()
    await nextTick()
    const frame = host.querySelector("iframe") as HTMLIFrameElement
    frame.dispatchEvent(new Event("load"))
    await nextTick()
    ready(frame)
    await nextTick()
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage")
    documentModel.value = trackedModel("First committed")
    await nextTick()
    ready(frame)
    await nextTick()
    await vi.waitFor(() => {
      expect(latestTrackMessage(postMessage.mock.calls)).toBeDefined()
    })
    await nextTick()

    const firstTrack = latestTrackMessage(postMessage.mock.calls)
    const firstRevision = firstTrack?.trackingRevision as number
    expect(firstTrack).toMatchObject({
      scope: "src/components/First.astro|",
      paths: ["src/components/First.astro|0", "0.4"],
    })
    expect(Number.isInteger(firstRevision)).toBe(true)

    const origin = new URL(frame.src).origin
    window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow,
      origin,
      data: {
        type: ARIA_MSG.rects,
        trackingRevision: firstRevision,
        rects: {
          "src/components/First.astro|0": [{ x: 20, y: 30, w: 200, h: 80 }],
          "0.4": [{ x: 10, y: 10, w: 400, h: 300 }],
        },
        classes: {},
        owners: {},
      },
    }))
    await nextTick()
    expect(host.querySelector('[data-overlay="toolbar"]')).not.toBeNull()
    expect(host.querySelectorAll('button[aria-label^="Resize "]')).toHaveLength(8)
    expect(host.querySelector(".outline-emerald-500")).not.toBeNull()

    pathScope.value = "src/components/Second.astro|"
    documentModel.value = trackedModel("Second")
    await nextTick()
    const secondTrack = latestTrackMessage(postMessage.mock.calls)
    const secondRevision = secondTrack?.trackingRevision as number
    expect(secondTrack).toMatchObject({
      scope: "src/components/Second.astro|",
      paths: ["src/components/Second.astro|0", "0.4"],
    })
    expect(secondRevision).toBeGreaterThan(firstRevision)
    expect(host.querySelector('[data-overlay="toolbar"]')).toBeNull()

    window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow,
      origin,
      data: {
        type: ARIA_MSG.rects,
        trackingRevision: firstRevision,
        rects: {
          "src/components/Second.astro|0": [{ x: 900, y: 900, w: 1, h: 1 }],
          "0.4": [{ x: 10, y: 10, w: 400, h: 300 }],
        },
        classes: {},
        owners: {},
      },
    }))
    await nextTick()
    expect(host.querySelector('[data-overlay="toolbar"]')).toBeNull()

    window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow,
      origin,
      data: {
        type: ARIA_MSG.rects,
        trackingRevision: secondRevision,
        rects: {
          "src/components/Second.astro|0": [{ x: 30, y: 40, w: 220, h: 90 }],
          "0.4": [{ x: 10, y: 10, w: 400, h: 300 }],
        },
        classes: {},
        owners: {},
      },
    }))
    await nextTick()
    expect(host.querySelector('[data-overlay="toolbar"]')).not.toBeNull()
    expect(host.querySelectorAll('button[aria-label^="Resize "]')).toHaveLength(8)
    expect(host.querySelector("iframe")).toBe(frame)

    pathScope.value = "src/components/First.astro|"
    documentModel.value = trackedModel("First again")
    await nextTick()
    const reentryTrack = latestTrackMessage(postMessage.mock.calls)
    expect(reentryTrack?.trackingRevision).toEqual(expect.any(Number))
    expect(reentryTrack?.trackingRevision as number).toBeGreaterThan(secondRevision)
    expect(reentryTrack).toMatchObject({
      scope: "src/components/First.astro|",
      paths: ["src/components/First.astro|0", "0.4"],
    })
    expect(host.querySelector("iframe")).toBe(frame)
  })
})
