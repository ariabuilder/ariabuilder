// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import IconPickerDialog from "@/components/ui/icon-picker/IconPickerDialog.vue"
import CollectionSettingsPanel from "@/workspace/studio/collections/components/CollectionSettingsPanel.vue"
import MediaPickerDialog from "@/workspace/studio/media/components/MediaPickerDialog.vue"

const designMocks = vi.hoisted(() => ({
  getDesignSnapshot: vi.fn(),
  detectIconRuntime: vi.fn(),
  searchProjectIcons: vi.fn(),
  resolveProjectIcons: vi.fn(),
}))

const mediaMocks = vi.hoisted(() => ({
  listMedia: vi.fn(),
  uploadMedia: vi.fn(),
  previewMedia: vi.fn(),
  getMediaGrouping: vi.fn(),
  updateMediaGrouping: vi.fn(),
}))

const workspaceMocks = vi.hoisted(() => ({
  getCollections: vi.fn(),
  scanWorkspace: vi.fn(),
  updateCollections: vi.fn(),
}))

vi.mock("@/lib/design", () => designMocks)
vi.mock("@/lib/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media")>()),
  ...mediaMocks,
}))
vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace")>()),
  ...workspaceMocks,
}))

async function settle(): Promise<void> {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("picker dialogs", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    mediaMocks.getMediaGrouping.mockResolvedValue({ groups: [], assignments: {} })
    mediaMocks.updateMediaGrouping.mockResolvedValue({ groups: [], assignments: {} })
    workspaceMocks.scanWorkspace.mockResolvedValue({ pages: [] })
    workspaceMocks.updateCollections.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ""
  })

  it("selects a project media asset from a labelled keyboard grid option", async () => {
    const selected: unknown[] = []
    const openUpdates: boolean[] = []
    mediaMocks.listMedia.mockResolvedValue([
      {
        id: "public/uploads/hero.png",
        name: "Hero",
        type: "image",
        file: "public/uploads/hero.png",
        url: "/uploads/hero.png",
        size: 10,
        mimeType: "image/png",
        mtimeMs: 1,
        dimensions: null,
        cropCount: 0,
      },
      {
        id: "public/uploads/card.png",
        name: "Card",
        type: "image",
        file: "public/uploads/card.png",
        url: "/uploads/card.png",
        size: 8,
        mimeType: "image/png",
        mtimeMs: 1,
        dimensions: null,
        cropCount: 0,
      },
    ])
    mediaMocks.previewMedia.mockResolvedValue({ dataUrl: "data:image/png;base64,AA==" })

    const app = createApp({
      render: () =>
        h(MediaPickerDialog, {
          open: true,
          projectRoot: "/project",
          mediaTypes: ["image"],
          onSelect: (asset: unknown) => selected.push(asset),
          "onUpdate:open": (open: boolean) => openUpdates.push(open),
        }),
    })
    const host = document.createElement("div")
    document.body.append(host)
    app.mount(host)
    await settle()

    const option = document.querySelector<HTMLButtonElement>(
      '[role="gridcell"][aria-label="Select Hero"]',
    )
    expect(option).not.toBeNull()
    expect(option?.tabIndex).toBe(0)
    option?.focus()
    option?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    await nextTick()
    const nextOption = document.querySelector<HTMLButtonElement>(
      '[role="gridcell"][aria-label="Select Card"]',
    )
    expect(document.activeElement).toBe(nextOption)
    nextOption?.click()
    await nextTick()
    expect(selected).toHaveLength(1)
    expect(openUpdates).toContain(false)
    app.unmount()
  })

  it("loads enabled installed packs and emits the stored icon value", async () => {
    const selected: string[] = []
    const openUpdates: boolean[] = []
    designMocks.getDesignSnapshot.mockResolvedValue({
      icons: { enabledPacks: ["lucide", "mdi"] },
    })
    designMocks.detectIconRuntime.mockResolvedValue({
      hasAstroIcon: true,
      hasIntegration: true,
      installedJsonPrefixes: ["lucide", "mdi"],
    })
    designMocks.searchProjectIcons.mockImplementation(
      async (_root: string, request: { pack: string }) => ({
        items: [{
          id: `${request.pack}:star`,
          pack: request.pack,
          name: "star",
          label: `${request.pack === "mdi" ? "MDI" : "Lucide"} Star`,
        }],
        nextCursor: null,
        snapshotVersion: `${request.pack}:1`,
      }),
    )
    designMocks.resolveProjectIcons.mockImplementation(
      async (_root: string, ids: string[]) => ({
        icons: Object.fromEntries(ids.map((id) => [
          id,
          {
            id,
            dataUrl: "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E",
            viewBox: "0 0 24 24",
            snapshotVersion: `${id.split(":")[0]}:1`,
          },
        ])),
        missing: [],
      }),
    )

    const app = createApp({
      render: () =>
        h(IconPickerDialog, {
          open: true,
          projectRoot: "/project",
          onSelect: (value: string) => selected.push(value),
          "onUpdate:open": (open: boolean) => openUpdates.push(open),
        }),
    })
    const host = document.createElement("div")
    document.body.append(host)
    app.mount(host)
    await settle()

    const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
    const dialogClasses = dialog?.className.split(/\s+/) ?? []
    expect(dialogClasses).toContain("max-h-[min(80dvh,720px)]!")
    expect(dialogClasses).not.toContain("h-[min(80dvh,720px)]!")

    const packTabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    packTabs[0]?.focus()
    packTabs[0]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    )
    await settle()
    expect(packTabs[1]?.getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(packTabs[1])

    const option = document.querySelector<HTMLButtonElement>(
      '[role="gridcell"][aria-label="Select MDI Star"]',
    )
    expect(option).not.toBeNull()
    expect(option?.getAttribute("aria-pressed")).toBe("false")
    option?.click()
    await nextTick()
    expect(selected).toEqual(["i-mdi:star"])
    expect(openUpdates).toContain(false)
    app.unmount()
  })

  it("edits a collection icon through the picker without a flat icon field", async () => {
    const collection = {
      id: "blog",
      name: "blog",
      label: "Blog",
      kind: "content" as const,
      scope: "global" as const,
      icon: null,
      urlPattern: null,
      listPageFile: null,
      templatePageFile: null,
      supports: [],
      schema: { fields: [], version: 1 },
    }
    workspaceMocks.getCollections.mockResolvedValue({ collections: [collection] })
    designMocks.getDesignSnapshot.mockResolvedValue({
      icons: { enabledPacks: ["lucide"] },
    })
    designMocks.detectIconRuntime.mockResolvedValue({
      hasAstroIcon: true,
      hasIntegration: true,
      installedJsonPrefixes: ["lucide"],
    })
    designMocks.searchProjectIcons.mockResolvedValue({
      items: [{
        id: "lucide:newspaper",
        pack: "lucide",
        name: "newspaper",
        label: "Newspaper",
      }],
      nextCursor: null,
      snapshotVersion: "lucide:1",
    })
    designMocks.resolveProjectIcons.mockResolvedValue({
      icons: {
        "lucide:newspaper": {
          id: "lucide:newspaper",
          dataUrl: "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E",
          viewBox: "0 0 24 24",
          snapshotVersion: "lucide:1",
        },
      },
      missing: [],
    })

    const app = createApp({
      render: () => h(CollectionSettingsPanel, {
        collection,
        projectRoot: "/project",
        embedded: true,
      }),
    })
    const host = document.createElement("div")
    document.body.append(host)
    app.mount(host)
    await settle()

    expect(document.querySelector("#collection-settings-icon")).toBeNull()
    const trigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="Choose collection icon"]',
    )
    expect(trigger).not.toBeNull()
    trigger?.click()
    await settle()

    document.querySelector<HTMLButtonElement>(
      '[aria-label="Select Newspaper"]',
    )?.click()
    await settle()

    const save = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Save settings")
    save?.click()
    await settle()

    expect(workspaceMocks.updateCollections).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        collections: [expect.objectContaining({ icon: "i-lucide:newspaper" })],
      }),
    )
    app.unmount()
  })
})
