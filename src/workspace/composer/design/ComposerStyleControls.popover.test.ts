// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AstroDocumentModel } from "../../../../shared/composer/types"
import { provideComposerBeacon } from "../selection/useComposerBeacon"
import { provideInspectorContext } from "../inspector/useInspectorContext"
import { provideComposerDocument, type ComposerDocumentSession } from "../useComposerDocumentSession"
import ComposerStyleControls from "./ComposerStyleControls.vue"
import ComposerPseudoSelector from "./ComposerPseudoSelector.vue"

const mounted: Array<() => void> = []

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("Composer Popover design controls", () => {
  it("adds placement and gap controls only for native Popover targets", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const style = "inset: auto; margin: 0.75rem; position-area: block-end; position-try-fallbacks: flip-block, flip-inline"
    const model = ref<AstroDocumentModel | null>({
      imports: [], extraFrontmatter: "", propSchema: [], slots: [], extendsTag: null,
      nodes: [{ id: "menu", kind: "element", name: "div", props: {
        id: { type: "string", value: "menu" },
        popover: { type: "bare" },
        style: { type: "string", value: style },
      }, children: [] }],
    })
    const InspectorHost = defineComponent({
      setup() {
        provideInspectorContext()
        return () => h(ComposerStyleControls, {
          styleText: style,
          isExpr: false,
          defaultSection: "popover",
          currentBreakpoint: "base",
        })
      },
    })
    const app = createApp(defineComponent({
      setup() {
        const beacon = provideComposerBeacon()
        beacon.illuminate("0")
        provideComposerDocument({
          model,
          editable: ref(true),
          designActive: ref(true),
          projectPath: ref("/project"),
          editFile: ref("src/pages/index.astro"),
          availableLayouts: ref([]),
          pages: ref([]),
          documentKind: ref("page"),
          previewStyle: vi.fn(),
          clearPreviewStyle: vi.fn(),
          computedStyle: vi.fn(async () => ({})),
        } as unknown as ComposerDocumentSession)
        return () => h(InspectorHost)
      },
    }))
    app.mount(host)
    mounted.push(() => { app.unmount(); host.remove() })
    await nextTick()

    expect(host.querySelector('[data-inspector-section="Popover"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Popover placement"]')?.textContent).toContain("Below center")
    expect([...host.querySelectorAll<HTMLInputElement>("input")].find((input) => input.value === "0.75rem")).toBeTruthy()
    expect(host.textContent).toContain("flips when space is limited")
  })

  it("offers the open state and backdrop as Popover pseudo selectors", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp({ render: () => h(ComposerPseudoSelector, { modelValue: "default" }) })
    app.mount(host)
    mounted.push(() => { app.unmount(); host.remove() })
    const trigger = host.querySelector("button") as HTMLButtonElement
    trigger.click()
    await vi.waitFor(() => expect(document.body.textContent).toContain("Popover"))
    const category = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Popover")!
    category.click()
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(":popover-open")
      expect(document.body.textContent).toContain("::backdrop")
    })
  })
})
