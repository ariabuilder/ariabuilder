import { describe, expect, it } from "vitest"
import {
  canCommitComposerDocumentLoad,
  composerExternalReloadFile,
  shouldPreserveComposerDocumentOnLoadFailure,
} from "./composerExternalReload"

const baseReload = {
  activeFile: "src/pages/index.astro",
  selectedPageFile: "src/pages/index.astro",
  drilling: false,
  standalone: false,
  reloadKey: 4,
  previousReloadKey: 4,
  pageMtimeMs: 20,
  previousPageMtimeMs: 20,
}

describe("Composer external reload routing", () => {
  it("reloads the active component for a global project refresh", () => {
    expect(composerExternalReloadFile({
      ...baseReload,
      activeFile: "src/components/Footer.astro",
      drilling: true,
      reloadKey: 5,
    })).toBe("src/components/Footer.astro")
  })

  it("reloads a changed page only while that page is active", () => {
    expect(composerExternalReloadFile({
      ...baseReload,
      pageMtimeMs: 21,
    })).toBe("src/pages/index.astro")

    expect(composerExternalReloadFile({
      ...baseReload,
      activeFile: "src/components/Footer.astro",
      drilling: true,
      pageMtimeMs: 21,
    })).toBeNull()

    expect(composerExternalReloadFile({
      ...baseReload,
      activeFile: "src/components/Footer.astro",
      standalone: true,
      pageMtimeMs: 21,
    })).toBeNull()
  })

  it("does not treat unchanged revisions as a reload during scope transitions", () => {
    expect(composerExternalReloadFile({
      ...baseReload,
      drilling: true,
    })).toBeNull()
    expect(composerExternalReloadFile(baseReload)).toBeNull()
  })
})

describe("Composer document load ownership", () => {
  it("allows only the newest load for the active target to commit", async () => {
    let currentGeneration = 0
    let activeFile: string | null = null
    const commits: string[] = []
    let releasePage!: () => void
    let releaseFooter!: () => void
    const pageReady = new Promise<void>((resolve) => { releasePage = resolve })
    const footerReady = new Promise<void>((resolve) => { releaseFooter = resolve })

    const load = async (requestedFile: string, ready: Promise<void>) => {
      const generation = ++currentGeneration
      activeFile = requestedFile
      await ready
      if (canCommitComposerDocumentLoad({
        generation,
        currentGeneration,
        requestedFile,
        activeFile,
      })) commits.push(requestedFile)
    }

    const pageLoad = load("src/pages/index.astro", pageReady)
    const footerLoad = load("src/components/Footer.astro", footerReady)
    releaseFooter()
    await footerLoad
    releasePage()
    await pageLoad

    expect(commits).toEqual(["src/components/Footer.astro"])
  })

  it("rejects a current generation whose model belongs to another file", () => {
    expect(canCommitComposerDocumentLoad({
      generation: 3,
      currentGeneration: 3,
      requestedFile: "src/components/Footer.astro",
      activeFile: "src/pages/index.astro",
    })).toBe(false)
  })
})

describe("Composer same-file load failure", () => {
  it("keeps an already loaded model when the same file fails to reload", () => {
    expect(shouldPreserveComposerDocumentOnLoadFailure({
      sameFile: true,
      hasLoadedModel: true,
    })).toBe(true)
  })

  it("clears the tree when the first open of a file fails", () => {
    expect(shouldPreserveComposerDocumentOnLoadFailure({
      sameFile: false,
      hasLoadedModel: false,
    })).toBe(false)
    expect(shouldPreserveComposerDocumentOnLoadFailure({
      sameFile: true,
      hasLoadedModel: false,
    })).toBe(false)
  })
})
