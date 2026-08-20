import { describe, expect, it } from "vitest"
import { composerPreviewRouteMismatch } from "./previewRouteState"

describe("composerPreviewRouteMismatch", () => {
  it("treats matching and trailing-slash paths as aligned", () => {
    expect(composerPreviewRouteMismatch({
      selectedPath: "/about",
      renderedPath: "/about/",
    })).toBeNull()
    expect(composerPreviewRouteMismatch({
      selectedPath: "/",
      renderedPath: "/",
    })).toBeNull()
  })

  it("reports a middleware redirect", () => {
    expect(composerPreviewRouteMismatch({
      selectedPath: "/",
      renderedPath: "/auth",
    })).toEqual({ selectedPath: "/", renderedPath: "/auth" })
  })

  it("waits for the rendered pathname before declaring a mismatch", () => {
    expect(composerPreviewRouteMismatch({
      selectedPath: "/",
      renderedPath: null,
    })).toBeNull()
  })
})
