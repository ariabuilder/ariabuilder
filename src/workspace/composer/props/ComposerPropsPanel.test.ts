// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AstroDocumentModel, PropValue } from "../../../../shared/composer/types"
import { listComposerPopoverTargets } from "../../../../shared/composer"
import { provideInspectorContext } from "../inspector/useInspectorContext"
import { provideComposerBeacon } from "../selection/useComposerBeacon"
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

vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace")>()),
  getCollections: vi.fn().mockResolvedValue({
    collections: [{
      id: "blog",
      name: "blog",
      label: "Blog",
      schema: { fields: [{ key: "title", label: "Title", type: "string" }] },
    }],
  }),
  listExternalEntries: vi.fn().mockResolvedValue({ items: [], fields: [] }),
}))

const mounted: Array<() => void> = []

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function mountPanel(options: {
  model?: AstroDocumentModel
  selectedPath?: string
} = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const model = ref<AstroDocumentModel | null>(options.model ?? {
    imports: [{ name: "Hero", path: "@components/Hero.astro" }],
    extraFrontmatter: "",
    nodes: [
      { id: "hero", kind: "component", name: "Hero", props: {}, children: [] },
      { id: "root", kind: "element", name: "main", props: {}, children: [] },
    ],
    propSchema: [],
    slots: [],
    extendsTag: null,
  })
  let beacon!: ReturnType<typeof provideComposerBeacon>
  const app = createApp(defineComponent({
    setup() {
      beacon = provideComposerBeacon()
      provideComposerDocument({
        model,
        editable: ref(true),
        designActive: ref(true),
        projectPath: ref("/project"),
        editFile: ref("src/pages/index.astro"),
        availableLayouts: ref([]),
        pages: ref([]),
        documentKind: ref("page"),
        commitInspectorMutation: vi.fn(),
        setSelectedProp: (name: string, value: PropValue | undefined) => {
          const node = model.value?.nodes[0]
          if (!node || !("props" in node)) return false
          if (value) node.props[name] = value
          else delete node.props[name]
          return true
        },
        popoverPreviewTargetId: ref(null),
        previewPopover: vi.fn(),
      } as unknown as ComposerDocumentSession)
      provideInspectorContext()
      beacon.illuminate(options.selectedPath ?? "0")
      return () => h(ComposerPropsPanel)
    },
  }))
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, beacon }
}

afterEach(() => {
  mocks.extractComposerPropSchema.mockReset()
  for (const unmount of mounted.splice(0)) unmount()
})

function expandSection(host: HTMLElement, title: string) {
  const header = host.querySelector<HTMLElement>(`[data-inspector-section="${title}"]`)
  header?.click()
  return header
}

describe("ComposerPropsPanel prop schema lifecycle", () => {
  it("collapses semantic HTML fields by default for native elements", async () => {
    const { host } = mountPanel({
      model: {
        imports: [], extraFrontmatter: "", propSchema: [], slots: [], extendsTag: null,
        nodes: [{
          id: "item",
          kind: "element",
          name: "li",
          props: { title: { type: "string", value: "Post" } },
          children: [{ id: "label", kind: "text", value: "Post" }],
        }],
      },
    })
    await nextTick()

    const semantic = host.querySelector('[data-inspector-section="Semantic HTML"]')
    const attributes = host.querySelector('[data-inspector-section="Attributes"]')
    expect(semantic).not.toBeNull()
    expect(semantic?.querySelector('[data-slot="collapsible-trigger"]')?.getAttribute("aria-expanded")).toBe("false")
    expect(semantic?.textContent).toContain("Semantic HTML")
    expect(semantic?.textContent).toContain("li")
    expect(host.textContent).not.toContain("ELEMENT")
    expect(attributes).not.toBeNull()
    expect(attributes?.querySelector('[data-slot="collapsible-trigger"]')?.getAttribute("aria-expanded")).toBe("false")
    expect(
      host.querySelector('[data-inspector-section="Content binding"]')
        ?.querySelector('[data-slot="collapsible-trigger"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false")
    expect(semantic?.contains(attributes)).toBe(false)
  })

  it("keeps inspector sections collapsed when selection moves from a component to an element", async () => {
    const { host, beacon } = mountPanel()
    await nextTick()

    expandSection(host, "Properties")
    await nextTick()
    expect(
      host.querySelector('[data-inspector-section="Properties"]')
        ?.querySelector('[data-slot="collapsible-trigger"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true")

    beacon.illuminate("1")
    await nextTick()

    const semantic = host.querySelector('[data-inspector-section="Semantic HTML"]')
    expect(semantic?.querySelector('[data-slot="collapsible-trigger"]')?.getAttribute("aria-expanded")).toBe("false")
    expect(
      host.querySelector('[data-inspector-section="Content binding"]')
        ?.querySelector('[data-slot="collapsible-trigger"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false")
  })

  it("prioritizes semantic CMS controls over raw loop editing", async () => {
    const { host } = mountPanel({
      model: {
        imports: [],
        extraFrontmatter: `/* @aria-cms-query:posts */\nconst posts = await getCollection("blog");\n/* @aria-cms-query-end:posts */`,
        collectionBindings: {
          posts: { collections: ["blog"], cardinality: "many" },
        },
        nodes: [{
          id: "loop",
          kind: "map",
          head: "posts.map((post) => (",
          children: [{
            id: "heading",
            kind: "element",
            name: "h2",
            props: {},
            children: [{ id: "title", kind: "expr", value: "{post.data.title}" }],
          }],
        }],
        propSchema: [],
        slots: [],
        extendsTag: null,
      },
      selectedPath: "0",
    })
    await nextTick()
    expandSection(host, "Content binding")
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Blog collection loop")
      expect(host.textContent).toContain("Collection loop")
    })
    expect(host.textContent).toContain("Advanced source")
    expect(host.querySelector("textarea")?.textContent ?? "").not.toContain("posts.map")
    expect(host.querySelector("[data-content-binding-source]")?.getAttribute("data-content-binding-source")).toBe("cms")
  })

  it("keeps unbound project loops on None until a source is chosen", async () => {
    const { host } = mountPanel({
      model: {
        imports: [],
        extraFrontmatter: "const { title, text, data, type = 'left', classes } = Astro.props",
        nodes: [{
          id: "loop",
          kind: "map",
          head: "data.map((faq: any) => (",
          children: [{
            id: "item",
            kind: "component",
            name: "FAQ",
            props: {
              title: { type: "expr", value: "faq.question" },
              text: { type: "expr", value: "faq.reply" },
            },
            children: [],
          }],
        }],
        propSchema: [],
        slots: [],
        extendsTag: null,
      },
      selectedPath: "0",
    })
    await nextTick()

    expect(host.querySelector("[data-content-binding-source]")?.getAttribute("data-content-binding-source")).toBe("none")
    expect(host.textContent).toContain("Content binding")
    expect(
      host.querySelector('[data-inspector-section="Content binding"]')
        ?.querySelector('[data-slot="collapsible-trigger"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false")
    expect(host.textContent).not.toContain("Bind field")
    expect(host.textContent).not.toContain("Current loop item")
    expect(host.textContent).not.toContain("Inherited from loop")
    expect(host.textContent).not.toContain("Advanced loop source")
    expect(host.textContent).not.toContain("Use the semantic CMS controls above")
  })

  it("shows dedicated Popover controls and connected triggers", async () => {
    const model: AstroDocumentModel = {
      imports: [], extraFrontmatter: "", propSchema: [], slots: [], extendsTag: null,
      nodes: [{
        id: "group", kind: "element", name: "div", props: {}, children: [
          { id: "open", kind: "element", name: "button", props: { type: { type: "string", value: "button" }, popovertarget: { type: "string", value: "menu" } }, children: [{ id: "open-text", kind: "text", value: "Open menu" }] },
          { id: "menu", kind: "element", name: "div", props: { id: { type: "string", value: "menu" }, popover: { type: "bare" } }, children: [{ id: "content", kind: "text", value: "Menu content" }] },
        ],
      }],
    }
    expect(listComposerPopoverTargets(model)[0]?.triggers).toHaveLength(1)
    const { host } = mountPanel({ model, selectedPath: "0.1" })
    await vi.waitFor(() => expect(host.textContent).toContain("Open menu"))
    expect(host.textContent).toContain("Show on canvas")
    expect(host.textContent).toContain("Create trigger")
    expect(host.querySelector('[aria-label="Popover behavior"]')).not.toBeNull()
  })

  it("offers Popover targeting from native Button controls", async () => {
    const model: AstroDocumentModel = {
      imports: [], extraFrontmatter: "", propSchema: [], slots: [], extendsTag: null,
      nodes: [
        { id: "button", kind: "element", name: "button", props: { type: { type: "string", value: "button" }, popovertarget: { type: "string", value: "menu" } }, children: [{ id: "label", kind: "text", value: "Open" }] },
        { id: "menu", kind: "element", name: "div", props: { id: { type: "string", value: "menu" }, popover: { type: "bare" } }, children: [] },
      ],
    }
    const { host } = mountPanel({ model, selectedPath: "0" })
    await nextTick()
    const actionGroup = host.querySelector('[aria-label="Button action"]')
    expect(actionGroup?.querySelectorAll('[role="radio"]')).toHaveLength(3)
    expect(actionGroup?.querySelector('[data-button-action="popover"]')?.getAttribute("aria-checked")).toBe("true")
    expect(host.querySelector('[aria-label="Popover target"]')).not.toBeNull()
    expect(host.textContent).toContain("Go to popover")
    expect(host.querySelector('input[inputmode="url"]')).toBeNull()
  })

  it("clears loading immediately when selection moves to a non-component root", async () => {
    const request = deferred<never>()
    mocks.extractComposerPropSchema.mockReturnValue(request.promise)
    const { host, beacon } = mountPanel()
    expandSection(host, "Properties")

    await vi.waitFor(() => {
      expect(host.textContent).toMatch(/loading prop schema/i)
    })

    beacon.illuminate("1")
    await nextTick()

    expect(host.textContent).not.toMatch(/loading prop schema/i)
  })

  it("inlines schema-aware Button controls and styles remaining props like Inspector rows", async () => {
    mocks.extractComposerPropSchema.mockResolvedValue({
      resolved: true,
      fields: [
        { name: "type", type: "enum", optional: true, options: ["button", "submit"], default: "button" },
        { name: "link", type: "string", optional: true },
        { name: "modal", type: "string", optional: true },
        { name: "style", type: "enum", optional: true, options: ["primary", "secondary"], default: "primary" },
        { name: "size", type: "enum", optional: true, options: ["sm", "lg"] },
        { name: "variation", type: "enum", optional: true, options: ["solid", "outline"] },
        { name: "elevated", type: "boolean", optional: true },
        { name: "classes", type: "string", optional: true },
        { name: "icon", type: "string", optional: true },
        { name: "iconSize", type: "string", optional: true },
        { name: "iconColor", type: "string", optional: true },
        { name: "iconSpaceBetween", type: "boolean", optional: true },
        { name: "download", type: "boolean", optional: true },
        { name: "trackingId", type: "string", optional: true },
      ],
      extendsTag: null,
      slots: [],
      hasRest: false,
      relativeFile: "src/components/Button.astro",
    })
    const { host } = mountPanel({
      model: {
        imports: [{ name: "Button", path: "@components/Button.astro" }],
        extraFrontmatter: "",
        nodes: [{
          id: "button",
          kind: "component",
          name: "Button",
          props: {
            style: { type: "string", value: "secondary" },
            size: { type: "string", value: "lg" },
            icon: { type: "string", value: "i-lucide:arrow-right" },
            link: { type: "string", value: "/pricing" },
            trackingId: { type: "string", value: "pricing-cta" },
          },
          children: [{ id: "label", kind: "text", value: "Pricing" }],
        }],
        propSchema: [],
        slots: [],
        extendsTag: null,
      },
    })

    await vi.waitFor(() => {
      expect(host.querySelector('[data-inspector-section="Properties"]')).not.toBeNull()
    })
    expandSection(host, "Properties")
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Tracking ID")
    })

    const buttonHeader = host.querySelector('[data-inspector-section="Button"]')
    expect(buttonHeader).toBeNull()
    expect(host.querySelector<HTMLInputElement>('input[inputmode="url"]')?.value).toBe("/pricing")
    expect(host.querySelector('[aria-label="Button variant"]')?.textContent).toContain("Secondary")
    expect(host.textContent).toContain("Icon size")
    expect(host.textContent).toContain("Icon color")
    expect(host.textContent).toContain("Space between")
    expect(host.textContent).toContain("Download")
    expect(host.textContent).toContain("Relationship")

    const genericFieldLabels = [...host.querySelectorAll("label")]
      .map((label) => label.textContent?.trim())
    expect(genericFieldLabels).toContain("Type")
    expect(genericFieldLabels).toContain("Modal")
    expect(genericFieldLabels).toContain("Variation")
    expect(genericFieldLabels).toContain("Elevated")
    expect(genericFieldLabels).toContain("Classes")
    expect(genericFieldLabels).toContain("Tracking ID")
    expect(genericFieldLabels).not.toContain("Style")
    expect(genericFieldLabels).not.toContain("Link")
    expect(host.textContent).not.toContain("enum")
    expect(host.textContent).not.toContain("boolean")
    const typeLabel = [...host.querySelectorAll("label")]
      .find((label) => label.textContent?.trim() === "Type")
    expect(typeLabel?.classList.contains("uppercase")).toBe(true)
    expect(host.querySelector("#composer-prop-modal")?.classList.contains("h-8")).toBe(true)
    expect(host.querySelector('[role="switch"][aria-label="Elevated"]')).not.toBeNull()
  })

  it("shows script and style attribute fields for raw tags", async () => {
    const { host, beacon } = mountPanel({
      model: {
        imports: [], extraFrontmatter: "", propSchema: [], slots: [], extendsTag: null,
        nodes: [
          { id: "grid-script", kind: "raw", name: "script", props: {}, inner: "console.log('grid')" },
          { id: "grid-style", kind: "raw", name: "style", props: {}, inner: ".grid { color: lime; }" },
        ],
      },
    })
    await nextTick()

    expect(host.querySelector('[data-inspector-section="Code"]')).toBeNull()
    expect(host.querySelector('[data-inspector-section="Properties"]')).not.toBeNull()
    expandSection(host, "Properties")
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Src")
      expect(host.textContent).toContain("Async")
    })

    beacon.illuminate("1")
    await nextTick()
    expandSection(host, "Properties")
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Media")
    })
    expect(host.querySelector('[data-inspector-section="Code"]')).toBeNull()
  })

  it("keeps property field focus after a keystroke updates the model", async () => {
    mocks.extractComposerPropSchema.mockResolvedValue({
      resolved: true,
      fields: [
        { name: "icon", type: "string", optional: true },
        { name: "label", type: "string", optional: true },
        { name: "class", type: "string", optional: true },
      ],
      extendsTag: null,
      slots: [],
      hasRest: false,
      relativeFile: "src/components/Eyebrow.astro",
    })
    const { host } = mountPanel({
      model: {
        imports: [{ name: "Eyebrow", path: "@components/Eyebrow.astro" }],
        extraFrontmatter: "",
        nodes: [{
          id: "eyebrow",
          kind: "component",
          name: "Eyebrow",
          props: { icon: { type: "string", value: "" } },
          children: [],
        }],
        propSchema: [],
        slots: [],
        extendsTag: null,
      },
    })

    await vi.waitFor(() => {
      expect(host.querySelector('[data-inspector-section="Properties"]')).not.toBeNull()
    })
    expandSection(host, "Properties")
    const input = await vi.waitFor(() => {
      const field = host.querySelector<HTMLInputElement>("#composer-prop-icon")
      expect(field).not.toBeNull()
      return field!
    })

    input.focus()
    input.value = "r"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()

    expect(input.disabled).toBe(false)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe("r")
  })
})
