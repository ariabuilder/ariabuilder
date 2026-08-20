// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref, type Component, type Ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AstroDocumentModel, EditableNode, ElementNode } from "../../../../shared/composer/types"
import { provideComposerBeacon } from "../selection/useComposerBeacon"
import { provideComposerDocument, type ComposerDocumentSession } from "../useComposerDocumentSession"
import { provideInspectorContext } from "../inspector/useInspectorContext"
import ComposerContentAttributes from "./ComposerContentAttributes.vue"
import ComposerButtonSection from "./ComposerButtonSection.vue"
import ComposerListSection from "./ComposerListSection.vue"
import ComposerMediaSection from "./ComposerMediaSection.vue"
import ComposerSpecialElementSections from "./ComposerSpecialElementSections.vue"

const mounted: Array<() => void> = []

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

function documentFor(node: EditableNode): AstroDocumentModel {
  return { imports: [], extraFrontmatter: "", nodes: [node], propSchema: [], slots: [], extendsTag: null }
}

function mountInspectorComponent(
  component: Component,
  model: Ref<AstroDocumentModel | null>,
  openSection: string,
  extraProps: Record<string, unknown> = {},
) {
  const host = document.createElement("div")
  document.body.append(host)
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
      provideInspectorContext()
      return () => h(component, {
        node: model.value?.nodes[0],
        openSection,
        ...extraProps,
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

describe("Inspector reset safety", () => {
  it("disables Content reset for expressions nested beneath formatting", async () => {
    const paragraph: ElementNode = {
      id: "paragraph",
      kind: "element",
      name: "p",
      props: {},
      children: [{
        id: "strong",
        kind: "element",
        name: "strong",
        props: {},
        children: [{ id: "name", kind: "expr", value: "{name}" }],
      }],
    }
    const model = ref<AstroDocumentModel | null>(documentFor(paragraph))
    const { host, commit } = mountInspectorComponent(ComposerContentAttributes, model, "content")
    await nextTick()

    expect((host.querySelector('[data-testid="property-reset-button"]') as HTMLButtonElement).disabled).toBe(true)
    expect(commit).not.toHaveBeenCalled()
  })

  it("keeps expression-valued HTML attributes read-only", async () => {
    const element: ElementNode = {
      id: "region",
      kind: "element",
      name: "div",
      props: { title: { type: "expr", value: "pageTitle" } },
      children: [],
    }
    const model = ref<AstroDocumentModel | null>(documentFor(element))
    const { host } = mountInspectorComponent(ComposerContentAttributes, model, "attributes")
    await nextTick()

    const titleInput = [...host.querySelectorAll<HTMLInputElement>("input")]
      .find((input) => input.value === "pageTitle")
    expect(titleInput?.disabled).toBe(true)
    expect(titleInput?.title).toContain("Detach or rebind")
  })

  it("disables Code reset and editing for expression-bound content", async () => {
    const pre: ElementNode = {
      id: "pre",
      kind: "element",
      name: "pre",
      props: {},
      children: [{
        id: "code",
        kind: "element",
        name: "code",
        props: { class: { type: "string", value: "language-js" } },
        children: [{ id: "snippet", kind: "expr", value: "{snippet}" }],
      }],
    }
    const model = ref<AstroDocumentModel | null>(documentFor(pre))
    const { host, commit } = mountInspectorComponent(ComposerSpecialElementSections, model, "code")
    await nextTick()

    expect((host.querySelector('[data-testid="property-reset-button"]') as HTMLButtonElement).disabled).toBe(true)
    expect(host.textContent).toContain("Detach or rebind this expression")
    expect(commit).not.toHaveBeenCalled()
  })

  it("preserves SVG viewBox while resetting presentation and accessibility", async () => {
    const svg: ElementNode = {
      id: "logo",
      kind: "element",
      name: "svg",
      props: {
        viewBox: { type: "string", value: "0 0 24 24" },
        width: { type: "string", value: "24" },
        fill: { type: "string", value: "currentColor" },
        role: { type: "string", value: "img" },
        "aria-label": { type: "string", value: "Logo" },
      },
      children: [],
    }
    const model = ref<AstroDocumentModel | null>(documentFor(svg))
    const { host, commit } = mountInspectorComponent(ComposerSpecialElementSections, model, "svg")
    await nextTick()

    ;(host.querySelector('[data-testid="property-reset-button"]') as HTMLButtonElement).click()
    await nextTick()
    const props = (model.value?.nodes[0] as ElementNode).props
    expect(props.viewBox).toMatchObject({ value: "0 0 24 24" })
    expect(props.width).toBeUndefined()
    expect(props.fill).toBeUndefined()
    expect(props.role).toBeUndefined()
    expect(props["aria-label"]).toBeUndefined()
    expect(commit.mock.calls[0]?.[2]).toEqual({ immediate: true, coalesceKey: null })
  })

  it("keeps expression-bound media controls read-only and reflects literal false booleans", async () => {
    const video: ElementNode = {
      id: "video",
      kind: "element",
      name: "video",
      props: {
        poster: { type: "expr", value: "entry.poster" },
        style: { type: "expr", value: "entry.mediaStyle" },
        autoplay: { type: "expr", value: "false" },
      },
      children: [],
    }
    const model = ref<AstroDocumentModel | null>(documentFor(video))
    const { host, commit } = mountInspectorComponent(ComposerMediaSection, model, "video")
    await nextTick()

    const poster = [...host.querySelectorAll<HTMLInputElement>("input")].find((input) => input.value === "entry.poster")
    expect(poster?.disabled).toBe(true)
    const scale = [...host.querySelectorAll<HTMLElement>('[role="combobox"]')].find((item) => item.textContent?.includes("cover")) as HTMLButtonElement
    expect(scale?.disabled).toBe(true)
    const autoplay = [...host.querySelectorAll<HTMLElement>('[role="switch"]')][0]
    expect(autoplay?.getAttribute("data-state")).toBe("unchecked")
    expect((autoplay as HTMLButtonElement).disabled).toBe(true)
    expect(commit).not.toHaveBeenCalled()
  })

  it("keeps expression-bound button and list presentation controls read-only", async () => {
    const button: ElementNode = {
      id: "button",
      kind: "element",
      name: "button",
      props: {
        "data-button-variant": { type: "expr", value: "variant" },
        disabled: { type: "expr", value: "false" },
      },
      children: [],
    }
    const buttonModel = ref<AstroDocumentModel | null>(documentFor(button))
    const mountedButton = mountInspectorComponent(ComposerButtonSection, buttonModel, "button")
    await nextTick()
    expect((mountedButton.host.querySelector('[aria-label="Button variant"]') as HTMLButtonElement).disabled).toBe(true)
    const disabledSwitch = mountedButton.host.querySelector('[role="switch"]') as HTMLButtonElement
    expect(disabledSwitch.getAttribute("data-state")).toBe("unchecked")
    expect(disabledSwitch.disabled).toBe(true)

    const list: ElementNode = {
      id: "list",
      kind: "element",
      name: "ul",
      props: { style: { type: "expr", value: "entry.listStyle" } },
      children: [{ id: "item", kind: "element", name: "li", props: {}, children: [] }],
    }
    const listModel = ref<AstroDocumentModel | null>(documentFor(list))
    const mountedList = mountInspectorComponent(ComposerListSection, listModel, "list")
    await nextTick()
    const markerControls = [...mountedList.host.querySelectorAll<HTMLButtonElement>('[data-testid="list-style-type-select"] [role="radio"], [data-testid="list-style-position-select"] [role="radio"]')]
    expect(markerControls).toHaveLength(6)
    expect(markerControls.every((control) => control.disabled)).toBe(true)
    expect(mountedButton.commit).not.toHaveBeenCalled()
    expect(mountedList.commit).not.toHaveBeenCalled()
  })

  it("shows one button section for Astro Button components and persists its label and URL", async () => {
    const component: EditableNode = {
      id: "component-button",
      kind: "component",
      name: "Button",
      props: { variant: { type: "string", value: "secondary" } },
      children: [{ id: "component-button-label", kind: "text", value: "Start" }],
    }
    const model = ref<AstroDocumentModel | null>(documentFor(component))
    const { host, commit } = mountInspectorComponent(ComposerContentAttributes, model, "button")
    await nextTick()

    expect(host.querySelector('[aria-label="Button variant"]')).not.toBeNull()
    expect(host.textContent).toContain("Button")
    expect(host.textContent).not.toContain("Link")

    const label = [...host.querySelectorAll<HTMLInputElement>("input")]
      .find((input) => input.value === "Start")
    expect(label).toBeInstanceOf(HTMLInputElement)
    if (label) {
      label.value = "Get started"
      label.dispatchEvent(new Event("input", { bubbles: true }))
    }

    const url = host.querySelector<HTMLInputElement>('input[inputmode="url"]')
    expect(url).toBeInstanceOf(HTMLInputElement)
    if (url) {
      url.value = "/pricing"
      url.dispatchEvent(new Event("change", { bubbles: true }))
    }
    await nextTick()

    const saved = model.value?.nodes[0]
    expect(saved?.kind).toBe("component")
    if (saved?.kind === "component") {
      expect(saved.children?.[0]).toMatchObject({ kind: "text", value: "Get started" })
      expect(saved.props.href).toEqual({ type: "string", value: "/pricing" })
    }
    expect(commit).toHaveBeenCalled()
  })

  it("keeps a native button label editable after adding a managed icon", async () => {
    const button: ElementNode = {
      id: "native-icon-button",
      kind: "element",
      name: "button",
      props: { "data-button-variant": { type: "string", value: "primary" } },
      children: [
        {
          id: "native-icon",
          kind: "element",
          name: "span",
          props: {
            class: { type: "string", value: "i-lucide:arrow-right" },
            "data-aria-button-icon": { type: "string", value: "true" },
            "aria-hidden": { type: "string", value: "true" },
          },
          children: [],
        },
        { id: "native-icon-button-label", kind: "text", value: "Continue" },
      ],
    }
    const model = ref<AstroDocumentModel | null>(documentFor(button))
    const { host } = mountInspectorComponent(ComposerButtonSection, model, "button")
    await nextTick()

    const label = [...host.querySelectorAll<HTMLInputElement>("input")]
      .find((input) => input.value === "Continue")
    expect(label).toBeInstanceOf(HTMLInputElement)
    expect(label?.disabled).toBe(false)
    expect(host.querySelectorAll('[aria-label="Button icon side"] [role="radio"]')).toHaveLength(2)
    expect(host.querySelector<HTMLInputElement>('[aria-label="Button icon size"]')).not.toBeNull()
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Button icon color"]')).not.toBeNull()
    expect(host.querySelector<HTMLInputElement>('[aria-label="Button icon gap"]')).not.toBeNull()
  })

  it("scrubs native icon metrics and switches icon side through the radio group", async () => {
    const button: ElementNode = {
      id: "native-icon-controls",
      kind: "element",
      name: "button",
      props: {},
      children: [
        {
          id: "native-icon-svg",
          kind: "element",
          name: "svg",
          props: {
            "data-aria-button-icon": { type: "string", value: "true" },
            "data-aria-button-icon-value": { type: "string", value: "i-lucide:arrow-right" },
          },
          children: [],
        },
        { id: "native-icon-controls-label", kind: "text", value: "Continue" },
      ],
    }
    const model = ref<AstroDocumentModel | null>(documentFor(button))
    const { host } = mountInspectorComponent(ComposerButtonSection, model, "button")
    await nextTick()

    const size = host.querySelector<HTMLInputElement>('[aria-label="Button icon size"]')
    size?.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 20, bubbles: true }))
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 30, bubbles: true }))
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 30, bubbles: true }))
    await nextTick()

    expect(button.props["data-button-icon-size"]).toEqual({ type: "string", value: "1.5em" })
    expect(button.props.style).toMatchObject({ type: "string" })
    expect(button.props.style?.type === "string" ? button.props.style.value : "").toContain("--aria-button-icon-size: 1.5em")

    const left = host.querySelector<HTMLButtonElement>('[data-icon-side="left"]')
    left?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    await nextTick()
    expect(button.props["data-button-icon-position"]).toEqual({ type: "string", value: "right" })
    expect(document.activeElement).toBe(host.querySelector('[data-icon-side="right"]'))
  })

  it("renders Button controls without a nested section surface in Props", async () => {
    const component: EditableNode = {
      id: "props-button",
      kind: "component",
      name: "Button",
      props: {
        variant: { type: "string", value: "primary" },
        icon: { type: "string", value: "i-lucide:arrow-right" },
        href: { type: "string", value: "/pricing" },
      },
      children: [{ id: "props-button-label", kind: "text", value: "Pricing" }],
    }
    const model = ref<AstroDocumentModel | null>(documentFor(component))
    const { host } = mountInspectorComponent(ComposerButtonSection, model, "button", { contentOnly: true })
    await nextTick()

    const header = host.querySelector('[data-inspector-section="Button"]')
    expect(header).toBeNull()
    expect(host.textContent).toContain("Icon size")
    expect(host.textContent).toContain("Icon color")
    expect(host.textContent).toContain("Space between")
    expect(host.textContent).toContain("Download")
    expect(host.textContent).toContain("Relationship")
  })

  it("supports arrow, Home, and End navigation in element segmented radio groups", async () => {
    const image: ElementNode = { id: "image", kind: "element", name: "img", props: {}, children: null }
    const imageModel = ref<AstroDocumentModel | null>(documentFor(image))
    const mountedImage = mountInspectorComponent(ComposerMediaSection, imageModel, "image")
    await nextTick()
    const media = mountedImage.host.querySelector('[data-source-mode="media"]') as HTMLButtonElement
    media.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    await nextTick()
    const url = mountedImage.host.querySelector('[data-source-mode="url"]') as HTMLButtonElement
    expect(url.getAttribute("aria-checked")).toBe("true")
    expect(document.activeElement).toBe(url)

    const list: ElementNode = {
      id: "list-keyboard", kind: "element", name: "ul", props: {},
      children: [{ id: "item-keyboard", kind: "element", name: "li", props: {}, children: [] }],
    }
    const listModel = ref<AstroDocumentModel | null>(documentFor(list))
    const mountedList = mountInspectorComponent(ComposerListSection, listModel, "list")
    await nextTick()
    const unordered = mountedList.host.querySelector('[data-list-mode="unordered"]') as HTMLButtonElement
    unordered.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
    await nextTick()
    const description = mountedList.host.querySelector('[data-list-mode="description"]') as HTMLButtonElement
    expect(description.getAttribute("aria-checked")).toBe("true")
    expect(document.activeElement).toBe(description)
    expect(mountedList.commit.mock.calls[0]?.[2]).toEqual({ immediate: true, coalesceKey: null })
  })

  it("splits identity and attributes into separate inspector clusters", async () => {
    const paragraph: ElementNode = {
      id: "copy",
      kind: "element",
      name: "p",
      props: {},
      children: [{ id: "text", kind: "text", value: "Hello" }],
    }
    const model = ref<AstroDocumentModel | null>(documentFor(paragraph))
    const identity = mountInspectorComponent(ComposerContentAttributes, model, "content", { cluster: "identity" })
    await nextTick()
    expect(sectionTitles(identity.host)).toContain("Content")
    expect(sectionTitles(identity.host)).not.toContain("Attributes")

    const attributes = mountInspectorComponent(ComposerContentAttributes, model, "attributes", { cluster: "attributes" })
    await nextTick()
    expect(sectionTitles(attributes.host)).toEqual(["Attributes"])
    expect(sectionTitles(attributes.host)).not.toContain("Content")
  })
})

function sectionTitles(host: HTMLElement) {
  return [...host.querySelectorAll("[data-inspector-section]")].map((node) => node.getAttribute("data-inspector-section"))
}
