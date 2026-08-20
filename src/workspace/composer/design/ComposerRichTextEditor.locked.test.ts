// @vitest-environment jsdom

import type { Editor } from "@tiptap/core"
import { NodeSelection } from "@tiptap/pm/state"
import { createApp, h, nextTick, ref, type ComponentPublicInstance } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EditableNode, ElementNode } from "../../../../shared/composer/types"
import ComposerRichTextEditor from "./ComposerRichTextEditor.vue"
import editorSource from "./ComposerRichTextEditor.vue?raw"

const mounted: Array<() => void> = []

function text(value: string) {
  return { id: `text-${value}`, kind: "text" as const, value }
}

function mountEditor(node: ElementNode, disabled = false) {
  const host = document.createElement("div")
  document.body.append(host)
  let component: (ComponentPublicInstance & { editor?: Editor | null }) | null = null
  const app = createApp({
    setup() {
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

describe("ComposerRichTextEditor locked content", () => {
  it("renders unsupported Astro content as an explicitly named locked token", async () => {
    const mountedEditor = mountEditor({
      id: "paragraph",
      kind: "element",
      name: "p",
      props: {},
      children: [text("Hello "), { id: "expr", kind: "expr", value: "{name}" }],
    })
    const { host } = mountedEditor
    await nextTick()
    await vi.waitFor(() => expect(host.querySelector(".ProseMirror")).not.toBeNull())

    const token = host.querySelector("[data-composer-rich-text-inline]")
    expect(token).not.toBeNull()
    expect(token?.getAttribute("contenteditable")).toBe("false")
    expect(token?.getAttribute("aria-label")).toContain("Locked Astro source")
    const editSource = host.querySelector(
      'button[aria-label="Edit source in Code"]',
    ) as HTMLButtonElement
    expect(editSource).not.toBeNull()
    expect(editSource.classList.contains("size-7")).toBe(true)
    expect(editSource.textContent?.trim()).toBe("")
    expect(editSource.querySelector("svg")).not.toBeNull()
    expect(editorSource).toContain('<AppIcon name="edit"')
    expect(editorSource).toContain('<TooltipContent side="bottom">')
    expect(host.querySelector('[role="toolbar"]')?.textContent).not.toContain(
      "Edit source in Code",
    )

    const editor = mountedEditor.component()?.editor
    let tokenPosition: number | null = null
    editor?.state.doc.descendants((node, position) => {
      if (node.type.name === "composerLockedInline") tokenPosition = position
    })
    expect(tokenPosition).not.toBeNull()
    if (editor && tokenPosition != null) {
      editor.view.dispatch(editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, tokenPosition),
      ))
      editor.commands.deleteSelection()
    }
    await nextTick()
    expect(host.querySelector("[data-composer-rich-text-inline]")).not.toBeNull()
  })

  it("allows deleting a nested image locked token from Content", async () => {
    const { host, component, currentNode } = mountControlledEditor({
      id: "paragraph",
      kind: "element",
      name: "p",
      props: {},
      children: [
        text("With years of experience."),
        {
          id: "image",
          kind: "element",
          name: "img",
          props: { src: { type: "string", value: "/src/assets/images/photo.webp" } },
          children: null,
        },
      ],
    })
    await nextTick()
    await vi.waitFor(() => expect(host.querySelector(".ProseMirror")).not.toBeNull())
    expect(host.querySelector("[data-composer-rich-text-inline]")).not.toBeNull()

    const editor = component()?.editor
    let tokenPosition: number | null = null
    editor?.state.doc.descendants((node, position) => {
      if (node.type.name === "composerLockedInline") tokenPosition = position
    })
    expect(tokenPosition).not.toBeNull()
    if (editor && tokenPosition != null) {
      editor.view.dispatch(editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, tokenPosition),
      ))
      editor.commands.deleteSelection()
    }
    await nextTick()
    expect(host.querySelector("[data-composer-rich-text-inline]")).toBeNull()
    expect(currentNode.value.children?.some(
      (child) => child.kind === "element" && child.name === "img",
    )).toBe(false)
  })

  it("disables formatting controls and editing in read-only mode", async () => {
    const { host } = mountEditor({
      id: "paragraph",
      kind: "element",
      name: "p",
      props: {},
      children: [text("Read only "), { id: "expr", kind: "expr", value: "{name}" }],
    }, true)
    await nextTick()
    await vi.waitFor(() => expect(host.querySelector(".ProseMirror")).not.toBeNull())

    expect((host.querySelector('button[aria-label="Bold"]') as HTMLButtonElement).disabled).toBe(true)
    expect((host.querySelector('button[aria-label="Edit source in Code"]') as HTMLButtonElement).disabled).toBe(true)
    expect(host.querySelector(".ProseMirror")?.getAttribute("contenteditable")).toBe("false")
  })
})
