// @vitest-environment jsdom

import { createApp, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ProjectRuntimeSession } from "@/lib/sessions"
import {
  ARIA_BRIDGE_ID,
  ARIA_MSG,
  ARIA_PROTOCOL_VERSION,
} from "../../../shared/composer/protocol"
import Stage from "./Stage.vue"

vi.mock("@/lib/thumbs", () => ({ captureThumbs: vi.fn() }))
const { restartSessionRuntime } = vi.hoisted(() => ({
  restartSessionRuntime: vi.fn(async () => undefined),
}))
vi.mock("@/lib/sessions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/sessions")>()
  return {
    ...original,
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

function mountStage(designMode = false) {
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

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("Stage warm frame swap", () => {
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
})
