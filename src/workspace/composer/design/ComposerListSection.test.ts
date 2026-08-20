// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AstroDocumentModel, ElementNode } from "../../../../shared/composer/types"
import { provideComposerBeacon } from "../selection/useComposerBeacon"
import { provideComposerDocument, type ComposerDocumentSession } from "../useComposerDocumentSession"
import { provideInspectorContext } from "../inspector/useInspectorContext"
import ComposerListSection from "./ComposerListSection.vue"

const mounted: Array<() => void> = []

function documentFor(node: ElementNode): AstroDocumentModel {
  return { imports: [], extraFrontmatter: "", nodes: [node], propSchema: [], slots: [], extendsTag: null }
}

function mountList(node: ElementNode, options: {
  activeClassName?: string
  styleText?: string
  inheritedStyleText?: string
} = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const model = ref<AstroDocumentModel | null>(documentFor(node))
  const previewStyle = vi.fn()
  const clearPreviewStyle = vi.fn()
  const setStyle = vi.fn()
  const commit = vi.fn((
    _label: string,
    mutation: (value: AstroDocumentModel) => { ok?: boolean } | void,
    _options?: { immediate?: boolean; coalesceKey?: string | null },
  ) => {
    if (!model.value) return false
    return mutation(model.value)?.ok !== false
  })
  const InspectorHost = defineComponent({
    setup() {
      const inspector = provideInspectorContext()
      if (options.activeClassName) inspector?.setActiveClass(options.activeClassName)
      return () => h(ComposerListSection, {
        openSection: "list",
        styleText: options.styleText,
        inheritedStyleText: options.inheritedStyleText,
        onSetStyle: setStyle,
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
        previewStyle,
        clearPreviewStyle,
      } as unknown as ComposerDocumentSession)
      return () => h(InspectorHost)
    },
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, commit, model, previewStyle, clearPreviewStyle, setStyle }
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ComposerListSection", () => {
  it("converts unordered to ordered through the list path and previews decimal markers", async () => {
    const { host, model, previewStyle } = mountList({
      id: "list",
      kind: "element",
      name: "ul",
      props: { class: { type: "string", value: "list-disc space-y-2" } },
      children: [{ id: "item", kind: "element", name: "li", props: {}, children: [] }],
    })
    await nextTick()
    ;(host.querySelector('[data-list-mode="ordered"]') as HTMLButtonElement).click()
    await nextTick()
    const list = model.value?.nodes[0] as ElementNode
    expect(list.name).toBe("ol")
    expect(list.props.style).toEqual({
      type: "string",
      value: "list-style: decimal outside none; padding-inline-start: 1.5em",
    })
    expect(list.props.class).toEqual({ type: "string", value: "space-y-2" })
    expect(host.querySelector('[data-list-mode="ordered"]')?.getAttribute("aria-checked")).toBe("true")
    expect(previewStyle).toHaveBeenCalledWith(
      "0",
      "list-style: decimal outside none; padding-inline-start: 1.5em",
    )
    expect(host.querySelector('[data-list-marker="decimal"]')?.getAttribute("aria-checked")).toBe("true")
    expect(host.querySelector('[data-testid="list-style-type-select"]')?.querySelectorAll('[role="radio"]')).toHaveLength(5)
  })

  it("paints unordered marker glyphs and commits the selected marker", async () => {
    const { host, model, previewStyle } = mountList({
      id: "list",
      kind: "element",
      name: "ul",
      props: { class: { type: "string", value: "list-disc space-y-2" } },
      children: [{ id: "item", kind: "element", name: "li", props: {}, children: [] }],
    })
    await nextTick()
    const markers = host.querySelector('[data-testid="list-style-type-select"]')
    expect(markers?.querySelectorAll('[role="radio"]')).toHaveLength(4)
    expect(host.querySelector('[data-list-marker="disc"]')?.getAttribute("aria-checked")).toBe("true")
    ;(host.querySelector('[data-list-marker="square"]') as HTMLButtonElement).click()
    await nextTick()
    const list = model.value?.nodes[0] as ElementNode
    expect(list.props.style).toEqual({
      type: "string",
      value: "list-style: square outside none; padding-inline-start: 1.5em",
    })
    expect(host.querySelector('[data-list-marker="square"]')?.getAttribute("aria-checked")).toBe("true")
    expect(previewStyle).toHaveBeenCalledWith(
      "0",
      "list-style: square outside none; padding-inline-start: 1.5em",
    )
  })

  it("toggles marker position with icon buttons", async () => {
    const { host, model } = mountList({
      id: "list",
      kind: "element",
      name: "ul",
      props: {},
      children: [{ id: "item", kind: "element", name: "li", props: {}, children: [] }],
    })
    await nextTick()
    expect(host.querySelector('[data-list-position="outside"]')?.getAttribute("aria-checked")).toBe("true")
    ;(host.querySelector('[data-list-position="inside"]') as HTMLButtonElement).click()
    await nextTick()
    const list = model.value?.nodes[0] as ElementNode
    expect(list.props.style).toEqual({
      type: "string",
      value: "list-style: disc inside none",
    })
    expect(host.querySelector('[data-list-position="inside"]')?.getAttribute("aria-checked")).toBe("true")
  })

  it("selects none when the active class authors list-style: none", async () => {
    const { host } = mountList({
      id: "list",
      kind: "element",
      name: "ul",
      props: { class: { type: "string", value: "hero__promise-list" } },
      children: [{ id: "item", kind: "element", name: "li", props: {}, children: [] }],
    }, {
      activeClassName: "hero__promise-list",
      styleText: "display: flex; align-items: center; list-style: none; gap: 1.5rem",
    })
    await nextTick()
    expect(host.querySelector('[data-list-marker="none"]')?.getAttribute("aria-checked")).toBe("true")
    expect(host.querySelector('[data-list-marker="disc"]')?.getAttribute("aria-checked")).toBe("false")
  })

  it("writes list-style into the selected class instead of the element", async () => {
    const { host, model, setStyle, commit } = mountList({
      id: "list",
      kind: "element",
      name: "ul",
      props: { class: { type: "string", value: "hero__promise-list" } },
      children: [{ id: "item", kind: "element", name: "li", props: {}, children: [] }],
    }, {
      activeClassName: "hero__promise-list",
      styleText: "display: flex; list-style: none",
    })
    await nextTick()
    ;(host.querySelector('[data-list-marker="square"]') as HTMLButtonElement).click()
    await nextTick()
    expect(setStyle).toHaveBeenCalledWith(
      {
        type: "string",
        value: "display: flex; list-style: square outside none",
      },
      true,
      { deletedKeys: ["list-style-type", "list-style-position"] },
    )
    expect((model.value?.nodes[0] as ElementNode).props.style).toBeUndefined()
    expect(commit).not.toHaveBeenCalled()
  })

  it("inherits list-style: none from a lower class breakpoint", async () => {
    const { host } = mountList({
      id: "list",
      kind: "element",
      name: "ul",
      props: { class: { type: "string", value: "hero__promise-list" } },
      children: [{ id: "item", kind: "element", name: "li", props: {}, children: [] }],
    }, {
      activeClassName: "hero__promise-list",
      styleText: "gap: 2rem",
      inheritedStyleText: "list-style: none",
    })
    await nextTick()
    expect(host.querySelector('[data-list-marker="none"]')?.getAttribute("aria-checked")).toBe("true")
  })
})
