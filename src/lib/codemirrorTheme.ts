import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { tags as t } from "@lezer/highlight"

/**
 * Soft, high-contrast syntax colors for Aria's dark (and light) surfaces.
 * Uses --cm-* tokens so themes can tune without touching editor setup.
 *
 * Replaces CodeMirror's defaultHighlightStyle (light-oriented blues/reds
 * that go near-invisible on dark backgrounds).
 */
const ariaHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: t.lineComment, color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: t.blockComment, color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: t.docComment, color: "var(--cm-comment)", fontStyle: "italic" },

  { tag: t.keyword, color: "var(--cm-keyword)" },
  { tag: t.controlKeyword, color: "var(--cm-keyword)" },
  { tag: t.operatorKeyword, color: "var(--cm-operator)" },
  { tag: t.definitionKeyword, color: "var(--cm-keyword)" },
  { tag: t.moduleKeyword, color: "var(--cm-keyword)" },

  { tag: t.name, color: "var(--cm-keyword)" },
  { tag: t.variableName, color: "var(--cm-property)" },
  { tag: t.propertyName, color: "var(--cm-property)" },
  { tag: t.attributeName, color: "var(--cm-property)" },
  { tag: t.className, color: "var(--cm-function)" },
  { tag: t.typeName, color: "var(--cm-function)" },
  { tag: t.tagName, color: "var(--cm-tag)" },
  { tag: t.namespace, color: "var(--cm-tag)" },
  { tag: t.labelName, color: "var(--cm-tag)" },
  { tag: t.macroName, color: "var(--cm-function)" },

  { tag: t.string, color: "var(--cm-string)" },
  { tag: t.docString, color: "var(--cm-string)" },
  { tag: t.character, color: "var(--cm-string)" },
  { tag: t.attributeValue, color: "var(--cm-string)" },

  { tag: t.number, color: "var(--cm-number)" },
  { tag: t.integer, color: "var(--cm-number)" },
  { tag: t.float, color: "var(--cm-number)" },
  { tag: t.bool, color: "var(--cm-atom)" },
  { tag: t.null, color: "var(--cm-atom)" },
  { tag: t.atom, color: "var(--cm-atom)" },
  { tag: t.unit, color: "var(--cm-number)" },
  { tag: t.color, color: "var(--cm-atom)" },
  { tag: t.url, color: "var(--cm-atom)" },

  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "var(--cm-function)",
  },
  { tag: t.standard(t.name), color: "var(--cm-function)" },
  { tag: t.definition(t.variableName), color: "var(--cm-property)" },
  { tag: t.definition(t.propertyName), color: "var(--cm-property)" },

  { tag: t.operator, color: "var(--cm-operator)" },
  { tag: t.derefOperator, color: "var(--cm-operator)" },
  { tag: t.arithmeticOperator, color: "var(--cm-operator)" },
  { tag: t.compareOperator, color: "var(--cm-operator)" },
  { tag: t.logicOperator, color: "var(--cm-operator)" },
  { tag: t.bitwiseOperator, color: "var(--cm-operator)" },

  { tag: t.punctuation, color: "var(--cm-punctuation)" },
  { tag: t.separator, color: "var(--cm-punctuation)" },
  { tag: t.bracket, color: "var(--cm-punctuation)" },
  { tag: t.angleBracket, color: "var(--cm-punctuation)" },
  { tag: t.squareBracket, color: "var(--cm-punctuation)" },
  { tag: t.paren, color: "var(--cm-punctuation)" },
  { tag: t.brace, color: "var(--cm-punctuation)" },

  { tag: t.regexp, color: "var(--cm-atom)" },
  { tag: t.escape, color: "var(--cm-number)" },
  { tag: t.special(t.string), color: "var(--cm-atom)" },
  { tag: t.meta, color: "var(--cm-comment)" },
  { tag: t.processingInstruction, color: "var(--cm-comment)" },
  { tag: t.invalid, color: "var(--cm-invalid)" },
])

/** Shared editor chrome that respects Aria surface tokens. */
export function codeEditorTheme(options?: {
  minHeight?: string
  contentPadding?: string
  linePadding?: string
  dark?: boolean
  focusOutline?: boolean
}): Extension {
  const minHeight = options?.minHeight ?? "100%"
  const contentPadding = options?.contentPadding ?? "16px 0"
  const linePadding = options?.linePadding ?? "0 16px"
  const dark = options?.dark ?? true
  const focusOutline = options?.focusOutline ?? true

  return EditorView.theme(
    {
      "&": {
        height: "100%",
        minHeight,
        fontSize: "13px",
        backgroundColor: "var(--code-editor-bg, var(--background))",
        color: "var(--code-editor-foreground, var(--cm-foreground))",
        outlineOffset: "-2px",
      },
      ".cm-editor": { height: "100%" },
      "&.cm-focused": {
        outline: focusOutline ? "2px solid var(--ring)" : "none",
        outlineOffset: focusOutline ? "-2px" : "0",
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
      },
      ".cm-content": { minHeight, padding: contentPadding },
      ".cm-line": { padding: linePadding },
      ".cm-placeholder": {
        color: "var(--muted-foreground)",
      },
      ".cm-gutters": {
        border: "none",
        backgroundColor: "var(--code-editor-bg, var(--background))",
        color:
          "var(--code-editor-gutter-foreground, var(--muted-foreground))",
      },
      ".cm-activeLineGutter": { backgroundColor: "transparent" },
      ".cm-activeLine": { backgroundColor: "transparent" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "var(--code-editor-selection, var(--accent))",
      },
      "&.cm-focused .cm-cursor": {
        borderLeftColor: "var(--foreground)",
      },
      ".cm-tooltip-autocomplete": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
      },
      // Soften matching brackets vs neon defaults
      "&.cm-focused .cm-matchingBracket": {
        backgroundColor: "color-mix(in oklab, var(--cm-function) 22%, transparent)",
        outline: "1px solid color-mix(in oklab, var(--cm-function) 35%, transparent)",
      },
    },
    { dark },
  )
}

/** Prefer Aria highlights over basicSetup's light-mode defaultHighlightStyle. */
export const codeEditorSyntaxHighlighting: Extension = syntaxHighlighting(
  ariaHighlightStyle,
)
