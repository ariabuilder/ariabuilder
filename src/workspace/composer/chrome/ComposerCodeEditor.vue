<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue"
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete"
import { indentWithTab } from "@codemirror/commands"
import { indentUnit } from "@codemirror/language"
import { Compartment, EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { setDiagnostics, type Diagnostic } from "@codemirror/lint"
import { basicSetup } from "codemirror"
import { astro } from "@/lib/codemirrorAstroLanguage"
import {
  codeEditorSyntaxHighlighting,
  codeEditorTheme,
} from "@/lib/codemirrorTheme"
import { m } from "@/paraglide/messages.js"
import { completeComposerCode } from "@/lib/composer"
import type { ComposerCodeDiagnostic } from "../../../../shared/composer"
import {
  clampCodeSourceRange,
  initialCodeEditorSelection,
  type CodeSourceRange,
} from "./codeEditorSelection"

const props = defineProps<{
  modelValue: string
  projectPath: string
  file: string | null
  selectionRange?: { from: number; to: number } | null
  /** Bumps when an external surface wants CodeMirror to reveal selectionRange. */
  selectionRevealNonce?: number
  /** Soft-wrap long lines (CodeMirror lineWrapping). */
  lineWrapping?: boolean
}>()

const emit = defineEmits<{
  "update:modelValue": [value: string]
  select: [range: { from: number; to: number }]
  cursor: [position: { line: number; column: number }]
}>()

const editorRoot = ref<HTMLElement | null>(null)
const editorView = shallowRef<EditorView | null>(null)
const wrapCompartment = new Compartment()
const helpId = `composer-code-help-${Math.random().toString(36).slice(2)}`
let languageTimer: ReturnType<typeof setTimeout> | null = null
let languageGeneration = 0
/** Suppress select emits while we programmatically reveal a node range. */
let suppressSelectEmit = 0

function wrapExtension(enabled: boolean) {
  return enabled ? EditorView.lineWrapping : []
}

/** 1-based line/column at the caret (selection head). */
function emitCursor(state: EditorState): void {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  emit("cursor", {
    line: line.number,
    column: head - line.from + 1,
  })
}

function offsetAt(
  state: EditorState,
  position: { line: number; character: number },
): number {
  const lineNumber = Math.min(Math.max(1, position.line + 1), state.doc.lines)
  const line = state.doc.line(lineNumber)
  return Math.min(line.to, line.from + Math.max(0, position.character))
}

function codeMirrorDiagnostics(
  state: EditorState,
  diagnostics: ComposerCodeDiagnostic[],
): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({
    from: offsetAt(state, diagnostic.range.start),
    to: offsetAt(state, diagnostic.range.end),
    severity:
      diagnostic.severity === 1
        ? "error"
        : diagnostic.severity === 2
          ? "warning"
          : "info",
    message: diagnostic.message,
    source: diagnostic.source,
  }))
}

async function requestLanguage(
  view: EditorView,
  position: number,
  includeCompletions: boolean,
): Promise<CompletionResult | null> {
  if (!props.file) return null
  const generation = ++languageGeneration
  const line = view.state.doc.lineAt(position)
  try {
    const result = await completeComposerCode(
      props.projectPath,
      props.file,
      view.state.doc.toString(),
      { line: line.number - 1, character: position - line.from },
    )
    if (generation !== languageGeneration || !editorView.value) return null
    editorView.value.dispatch(
      setDiagnostics(
        editorView.value.state,
        codeMirrorDiagnostics(editorView.value.state, result.diagnostics),
      ),
    )
    if (!includeCompletions || result.completions.length === 0) return null
    const word = view.state.sliceDoc(0, position).match(/[\w:-]*$/)?.[0] ?? ""
    return {
      from: position - word.length,
      options: result.completions.map((item) => ({
        label: item.label,
        detail: item.detail,
        type:
          item.kind === 10
            ? "property"
            : item.kind === 2 || item.kind === 3
              ? "function"
              : "text",
        apply: item.insertText ?? item.textEdit?.newText ?? item.label,
      })),
    }
  } catch {
    return null
  }
}

async function completionSource(context: CompletionContext) {
  const token = context.matchBefore(/[\w:-]*/)
  if ((!context.explicit && !token) || !context.view) return null
  return requestLanguage(context.view, context.pos, true)
}

function scheduleLanguageDiagnostics(view: EditorView) {
  if (languageTimer) clearTimeout(languageTimer)
  languageTimer = setTimeout(() => {
    languageTimer = null
    void requestLanguage(view, view.state.selection.main.head, false)
  }, 500)
}

function createEditor(): void {
  if (!editorRoot.value || editorView.value) return
  const state = EditorState.create({
    doc: props.modelValue,
    selection: initialCodeEditorSelection(
      props.selectionRange,
      props.modelValue.length,
    ),
    extensions: [
      basicSetup,
      codeEditorSyntaxHighlighting,
      EditorState.tabSize.of(2),
      indentUnit.of("  "),
      keymap.of([indentWithTab]),
      autocompletion({ override: [completionSource] }),
      astro(),
      wrapCompartment.of(wrapExtension(Boolean(props.lineWrapping))),
      EditorView.contentAttributes.of({
        "aria-label": m.composer_code_editor_label(),
        "aria-describedby": helpId,
        spellcheck: "false",
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit("update:modelValue", update.state.doc.toString())
          scheduleLanguageDiagnostics(update.view)
        }
        if (suppressSelectEmit > 0) return
        if (update.selectionSet || update.docChanged) {
          emit("select", {
            from: update.state.selection.main.from,
            to: update.state.selection.main.to,
          })
          emitCursor(update.state)
        }
      }),
      codeEditorTheme({ contentPadding: "12px 0", linePadding: "0 16px" }),
    ],
  })
  editorView.value = new EditorView({ state, parent: editorRoot.value })
  emitCursor(editorView.value.state)
  revealSourceRange(props.selectionRange)
  scheduleLanguageDiagnostics(editorView.value)
}

function syncContent(value: string): void {
  const view = editorView.value
  if (!view) return
  const current = view.state.doc.toString()
  if (current === value) return
  const head = Math.min(view.state.selection.main.head, value.length)
  suppressSelectEmit += 1
  try {
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: EditorSelection.cursor(head),
    })
  } finally {
    suppressSelectEmit -= 1
  }
}

watch(() => props.modelValue, syncContent)

watch(
  () => Boolean(props.lineWrapping),
  (enabled) => {
    const view = editorView.value
    if (!view) return
    view.dispatch({
      effects: wrapCompartment.reconfigure(wrapExtension(enabled)),
    })
  },
)

function revealSourceRange(range: CodeSourceRange | null | undefined): void {
  const view = editorView.value
  if (!view || !range) return
  const clamped = clampCodeSourceRange(range, view.state.doc.length)
  const current = view.state.selection.main
  suppressSelectEmit += 1
  try {
    view.dispatch({
      ...(current.from === clamped.from && current.to === clamped.to
        ? {}
        : { selection: EditorSelection.range(clamped.from, clamped.to) }),
      effects: EditorView.scrollIntoView(clamped.from, { y: "center" }),
    })
  } finally {
    suppressSelectEmit -= 1
  }
}

// Reveal only when layers/canvas/api bump the nonce — not when code itself
// illuminated a path (that would fight the caret and re-emit select).
watch(
  () => props.selectionRevealNonce ?? 0,
  (nonce, prev) => {
    if (nonce === prev) return
    revealSourceRange(props.selectionRange)
  },
)

onMounted(createEditor)
onBeforeUnmount(() => {
  if (languageTimer) clearTimeout(languageTimer)
  editorView.value?.destroy()
})
</script>

<template>
  <div class="relative h-full min-h-0 min-w-0 overflow-hidden bg-background dark:bg-sidebar">
    <p :id="helpId" class="sr-only">{{ m.composer_code_editor_keyboard_help() }}</p>
    <div ref="editorRoot" class="h-full min-h-0 overflow-hidden" />
  </div>
</template>
