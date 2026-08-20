// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, nextTick } from "vue"

const mocks = vi.hoisted(() => ({
  assessCollectionMigration: vi.fn(),
  migrateCollectionToAria: vi.fn(),
}))

vi.mock("@/lib/workspace", () => mocks)

import MigrateCollectionDialog from "@/workspace/studio/collections/dialogs/MigrateCollectionDialog.vue"

const mounted: Array<() => void> = []

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

async function flushUi(): Promise<void> {
  await Promise.resolve()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

describe("MigrateCollectionDialog", () => {
  it("shows a plain confirmation, imports the reviewed snapshot, and reports completion", async () => {
    mocks.assessCollectionMigration.mockResolvedValue({
      previewHash: "a".repeat(64),
      generatedAt: "2026-08-13T12:00:00.000Z",
      collection: { id: "external-projects", name: "projects", label: "Projects" },
      source: {
        kind: "external-build",
        provider: "external",
        label: "External CMS",
        mode: "build-time",
        readOnly: true,
        schemaAvailable: true,
        cacheState: "fresh",
      },
      entryCount: 6,
      locales: [],
      fields: [],
      initialImportStatus: "draft",
      mutatesExternalSource: true,
      requiresExplicitMapping: false,
    })
    mocks.migrateCollectionToAria.mockResolvedValue({
      ok: true,
      collectionId: "managed-projects",
      collectionName: "projects",
      importedEntries: 6,
      initialStatus: "draft",
      sourceChanged: true,
      routesChanged: false,
    })

    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp(MigrateCollectionDialog, {
      open: true,
      projectRoot: "/project",
      collectionId: "external-projects",
      collectionLabel: "Projects",
      sourceLabel: "External CMS",
    })
    app.mount(host)
    mounted.push(() => app.unmount())
    await flushUi()

    expect(document.body.textContent).toContain("Migrate to Aria Collections")
    expect(document.body.textContent).toContain("Aria is ready to migrate 6 entries from External CMS")
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain("6 entries are ready to migrate")
    expect(document.body.textContent).not.toContain("Preview hash")
    expect(document.body.textContent).not.toContain("a".repeat(64))

    const importButton = [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Migrate collection"))
    importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await flushUi()

    expect(mocks.migrateCollectionToAria).toHaveBeenCalledWith(
      "/project",
      "external-projects",
      "a".repeat(64),
    )
    expect(document.body.textContent).toContain("Migration complete")
    expect(document.body.textContent).toContain("6 entries were migrated as drafts")
    expect(document.body.textContent).toContain("View collection")
  })
})
