// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AstroDocumentModel, ElementNode } from "../../../../shared/composer/types"
import { provideComposerBeacon } from "../selection/useComposerBeacon"
import {
  provideComposerDocument,
  type ComposerDocumentSession,
} from "../useComposerDocumentSession"
import { provideInspectorContext } from "../inspector/useInspectorContext"
import ComposerDesignPanel from "./ComposerDesignPanel.vue"

const mockState = vi.hoisted(() => ({
  content: null as ReturnType<typeof ref<string>> | null,
}))

vi.mock("@/workspace/design/composables/useClassManagerInventory", async () => {
  const { ref } = await import("vue")
  return {
    useClassManagerInventory: () => {
      const content = ref("")
      const diskContent = ref("")
      mockState.content = content
      return {
        selectedPath: ref("src/styles/global.css"),
        content,
        diskContent,
        mtimeMs: ref(1),
        error: ref<string | null>(null),
        classEntries: ref([]),
        bootstrap: vi.fn().mockResolvedValue(undefined),
        loadFile: vi.fn().mockResolvedValue(undefined),
        createClass: vi.fn((name: string, css = "") => {
          content.value = `.${name} {\n  ${css};\n}\n`
          return name
        }),
        adoptSavedContent: vi.fn((next: string) => {
          content.value = next
          diskContent.value = next
        }),
      }
    },
  }
})

vi.mock("@/composables/useVariableReferenceOptions", async () => {
  const { ref } = await import("vue")
  return {
    useVariableReferenceOptions: () => ({ variableReferenceOptions: ref([]) }),
  }
})

vi.mock("./ComposerStyleControls.vue", async () => {
  const { defineComponent, h } = await import("vue")
  return {
    default: defineComponent({
      emits: ["setStyle"],
      setup(_, { emit }) {
        const select = (family: string) => emit(
          "setStyle",
          { type: "string", value: `font-family: ${family}` },
          true,
        )
        return () => h("div", [
          h("button", {
            "data-testid": "font-inter",
            onClick: () => select("Inter"),
          }, "Inter"),
          h("button", {
            "data-testid": "font-outfit",
            onClick: () => select("Outfit"),
          }, "Outfit"),
        ])
      },
    }),
  }
})

vi.mock("./ComposerClassEditor.vue", async () => {
  const { defineComponent } = await import("vue")
  return { default: defineComponent({ render: () => null }) }
})

vi.mock("./ComposerContentAttributes.vue", async () => {
  const { defineComponent } = await import("vue")
  return { default: defineComponent({ render: () => null }) }
})

vi.mock("@/workspace/design/dialogs/ClassManagerCssDialog.vue", async () => {
  const { defineComponent } = await import("vue")
  return { default: defineComponent({ render: () => null }) }
})

vi.mock("@/workspace/design/dialogs/ClassManagerNameDialog.vue", async () => {
  const { defineComponent } = await import("vue")
  return { default: defineComponent({ render: () => null }) }
})

const mounted: Array<() => void> = []

function documentFor(node: ElementNode): AstroDocumentModel {
  return {
    imports: [],
    extraFrontmatter: "",
    nodes: [node],
    propSchema: [],
    slots: [],
    extendsTag: null,
  }
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  mockState.content = null
})

describe("ComposerDesignPanel repeated font commits", () => {
  it("repaints the latest font after the first edit creates an automatic class", async () => {
    let finishAutomaticClass: () => void = () => undefined
    const automaticClassGate = new Promise<void>((resolve) => {
      finishAutomaticClass = resolve
    })
    const heading: ElementNode = {
      id: "heading",
      kind: "element",
      name: "h1",
      props: {},
      children: [],
    }
    const model = ref<AstroDocumentModel | null>(documentFor(heading))
    const previewStyle = vi.fn()
    const commitModelWithStylesheet = vi.fn(async (
      mutate: (model: AstroDocumentModel) => { ok?: boolean } | void,
    ) => {
      await automaticClassGate
      if (model.value) mutate(model.value)
      return [
        { relativeFile: "src/pages/index.astro", mtimeMs: 2 },
        { relativeFile: "src/styles/global.css", mtimeMs: 2 },
      ]
    })
    const InspectorHost = defineComponent({
      setup() {
        provideInspectorContext()
        return () => h(ComposerDesignPanel)
      },
    })
    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp({
      setup() {
        const beacon = provideComposerBeacon()
        beacon.illuminate("0")
        provideComposerDocument({
          model,
          editable: ref(true),
          mutationPending: ref(false),
          designActive: ref(true),
          saveError: ref(null),
          projectPath: ref("/tmp/project"),
          editFile: ref("src/pages/index.astro"),
          availableLayouts: ref([]),
          pages: ref([]),
          documentKind: ref("page"),
          registerBeforeFlush: () => () => undefined,
          flushSave: vi.fn().mockResolvedValue(undefined),
          commitModelWithStylesheet,
          commitStylesheetEdit: vi.fn().mockResolvedValue({
            relativeFile: "src/styles/global.css",
            mtimeMs: 3,
          }),
          previewStyle,
          clearPreviewStyle: vi.fn(),
        } as unknown as ComposerDocumentSession)
        return () => h(InspectorHost)
      },
    })
    app.mount(host)
    mounted.push(() => {
      app.unmount()
      host.remove()
    })

    ;(host.querySelector('[data-testid="font-inter"]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(commitModelWithStylesheet).toHaveBeenCalledOnce())
    ;(host.querySelector('[data-testid="font-outfit"]') as HTMLButtonElement).click()
    finishAutomaticClass()

    await vi.waitFor(() => {
      expect(mockState.content?.value).toContain("font-family: Outfit")
      expect(previewStyle).toHaveBeenLastCalledWith("0", "font-family: Outfit !important")
    })
    await nextTick()
  })
})
