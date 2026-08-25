// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AstroDocumentModel, ElementNode } from "../../../../shared/composer/types"
import { provideComposerBeacon } from "../selection/useComposerBeacon"
import { provideComposerDocument, type ComposerDocumentSession } from "../useComposerDocumentSession"
import { provideInspectorContext } from "../inspector/useInspectorContext"
import ComposerContentAttributes from "./ComposerContentAttributes.vue"

const cmsMocks = vi.hoisted(() => ({
  getCollections: vi.fn(),
  getCmsEntry: vi.fn(),
  updateCmsEntry: vi.fn(),
}))

vi.mock("@/lib/workspace", async (original) => ({
  ...await original<typeof import("@/lib/workspace")>(),
  getCollections: cmsMocks.getCollections,
}))
vi.mock("@/lib/cms", async (original) => ({
  ...await original<typeof import("@/lib/cms")>(),
  getCmsEntry: cmsMocks.getCmsEntry,
  updateCmsEntry: cmsMocks.updateCmsEntry,
}))

let unmount: (() => void) | null = null

afterEach(() => {
  unmount?.()
  unmount = null
})

describe("Composer CMS content editing", () => {
  it("shows and edits the resolved value for a managed direct CMS text binding", async () => {
    const paragraph: ElementNode = {
      id: "description",
      kind: "element",
      name: "p",
      props: {},
      children: [
        { id: "leading-space", kind: "text", value: "\n  " },
        {
          id: "description-copy",
          kind: "expr",
          value: '{heroCopy?.data?.["description"] ?? /* @aria-cms-fallback */ "Fallback"}',
        },
        { id: "trailing-space", kind: "text", value: "\n" },
      ],
    }
    const record = {
      entry: { id: "hero-id", version: "v1" },
      locales: [{
        locale: "en",
        title: "Hero",
        slug: "hero",
        frontmatter: { description: "Build pages on a visual canvas." },
        body: [],
        isSource: true,
        status: "published",
        publishedAt: null,
      }],
      relations: [],
    }
    cmsMocks.getCollections.mockResolvedValue({
      collections: [{ id: "site-copy", name: "site-copy", source: { kind: "aria-managed" } }],
    })
    cmsMocks.getCmsEntry.mockResolvedValue(record)
    cmsMocks.updateCmsEntry.mockImplementation(async (_projectPath, input) => ({
      ...record,
      entry: { ...record.entry, version: "v2" },
      locales: [{
        ...record.locales[0],
        frontmatter: input.patch.upsertLocale.frontmatter,
      }],
    }))
    const model = ref<AstroDocumentModel | null>({
      imports: [],
      propSchema: [],
      slots: [],
      extendsTag: null,
      nodes: [paragraph],
      extraFrontmatter: `import { getCollection } from "astro:content";
/* @aria-cms-query:hero-copy */
const heroCopy = (await getCollection("site-copy"))
  .find((entry) => (entry.data.slug ?? entry.id) === "hero");
/* @aria-cms-query-end:hero-copy */`,
    })
    const host = document.createElement("div")
    document.body.append(host)
    const InspectorHost = defineComponent({
      setup() {
        provideInspectorContext()
        return () => h(ComposerContentAttributes, { node: paragraph, openSection: "content" })
      },
    })
    const app = createApp({
      setup() {
        provideComposerBeacon().illuminate("0")
        provideComposerDocument({
          model,
          editable: ref(true),
          designActive: ref(true),
          projectPath: ref("/tmp/aria-starter"),
          editFile: ref("src/pages/index.astro"),
          availableLayouts: ref([]),
          pages: ref([]),
          documentKind: ref("page"),
          commitInspectorMutation: vi.fn(),
        } as unknown as ComposerDocumentSession)
        return () => h(InspectorHost)
      },
    })
    app.mount(host)
    unmount = () => { app.unmount(); host.remove() }

    await vi.waitFor(() => {
      expect(host.querySelector<HTMLTextAreaElement>("#composer-cms-content")?.value)
        .toBe("Build pages on a visual canvas.")
    })
    expect(host.textContent).not.toContain("heroCopy?.data")

    const input = host.querySelector<HTMLTextAreaElement>("#composer-cms-content")!
    input.value = "Manage content visually."
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await vi.waitFor(() => expect(cmsMocks.updateCmsEntry).toHaveBeenCalled())
    expect(cmsMocks.updateCmsEntry.mock.calls.at(-1)?.[1]).toMatchObject({
      collectionId: "site-copy",
      id: "hero-id",
      version: "v1",
      patch: { upsertLocale: { frontmatter: { description: "Manage content visually." } } },
    })
  })
})
