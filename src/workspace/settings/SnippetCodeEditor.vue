<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, watch } from "vue"
import { indentWithTab } from "@codemirror/commands"
import { html } from "@codemirror/lang-html"
import { indentUnit } from "@codemirror/language"
import { Compartment, EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view"
import { basicSetup } from "codemirror"
import {
  codeEditorSyntaxHighlighting,
  codeEditorTheme,
} from "@/lib/codemirrorTheme"

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    disabled?: boolean
    inputId?: string
    ariaLabel?: string
  }>(),
  {
    placeholder: "",
    disabled: false,
    inputId: "",
    ariaLabel: "",
  },
)

const emit = defineEmits<{
  "update:modelValue": [value: string]
}>()

const editorRoot = shallowRef<HTMLElement | null>(null)
const editorView = shallowRef<EditorView | null>(null)
const editableCompartment = new Compartment()
const attrsCompartment = new Compartment()

function contentAttributes() {
  const attrs: Record<string, string> = {}
  if (props.inputId) attrs.id = props.inputId
  if (props.ariaLabel) attrs["aria-label"] = props.ariaLabel
  return attrs
}

function createEditor(): void {
  if (!editorRoot.value || editorView.value) return

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      basicSetup,
      codeEditorSyntaxHighlighting,
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      indentUnit.of("  "),
      keymap.of([indentWithTab]),
      // Snippets often use void/self-closing markup (<meta />, <link />, etc.).
      html({ selfClosingTags: true }),
      props.placeholder ? cmPlaceholder(props.placeholder) : [],
      editableCompartment.of(EditorView.editable.of(!props.disabled)),
      attrsCompartment.of(EditorView.contentAttributes.of(contentAttributes())),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        emit("update:modelValue", update.state.doc.toString())
      }),
      codeEditorTheme({
        minHeight: "160px",
        contentPadding: "12px 0",
        linePadding: "0 12px",
      }),
    ],
  })

  editorView.value = new EditorView({
    state,
    parent: editorRoot.value,
  })
}

function destroyEditor(): void {
  editorView.value?.destroy()
  editorView.value = null
}

function syncEditorContent(value: string): void {
  const view = editorView.value
  if (!view) return
  const currentValue = view.state.doc.toString()
  if (currentValue === value) return
  const cursorPosition = Math.min(view.state.selection.main.head, value.length)
  view.dispatch({
    changes: { from: 0, to: currentValue.length, insert: value },
    selection: EditorSelection.cursor(cursorPosition),
  })
}

watch(() => props.modelValue, syncEditorContent)

watch(
  () => props.disabled,
  (disabled) => {
    editorView.value?.dispatch({
      effects: editableCompartment.reconfigure(
        EditorView.editable.of(!disabled),
      ),
    })
  },
)

watch(
  () => [props.inputId, props.ariaLabel] as const,
  () => {
    editorView.value?.dispatch({
      effects: attrsCompartment.reconfigure(
        EditorView.contentAttributes.of(contentAttributes()),
      ),
    })
  },
)

onMounted(() => {
  createEditor()
})

onBeforeUnmount(() => {
  destroyEditor()
})
</script>

<template>
  <div
    ref="editorRoot"
    class="min-h-[160px] overflow-hidden rounded-md border border-border/50 bg-background"
    :class="{ 'pointer-events-none opacity-60': disabled }"
  />
</template>
