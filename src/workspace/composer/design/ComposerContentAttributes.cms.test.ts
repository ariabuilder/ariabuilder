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
const confirmConnectedText = vi.hoisted(() => vi.fn())

vi.mock("@/lib/workspace", async (original) => ({
  ...await original<typeof import("@/lib/workspace")>(),
  getCollections: cmsMocks.getCollections,
}))
vi.mock("@/lib/cms", async (original) => ({
  ...await original<typeof import("@/lib/cms")>(),
  getCmsEntry: cmsMocks.getCmsEntry,
  updateCmsEntry: cmsMocks.updateCmsEntry,
}))
vi.mock("@/composables/useConfirm", () => ({ confirm: confirmConnectedText }))

let unmount: (() => void) | null = null

afterEach(() => {
  unmount?.()
  unmount = null
  vi.clearAllMocks()
})

describe("Composer CMS content editing", () => {
  it("asks before replacing a page-level CMS binding and restores it when cancelled", async () => {
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
    const commitInspectorMutation = vi.fn((_label, mutation) => {
      const result = mutation(model.value!)
      return result.ok
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
          commitInspectorMutation,
          computedStyle: vi.fn().mockResolvedValue({}),
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
    confirmConnectedText.mockResolvedValueOnce(false)
    input.value = "Keep this connected."
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await vi.waitFor(() => expect(confirmConnectedText).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(input.value).toBe("Build pages on a visual canvas."))
    expect(commitInspectorMutation).not.toHaveBeenCalled()
    expect(cmsMocks.updateCmsEntry).not.toHaveBeenCalled()

    confirmConnectedText.mockResolvedValueOnce(true)
    input.value = "Manage content visually."
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await vi.waitFor(() => expect(commitInspectorMutation).toHaveBeenCalledOnce())
    expect(confirmConnectedText).toHaveBeenLastCalledWith({
      title: "Replace connected text?",
      description: "This text comes from CMS field “description”. Replacing it in the Inspector removes that live connection and creates static text.",
      confirmLabel: "Replace with static text",
      cancelLabel: "Keep connection",
      destructive: true,
    })
    expect(cmsMocks.updateCmsEntry).not.toHaveBeenCalled()
    expect(paragraph.children?.[1]).toMatchObject({ kind: "text", value: "Manage content visually." })
  })

  it("resolves a related value for display but detaches it instead of writing an indirect owner", async () => {
    const heading: ElementNode = {
      id: "byline",
      kind: "element",
      name: "p",
      props: {},
      children: [{
        id: "author-name",
        kind: "expr",
        value: '{/* @aria-cms-field:author.name */ authorsById.get(String(((featuredPost?.data?.["author"])?.id ?? (featuredPost?.data?.["author"])?.slug ?? (featuredPost?.data?.["author"])?.ariaEntryId ?? featuredPost?.data?.["author"]) ?? ""))?.["name"] ?? /* @aria-cms-fallback */ "Unknown author"}',
      }],
    }
    const postRecord = {
      entry: { id: "post-id", version: "p1" },
      locales: [{
        locale: "en",
        title: "Featured post",
        slug: "featured",
        frontmatter: { author: { id: "author-id", collection: "authors" } },
        body: [],
        isSource: true,
        status: "published",
        publishedAt: null,
      }],
      relations: [],
    }
    const authorRecord = {
      entry: { id: "author-id", version: "a1" },
      locales: [{
        locale: "en",
        title: "Ada",
        slug: "ada",
        frontmatter: { name: "Ada Lovelace" },
        body: [],
        isSource: true,
        status: "published",
        publishedAt: null,
      }],
      relations: [],
    }
    cmsMocks.getCollections.mockResolvedValue({
      collections: [
        { id: "posts-id", name: "posts", label: "Posts", source: { kind: "aria-managed" } },
        { id: "authors-id", name: "authors", label: "Authors", source: { kind: "aria-managed" } },
      ],
    })
    cmsMocks.getCmsEntry.mockImplementation(async (_projectPath, collectionId) => collectionId === "posts-id" ? postRecord : authorRecord)
    cmsMocks.updateCmsEntry.mockImplementation(async (_projectPath, input) => ({
      ...authorRecord,
      entry: { ...authorRecord.entry, version: "a2" },
      locales: [{ ...authorRecord.locales[0], frontmatter: input.patch.upsertLocale.frontmatter }],
    }))
    const model = ref<AstroDocumentModel | null>({
      imports: [],
      propSchema: [],
      slots: [],
      extendsTag: null,
      nodes: [heading],
      extraFrontmatter: `import { getCollection } from "astro:content";
/* @aria-cms-query:featured-post */
const featuredPost = (await getCollection("posts")).find((entry) => (entry.data.slug ?? entry.id) === "featured");
/* @aria-cms-query-end:featured-post */
/* @aria-cms-lookup:authors */
const authorsById = new Map((await getCollection("authors")).flatMap((entry) => {
  const value = { ...entry.data, id: entry.id };
  return [[entry.id, value]];
}));
/* @aria-cms-lookup-end:authors */`,
    })
    const host = document.createElement("div")
    document.body.append(host)
    const InspectorHost = defineComponent({
      setup() {
        provideInspectorContext()
        return () => h(ComposerContentAttributes, { node: heading, openSection: "content" })
      },
    })
    const commitInspectorMutation = vi.fn((_label, mutation) => {
      const result = mutation(model.value!)
      return result.ok
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
          commitInspectorMutation,
          computedStyle: vi.fn().mockResolvedValue({}),
          reloadPreview: vi.fn(),
        } as unknown as ComposerDocumentSession)
        return () => h(InspectorHost)
      },
    })
    app.mount(host)
    unmount = () => { app.unmount(); host.remove() }

    await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>("#composer-cms-content")?.value).toBe("Ada Lovelace"))
    expect(host.textContent).toContain("Authors · Ada · en")
    expect(host.textContent).not.toContain("authorsById.get")

    const input = host.querySelector<HTMLInputElement>("#composer-cms-content")!
    confirmConnectedText.mockResolvedValueOnce(true)
    input.value = "Grace Hopper"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await vi.waitFor(() => expect(commitInspectorMutation).toHaveBeenCalledOnce())
    expect(cmsMocks.updateCmsEntry).not.toHaveBeenCalled()
    expect(heading.children?.[0]).toMatchObject({ kind: "text", value: "Grace Hopper" })
  })
})
