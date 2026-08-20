import { computed, nextTick, reactive, watch } from "vue"
import { describe, expect, it, vi } from "vitest"
import { composerPageNavigationIdentity } from "./composerPageNavigation"

describe("Composer page navigation identity", () => {
  it("does not change when a workspace rescan replaces the same page inventory", async () => {
    const state = reactive({
      projectPath: "/project",
      selectedRoute: "/",
      pages: [{ route: "/", file: "src/pages/index.astro", mtimeMs: 1 }],
    })
    const identity = computed(() => {
      const selected = state.pages.find((page) => page.route === state.selectedRoute) ?? null
      return composerPageNavigationIdentity({
        projectPath: state.projectPath,
        selectedRoute: state.selectedRoute,
        selectedPageFile: selected?.file ?? null,
      })
    })
    const changed = vi.fn()
    const stop = watch(identity, changed)

    state.pages = [{ route: "/", file: "src/pages/index.astro", mtimeMs: 2 }]
    await nextTick()
    expect(changed).not.toHaveBeenCalled()

    state.pages = [{ route: "/", file: "src/pages/home.astro", mtimeMs: 3 }]
    await nextTick()
    expect(changed).toHaveBeenCalledOnce()
    stop()
  })
})
