// @vitest-environment jsdom
import { createApp, defineComponent, h } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AriaCollectionDef } from "../../../../../shared/types"
import ExternalCollectionEntriesView from "./ExternalCollectionEntriesView.vue"

const mocks = vi.hoisted(() => ({
  listExternalEntries: vi.fn(),
}))

vi.mock("@/lib/workspace", () => ({
  listExternalEntries: mocks.listExternalEntries,
}))

const mounted: Array<() => void> = []

const collection: AriaCollectionDef = {
  id: "astro:content:blog",
  name: "blog",
  label: "Blog",
  kind: "content",
  urlPattern: null,
  listPageFile: null,
  templatePageFile: null,
  source: {
    kind: "astro-local",
    provider: "astro",
    label: "Local Astro",
    mode: "file",
    readOnly: true,
    adapter: "astro-glob",
    schemaAvailable: true,
    cacheState: "fresh",
  },
  capabilities: {
    read: true,
    refresh: true,
    writeEntry: false,
    createEntry: false,
    translate: false,
    publish: false,
    writeSchema: false,
    migrate: true,
  },
}

function mountView(onOpen: (entryId: string) => void): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp(defineComponent({
    setup: () => () => h(ExternalCollectionEntriesView, {
      projectRoot: "/project",
      collection,
      onOpen,
    }),
  }))
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}

afterEach(() => {
  mocks.listExternalEntries.mockReset()
  localStorage.clear()
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ExternalCollectionEntriesView", () => {
  it("matches managed table density and opens an entry from the whole row", async () => {
    mocks.listExternalEntries.mockResolvedValue({
      items: [{
        id: "welcome",
        data: {
          title: "Welcome",
          description: "First post",
          pubDate: "2026-08-01T12:00:00.000Z",
          image: "/post.jpg",
          author: "Andy",
          tags: "astro, aria",
        },
        filePath: "src/content/blog/welcome.md",
      }],
      fields: [
        { key: "title", label: "Title", type: "string", source: "schema", sortable: true, complex: false, image: false },
        { key: "description", label: "Description", type: "string", source: "schema", sortable: true, complex: false, image: false },
        { key: "pubDate", label: "PubDate", type: "datetime", source: "schema", sortable: true, complex: false, image: false },
        { key: "image", label: "Image", type: "string", source: "schema", sortable: true, complex: false, image: true },
        { key: "author", label: "Author", type: "string", source: "schema", sortable: true, complex: false, image: false },
        { key: "tags", label: "Tags", type: "string", source: "schema", sortable: true, complex: false, image: false },
      ],
      issues: [],
      total: 1,
      filteredTotal: 1,
      scannedTotal: 1,
      page: 1,
      limit: 50,
      truncated: false,
    })
    const onOpen = vi.fn()
    const host = mountView(onOpen)

    await vi.waitFor(() => {
      expect(host.querySelector("tbody tr")).not.toBeNull()
      expect(host.querySelector('[data-column-id="cover"]')).not.toBeNull()
      expect(host.querySelector('[data-column-id="field:description"]')).toBeNull()
    })
    const row = host.querySelector<HTMLElement>("tbody tr")!
    const cells = row.querySelectorAll<HTMLElement>("td")
    const table = row.closest("table")!

    expect(table.className).toContain("min-w-[72rem]")
    expect(row.className).toContain("h-12")
    expect(row.className).toContain("cursor-pointer")
    expect(row.className).toContain("hover:[box-shadow:inset_2px_0_0_0_var(--primary),inset_-2px_0_0_0_var(--primary)]")
    expect(cells[0]?.className).toContain("px-5")
    expect(cells[0]?.className).toContain("py-3")

    expect(cells[0]?.dataset.columnId).toBe("select")
    expect(cells[1]?.dataset.columnId).toBe("cover")
    expect(cells[2]?.dataset.columnId).toBe("field:title")
    expect(cells[1]?.querySelector(".h-6")).not.toBeNull()

    cells[cells.length - 1]!.click()
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith("welcome")

    onOpen.mockClear()
    const titleButton = row.querySelector<HTMLButtonElement>("button")!
    expect(titleButton.textContent).toContain("Welcome")
    titleButton.click()
    expect(onOpen).toHaveBeenCalledOnce()
  })
})
