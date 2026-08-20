import { nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useConditionCollections } from "./useConditionCollections"

const mocks = vi.hoisted(() => ({ getCollections: vi.fn() }))

vi.mock("@/lib/workspace", () => ({ getCollections: mocks.getCollections }))

afterEach(() => mocks.getCollections.mockReset())

describe("useConditionCollections", () => {
  it("loads collection schemas only after condition authoring opens", async () => {
    mocks.getCollections.mockResolvedValue({
      collections: [{
        id: "posts",
        name: "posts",
        label: "Posts",
        kind: "content",
        urlPattern: null,
        listPageFile: null,
        templatePageFile: null,
      }],
    })
    const open = ref(false)
    const projectPath = ref("/project")
    const state = useConditionCollections(open, projectPath)

    await nextTick()
    expect(mocks.getCollections).not.toHaveBeenCalled()

    open.value = true
    await vi.waitFor(() => expect(mocks.getCollections).toHaveBeenCalledWith("/project"))
    await vi.waitFor(() => expect(state.collections.value).toHaveLength(1))

    open.value = false
    await nextTick()
    open.value = true
    await nextTick()
    expect(mocks.getCollections).toHaveBeenCalledTimes(1)
  })

  it("clears stale schemas and reloads when the project changes", async () => {
    mocks.getCollections
      .mockResolvedValueOnce({ collections: [{ id: "one", name: "one", label: "One", kind: "content", urlPattern: null, listPageFile: null, templatePageFile: null }] })
      .mockResolvedValueOnce({ collections: [{ id: "two", name: "two", label: "Two", kind: "content", urlPattern: null, listPageFile: null, templatePageFile: null }] })
    const open = ref(true)
    const projectPath = ref("/one")
    const state = useConditionCollections(open, projectPath)
    await vi.waitFor(() => expect(state.collections.value[0]?.id).toBe("one"))

    projectPath.value = "/two"
    await vi.waitFor(() => expect(mocks.getCollections).toHaveBeenCalledWith("/two"))
    await vi.waitFor(() => expect(state.collections.value[0]?.id).toBe("two"))
  })
})
