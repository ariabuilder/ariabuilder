<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue"
import { indentWithTab } from "@codemirror/commands"
import { cssLanguage } from "@codemirror/lang-css"
import { indentUnit } from "@codemirror/language"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view"
import { basicSetup } from "codemirror"
import {
  codeEditorSyntaxHighlighting,
  codeEditorTheme,
} from "@/lib/codemirrorTheme"
import {
  createCssCompletionSource,
  type CssCompletionDocumentKind,
} from "../lib/cssVariableCompletions"
import type { VariableReferenceOption } from "../lib/variableReferences"

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    lineNumbers?: boolean
    variableReferences?: readonly VariableReferenceOption[]
    classReferences?: readonly string[]
    utilityReferences?: readonly string[]
    keyframeReferences?: readonly string[]
    documentKind?: CssCompletionDocumentKind
    focusOutline?: boolean
  }>(),
  {
    placeholder: "",
    lineNumbers: true,
    variableReferences: () => [],
    classReferences: () => [],
    utilityReferences: () => [],
    keyframeReferences: () => [],
    documentKind: "stylesheet",
    focusOutline: true,
  },
)

const emit = defineEmits<{
  "update:modelValue": [value: string]
}>()

const editorRoot = ref<HTMLElement | null>(null)
const editorView = shallowRef<EditorView | null>(null)

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
      cssLanguage,
      cssLanguage.data.of({
        autocomplete: createCssCompletionSource(
          () => props.variableReferences ?? [],
          {
            documentKind: props.documentKind,
            getProjectSymbols: () => ({
              classNames: props.classReferences ?? [],
              utilityCandidates: props.utilityReferences ?? [],
              keyframeNames: props.keyframeReferences ?? [],
            }),
          },
        ),
      }),
      props.placeholder ? cmPlaceholder(props.placeholder) : [],
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        emit("update:modelValue", update.state.doc.toString())
      }),
      !props.lineNumbers
        ? EditorView.theme({
            ".cm-gutters": { display: "none !important" },
          })
        : [],
      codeEditorTheme({ focusOutline: props.focusOutline }),
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
    class="h-full min-h-[240px] overflow-hidden rounded-md border border-border/50 bg-background [--code-editor-bg:var(--background)] dark:bg-sidebar dark:[--code-editor-bg:var(--sidebar)]"
  />
</template>
