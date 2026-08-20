import { Extension, Mark, mergeAttributes, Node } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import { m } from "@/paraglide/messages.js"

export function composerSourceColorVariable(sourcePath: string): string {
  return `--composer-rich-text-source-${sourcePath.replace(/[^a-zA-Z0-9_-]/g, "-")}`
}

export const ComposerInlineDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "paragraph",
})

export const ComposerInlineKeyboard = Extension.create({
  name: "composerInlineKeyboard",
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.setHardBreak(),
    }
  },
})

export const ComposerSourcePathAttributes = Extension.create({
  name: "composerSourcePathAttributes",
  addGlobalAttributes() {
    return [{
      types: ["bold", "italic", "underline", "strike", "code", "link"],
      attributes: {
        sourcePath: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-composer-source-path"),
          renderHTML: (attributes) => {
            const sourcePath = attributes.sourcePath
            if (typeof sourcePath !== "string" || !sourcePath) return {}
            return {
              "data-composer-source-path": sourcePath,
              style: `color: var(${composerSourceColorVariable(sourcePath)}, inherit)`,
            }
          },
        },
      },
    }]
  },
})

export const ComposerSourceText = Mark.create({
  name: "composerSourceText",
  inclusive: true,
  addAttributes() {
    return { sourcePath: { default: "" } }
  },
  parseHTML() {
    return [{ tag: "span[data-composer-source-text]" }]
  },
  renderHTML({ HTMLAttributes }) {
    const sourcePath = typeof HTMLAttributes.sourcePath === "string"
      ? HTMLAttributes.sourcePath
      : ""
    return ["span", {
      "data-composer-source-text": "",
      "data-composer-source-path": sourcePath,
      style: sourcePath
        ? `color: var(${composerSourceColorVariable(sourcePath)}, inherit)`
        : undefined,
    }, 0]
  },
})

export const ComposerTextColor = Mark.create({
  name: "textColor",
  addAttributes() {
    return { color: { default: null } }
  },
  parseHTML() {
    return [
      {
        tag: "span[data-composer-text-color]",
        getAttrs: (element) => ({
          color: element.getAttribute("data-composer-text-color") || null,
        }),
      },
      {
        tag: "span[style]",
        getAttrs: (element) => ({
          color: (element as HTMLElement).style.color || null,
        }),
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    const color = typeof HTMLAttributes.color === "string"
      ? HTMLAttributes.color
      : ""
    return ["span", {
      "data-composer-text-color": color || undefined,
      style: color ? `color: ${color}` : undefined,
    }, 0]
  },
})

export const ComposerSpan = Mark.create({
  name: "composerSpan",
  inclusive: true,
  addAttributes() {
    return {
      htmlAttrs: { default: {} },
      sourcePath: { default: null },
    }
  },
  parseHTML() {
    return [{
      tag: "span[data-composer-span]",
      getAttrs: (element) => {
        const htmlAttrs: Record<string, string> = {}
        for (const attribute of Array.from((element as HTMLElement).attributes)) {
          if (attribute.name.startsWith("data-composer-")) continue
          htmlAttrs[attribute.name] = attribute.value
        }
        return { htmlAttrs }
      },
    }]
  },
  renderHTML({ HTMLAttributes }) {
    const htmlAttrs = HTMLAttributes.htmlAttrs && typeof HTMLAttributes.htmlAttrs === "object"
      ? HTMLAttributes.htmlAttrs as Record<string, unknown>
      : {}
    const sourcePath = typeof HTMLAttributes.sourcePath === "string"
      ? HTMLAttributes.sourcePath
      : ""
    const rendered: Record<string, unknown> = { "data-composer-span": "" }
    if (sourcePath) {
      rendered["data-composer-source-path"] = sourcePath
      rendered.style = `color: var(${composerSourceColorVariable(sourcePath)}, inherit)`
    }
    for (const [name, value] of Object.entries(htmlAttrs)) {
      if (name === "style" && typeof value === "string" && value && typeof rendered.style === "string") {
        rendered.style = `${value};${rendered.style}`
        continue
      }
      if (typeof value === "string") rendered[name] = value
    }
    return ["span", rendered, 0]
  },
})

type LockedToken = { token: string; removable: boolean }

function lockedTokenList(document: {
  descendants: (visit: (node: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void
}): LockedToken[] {
  const tokens: LockedToken[] = []
  document.descendants((node) => {
    if (node.type.name !== "composerLockedInline" && node.type.name !== "composerLockedBlock") return
    if (typeof node.attrs.token !== "string") return
    tokens.push({
      token: node.attrs.token,
      removable: node.attrs.removable === true,
    })
  })
  return tokens
}

function lockedTokensAllowed(before: LockedToken[], after: LockedToken[]): boolean {
  let index = 0
  for (const token of after) {
    while (index < before.length && before[index]!.token !== token.token) {
      if (!before[index]!.removable) return false
      index += 1
    }
    if (index >= before.length) return false
    index += 1
  }
  while (index < before.length) {
    if (!before[index]!.removable) return false
    index += 1
  }
  return true
}

export const ComposerLockedGuard = Extension.create({
  name: "composerLockedGuard",
  addStorage() {
    return { allowChange: false }
  },
  addProseMirrorPlugins() {
    const extension = this
    return [new Plugin({
      filterTransaction(transaction, state) {
        if (!transaction.docChanged || extension.storage.allowChange) return true
        return lockedTokensAllowed(lockedTokenList(state.doc), lockedTokenList(transaction.doc))
      },
    })]
  },
})

function lockedNode(name: string, inline: boolean) {
  return Node.create({
    name,
    group: inline ? "inline" : "block",
    inline,
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
      return {
        token: { default: "" },
        label: { default: "Source content" },
        removable: { default: false, rendered: false },
      }
    },
    parseHTML() {
      return [{ tag: `[data-composer-rich-text-${inline ? "inline" : "block"}]` }]
    },
    renderHTML({ HTMLAttributes }) {
      const label = typeof HTMLAttributes.label === "string"
        ? HTMLAttributes.label
        : "Source content"
      return [
        inline ? "span" : "div",
        mergeAttributes(HTMLAttributes, {
          [`data-composer-rich-text-${inline ? "inline" : "block"}`]: "",
          class: inline ? "composer-rich-text-locked-inline" : "composer-rich-text-locked-block",
          contenteditable: "false",
          tabindex: "0",
          "aria-label": m.composer_rich_text_locked_label({ label }),
          title: m.composer_rich_text_locked_hint(),
        }),
        label,
      ]
    },
  })
}

export const ComposerLockedInline = lockedNode("composerLockedInline", true)
export const ComposerLockedBlock = lockedNode("composerLockedBlock", false)
