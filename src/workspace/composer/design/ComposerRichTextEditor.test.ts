// @vitest-environment jsdom

import { createApp, h, nextTick, ref, type ComponentPublicInstance } from "vue"
import type { Editor } from "@tiptap/core"
import { afterEach, describe, expect, it, vi } from "vitest"
import editorSource from "./ComposerRichTextEditor.vue?raw"
import ComposerRichTextEditor from "./ComposerRichTextEditor.vue"
import type { EditableNode, ElementNode } from "../../../../shared/composer/types"
import {
  provideComposerDocument,
  type ComposerDocumentSession,
} from "../useComposerDocumentSession"

const mounted: Array<() => void> = []

function text(value: string) {
  return { id: `text-${value}`, kind: "text" as const, value }
}

function mountEditor(
  node: ElementNode,
  disabled = false,
  session?: Partial<ComposerDocumentSession>,
) {
  const host = document.createElement("div")
  document.body.append(host)
  let component: (ComponentPublicInstance & {
    editor?: Editor | null
    previewTextColor?: (color: string) => void
  }) | null = null
  const app = createApp({
    setup() {
      if (session) {
        provideComposerDocument(session as ComposerDocumentSession)
      }
      return () => h(ComposerRichTextEditor, {
        node,
        path: "0",
        disabled,
        ref: (value: unknown) => { component = value as typeof component },
      })
    },
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, component: () => component }
}

function mountControlledEditor(node: ElementNode) {
  const host = document.createElement("div")
  document.body.append(host)
  const currentNode = ref(node)
  let component: (ComponentPublicInstance & { editor?: Editor | null }) | null = null
  const app = createApp({
    setup() {
      return () => h(ComposerRichTextEditor, {
        node: currentNode.value,
        path: "0",
        ref: (value: unknown) => { component = value as typeof component },
        onUpdate: (children: EditableNode[]) => {
          currentNode.value = { ...currentNode.value, children }
        },
      })
    },
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, component: () => component, currentNode }
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  document.body.innerHTML = ""
})
describe("ComposerRichTextEditor", () => {
  it("shows inline formatting without block controls for a heading", async () => {
    const { host } = mountEditor({
      id: "heading",
      kind: "element",
      name: "h1",
      props: {},
      children: [
        text("Real Projects. "),
        {
          id: "strong",
          kind: "element",
          name: "strong",
          props: {},
          children: [text("Real Results.")],
        },
      ],
    })
    await nextTick()
    await vi.waitFor(() => expect(host.querySelector(".ProseMirror")).not.toBeNull())

    expect(host.querySelector('[aria-label="Rich text content"]')).not.toBeNull()
    const toolbar = host.querySelector('[role="toolbar"]')
    expect(toolbar?.classList.contains("flex-nowrap")).toBe(true)
    expect(toolbar?.classList.contains("overflow-x-auto")).toBe(true)
    expect(toolbar?.classList.contains("border-b")).toBe(false)
    expect(toolbar?.querySelector(".w-px")).toBeNull()
    expect(toolbar?.parentElement?.classList.contains("border")).toBe(false)
    expect(toolbar?.parentElement?.classList.contains("rounded-md")).toBe(false)
    expect(host.querySelector('button[aria-label="Bold"]')).not.toBeNull()
    const colorButton = host.querySelector('button[aria-label="Text color"]') as HTMLButtonElement
    expect(colorButton).not.toBeNull()
    expect(colorButton.classList.contains("size-7")).toBe(true)
    expect(colorButton.querySelector(":scope > span")?.classList.contains("size-3")).toBe(true)
    const variableButton = host.querySelector('button[aria-label="Assign variable"]')
    expect(variableButton?.classList.contains("border-0")).toBe(true)
    expect(variableButton?.classList.contains("bg-transparent")).toBe(true)
    expect(variableButton?.querySelector("svg")?.classList.contains("size-3.5")).toBe(true)
    expect(host.querySelector('button[aria-label="Strikethrough"] svg')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Bulleted list"]')).toBeNull()
    expect(host.textContent).toContain("Real Projects. Real Results.")
    expect(host.querySelector("strong")?.textContent).toBe("Real Results.")
    expect(host.querySelector(".composer-rich-text-editor")?.classList.contains("border-t")).toBe(true)
    expect(editorSource).toContain("font-weight: 700;")
    expect(editorSource).toContain("font-style: italic;")
    expect(editorSource).toContain("text-decoration: underline;")
    expect(editorSource).toContain("text-decoration: line-through;")
    expect(editorSource).toContain("font-family: var(--font-mono, ui-monospace, monospace);")
    expect(editorSource).toContain("text-underline-offset: 0.15em;")

    const strike = host.querySelector('button[aria-label="Strikethrough"]') as HTMLButtonElement
    strike.click()
    await nextTick()
    expect(strike.getAttribute("aria-pressed")).toBe("true")
  })

  it("resolves a heading span wrapper as editable text instead of a locked token", async () => {
    const { host } = mountEditor({
      id: "hero-title",
      kind: "element",
      name: "h1",
      props: { class: { type: "string", value: "hero__title" } },
      children: [
        text("Build visually."),
        { id: "break", kind: "element", name: "br", props: {}, children: null },
        {
          id: "accent",
          kind: "element",
          name: "span",
          props: {},
          children: [text("Own every file.")],
        },
      ],
    })
    await nextTick()
    await vi.waitFor(() => expect(host.querySelector(".ProseMirror")).not.toBeNull())

    expect(host.textContent).toContain("Build visually.")
    expect(host.textContent).toContain("Own every file.")
    expect(host.querySelector("[data-composer-rich-text-inline]")).toBeNull()
    expect(host.querySelector("[data-composer-span]")?.textContent).toBe("Own every file.")
    expect(host.querySelector('button[aria-label="Edit source in Code"]')).toBeNull()
  })

  it("uses compact start-aligned Inspector typography for wrapping inline text", async () => {
    const { host } = mountEditor({
      id: "long-paragraph",
      kind: "element",
      name: "p",
      props: { class: { type: "string", value: "site-centered-display-copy" } },
      children: [text("From downtown Toronto cores to remote northern sites, our in-house maintained fleet is mobilized fast.")],
    })
    await nextTick()
    await vi.waitFor(() => expect(host.querySelector(".ProseMirror")).not.toBeNull())

    const surface = host.querySelector(".composer-rich-text-editor") as HTMLElement
    const proseMirror = host.querySelector(".ProseMirror") as HTMLElement
    const paragraph = proseMirror.querySelector("p") as HTMLParagraphElement

    expect(surface.dataset.editorMode).toBe("inline")
    expect(surface.classList.contains("font-sans")).toBe(true)
    expect(surface.classList.contains("text-sm")).toBe(true)
    expect(surface.classList.contains("font-normal")).toBe(true)
    expect(surface.classList.contains("leading-[1.5]")).toBe(true)
    expect(surface.classList.contains("tracking-normal")).toBe(true)
    expect(surface.classList.contains("bg-background")).toBe(true)
    expect(surface.classList.contains("text-foreground")).toBe(true)
    expect(surface.getAttribute("style")).toBeNull()
    expect(editorSource).toContain("white-space: normal;")
    expect(editorSource).toContain("color: inherit;")
    expect(editorSource).toContain("background-color: transparent;")
    expect(editorSource).toContain("text-align: start;")
    expect(paragraph.textContent).toContain("remote northern sites")

    proseMirror.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    proseMirror.focus()
    await nextTick()
    expect(surface.dataset.keyboardFocus).toBeUndefined()

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
    await nextTick()
    expect(surface.dataset.keyboardFocus).toBe("true")
    expect(editorSource).toContain('[data-keyboard-focus="true"] :deep(.ProseMirror:focus)')
  })

  it("shows an explicit text color mark without a toolbar clear button", async () => {
    const mountedEditor = mountEditor({
      id: "heading-color",
      kind: "element",
      name: "h1",
      props: {},
      children: [{
        id: "color-span",
        kind: "element",
        name: "span",
        props: { style: { type: "string", value: "color: var(--color-primary)" } },
        children: [text("Colored")],
      }],
    })
    const { host } = mountedEditor
    await nextTick()
    await vi.waitFor(() => expect(host.querySelector(".ProseMirror")).not.toBeNull())

    const editor = mountedEditor.component()?.editor
    editor?.commands.selectAll()
    await nextTick()
    expect(host.querySelector('button[aria-label="Remove text color"]')).toBeNull()
    const colored = host.querySelector("[data-composer-text-color]") as HTMLElement
    expect(colored.getAttribute("data-composer-text-color")).toBe("var(--color-primary)")
    expect(colored.style.color).toBe("var(--color-primary)")
    expect(editor?.getAttributes("textColor").color).toBe("var(--color-primary)")
  })

  it("preserves the caret across controlled model echoes while typing", async () => {
    const mountedEditor = mountControlledEditor({
      id: "colored-copy",
      kind: "element",
      name: "p",
      props: {},
      children: [{
        id: "colored-copy-span",
        kind: "element",
        name: "span",
        props: { style: { type: "string", value: "color: var(--color-primary)" } },
        children: [text("Copy")],
      }],
    })
    await vi.waitFor(() => expect(mountedEditor.component()?.editor).toBeTruthy())

    const editor = mountedEditor.component()!.editor!
    editor.commands.setTextSelection(3)
    editor.commands.insertContent("X")
    await nextTick()
    const afterFirstEdit = editor.state.selection.from

    editor.commands.insertContent("Y")
    await nextTick()

    expect(afterFirstEdit).toBe(4)
    expect(editor.state.selection.from).toBe(5)
    expect(editor.getText()).toBe("CoXYpy")
  })

  it("reflects canvas background and text colors without adopting canvas typography", async () => {
    const computedStyle = vi.fn(async ({ relativePath }: { relativePath?: string }) => ({
      color: relativePath?.startsWith("1") ? "rgb(24, 74, 138)" : "rgb(31, 41, 55)",
      ...(relativePath ? {} : {
        "aria-effective-background": "linear-gradient(135deg, rgb(7, 11, 20) 0%, rgb(11, 16, 32) 52%, rgb(16, 26, 53) 100%) rgba(0, 0, 0, 0)",
        "aria-effective-background-color": "rgb(245, 247, 250)",
      }),
    }))
    const previewStyle = vi.fn()
    const clearPreviewStyle = vi.fn()
    const mountedEditor = mountEditor({
      id: "computed-heading",
      kind: "element",
      name: "h1",
      props: { class: { type: "string", value: "project-heading" } },
      children: [
        text("Real Projects. "),
        {
          id: "computed-strong",
          kind: "element",
          name: "strong",
          props: {},
          children: [text("Real Results.")],
        },
      ],
    }, false, {
      computedStyle: computedStyle as ComposerDocumentSession["computedStyle"],
      previewStyle,
      clearPreviewStyle,
    })
    const { host } = mountedEditor
    await nextTick()
    await vi.waitFor(() => expect(computedStyle).toHaveBeenCalledWith({
      path: "0",
      properties: [
        "color",
        "aria-effective-background",
        "aria-effective-background-color",
      ],
    }))
    await vi.waitFor(() => expect(computedStyle).toHaveBeenCalledWith({
      path: "0",
      relativePath: "1",
      properties: ["color"],
    }))

    const editor = mountedEditor.component()?.editor
    editor?.commands.setTextSelection(18)
    await vi.waitFor(() => {
      const swatch = host.querySelector(
        'button[aria-label="Text color"] span.absolute',
      ) as HTMLElement
      expect(swatch.style.backgroundColor).toBe("rgb(24, 74, 138)")
    })
    const editorSurface = host.querySelector(".composer-rich-text-editor") as HTMLElement
    expect(editorSurface.style.color).toBe("rgb(31, 41, 55)")
    expect(editorSurface.style.backgroundImage).toContain("linear-gradient(135deg")
    expect(editorSurface.style.backgroundImage).toContain("rgb(7, 11, 20)")
    expect(editorSurface.style.getPropertyValue("--composer-rich-text-source-1-0"))
      .toBe("rgb(24, 74, 138)")
    expect((host.querySelector('[data-composer-source-path="1.0"]') as HTMLElement).style.color)
      .toContain("--composer-rich-text-source-1-0")
    expect(editorSurface.classList.contains("font-sans")).toBe(true)
    expect(editorSurface.classList.contains("text-sm")).toBe(true)
    expect(editorSource).toContain("text-align: start;")
    const toolbar = host.querySelector('[role="toolbar"]') as HTMLElement
    expect(toolbar.style.backgroundColor).toBe("")
    expect(host.querySelector("strong")?.getAttribute("data-composer-source-path"))
      .toBe("1")
    mountedEditor.component()?.previewTextColor?.("#be185d")
    expect(previewStyle).toHaveBeenCalledWith(
      "0",
      "color: #be185d !important;",
      "1.0",
    )
  })

  it("shows block controls for an explicit Rich Text primitive", async () => {
    const { host } = mountEditor({
      id: "rich",
      kind: "element",
      name: "div",
      props: { "data-aria-type": { type: "string", value: "RichText" } },
      children: [
        {
          id: "paragraph",
          kind: "element",
          name: "p",
          props: {},
          children: [text("Rich text")],
        },
        {
          id: "heading-two",
          kind: "element",
          name: "h2",
          props: {},
          children: [text("Section heading")],
        },
        {
          id: "quote",
          kind: "element",
          name: "blockquote",
          props: {},
          children: [{
            id: "quote-paragraph",
            kind: "element",
            name: "p",
            props: {},
            children: [text("Quoted text")],
          }],
        },
        {
          id: "list",
          kind: "element",
          name: "ul",
          props: {},
          children: [{
            id: "list-item",
            kind: "element",
            name: "li",
            props: {},
            children: [text("List item")],
          }],
        },
      ],
    })
    await nextTick()
    await vi.waitFor(() => expect(host.querySelector(".ProseMirror")).not.toBeNull())

    const surface = host.querySelector(".composer-rich-text-editor") as HTMLElement
    const rootBlocks = [...host.querySelectorAll(".ProseMirror > *")] as HTMLElement[]
    expect(surface.dataset.editorMode).toBe("block")
    expect(rootBlocks.map((element) => element.tagName)).toEqual(["P", "H2", "BLOCKQUOTE", "UL"])
    expect(editorSource).toContain('.composer-rich-text-editor[data-editor-mode="block"] :deep(.ProseMirror > * + *)')
    expect(editorSource).toContain("margin-block-start: 0.75rem;")
    expect(editorSource).toMatch(/:deep\(p\),[\s\S]*:deep\(h4\) \{\s*margin: 0;/)
    expect(editorSource).toContain("border-inline-start: 2px solid var(--border);")
    expect(editorSource).toContain("list-style: disc;")
    expect(editorSource).toContain("list-style: decimal;")
    expect(host.querySelector('button[aria-label="Paragraph"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Heading 2"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Bulleted list"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Numbered list"]')).not.toBeNull()

    const quote = host.querySelector('button[aria-label="Block quote"]') as HTMLButtonElement
    quote.click()
    await nextTick()
    expect(quote.getAttribute("aria-pressed")).toBe("true")
  })

})
