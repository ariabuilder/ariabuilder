import { describe, expect, it } from "vitest"
import { buildComposerLayerTree } from "../../../shared/composer/layers"
import { buildComposerLayoutContract } from "../../../shared/composer/layoutAuthoring"
import { parseAstro } from "../../../shared/composer/parseAstro"
import {
  decidePageLayoutContextAction,
  shouldClearLayoutForPageLoad,
} from "./pageLayoutContext"

async function modelFor(source: string) {
  const result = await parseAstro(source)
  expect(result.editable).toBe(true)
  if (!result.editable) throw new Error("expected editable source")
  return result.model
}

describe("decidePageLayoutContextAction", () => {
  const pageFile = "src/pages/index.astro"
  const componentFile = "src/components/Hero.astro"

  it("preserves layout while drilled into a component", () => {
    expect(
      decidePageLayoutContextAction({
        stackKind: "component",
        activeFile: componentFile,
        pageStackFile: pageFile,
        hasLayoutWrapper: false,
      }),
    ).toBe("preserve")
  })

  it("preserves layout while drilled into a layout document", () => {
    expect(
      decidePageLayoutContextAction({
        stackKind: "layout",
        activeFile: "src/layouts/Base.astro",
        pageStackFile: pageFile,
        hasLayoutWrapper: false,
      }),
    ).toBe("preserve")
  })

  it("preserves layout during the post-pop race (kind=page, file still component)", () => {
    expect(
      decidePageLayoutContextAction({
        stackKind: "page",
        activeFile: componentFile,
        pageStackFile: pageFile,
        hasLayoutWrapper: false,
      }),
    ).toBe("preserve")
  })

  it("refreshes when page kind and file are aligned with a layout wrapper", () => {
    expect(
      decidePageLayoutContextAction({
        stackKind: "page",
        activeFile: pageFile,
        pageStackFile: pageFile,
        hasLayoutWrapper: true,
      }),
    ).toBe("refresh")
  })

  it("clears when the page has no layout wrapper", () => {
    expect(
      decidePageLayoutContextAction({
        stackKind: "page",
        activeFile: pageFile,
        pageStackFile: pageFile,
        hasLayoutWrapper: false,
      }),
    ).toBe("clear")
  })

  it("preserves when the stack is empty / file missing", () => {
    expect(
      decidePageLayoutContextAction({
        stackKind: null,
        activeFile: null,
        pageStackFile: null,
        hasLayoutWrapper: false,
      }),
    ).toBe("preserve")
  })
})

describe("shouldClearLayoutForPageLoad", () => {
  it("keeps layout when returning to the same page owner", () => {
    expect(
      shouldClearLayoutForPageLoad({
        pageFile: "src/pages/index.astro",
        layoutOwnerFile: "src/pages/index.astro",
      }),
    ).toBe(false)
  })

  it("clears layout when switching to a different page", () => {
    expect(
      shouldClearLayoutForPageLoad({
        pageFile: "src/pages/about.astro",
        layoutOwnerFile: "src/pages/index.astro",
      }),
    ).toBe(true)
  })

  it("does not clear when there is no prior owner", () => {
    expect(
      shouldClearLayoutForPageLoad({
        pageFile: "src/pages/index.astro",
        layoutOwnerFile: null,
      }),
    ).toBe(false)
  })
})

describe("page layout projection after drill return", () => {
  it("keeps slot-group / layout name when contract is preserved across return", async () => {
    const layout = await modelFor(`---
const { title } = Astro.props
---
<html><body>
  <header><slot name="header" /></header>
  <main><slot /></main>
</body></html>`)
    const page = await modelFor(`---
import Layout from "../layouts/Layout.astro"
---
<Layout>
  <section class="hero-section"><h1>sasha simler</h1></section>
  <style>h1 { color: red }</style>
</Layout>`)
    const contract = buildComposerLayoutContract(layout)

    // Simulate breadcrumb-back with preserved layout refs (the bug fixed path).
    const withLayout = buildComposerLayerTree(page, {
      pageDocument: true,
      layoutContract: contract,
      layoutModel: layout,
    })
    expect(withLayout.document[0]?.label).toBe("Layout")
    expect(
      withLayout.content.some((row) => row.treeKey.startsWith("slot-group:")),
    ).toBe(true)

    // Simulate the regression: contract wiped during drill / post-pop race.
    const withoutLayout = buildComposerLayerTree(page, { pageDocument: true })
    expect(withoutLayout.document[0]?.label).toBe("No layout")
    expect(
      withoutLayout.content.some((row) => row.treeKey.startsWith("slot-group:")),
    ).toBe(false)
    // Flat projection: Layout (or its children) appear as normal content rows.
    expect(withoutLayout.content.map((row) => row.label)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Layout|Section/i)]),
    )
  })
})
