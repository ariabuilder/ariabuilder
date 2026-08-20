// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AstroDocumentModel } from "../../../../shared/composer/types"
import { provideComposerBeacon } from "../selection/useComposerBeacon"
import { provideInspectorContext } from "../inspector/useInspectorContext"
import {
  provideComposerDocument,
  type ComposerDocumentSession,
} from "../useComposerDocumentSession"
import ComposerPropsPanel from "./ComposerPropsPanel.vue"

const mocks = vi.hoisted(() => ({
  extractComposerPropSchema: vi.fn(),
}))

vi.mock("@/lib/composer", () => ({
  extractComposerPropSchema: mocks.extractComposerPropSchema,
}))

vi.mock("@/workspace/studio/media/components/ProjectImagePickerField.vue", () => ({
  default: defineComponent({
    props: {
      modelValue: { type: String, default: "" },
      disabled: { type: Boolean, default: false },
    },
    emits: ["update:modelValue"],
    setup(props, { emit }) {
      return () => h("button", {
        type: "button",
        disabled: props.disabled,
        "data-testid": "site-icon-picker",
        onClick: () => emit("update:modelValue", "/replacement.png"),
      }, props.modelValue)
    },
  }),
}))

vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace")>()),
  getCollections: vi.fn().mockResolvedValue({ collections: [] }),
  listExternalEntries: vi.fn().mockResolvedValue({ items: [], fields: [] }),
}))

const mounted: Array<() => void> = []

afterEach(() => {
  mocks.extractComposerPropSchema.mockReset()
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ComposerPropsPanel site icons", () => {
  it("keeps each literal icon variant independent and hides raw attributes", async () => {
    const model = ref<AstroDocumentModel | null>({
      imports: [],
      extraFrontmatter: "",
      propSchema: [],
      slots: [],
      extendsTag: null,
      nodes: [{
        id: "icon-32",
        kind: "element",
        name: "link",
        props: {
          rel: { type: "string", value: "icon" },
          type: { type: "string", value: "image/png" },
          sizes: { type: "string", value: "32x32" },
          href: { type: "string", value: "/favicon-32x32.png" },
        },
        children: [],
      }],
    })
    const setSelectedProp = vi.fn()
    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp(defineComponent({
      setup() {
        const beacon = provideComposerBeacon()
        provideComposerDocument({
          model,
          editable: ref(true),
          designActive: ref(true),
          projectPath: ref("/project"),
          editFile: ref("src/layouts/Layout.astro"),
          availableLayouts: ref([]),
          pages: ref([]),
          documentKind: ref("layout"),
          setSelectedProp,
          commitInspectorMutation: vi.fn(),
          popoverPreviewTargetId: ref(null),
          previewPopover: vi.fn(),
        } as unknown as ComposerDocumentSession)
        provideInspectorContext()
        beacon.illuminate("0")
        return () => h(ComposerPropsPanel)
      },
    }))
    app.mount(host)
    mounted.push(() => { app.unmount(); host.remove() })
    await nextTick()

    expect(host.querySelector('[data-testid="site-icon-picker"]')?.textContent)
      .toContain("/favicon-32x32.png")
    expect(host.textContent).toContain("32x32")
    expect(host.textContent).toContain("image/png")
    expect(host.textContent).not.toContain("Advanced attributes")
    expect(host.querySelector('input[id="composer-document-primary"]')).toBeNull()

    host.querySelector<HTMLButtonElement>('[data-testid="site-icon-picker"]')?.click()
    await nextTick()
    expect(setSelectedProp).toHaveBeenCalledWith(
      "href",
      { type: "string", value: "/replacement.png" },
      { immediate: false },
    )
  })
})
