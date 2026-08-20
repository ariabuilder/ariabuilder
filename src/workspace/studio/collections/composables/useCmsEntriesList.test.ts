// @vitest-environment jsdom

import {
  createApp,
  defineComponent,
  h,
  KeepAlive,
  nextTick,
  ref,
} from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AriaEntryRecord, EntryStatus } from "../../../../../shared/cms"
import { useCmsEntriesList } from "./useCmsEntriesList"

const mocks = vi.hoisted(() => ({
  listCmsEntries: vi.fn(),
}))

vi.mock("@/lib/cms", () => ({
  listCmsEntries: mocks.listCmsEntries,
}))

const mountedApps: Array<ReturnType<typeof createApp>> = []

function entry(status: EntryStatus): AriaEntryRecord {
  const publishedAt = status === "published" ? "2026-08-16T11:40:04.697Z" : null
  return {
    entry: {
      id: "entry-1",
      collectionId: "blog",
      status,
      version: `version-${status}`,
      authorId: "local",
      createdAt: "2026-08-14T13:42:37.010Z",
      updatedAt: publishedAt ?? "2026-08-14T13:42:37.010Z",
      publishedAt,
    },
    locales: [
      {
        entryId: "entry-1",
        collectionId: "blog",
        locale: "en",
        slug: "third-post",
        title: "Third post",
        frontmatter: {},
        body: null,
        isSource: true,
      },
    ],
  }
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ""
  mocks.listCmsEntries.mockReset()
})

describe("useCmsEntriesList", () => {
  it("refreshes cached rows when the collection screen is reactivated", async () => {
    mocks.listCmsEntries
      .mockResolvedValueOnce({ items: [entry("draft")], total: 1, page: 1, limit: 50 })
      .mockResolvedValueOnce({ items: [entry("published")], total: 1, page: 1, limit: 50 })

    const showCollection = ref(true)
    const CollectionScreen = defineComponent({
      name: "CollectionScreen",
      setup() {
        const projectRoot = ref("/project")
        const collectionId = ref("blog")
        const { rows } = useCmsEntriesList(projectRoot, collectionId)
        return () => h("div", { "data-status": rows.value[0]?.status ?? "loading" })
      },
    })
    const EntryScreen = defineComponent({
      name: "EntryScreen",
      setup: () => () => h("div", "entry"),
    })
    const app = createApp(
      defineComponent({
        setup: () => () =>
          h(KeepAlive, null, {
            default: () =>
              showCollection.value ? h(CollectionScreen) : h(EntryScreen),
          }),
      }),
    )
    mountedApps.push(app)
    const host = document.createElement("div")
    document.body.append(host)
    app.mount(host)

    await vi.waitFor(() => {
      expect(host.querySelector("[data-status]")?.getAttribute("data-status")).toBe("draft")
    })
    expect(mocks.listCmsEntries).toHaveBeenCalledTimes(1)

    showCollection.value = false
    await nextTick()
    showCollection.value = true
    await nextTick()

    await vi.waitFor(() => {
      expect(host.querySelector("[data-status]")?.getAttribute("data-status")).toBe("published")
    })
    expect(mocks.listCmsEntries).toHaveBeenCalledTimes(2)
  })
})
