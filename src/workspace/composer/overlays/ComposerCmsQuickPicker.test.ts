// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { AstroDocumentModel } from "../../../../shared/composer/types"
import { provideComposerDocument, type ComposerDocumentSession } from "../useComposerDocumentSession"
import ComposerCmsQuickPicker from "./ComposerCmsQuickPicker.vue"

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
})
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

const mocks = vi.hoisted(() => ({
  getCollections: vi.fn(),
  getExternalEntry: vi.fn(),
  listExternalEntries: vi.fn(),
  getCmsEntry: vi.fn(),
  listCmsEntries: vi.fn(),
}))

vi.mock("@/lib/workspace", () => ({
  getCollections: mocks.getCollections,
  getExternalEntry: mocks.getExternalEntry,
  listExternalEntries: mocks.listExternalEntries,
}))
vi.mock("@/lib/cms", () => ({
  getCmsEntry: mocks.getCmsEntry,
  listCmsEntries: mocks.listCmsEntries,
}))

const mounted: Array<() => void> = []

function sourceModel(): AstroDocumentModel {
  return {
    imports: [],
    extraFrontmatter: "",
    nodes: [{
      id: "heading",
      kind: "element",
      name: "h1",
      props: {},
      children: [{ id: "copy", kind: "text", value: "Static heading" }],
    }],
    propSchema: [],
    slots: [],
    extendsTag: null,
  }
}

function mountPicker(initialModel = sourceModel(), control: "text" | "loop" = "text") {
  const host = document.createElement("div")
  document.body.append(host)
  const model = ref<AstroDocumentModel | null>(initialModel)
  const saveError = ref<string | null>(null)
  const commitModelMutation = vi.fn(async (mutation: (model: AstroDocumentModel) => { ok: boolean; reason?: string }) => {
    const next = JSON.parse(JSON.stringify(model.value)) as AstroDocumentModel
    const result = mutation(next)
    if (!result.ok) {
      saveError.value = result.reason ?? null
      return false
    }
    model.value = next
    return true
  })
  const app = createApp(defineComponent({
    setup() {
      provideComposerDocument({
        model,
        editable: ref(true),
        designActive: ref(true),
        projectPath: ref("/project"),
        editFile: ref("src/pages/index.astro"),
        availableLayouts: ref([]),
        pages: ref([]),
        documentKind: ref("page"),
        saveError,
        commitModelMutation,
      } as unknown as ComposerDocumentSession)
      return () => h(TooltipProvider, null, {
        default: () => h(ComposerCmsQuickPicker, {
          path: "0",
          control,
          icon: control === "loop" ? "collections" : "databaseLine",
          label: control === "loop" ? "Repeat from collection" : "Bind text field",
        }),
      })
    },
  }))
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { model, saveError, commitModelMutation }
}

function elementWithText(text: string): HTMLElement {
  const element = [...document.body.querySelectorAll<HTMLElement>("*")]
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!element) throw new Error(`Could not find ${text}`)
  return element
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

async function selectField(path: string, nodeLabel = "h1") {
  click(button(`Field for ${nodeLabel}`))
  let option: HTMLElement | undefined
  await vi.waitFor(() => {
    option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((candidate) => path
      ? candidate.textContent?.includes(path)
      : candidate.textContent?.trim().startsWith("Static"))
    expect(option).toBeTruthy()
  })
  click(option!)
}

function button(label: string): HTMLButtonElement {
  const element = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!element) throw new Error(`Could not find button ${label}`)
  return element
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  document.body.querySelectorAll("[data-radix-popper-content-wrapper]").forEach((element) => element.remove())
  vi.clearAllMocks()
})

describe("ComposerCmsQuickPicker", () => {
  it("stages collection, entry, and mapping while Cancel leaves the document unchanged", async () => {
    mocks.getCollections.mockResolvedValue({
      collections: [{
        id: "site-copy",
        name: "site-copy",
        label: "Site Copy",
        schema: { fields: [{ key: "heading", label: "Heading", type: "text" }] },
      }],
    })
    mocks.listCmsEntries.mockResolvedValue({
      items: [{
        entry: { id: "hero-id", status: "published", version: "v1" },
        locales: [{ locale: "en", slug: "hero", title: "Hero", frontmatter: { heading: "Your Astro project, now visual." }, body: null, isSource: true }],
        relations: [],
      }],
    })
    const { model, commitModelMutation } = mountPicker()

    click(button("Bind text field"))
    await vi.waitFor(() => expect(elementWithText("Site Copy")).toBeTruthy())
    expect(document.body.textContent).not.toContain("Target prop")
    click(elementWithText("Site Copy"))
    await vi.waitFor(() => expect(elementWithText("Hero")).toBeTruthy())
    click(elementWithText("Hero"))
    await vi.waitFor(() => expect(document.body.querySelector('button[aria-label="Field for h1"]')).not.toBeNull())
    await selectField("heading")
    await vi.waitFor(() => expect(document.body.textContent).toContain("Your Astro project, now visual."))

    click(elementWithText("Cancel"))
    await nextTick()
    expect(commitModelMutation).not.toHaveBeenCalled()
    expect(model.value?.nodes[0]).toEqual(sourceModel().nodes[0])
  })

  it("applies all staged choices through one persisted document transaction", async () => {
    mocks.getCollections.mockResolvedValue({
      collections: [{
        id: "site-copy",
        name: "site-copy",
        label: "Site Copy",
        schema: { fields: [{ key: "heading", label: "Heading", type: "text" }] },
      }],
    })
    mocks.listCmsEntries.mockResolvedValue({
      items: [{
        entry: { id: "hero-id", status: "published", version: "v1" },
        locales: [{ locale: "en", slug: "hero", title: "Hero", frontmatter: { heading: "Resolved heading" }, body: null, isSource: true }],
        relations: [],
      }],
    })
    const { model, commitModelMutation } = mountPicker()

    click(button("Bind text field"))
    await vi.waitFor(() => expect(elementWithText("Site Copy")).toBeTruthy())
    click(elementWithText("Site Copy"))
    await vi.waitFor(() => expect(elementWithText("Hero")).toBeTruthy())
    click(elementWithText("Hero"))
    await vi.waitFor(() => expect(document.body.querySelector('button[aria-label="Field for h1"]')).not.toBeNull())
    await selectField("heading")
    await vi.waitFor(() => expect(document.body.textContent).toContain("Resolved heading"))
    click(elementWithText("Apply"))
    await vi.waitFor(() => expect(commitModelMutation).toHaveBeenCalledTimes(1))

    expect(model.value?.extraFrontmatter).toContain("@aria-cms-query")
    expect(JSON.stringify(model.value?.nodes)).toContain("@aria-cms-fallback")
    expect(document.body.textContent).not.toContain("Target prop")
  })

  it("restores the exact static fallback even when the former entry is unavailable", async () => {
    mocks.getCollections.mockResolvedValue({
      collections: [{
        id: "site-copy",
        name: "site-copy",
        label: "Site Copy",
        schema: { fields: [{ key: "heading", label: "Heading", type: "text" }] },
      }],
    })
    mocks.listCmsEntries.mockResolvedValue({ items: [] })
    const { model, commitModelMutation } = mountPicker({
      imports: [],
      extraFrontmatter: `import { getCollection } from "astro:content";
/* @aria-cms-query:hero */
const heroCopy = (await getCollection("site-copy")).find((entry) => (entry.data.slug ?? entry.id) === "missing-hero");
/* @aria-cms-query-end:hero */`,
      nodes: [{
        id: "heading",
        kind: "element",
        name: "h1",
        props: {},
        children: [{
          id: "copy",
          kind: "expr",
          value: '{heroCopy?.data?.["heading"] ?? /* @aria-cms-fallback */ "Exact static heading"}',
        }],
      }],
      propSchema: [],
      slots: [],
      extendsTag: null,
    })

    click(button("Bind text field"))
    await vi.waitFor(() => expect(document.body.querySelector('button[aria-label="Field for h1"]')).not.toBeNull())
    await selectField("")
    click(elementWithText("Apply"))
    await vi.waitFor(() => expect(commitModelMutation).toHaveBeenCalledTimes(1))

    expect(JSON.stringify(model.value?.nodes)).toContain("Exact static heading")
    expect(JSON.stringify(model.value?.nodes)).not.toContain("@aria-cms-fallback")
    expect(model.value?.extraFrontmatter).not.toContain("@aria-cms-query")
  })

  it("previews the exact one-hop referenced entry instead of its raw identifier", async () => {
    mocks.getCollections.mockResolvedValue({
      collections: [{
        id: "posts-id",
        name: "posts",
        label: "Posts",
        schema: { fields: [{ key: "author", label: "Author", type: "reference", targetCollection: "authors-id" }] },
      }, {
        id: "authors-id",
        name: "authors",
        label: "Authors",
        schema: { fields: [{ key: "name", label: "Name", type: "string" }] },
      }],
    })
    mocks.listCmsEntries.mockImplementation(async (_projectPath: string, input: { collectionId: string }) => input.collectionId === "posts-id"
      ? {
          items: [{
            entry: { id: "post-id", status: "published", version: "v1" },
            locales: [{ locale: "en", slug: "post", title: "Post", frontmatter: { author: { id: "author-id", collection: "authors" } }, body: null, isSource: true }],
            relations: [],
          }],
        }
      : { items: [] })
    mocks.getCmsEntry.mockResolvedValue({
      entry: { id: "author-id", status: "published", version: "v1" },
      locales: [{ locale: "en", slug: "ada", title: "Ada", frontmatter: { name: "Ada Lovelace" }, body: null, isSource: true }],
      relations: [],
    })
    mountPicker()

    click(button("Bind text field"))
    await vi.waitFor(() => expect(elementWithText("Posts")).toBeTruthy())
    click(elementWithText("Posts"))
    await vi.waitFor(() => expect(elementWithText("Post")).toBeTruthy())
    click(elementWithText("Post"))
    await vi.waitFor(() => expect(document.body.querySelector('button[aria-label="Field for h1"]')).not.toBeNull())
    await selectField("author.name")

    await vi.waitFor(() => expect(document.body.textContent).toContain("Ada Lovelace"))
    expect(mocks.getCmsEntry).toHaveBeenCalledWith("/project", "authors-id", "author-id")
    expect(document.body.textContent).not.toContain("author-id")
  })

  it("keeps the picker open and the document unchanged when Apply fails", async () => {
    mocks.getCollections.mockResolvedValue({
      collections: [{
        id: "site-copy",
        name: "site-copy",
        label: "Site Copy",
        schema: { fields: [{ key: "heading", label: "Heading", type: "text" }] },
      }],
    })
    mocks.listCmsEntries.mockResolvedValue({
      items: [{
        entry: { id: "hero-id", status: "published", version: "v1" },
        locales: [{ locale: "en", slug: "hero", title: "Hero", frontmatter: { heading: "Heading" }, body: null, isSource: true }],
        relations: [],
      }],
    })
    const { model, saveError, commitModelMutation } = mountPicker()
    const before = JSON.stringify(model.value)

    click(button("Bind text field"))
    await vi.waitFor(() => expect(elementWithText("Site Copy")).toBeTruthy())
    click(elementWithText("Site Copy"))
    await vi.waitFor(() => expect(elementWithText("Hero")).toBeTruthy())
    click(elementWithText("Hero"))
    await vi.waitFor(() => expect(document.body.querySelector('button[aria-label="Field for h1"]')).not.toBeNull())
    saveError.value = "Astro source changed on disk."
    commitModelMutation.mockResolvedValueOnce(false)
    click(elementWithText("Apply"))

    await vi.waitFor(() => expect(document.body.textContent).toContain("Astro source changed on disk."))
    expect(commitModelMutation).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(model.value)).toBe(before)
    expect(document.body.querySelector('section[aria-label="Map CMS fields"]')).not.toBeNull()
  })

  it("dismisses on Escape and restores focus to the toolbar trigger", async () => {
    mocks.getCollections.mockResolvedValue({ collections: [] })
    mountPicker()
    const trigger = button("Bind text field")
    trigger.focus()
    click(trigger)
    await vi.waitFor(() => expect(document.body.querySelector('section[aria-label="Choose a collection"]')).not.toBeNull())
    const content = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]')
    if (!content) throw new Error("Could not find picker content")
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

    await vi.waitFor(() => expect(document.body.querySelector('section[aria-label="Choose a collection"]')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it("wraps a structure and resolves every target by stable node ID in one transaction", async () => {
    mocks.getCollections.mockResolvedValue({
      collections: [{
        id: "posts-id",
        name: "posts",
        label: "Posts",
        schema: { fields: [
          { key: "title", label: "Title", type: "text" },
          { key: "summary", label: "Summary", type: "text" },
        ] },
      }],
    })
    mocks.listCmsEntries.mockResolvedValue({
      items: [{
        entry: { id: "post-id", status: "published", version: "v1" },
        locales: [{ locale: "en", slug: "post", title: "Post", frontmatter: { title: "Bound title", summary: "Bound summary" }, body: null, isSource: true }],
        relations: [],
      }],
    })
    const { model, commitModelMutation } = mountPicker({
      imports: [],
      extraFrontmatter: "",
      nodes: [{
        id: "card",
        kind: "element",
        name: "article",
        props: {},
        children: [{
          id: "heading",
          kind: "element",
          name: "h2",
          props: {},
          children: [{ id: "heading-copy", kind: "text", value: "Fallback title" }],
        }, {
          id: "summary",
          kind: "element",
          name: "p",
          props: {},
          children: [{ id: "summary-copy", kind: "text", value: "Fallback summary" }],
        }],
      }],
      propSchema: [],
      slots: [],
      extendsTag: null,
    }, "loop")

    click(button("Repeat from collection"))
    await vi.waitFor(() => expect(elementWithText("Posts")).toBeTruthy())
    click(elementWithText("Posts"))
    await vi.waitFor(() => expect(document.body.querySelector('button[aria-label="Field for h2"]')).not.toBeNull())
    await selectField("title", "h2")
    await selectField("summary", "p")
    click(elementWithText("Apply"))
    await vi.waitFor(() => expect(commitModelMutation).toHaveBeenCalledTimes(1))

    expect(model.value?.nodes[0]?.kind).toBe("map")
    expect(JSON.stringify(model.value?.nodes)).toContain('entry?.data?.[\\"title\\"]')
    expect(JSON.stringify(model.value?.nodes)).toContain('entry?.data?.[\\"summary\\"]')
    expect(model.value?.extraFrontmatter).toContain("@aria-cms-query")
  })
})
