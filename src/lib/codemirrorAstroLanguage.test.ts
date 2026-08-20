import { describe, expect, it } from "vitest"
import { EditorState } from "@codemirror/state"
import { ensureSyntaxTree } from "@codemirror/language"
import { NodeProp } from "@lezer/common"
import {
  astro,
  findAstroFrontmatter,
  parseAstroOuterTree,
} from "./codemirrorAstroLanguage"

const sample = `---
const title: string = "Hello"
function greet() {
  return title
}
---
<div class="hero">
  <h1>Hi</h1>
</div>
`

describe("findAstroFrontmatter", () => {
  it("locates closed frontmatter ranges", () => {
    const fm = findAstroFrontmatter(sample)
    expect(fm).not.toBeNull()
    expect(sample.slice(fm!.openFrom, fm!.openTo)).toBe("---")
    expect(sample.slice(fm!.closeFrom, fm!.closeTo)).toBe("---")
    expect(sample.slice(fm!.contentFrom, fm!.contentTo)).toContain("const title")
    expect(sample.slice(fm!.bodyFrom)).toContain("<div")
    expect(fm!.closed).toBe(true)
  })

  it("allows leading blank lines", () => {
    const text = `\n\n---\nconst x = 1\n---\n<p/>\n`
    const fm = findAstroFrontmatter(text)
    expect(fm?.openFrom).toBe(2)
    expect(fm?.closed).toBe(true)
  })

  it("returns null when the document does not start with a fence", () => {
    expect(findAstroFrontmatter("<div>no frontmatter</div>")).toBeNull()
  })
})

describe("parseAstroOuterTree", () => {
  it("builds FrontmatterContent and Text nodes", () => {
    const tree = parseAstroOuterTree(sample)
    expect(tree.toString()).toBe(
      "Document(Frontmatter(FrontmatterOpen,FrontmatterContent,FrontmatterClose),Text)",
    )
  })

  it("builds a single Text node without frontmatter", () => {
    const tree = parseAstroOuterTree(`<section><p>Hello</p></section>`)
    expect(tree.toString()).toBe("Document(Text)")
  })
})

describe("astro() mixed language", () => {
  it("mounts TypeScript in frontmatter and HTML in the body", () => {
    const support = astro()
    const tree = support.language.parser.parse(sample)

    const names = new Set<string>()
    let sawMountedScript = false
    let sawHtmlElement = false

    tree.iterate({
      enter: (node) => {
        names.add(node.name)
        if (node.name === "FrontmatterContent") {
          const mounted = node.tree?.prop(NodeProp.mounted)
          if (mounted && !mounted.overlay) {
            sawMountedScript = true
            expect(mounted.tree.topNode.name).toBe("Script")
          }
        }
        if (node.name === "Element" || node.name === "TagName") {
          sawHtmlElement = true
        }
      },
    })

    const topMount = tree.prop(NodeProp.mounted)
    if (topMount?.tree) {
      topMount.tree.iterate({
        enter: (node) => {
          names.add(node.name)
          if (node.name === "Element" || node.name === "TagName") {
            sawHtmlElement = true
          }
        },
      })
    }

    expect(
      sawMountedScript || names.has("const") || names.has("VariableDefinition"),
      `names=${[...names].join(",")} tree=${tree.toString()} mount=${topMount ? topMount.tree.toString() : "none"}`,
    ).toBe(true)

    expect(
      sawHtmlElement,
      `names=${[...names].join(",")} tree=${tree.toString()} mount=${topMount ? `${JSON.stringify(topMount.overlay)} ${topMount.tree.toString()}` : "none"}`,
    ).toBe(true)

    // Also verify the editor Language state path.
    const state = EditorState.create({
      doc: sample,
      extensions: [support],
    })
    const editorTree = ensureSyntaxTree(state, sample.length, 5000)
    expect(editorTree).not.toBeNull()
  })

  it("still highlights HTML-only documents without frontmatter", () => {
    const doc = `<section><p>Hello</p></section>`
    const tree = astro().language.parser.parse(doc)
    const topMount = tree.prop(NodeProp.mounted)
    const names = new Set<string>()

    tree.iterate({
      enter: (node) => {
        names.add(node.name)
      },
    })
    if (topMount?.tree) {
      topMount.tree.iterate({
        enter: (node) => {
          names.add(node.name)
        },
      })
    }

    expect(
      names.has("Element") || names.has("TagName"),
      `names=${[...names].join(",")} mount=${topMount ? topMount.tree.toString() : "none"} base=${tree.toString()}`,
    ).toBe(true)
    expect(names.has("Frontmatter")).toBe(false)
  })
})
