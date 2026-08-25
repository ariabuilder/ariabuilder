import { describe, expect, it } from "vitest"
import { inferComposerContentBindingSource } from "./contentBindingSource"
import type { AstroDocumentModel } from "./types"

function model(overrides: Partial<AstroDocumentModel>): AstroDocumentModel {
  return {
    imports: [],
    extraFrontmatter: "",
    nodes: [],
    propSchema: [],
    slots: [],
    extendsTag: null,
    ...overrides,
  }
}

describe("inferComposerContentBindingSource", () => {
  it("opens project data for local loop fields", () => {
    const doc = model({
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
            open: { type: "expr", value: "faq.open" },
          },
          children: [],
        }],
      }],
    })

    expect(inferComposerContentBindingSource(doc, "0")).toBe("project")
    expect(inferComposerContentBindingSource(doc, "0.0")).toBe("project")
  })

  it("opens Aria CMS for managed collection loops", () => {
    const doc = model({
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
    })

    expect(inferComposerContentBindingSource(doc, "0")).toBe("cms")
    expect(inferComposerContentBindingSource(doc, "0.0")).toBe("cms")
  })

  it("opens project translations when a managed translation fallback is present", () => {
    const doc = model({
      nodes: [{
        id: "heading",
        kind: "element",
        name: "h1",
        props: {},
        children: [{
          id: "title",
          kind: "expr",
          value: '{hero?.["title"] ?? /* @aria-translation-fallback */ "Pricing"}',
        }],
      }],
    })

    expect(inferComposerContentBindingSource(doc, "0")).toBe("translations")
  })

  it("keeps a managed project data property out of the CMS heuristic", () => {
    const doc = model({
      nodes: [{
        id: "title",
        kind: "expr",
        value: '{project.data.title ?? /* @aria-project-fallback */ "Original"}',
      }],
    })
    expect(inferComposerContentBindingSource(doc, "0")).toBe("project")
  })

  it("keeps a hand-written local data property out of the CMS heuristic", () => {
    const doc = model({
      extraFrontmatter: "const project = { data: { title: 'Local' } }",
      nodes: [{ id: "title", kind: "expr", value: "{project.data.title}" }],
    })
    expect(inferComposerContentBindingSource(doc, "0")).toBe("project")
  })

  it("leaves static authored copy on None", () => {
    const doc = model({
      nodes: [{
        id: "heading",
        kind: "element",
        name: "h2",
        props: {},
        children: [{ id: "label", kind: "text", value: "Understanding Our Pricing Plans" }],
      }],
    })

    expect(inferComposerContentBindingSource(doc, "0")).toBe("none")
  })

  it("recognizes expressions that use imported project data", () => {
    const doc = model({
      imports: [{ name: "featuresData", path: "../data/features.json" }],
      nodes: [{
        id: "heading",
        kind: "element",
        name: "h2",
        props: {},
        children: [{ id: "title", kind: "expr", value: "{featuresData[0].title}" }],
      }],
    })
    expect(inferComposerContentBindingSource(doc, "0")).toBe("project")
  })
})
