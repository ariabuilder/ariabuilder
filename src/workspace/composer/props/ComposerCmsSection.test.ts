// @vitest-environment jsdom
import { createApp, defineComponent, h, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AstroDocumentModel } from "../../../../shared/composer/types"
import { provideComposerBeacon } from "../selection/useComposerBeacon"
import { provideComposerDocument, type ComposerDocumentSession } from "../useComposerDocumentSession"
import ComposerCmsSection from "./ComposerCmsSection.vue"

const mocks = vi.hoisted(() => ({
  getCollections: vi.fn(),
  listExternalEntries: vi.fn(),
  listCmsEntries: vi.fn(),
}))

vi.mock("@/lib/workspace", () => ({
  getCollections: mocks.getCollections,
  listExternalEntries: mocks.listExternalEntries,
}))
vi.mock("@/lib/cms", () => ({ listCmsEntries: mocks.listCmsEntries }))

const mounted: Array<() => void> = []

function mountSection(sourceModel?: AstroDocumentModel) {
  const host = document.createElement("div")
  document.body.append(host)
  const model = ref<AstroDocumentModel | null>(sourceModel ?? {
    imports: [],
    extraFrontmatter: "",
    nodes: [{ id: "text", kind: "text", value: "Hello" }],
    propSchema: [],
    slots: [],
    extendsTag: null,
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
        commitInspectorMutation: vi.fn(),
      } as unknown as ComposerDocumentSession)
      return () => h(ComposerCmsSection)
    },
  }))
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return host
}

afterEach(() => {
  mocks.getCollections.mockReset()
  mocks.listExternalEntries.mockReset()
  mocks.listCmsEntries.mockReset()
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ComposerCmsSection", () => {
  it("loads collections for the always-visible binding section", async () => {
    mocks.getCollections.mockResolvedValue({ collections: [] })
    const host = mountSection()
    await vi.waitFor(() => expect(mocks.getCollections).toHaveBeenCalledWith("/project"))

    expect(host.textContent).toContain("CMS binding")
    expect(host.querySelector("details")).toBeNull()
    expect(mocks.listCmsEntries).not.toHaveBeenCalled()
  })

  it("does not send discovered Astro collections to the managed entry API", async () => {
    mocks.getCollections.mockResolvedValue({
      collections: [{
        id: "astro:content:post",
        name: "post",
        label: "Post",
        kind: "content",
        urlPattern: null,
        listPageFile: null,
        templatePageFile: null,
        source: {
          kind: "astro-local",
          provider: "astro",
          label: "Local Astro",
          mode: "file",
          readOnly: true,
          schemaAvailable: false,
          cacheState: "unavailable",
        },
      }],
    })
    mountSection()
    await vi.waitFor(() => expect(mocks.getCollections).toHaveBeenCalledWith("/project"))

    expect(mocks.listCmsEntries).not.toHaveBeenCalled()
  })

  it("hydrates an existing multiline text binding and resolves its preview", async () => {
    mocks.getCollections.mockResolvedValue({
      collections: [{
        id: "site-copy",
        name: "site-copy",
        label: "Site Copy",
        schema: { fields: [{ key: "description", label: "Description", type: "text" }] },
      }],
    })
    mocks.listCmsEntries.mockResolvedValue({
      items: [{
        entry: { id: "hero-id", version: "v1" },
        locales: [{
          locale: "en",
          slug: "hero",
          title: "Hero",
          frontmatter: { description: "Build pages on a visual canvas." },
          body: null,
          isSource: true,
        }],
      }],
    })
    const host = mountSection({
      imports: [],
      extraFrontmatter: `/* @aria-cms-query:site-copy-hero */
const heroCopy = (await getCollection("site-copy"))
  .find((entry) => (entry.data.slug ?? entry.id) === "hero");
/* @aria-cms-query-end:site-copy-hero */`,
      nodes: [{
        id: "description",
        kind: "element",
        name: "p",
        props: { class: { type: "string", value: "hero__lede" } },
        children: [
          { id: "before", kind: "text", value: "\n  " },
          {
            id: "copy",
            kind: "expr",
            value: '{heroCopy?.data?.["description"] ?? /* @aria-cms-fallback */ "Fallback"}',
          },
          { id: "after", kind: "text", value: "\n" },
        ],
      }],
      propSchema: [],
      slots: [],
      extendsTag: null,
    })

    await vi.waitFor(() => expect(host.textContent).toContain("Build pages on a visual canvas."))
    expect(host.textContent).toContain("Description")
    expect(host.textContent).not.toContain("Target prop")
    expect(host.textContent).not.toContain("hero-id")
  })
})
