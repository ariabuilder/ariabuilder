// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, ref, type Ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AstroDocumentModel, ElementNode } from "../../../../shared/composer/types"
import { createAlertPresetIcon } from "../../../../shared/composer"
import { provideComposerBeacon } from "../selection/useComposerBeacon"
import { provideComposerDocument, type ComposerDocumentSession } from "../useComposerDocumentSession"
import { provideInspectorContext } from "../inspector/useInspectorContext"
import ComposerBemPresetSection from "./ComposerBemPresetSection.vue"

const mounted: Array<() => void> = []

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

function documentFor(node: ElementNode): AstroDocumentModel {
  return { imports: [], extraFrontmatter: "", nodes: [node], propSchema: [], slots: [], extendsTag: null }
}

function alertNode(className = "aria-alert aria-alert--info"): ElementNode {
  return {
    id: "alert",
    kind: "element",
    name: "div",
    props: {
      "data-aria-type": { type: "string", value: "Alert" },
      class: { type: "string", value: className },
      role: { type: "string", value: "status" },
    },
    children: [createAlertPresetIcon("info")],
  }
}

function mountSection(model: Ref<AstroDocumentModel | null>) {
  const host = document.createElement("div")
  document.body.append(host)
  const commit = vi.fn((
    _label: string,
    mutation: (value: AstroDocumentModel) => { ok?: boolean } | void,
  ) => {
    if (!model.value) return false
    return mutation(model.value)?.ok !== false
  })
  const InspectorHost = defineComponent({
    setup() {
      provideInspectorContext()
      return () => h(ComposerBemPresetSection, {
        node: model.value?.nodes[0] as ElementNode,
        openSection: "variant",
      })
    },
  })
  const app = createApp({
    setup() {
      const beacon = provideComposerBeacon()
      beacon.illuminate("0")
      provideComposerDocument({
        model,
        editable: ref(true),
        designActive: ref(true),
        projectPath: ref(""),
        editFile: ref("src/pages/index.astro"),
        availableLayouts: ref([]),
        pages: ref([]),
        documentKind: ref("page"),
        commitInspectorMutation: commit,
      } as unknown as ComposerDocumentSession)
      return () => h(InspectorHost)
    },
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, commit }
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  vi.unstubAllGlobals()
})

describe("ComposerBemPresetSection", () => {
  it("switches an Alert preset and keeps a named variant", async () => {
    const model = ref<AstroDocumentModel | null>(documentFor(
      alertNode("aria-alert aria-alert--info aria-alert--products"),
    ))
    const { host } = mountSection(model)
    await nextTick()

    const warning = host.querySelector<HTMLButtonElement>('[data-bem-preset="warning"]')
    expect(warning).not.toBeNull()
    warning?.click()
    await nextTick()

    expect((model.value?.nodes[0] as ElementNode).props.class).toMatchObject({
      value: "aria-alert aria-alert--warning aria-alert--products",
    })
    const icon = (model.value?.nodes[0] as ElementNode).children?.[0]
    expect(icon?.kind === "element" ? icon.props["data-aria-alert-icon"] : null).toMatchObject({
      value: "warning",
    })
  })

  it("clears a Badge preset back to the default look", async () => {
    const model = ref<AstroDocumentModel | null>(documentFor({
      id: "badge",
      kind: "element",
      name: "span",
      props: {
        "data-aria-type": { type: "string", value: "Badge" },
        class: { type: "string", value: "aria-badge aria-badge--muted" },
      },
      children: [{ id: "text", kind: "text", value: "New" }],
    }))
    const { host } = mountSection(model)
    await nextTick()

    host.querySelector<HTMLButtonElement>('[data-bem-preset="default"]')?.click()
    await nextTick()
    expect((model.value?.nodes[0] as ElementNode).props.class).toMatchObject({
      value: "aria-badge",
    })
  })

  it("disables presets when class is expression-bound", async () => {
    const model = ref<AstroDocumentModel | null>(documentFor({
      id: "alert",
      kind: "element",
      name: "div",
      props: {
        "data-aria-type": { type: "string", value: "Alert" },
        class: { type: "expr", value: "alertClass" },
      },
      children: [],
    }))
    const { host } = mountSection(model)
    await nextTick()
    expect(
      [...host.querySelectorAll<HTMLButtonElement>("[data-bem-preset]")].every((button) => button.disabled),
    ).toBe(true)
  })
})
