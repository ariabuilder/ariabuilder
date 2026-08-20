import { describe, expect, it, vi } from "vitest"
import {
  composerAuthoringPreviewReady,
  waitForComposerAuthoringPreview,
} from "./composerAuthoringPreview"

function htmlResponse(html: string, ok = true): Response {
  return {
    ok,
    text: async () => html,
  } as Response
}

describe("composer authoring preview wait", () => {
  it("treats the harness marker as ready only for the requested component", () => {
    const html = `<body data-aria-component-authoring="src/components/Header.astro"></body>`
    expect(composerAuthoringPreviewReady(html, "src/components/Header.astro")).toBe(true)
    expect(composerAuthoringPreviewReady(html, "src/components/Footer.astro")).toBe(false)
    expect(composerAuthoringPreviewReady("<body></body>", "src/components/Header.astro")).toBe(false)
  })

  it("resolves when the authoring route HTML contains the target marker", async () => {
    const fetchImpl = vi.fn(async () =>
      htmlResponse(`<body data-aria-component-authoring="src/components/Hero.astro"></body>`),
    )
    await waitForComposerAuthoringPreview({
      previewUrl: "http://127.0.0.1:4321/",
      route: "/__aria/component-authoring",
      componentFile: "src/components/Hero.astro",
      fetchImpl,
      timeoutMs: 1_000,
      intervalMs: 10,
    })
    expect(fetchImpl).toHaveBeenCalled()
    const requested = String(fetchImpl.mock.calls.at(0)?.at(0) ?? "")
    expect(requested).toContain("/__aria/component-authoring")
    expect(requested).toContain("t=")
  })

  it("retries while the placeholder body stays empty, then resolves", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse("<body></body>"))
      .mockResolvedValueOnce(
        htmlResponse(`<body data-aria-component-authoring="src/components/Hero.astro"></body>`),
      )
    await waitForComposerAuthoringPreview({
      previewUrl: "http://127.0.0.1:4321/",
      route: "/__aria/component-authoring",
      componentFile: "src/components/Hero.astro",
      fetchImpl,
      now: (() => {
        let t = 0
        return () => {
          t += 1
          return t
        }
      })(),
      sleep: async () => undefined,
      timeoutMs: 20,
      intervalMs: 1,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("rejects when the authoring route never leaves the empty placeholder", async () => {
    const fetchImpl = vi.fn(async () => htmlResponse("<body></body>"))
    await expect(
      waitForComposerAuthoringPreview({
        previewUrl: "http://127.0.0.1:4321/",
        route: "/__aria/component-authoring",
        componentFile: "src/components/Hero.astro",
        fetchImpl,
        now: (() => {
          let t = 0
          return () => {
            t += 10
            return t
          }
        })(),
        sleep: async () => undefined,
        timeoutMs: 25,
        intervalMs: 10,
      }),
    ).rejects.toThrow("The isolated component preview did not become ready.")
  })
})
