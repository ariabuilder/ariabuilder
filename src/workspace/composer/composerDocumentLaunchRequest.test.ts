import { afterEach, describe, expect, it } from "vitest"
import {
  composerDocumentLaunchTicket,
  peekComposerDocumentLaunchRequest,
  requestComposerDocumentLaunch,
  takeComposerDocumentLaunchRequest,
} from "./composerDocumentLaunchRequest"

afterEach(() => {
  // Drain any leftover pending request between tests.
  takeComposerDocumentLaunchRequest()
  takeComposerDocumentLaunchRequest("/project/a")
  takeComposerDocumentLaunchRequest("/project/b")
})

describe("composerDocumentLaunchRequest", () => {
  it("queues a launch and bumps the ticket so already-mounted Composer can react", () => {
    const before = composerDocumentLaunchTicket()

    requestComposerDocumentLaunch({
      mode: "standalone-component",
      kind: "layout",
      name: "Base",
      file: "src/layouts/Base.astro",
    })

    expect(composerDocumentLaunchTicket()).toBe(before + 1)
    expect(peekComposerDocumentLaunchRequest()).toEqual({
      mode: "standalone-component",
      kind: "layout",
      name: "Base",
      file: "src/layouts/Base.astro",
    })

    const taken = takeComposerDocumentLaunchRequest()
    expect(taken && "file" in taken ? taken.file : null).toBe(
      "src/layouts/Base.astro",
    )
    expect(peekComposerDocumentLaunchRequest()).toBeNull()
    // Clearing pending must not re-trigger watchers via the ticket.
    expect(composerDocumentLaunchTicket()).toBe(before + 1)
  })

  it("replaces a pending launch and bumps the ticket again", () => {
    const before = composerDocumentLaunchTicket()

    requestComposerDocumentLaunch({
      mode: "standalone-component",
      kind: "layout",
      name: "Base",
      file: "src/layouts/Base.astro",
    })
    requestComposerDocumentLaunch({
      mode: "standalone-component",
      kind: "layout",
      name: "Blog",
      file: "src/layouts/Blog.astro",
    })

    expect(composerDocumentLaunchTicket()).toBe(before + 2)
    const taken = takeComposerDocumentLaunchRequest()
    expect(taken && "file" in taken ? taken.file : null).toBe(
      "src/layouts/Blog.astro",
    )
  })

  it("keeps launch requests isolated by project", () => {
    requestComposerDocumentLaunch({
      mode: "standalone-component",
      kind: "component",
      name: "Alpha",
      file: "src/components/Alpha.astro",
    }, "/project/a")
    requestComposerDocumentLaunch({
      mode: "standalone-component",
      kind: "component",
      name: "Beta",
      file: "src/components/Beta.astro",
    }, "/project/b")

    expect(peekComposerDocumentLaunchRequest("/project/a")).toMatchObject({
      file: "src/components/Alpha.astro",
    })
    expect(peekComposerDocumentLaunchRequest("/project/b")).toMatchObject({
      file: "src/components/Beta.astro",
    })
    expect(takeComposerDocumentLaunchRequest("/project/a")).toMatchObject({
      file: "src/components/Alpha.astro",
    })
    expect(peekComposerDocumentLaunchRequest("/project/b")).toMatchObject({
      file: "src/components/Beta.astro",
    })
  })
})
