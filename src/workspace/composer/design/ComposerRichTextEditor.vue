<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from "vue"
import type { Editor, JSONContent } from "@tiptap/core"
import { EditorContent, useEditor } from "@tiptap/vue-3"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import Placeholder from "@tiptap/extension-placeholder"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { ColorField } from "@/components/ui/color-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import {
  composerRichTextFromJson,
  composerRichTextToJson,
  type ComposerRichTextDocument,
} from "../../../../shared/composer/richText"
import type { EditableNode, ElementNode } from "../../../../shared/composer/types"
import {
  ComposerInlineDocument,
  ComposerInlineKeyboard,
  ComposerLockedBlock,
  ComposerLockedGuard,
  ComposerLockedInline,
  ComposerSourcePathAttributes,
  ComposerSourceText,
  ComposerSpan,
  ComposerTextColor,
  composerSourceColorVariable,
} from "./composerRichTextExtensions"
import { tryUseComposerDocument } from "../useComposerDocumentSession"

const props = defineProps<{
  node: ElementNode
  path: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  update: [children: EditableNode[]]
  commit: []
  editCode: []
}>()

const sourceDocument = ref<ComposerRichTextDocument>(composerRichTextToJson(props.node))
const composerDocument = tryUseComposerDocument()
const initialMode = sourceDocument.value.mode
const editorVersion = ref(0)
const linkDialogOpen = ref(false)
const linkHref = ref("")
const linkNewTab = ref(false)
const keyboardFocusMode = ref(false)
const renderedRootColor = ref("")
const renderedBackground = ref("")
const renderedSourceColors = ref<Record<string, string>>({})
let renderedColorRequest = 0
let previewedColorPath: string | null = null
let clearPreviewTimer: ReturnType<typeof setTimeout> | null = null
let locallyEmittedChildren: string | null = null

function refresh() {
  editorVersion.value += 1
}

function handleWindowKeyDown(event: KeyboardEvent) {
  if (event.key === "Tab") keyboardFocusMode.value = true
}

function handleWindowPointerDown() {
  keyboardFocusMode.value = false
}

function currentChildren(): EditableNode[] {
  const json = editor.value?.getJSON() as JSONContent | undefined
  return json
    ? composerRichTextFromJson(sourceDocument.value, json)
    : [...(props.node.children ?? [])]
}

const editor = useEditor({
  content: sourceDocument.value.json as JSONContent,
  editable: !props.disabled,
  extensions: [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      link: false,
      document: initialMode === "inline" ? false : undefined,
      codeBlock: false,
      horizontalRule: false,
    }),
    Placeholder.configure({ placeholder: "Write…" }),
    Link.configure({ autolink: false, linkOnPaste: true, openOnClick: false }),
    ComposerTextColor,
    ComposerSourcePathAttributes,
    ComposerSourceText,
    ComposerSpan,
    ComposerLockedInline,
    ComposerLockedBlock,
    ComposerLockedGuard,
    ...(initialMode === "inline" ? [ComposerInlineDocument, ComposerInlineKeyboard] : []),
  ],
  editorProps: {
    attributes: {
      "aria-label": m.composer_rich_text_editor_label(),
      spellcheck: "true",
    },
    handleDOMEvents: {
      blur: () => {
        emit("commit")
        return false
      },
    },
  },
  onUpdate: () => {
    refresh()
    const children = currentChildren()
    // The Inspector writes this value into a cloned Composer model and feeds
    // that model straight back as a prop. Treat that round trip as an
    // acknowledgement, not an external replacement: setContent() blurs the
    // ProseMirror surface and leaves ordinary typing after the first edit with
    // nowhere to go.
    locallyEmittedChildren = JSON.stringify(children)
    emit("update", children)
  },
  onCreate: ({ editor: active }) => { void syncRenderedColors(active) },
  onSelectionUpdate: ({ editor: active }) => {
    refresh()
    void syncRenderedColors(active)
  },
  onTransaction: refresh,
})

defineExpose({ editor, previewTextColor })

const isBlockMode = computed(() => sourceDocument.value.mode === "block")
const isRootLink = computed(() => props.node.name.toLowerCase() === "a")
const hasLockedContent = computed(() => Object.keys(sourceDocument.value.lockedNodes).length > 0)
const selectedSourcePath = computed(() => {
  editorVersion.value
  const paths = ["composerSourceText", "bold", "italic", "underline", "strike", "code", "link", "composerSpan"]
    .map((type) => editor.value?.getAttributes(type).sourcePath)
    .filter((value): value is string => typeof value === "string" && Boolean(value))
  return paths.sort((a, b) => b.split(".").length - a.split(".").length)[0] ?? ""
})
const selectedTextColor = computed(() => {
  editorVersion.value
  const color = editor.value?.getAttributes("textColor").color
  if (typeof color === "string" && color) return color
  return renderedSourceColors.value[selectedSourcePath.value] ?? renderedRootColor.value
})
const renderedEditorSurfaceStyle = computed<CSSProperties | undefined>(() => {
  const style: CSSProperties = {}
  if (renderedRootColor.value) style.color = renderedRootColor.value
  if (renderedBackground.value) style.background = renderedBackground.value
  for (const [sourcePath, color] of Object.entries(renderedSourceColors.value)) {
    if (!color) continue
    style[composerSourceColorVariable(sourcePath) as `--${string}`] = color
  }
  return Object.keys(style).length ? style : undefined
})

function sourcePathsIn(json: JSONContent): string[] {
  const paths = new Set<string>()
  const visit = (item: JSONContent) => {
    for (const mark of item.marks ?? []) {
      const sourcePath = mark.attrs?.sourcePath
      if (typeof sourcePath === "string" && sourcePath) paths.add(sourcePath)
    }
    for (const child of item.content ?? []) visit(child)
  }
  visit(json)
  return [...paths]
}

async function syncRenderedColors(active: Editor) {
  const request = ++renderedColorRequest
  if (!composerDocument) return
  const paths = sourcePathsIn(active.getJSON())
  const [root, ...descendants] = await Promise.all([
    composerDocument.computedStyle({
      path: props.path,
      properties: [
        "color",
        "aria-effective-background",
        "aria-effective-background-color",
      ],
    }),
    ...paths.map((relativePath) =>
      composerDocument.computedStyle({
        path: props.path,
        relativePath,
        properties: ["color"],
      }),
    ),
  ])
  if (request !== renderedColorRequest) return
  renderedRootColor.value = root.color ?? ""
  renderedBackground.value = root["aria-effective-background"]
    ?? root["aria-effective-background-color"]
    ?? ""
  renderedSourceColors.value = Object.fromEntries(
    paths.map((path, index) => [path, descendants[index]?.color ?? ""]),
  )
}

watch(
  () => props.disabled,
  (disabled) => editor.value?.setEditable(!disabled),
)

watch(
  () => props.node,
  (node) => {
    const next = composerRichTextToJson(node)
    sourceDocument.value = next
    const active = editor.value
    if (!active) return
    const incomingChildren = JSON.stringify(node.children ?? [])
    if (incomingChildren === locallyEmittedChildren) {
      locallyEmittedChildren = null
      return
    }
    if (JSON.stringify(active.getJSON()) !== JSON.stringify(next.json)) {
      const guard = (active.storage as unknown as Record<string, { allowChange: boolean }>).composerLockedGuard
      guard.allowChange = true
      try {
        active.commands.setContent(next.json as JSONContent, { emitUpdate: false })
      } finally {
        guard.allowChange = false
      }
      refresh()
      void syncRenderedColors(active)
    }
  },
  { deep: true },
)

function buttonClass(active = false) {
  return cn(
    "inline-flex size-7 shrink-0 items-center justify-center rounded-sm border border-transparent text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40",
    active && "border-border bg-card/70 text-foreground",
  )
}

function markActive(name: string): boolean {
  editorVersion.value
  return editor.value?.isActive(name) ?? false
}

function toggleMark(name: "bold" | "italic" | "underline" | "strike" | "code") {
  const chain = editor.value?.chain().focus()
  if (!chain) return
  if (name === "bold") chain.toggleBold().run()
  else if (name === "italic") chain.toggleItalic().run()
  else if (name === "underline") chain.toggleUnderline().run()
  else if (name === "strike") chain.toggleStrike().run()
  else chain.toggleCode().run()
}

function setTextColor(color: string) {
  if (!editor.value || !color.trim()) return
  editor.value.chain().focus().setMark("textColor", { color: color.trim() }).run()
  emit("commit")
  scheduleColorPreviewClear()
}

function previewTextColor(color: string) {
  const value = color.trim()
  const sourcePath = selectedSourcePath.value
  if (!composerDocument || !value || !sourcePath) return
  if (previewedColorPath && previewedColorPath !== sourcePath) {
    composerDocument.clearPreviewStyle(props.path, previewedColorPath)
  }
  if (clearPreviewTimer) clearTimeout(clearPreviewTimer)
  clearPreviewTimer = null
  previewedColorPath = sourcePath
  composerDocument.previewStyle(
    props.path,
    `color: ${value} !important;`,
    sourcePath,
  )
  renderedSourceColors.value = {
    ...renderedSourceColors.value,
    [sourcePath]: value,
  }
}

function clearColorPreview() {
  if (clearPreviewTimer) clearTimeout(clearPreviewTimer)
  clearPreviewTimer = null
  if (composerDocument && previewedColorPath) {
    composerDocument.clearPreviewStyle(props.path, previewedColorPath)
  }
  previewedColorPath = null
}

function scheduleColorPreviewClear() {
  if (!previewedColorPath) return
  if (clearPreviewTimer) clearTimeout(clearPreviewTimer)
  // Keep the exact preview in place while Astro persists and applies its HMR update.
  clearPreviewTimer = setTimeout(clearColorPreview, 1_200)
}

function setBlock(type: "paragraph" | "h2" | "h3" | "h4" | "blockquote" | "bulletList" | "orderedList") {
  const chain = editor.value?.chain().focus()
  if (!chain) return
  if (type === "paragraph") chain.setParagraph().run()
  else if (type === "blockquote") chain.toggleBlockquote().run()
  else if (type === "bulletList") chain.toggleBulletList().run()
  else if (type === "orderedList") chain.toggleOrderedList().run()
  else chain.toggleHeading({ level: Number(type.slice(1)) as 2 | 3 | 4 }).run()
}

function openLinkDialog() {
  const attrs = editor.value?.getAttributes("link") ?? {}
  linkHref.value = typeof attrs.href === "string" ? attrs.href : ""
  linkNewTab.value = attrs.target === "_blank"
  linkDialogOpen.value = true
}

function applyLink() {
  const href = linkHref.value.trim()
  if (!href || !editor.value) return
  editor.value.chain().focus().extendMarkRange("link").setLink({
    href,
    target: linkNewTab.value ? "_blank" : null,
    rel: linkNewTab.value ? "noopener noreferrer" : null,
  }).run()
  linkDialogOpen.value = false
}

function removeLink() {
  editor.value?.chain().focus().extendMarkRange("link").unsetLink().run()
  linkDialogOpen.value = false
}

onMounted(() => {
  window.addEventListener("keydown", handleWindowKeyDown, true)
  window.addEventListener("pointerdown", handleWindowPointerDown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWindowKeyDown, true)
  window.removeEventListener("pointerdown", handleWindowPointerDown, true)
  clearColorPreview()
  editor.value?.destroy()
})
</script>

<template>
  <div class="min-w-0">
    <div class="flex flex-nowrap items-center gap-0.5 overflow-x-auto px-1.5 py-1" role="toolbar" :aria-label="m.composer_rich_text_formatting_label()">
      <template v-if="isBlockMode">
        <button type="button" :class="buttonClass(markActive('paragraph'))" :disabled="disabled" :aria-label="m.composer_rich_text_paragraph()" :aria-pressed="markActive('paragraph')" @click="setBlock('paragraph')">P</button>
        <button v-for="level in [2, 3, 4]" :key="level" type="button" :class="buttonClass(editor?.isActive('heading', { level }) ?? false)" :disabled="disabled" :aria-label="m.composer_rich_text_heading({ level: String(level) })" :aria-pressed="editor?.isActive('heading', { level })" @click="setBlock(`h${level}` as 'h2' | 'h3' | 'h4')">H{{ level }}</button>
        <button type="button" :class="buttonClass(markActive('bulletList'))" :disabled="disabled" :aria-label="m.composer_rich_text_bulleted_list()" :aria-pressed="markActive('bulletList')" @click="setBlock('bulletList')"><AppIcon name="listBulleted" :size="14" aria-hidden="true" /></button>
        <button type="button" :class="buttonClass(markActive('orderedList'))" :disabled="disabled" :aria-label="m.composer_rich_text_numbered_list()" :aria-pressed="markActive('orderedList')" @click="setBlock('orderedList')"><AppIcon name="listNumbered" :size="14" aria-hidden="true" /></button>
        <button type="button" :class="buttonClass(markActive('blockquote'))" :disabled="disabled" :aria-label="m.composer_rich_text_block_quote()" :aria-pressed="markActive('blockquote')" @click="setBlock('blockquote')">“”</button>
      </template>

      <button type="button" :class="buttonClass(markActive('bold'))" :disabled="disabled" :aria-label="m.composer_rich_text_bold()" :aria-pressed="markActive('bold')" @click="toggleMark('bold')"><AppIcon name="bold" :size="14" aria-hidden="true" /></button>
      <button type="button" :class="buttonClass(markActive('italic'))" :disabled="disabled" :aria-label="m.composer_rich_text_italic()" :aria-pressed="markActive('italic')" @click="toggleMark('italic')"><AppIcon name="italic" :size="14" aria-hidden="true" /></button>
      <button type="button" :class="buttonClass(markActive('underline'))" :disabled="disabled" :aria-label="m.composer_rich_text_underline()" :aria-pressed="markActive('underline')" @click="toggleMark('underline')"><AppIcon name="underline" :size="14" aria-hidden="true" /></button>
      <button type="button" :class="buttonClass(markActive('strike'))" :disabled="disabled" :aria-label="m.composer_rich_text_strikethrough()" :aria-pressed="markActive('strike')" @click="toggleMark('strike')"><AppIcon name="strikethrough" :size="14" aria-hidden="true" /></button>
      <button type="button" :class="buttonClass(markActive('code'))" :disabled="disabled" :aria-label="m.composer_rich_text_inline_code()" :aria-pressed="markActive('code')" @click="toggleMark('code')"><AppIcon name="code" :size="14" aria-hidden="true" /></button>
      <button v-if="!isRootLink" type="button" :class="buttonClass(markActive('link'))" :disabled="disabled" :aria-label="m.composer_rich_text_edit_link()" :aria-pressed="markActive('link')" @click="openLinkDialog"><AppIcon name="link" :size="14" aria-hidden="true" /></button>
      <ColorField
        :model-value="selectedTextColor"
        variant="toolbar"
        layout="unified"
        persist-mode="commit"
        show-design-colors
        show-variables
        show-alpha
        :disabled="disabled"
        :trigger-label="m.composer_rich_text_text_color()"
        content-side="left"
        content-align="start"
        @preview="previewTextColor"
        @commit="setTextColor"
      />
      <TooltipProvider v-if="hasLockedContent">
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              :class="cn(buttonClass(), 'ml-auto')"
              :disabled="disabled"
              :aria-label="m.composer_rich_text_edit_source()"
              @click="emit('editCode')"
            >
              <AppIcon name="edit" :size="14" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{{ m.composer_rich_text_edit_source() }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <p class="sr-only" id="composer-rich-text-help">{{ m.composer_rich_text_help() }}</p>
    <EditorContent
      :editor="editor"
      class="composer-rich-text-editor min-h-20 border-t border-border bg-background px-3 py-2 font-sans text-sm font-normal leading-[1.5] tracking-normal text-foreground"
      :style="renderedEditorSurfaceStyle"
      :data-keyboard-focus="keyboardFocusMode ? 'true' : undefined"
      :data-editor-mode="sourceDocument.mode"
      aria-describedby="composer-rich-text-help"
    />
  </div>

  <Dialog v-model:open="linkDialogOpen">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ m.composer_rich_text_edit_link() }}</DialogTitle>
        <DialogDescription>{{ m.composer_rich_text_link_description() }}</DialogDescription>
      </DialogHeader>
      <div class="space-y-3">
        <div class="space-y-1.5">
          <Label for="composer-rich-text-link">{{ m.composer_rich_text_link_url() }}</Label>
          <Input id="composer-rich-text-link" v-model="linkHref" placeholder="https://" @keydown.enter.prevent="applyLink" />
        </div>
        <label class="flex items-center gap-2 text-sm text-foreground">
          <input v-model="linkNewTab" type="checkbox" class="size-4" />
          {{ m.composer_rich_text_link_new_tab() }}
        </label>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" :disabled="!markActive('link')" @click="removeLink">{{ m.composer_rich_text_remove_link() }}</Button>
        <Button type="button" :disabled="!linkHref.trim()" @click="applyLink">{{ m.composer_rich_text_apply() }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.composer-rich-text-editor :deep(.ProseMirror) {
  min-height: 4rem;
  outline: none;
  overflow-wrap: break-word;
  white-space: normal;
  color: inherit;
  background-color: transparent;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.5;
  letter-spacing: normal;
  word-spacing: normal;
  text-align: start;
  text-indent: 0;
  text-transform: none;
}

.composer-rich-text-editor[data-keyboard-focus="true"] :deep(.ProseMirror:focus) {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}

.composer-rich-text-editor :deep(p),
.composer-rich-text-editor :deep(blockquote),
.composer-rich-text-editor :deep(ul),
.composer-rich-text-editor :deep(ol),
.composer-rich-text-editor :deep(h2),
.composer-rich-text-editor :deep(h3),
.composer-rich-text-editor :deep(h4) {
  margin: 0;
}

.composer-rich-text-editor[data-editor-mode="block"] :deep(.ProseMirror > * + *) {
  margin-block-start: 0.75rem;
}

.composer-rich-text-editor :deep(h2),
.composer-rich-text-editor :deep(h3),
.composer-rich-text-editor :deep(h4) {
  font-weight: 650;
  line-height: 1.2;
}

.composer-rich-text-editor :deep(h2) {
  font-size: 1.25rem;
}

.composer-rich-text-editor :deep(h3) {
  font-size: 1.125rem;
}

.composer-rich-text-editor :deep(h4) {
  font-size: 1rem;
}

.composer-rich-text-editor :deep(strong) {
  font-weight: 700;
}

.composer-rich-text-editor :deep(em) {
  font-style: italic;
}

.composer-rich-text-editor :deep(u) {
  text-decoration: underline;
}

.composer-rich-text-editor :deep(s) {
  text-decoration: line-through;
}

.composer-rich-text-editor :deep(code) {
  border-radius: 0.25rem;
  background: var(--muted);
  padding-inline: 0.25rem;
  color: var(--foreground);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.875em;
}

.composer-rich-text-editor :deep(a) {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.composer-rich-text-editor :deep(blockquote) {
  border-inline-start: 2px solid var(--border);
  padding-inline-start: 0.75rem;
  color: var(--muted-foreground);
}

.composer-rich-text-editor :deep(ul),
.composer-rich-text-editor :deep(ol) {
  padding-inline-start: 1.25rem;
}

.composer-rich-text-editor :deep(ul) {
  list-style: disc;
}

.composer-rich-text-editor :deep(ol) {
  list-style: decimal;
}

.composer-rich-text-editor :deep(.composer-rich-text-locked-inline),
.composer-rich-text-editor :deep(.composer-rich-text-locked-block) {
  border: 1px dashed var(--border);
  border-radius: 0.25rem;
  background: color-mix(in oklch, var(--muted) 65%, transparent);
  color: var(--muted-foreground);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.75rem;
}

.composer-rich-text-editor :deep(.composer-rich-text-locked-inline) {
  margin-inline: 0.125rem;
  padding: 0.125rem 0.25rem;
}

.composer-rich-text-editor :deep(.composer-rich-text-locked-block) {
  margin-block: 0.375rem;
  padding: 0.5rem;
}

.composer-rich-text-editor :deep(.ProseMirror-selectednode) {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}
</style>
