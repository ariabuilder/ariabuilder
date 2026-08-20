import { effectScope, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useCmsEntriesList } from "@/workspace/studio/collections/composables/useCmsEntriesList"

const cmsMocks = vi.hoisted(() => ({
  listCmsEntries: vi.fn(),
}))

vi.mock("@/lib/cms", () => cmsMocks)

describe("useCmsEntriesList", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("does not query the managed CMS while a picker is closed", async () => {
    cmsMocks.listCmsEntries.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 50,
    })
    const enabled = ref(false)
    const scope = effectScope()

    scope.run(() => {
      useCmsEntriesList(ref("/project"), ref("astro:content:authors"), enabled)
    })
    await nextTick()
    expect(cmsMocks.listCmsEntries).not.toHaveBeenCalled()

    enabled.value = true
    await nextTick()
    expect(cmsMocks.listCmsEntries).toHaveBeenCalledTimes(1)
    expect(cmsMocks.listCmsEntries).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({ collectionId: "astro:content:authors" }),
    )

    scope.stop()
  })
})
