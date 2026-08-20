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

vi.mock("@/workspace/design/composables/useClassManagerInventory", async () => {
  const { ref } = await import("vue")
  return {
    useClassManagerInventory: () => ({
      selectedPath: ref("src/styles/global.css"),
      content: ref(""),
      diskContent: ref(""),
      mtimeMs: ref(1),
      error: ref<string | null>(null),
      classEntries: ref([]),
      bootstrap: vi.fn().mockResolvedValue(undefined),
      loadFile: vi.fn().mockResolvedValue(undefined),
      createClass: vi.fn(),
      adoptSavedContent: vi.fn(),
    }),
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
      props: { disabled: Boolean },
      setup(props) {
        return () => h("button", {
          "data-testid": "design-style-controls",
          disabled: props.disabled,
        }, "Opacity")
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

function mountDesignPanel(contextNode?: ElementNode) {
  const pageNode: ElementNode = {
    id: "page-node",
    kind: "element",
    name: "main",
    props: {},
    children: [],
  }
  const model = ref<AstroDocumentModel | null>(documentFor(pageNode))
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
      if (contextNode) {
        beacon.inspectContext({
          file: "src/layouts/BaseLayout.astro",
          path: "0",
          label: "Layout main",
          node: contextNode,
        })
      }
      provideComposerDocument({
        model,
        editable: ref(true),
        designActive: ref(true),
        saveError: ref(null),
        projectPath: ref("/tmp/project"),
        editFile: ref("src/pages/index.astro"),
        availableLayouts: ref([]),
        pages: ref([]),
        documentKind: ref("page"),
        registerBeforeFlush: () => () => undefined,
      } as unknown as ComposerDocumentSession)
      return () => h(InspectorHost)
    },
  })
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ComposerDesignPanel Opacity safety", () => {
  it("keeps related-file context selections read-only", async () => {
    const host = mountDesignPanel({
      id: "layout-node",
      kind: "element",
      name: "main",
      props: { style: { type: "string", value: "opacity: 0.44" } },
      children: [],
    })
    await nextTick()

    expect(
      (host.querySelector('[data-testid="design-style-controls"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(host.textContent).toContain("This document is read-only.")
  })

  it("keeps the active document selection editable", async () => {
    const host = mountDesignPanel()
    await nextTick()

    expect(
      (host.querySelector('[data-testid="design-style-controls"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })
})
