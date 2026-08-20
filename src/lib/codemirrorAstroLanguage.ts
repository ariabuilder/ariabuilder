import { html } from "@codemirror/lang-html"
import { javascript, typescriptLanguage } from "@codemirror/lang-javascript"
import {
  Language,
  LanguageSupport,
  defineLanguageFacet,
  foldInside,
  foldNodeProp,
  languageDataProp,
} from "@codemirror/language"
import {
  NodeSet,
  NodeType,
  Parser,
  Tree,
  parseMixed,
  type Input,
  type PartialParse,
  type TreeFragment,
} from "@lezer/common"
import { styleTags, tags as t } from "@lezer/highlight"

const Ids = {
  Error: 0,
  Document: 1,
  Frontmatter: 2,
  FrontmatterOpen: 3,
  FrontmatterContent: 4,
  FrontmatterClose: 5,
  Text: 6,
} as const

export type AstroFrontmatterRanges = {
  openFrom: number
  openTo: number
  contentFrom: number
  contentTo: number
  closeFrom: number
  closeTo: number
  bodyFrom: number
  closed: boolean
}

/**
 * Locate Astro `---` frontmatter at the start of a document.
 * Allows leading blank lines; opening fence must begin at column 0.
 */
export function findAstroFrontmatter(text: string): AstroFrontmatterRanges | null {
  let i = 0
  while (i < text.length) {
    if (text[i] === "\n") {
      i += 1
      continue
    }
    if (text[i] === "\r") {
      i += 1
      if (text[i] === "\n") i += 1
      continue
    }
    break
  }

  if (text.slice(i, i + 3) !== "---") return null

  let openEnd = i + 3
  while (openEnd < text.length && text[openEnd] !== "\n" && text[openEnd] !== "\r") {
    if (text[openEnd] !== " " && text[openEnd] !== "\t") return null
    openEnd += 1
  }

  let contentStart = openEnd
  if (text[contentStart] === "\r") contentStart += 1
  if (text[contentStart] === "\n") contentStart += 1

  let pos = contentStart
  while (pos <= text.length) {
    const atLineStart = pos === contentStart || text[pos - 1] === "\n"
    if (atLineStart && text.slice(pos, pos + 3) === "---") {
      let fenceEnd = pos + 3
      let valid = true
      while (fenceEnd < text.length && text[fenceEnd] !== "\n" && text[fenceEnd] !== "\r") {
        if (text[fenceEnd] !== " " && text[fenceEnd] !== "\t") {
          valid = false
          break
        }
        fenceEnd += 1
      }
      if (valid) {
        let bodyStart = fenceEnd
        if (text[bodyStart] === "\r") bodyStart += 1
        if (text[bodyStart] === "\n") bodyStart += 1
        return {
          openFrom: i,
          openTo: openEnd,
          contentFrom: contentStart,
          contentTo: pos,
          closeFrom: pos,
          closeTo: fenceEnd,
          bodyFrom: bodyStart,
          closed: true,
        }
      }
    }
    if (pos >= text.length) break
    pos += 1
  }

  return {
    openFrom: i,
    openTo: openEnd,
    contentFrom: contentStart,
    contentTo: text.length,
    closeFrom: text.length,
    closeTo: text.length,
    bodyFrom: text.length,
    closed: false,
  }
}

const data = defineLanguageFacet({
  commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  indentOnInput: /^\s*(?:<\/[\w:-]+>|---)\s*$/,
  wordChars: "-_:",
})

const nodeSet = new NodeSet([
  NodeType.define({ id: Ids.Error, name: "⚠", error: true }),
  NodeType.define({
    id: Ids.Document,
    name: "Document",
    top: true,
    props: [languageDataProp.add(() => data)],
  }),
  NodeType.define({ id: Ids.Frontmatter, name: "Frontmatter" }),
  NodeType.define({ id: Ids.FrontmatterOpen, name: "FrontmatterOpen" }),
  NodeType.define({ id: Ids.FrontmatterContent, name: "FrontmatterContent" }),
  NodeType.define({ id: Ids.FrontmatterClose, name: "FrontmatterClose" }),
  NodeType.define({ id: Ids.Text, name: "Text" }),
]).extend(
  styleTags({
    FrontmatterOpen: t.processingInstruction,
    FrontmatterClose: t.processingInstruction,
  }),
  foldNodeProp.add({
    Frontmatter: foldInside,
  }),
)

function leaf(typeId: number, length: number): Tree {
  return new Tree(nodeSet.types[typeId]!, [], [], length)
}

function buildAstroTree(text: string): Tree {
  const fm = findAstroFrontmatter(text)

  if (!fm) {
    const children: Tree[] = []
    const positions: number[] = []
    if (text.length > 0) {
      children.push(leaf(Ids.Text, text.length))
      positions.push(0)
    }
    return new Tree(nodeSet.types[Ids.Document]!, children, positions, text.length)
  }

  const children: Tree[] = []
  const positions: number[] = []

  if (fm.openFrom > 0) {
    children.push(leaf(Ids.Text, fm.openFrom))
    positions.push(0)
  }

  const fmChildren: Tree[] = []
  const fmPositions: number[] = []

  fmChildren.push(leaf(Ids.FrontmatterOpen, fm.openTo - fm.openFrom))
  fmPositions.push(0)

  fmChildren.push(leaf(Ids.FrontmatterContent, fm.contentTo - fm.contentFrom))
  fmPositions.push(fm.contentFrom - fm.openFrom)

  let frontmatterLength = fm.contentTo - fm.openFrom
  if (fm.closed) {
    fmChildren.push(leaf(Ids.FrontmatterClose, fm.closeTo - fm.closeFrom))
    fmPositions.push(fm.closeFrom - fm.openFrom)
    frontmatterLength = fm.closeTo - fm.openFrom
  }

  children.push(
    new Tree(nodeSet.types[Ids.Frontmatter]!, fmChildren, fmPositions, frontmatterLength),
  )
  positions.push(fm.openFrom)

  if (fm.bodyFrom < text.length) {
    children.push(leaf(Ids.Text, text.length - fm.bodyFrom))
    positions.push(fm.bodyFrom)
  }

  return new Tree(nodeSet.types[Ids.Document]!, children, positions, text.length)
}

class AstroOuterParse implements PartialParse {
  parsedPos = 0
  stoppedAt: number | null = null

  constructor(readonly input: Input) {}

  advance(): Tree | null {
    const text = this.input.read(0, this.input.length)
    this.parsedPos = this.input.length
    return buildAstroTree(text)
  }

  stopAt(pos: number): void {
    this.stoppedAt = pos
  }
}

function createAstroParser(htmlParser: Parser): Parser {
  const wrap = parseMixed((node) => {
    if (node.type.isTop) {
      return {
        parser: htmlParser,
        overlay: (child) => child.name === "Text",
      }
    }
    if (node.name === "FrontmatterContent") {
      return { parser: typescriptLanguage.parser }
    }
    return null
  })

  return new (class extends Parser {
    createParse(
      input: Input,
      fragments: readonly TreeFragment[],
      ranges: readonly { from: number; to: number }[],
    ): PartialParse {
      return wrap(new AstroOuterParse(input), input, fragments, ranges)
    }
  })()
}

/**
 * Astro language support for composer code view: TypeScript in `---`
 * frontmatter, HTML (with nested script/style) in the template body.
 */
export function astro(): LanguageSupport {
  const htmlSupport = html({
    selfClosingTags: true,
    matchClosingTags: false,
  })
  const jsSupport = javascript({ typescript: true })
  const parser = createAstroParser(htmlSupport.language.parser)
  const language = new Language(data, parser, [], "astro")
  return new LanguageSupport(language, [htmlSupport.support, jsSupport.support])
}

/** @internal test helper — outer structure only, no mixed mounts. */
export function parseAstroOuterTree(text: string): Tree {
  return buildAstroTree(text)
}
