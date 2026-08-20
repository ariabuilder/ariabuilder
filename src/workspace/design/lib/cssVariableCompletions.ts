import {
  CompletionContext,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete"
import { cssCompletionSource, cssLanguage } from "@codemirror/lang-css"
import { EditorState } from "@codemirror/state"
import type { VariableReferenceOption } from "./variableReferences"

const DECLARATION_WRAPPER_PREFIX = ".aria-declaration { "
const DECLARATION_WRAPPER_SUFFIX = " }"

export type CssCompletionProjectSymbols = {
  classNames?: readonly string[]
  utilityCandidates?: readonly string[]
  keyframeNames?: readonly string[]
}

export type CssCompletionDocumentKind = "stylesheet" | "declarations"

function toCssVariableName(value: string): string {
  return `--${value.trim().replace(/^--/, "")}`
}

export function buildCssVariableCompletionOptions(
  variableReferences: readonly VariableReferenceOption[],
): Completion[] {
  const seen = new Set<string>()
  return variableReferences.flatMap((variable) => {
    const name = toCssVariableName(variable.value)
    if (seen.has(name)) return []
    seen.add(name)
    return [
      {
        label: name,
        apply: name,
        detail: variable.meta,
        type: "variable" as const,
      },
    ]
  })
}

function getVariableReferenceMatch(context: CompletionContext) {
  const match = context.matchBefore(/--[\w-]*/)
  if (!match) return null
  const beforeVariable = context.state.sliceDoc(
    Math.max(0, match.from - 16),
    match.from,
  )
  return /var\(\s*$/i.test(beforeVariable) ? match : null
}

function createDeclarationCompletionContext(context: CompletionContext) {
  const state = EditorState.create({
    doc: `${DECLARATION_WRAPPER_PREFIX}${context.state.doc.toString()}${DECLARATION_WRAPPER_SUFFIX}`,
    extensions: [cssLanguage],
  })

  return new CompletionContext(
    state,
    DECLARATION_WRAPPER_PREFIX.length + context.pos,
    context.explicit,
  )
}

function rebaseDeclarationCompletion(
  result: CompletionResult,
): CompletionResult {
  return {
    ...result,
    from: result.from - DECLARATION_WRAPPER_PREFIX.length,
  }
}

function mergeCompletionOptions(
  ...groups: readonly (readonly Completion[])[]
): Completion[] {
  const seen = new Set<string>()
  return groups.flat().filter((option) => {
    const key = typeof option.apply === "string" ? option.apply : option.label
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildNamedOptions(
  names: readonly string[],
  detail: string,
): Completion[] {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({ label: name, apply: name, detail, type: "class" }))
}

function getApplyMatch(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos)
  const before = context.state.sliceDoc(line.from, context.pos)
  const match = before.match(/@apply\s+(?:[^\s;{}]+\s+)*([^\s;{}]*)$/i)
  if (!match) return null
  return { from: context.pos - (match[1]?.length ?? 0) }
}

function getAnimationNameMatch(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos)
  const before = context.state.sliceDoc(line.from, context.pos)
  const match = before.match(/\banimation(?:-name)?\s*:\s*([\w-]*)$/i)
  if (!match) return null
  return { from: context.pos - (match[1]?.length ?? 0) }
}

function getClassSelectorMatch(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos)
  const before = context.state.sliceDoc(line.from, context.pos)
  const match = before.match(/\.([_a-zA-Z][\w-]*)?$/)
  if (!match || before.slice(0, match.index).includes("{")) return null
  return { from: context.pos - (match[1]?.length ?? 0) }
}

export function createCssCompletionSource(
  getVariables: () => readonly VariableReferenceOption[],
  options: {
    documentKind?: CssCompletionDocumentKind
    getProjectSymbols?: () => CssCompletionProjectSymbols
  } = {},
): CompletionSource {
  return async (context: CompletionContext) => {
    const variableMatch = getVariableReferenceMatch(context)
    if (variableMatch) {
      const variableOptions = buildCssVariableCompletionOptions(getVariables())
      return {
        from: variableMatch.from,
        options: variableOptions,
        validFor: /^--[\w-]*$/,
      } satisfies CompletionResult
    }

    const project = options.getProjectSymbols?.() ?? {}
    const applyMatch = getApplyMatch(context)
    if (applyMatch) {
      return {
        from: applyMatch.from,
        options: mergeCompletionOptions(
          buildNamedOptions(project.utilityCandidates ?? [], "Project utility"),
          buildNamedOptions(project.classNames ?? [], "Aria project class"),
        ),
        validFor: /^[!@]?[-\w:[\]/.]*$/,
      }
    }

    const animationMatch = getAnimationNameMatch(context)
    if (animationMatch && project.keyframeNames?.length) {
      return {
        from: animationMatch.from,
        options: buildNamedOptions(project.keyframeNames, "Project keyframe"),
        validFor: /^[\w-]*$/,
      }
    }

    if (options.documentKind !== "declarations") {
      const selectorMatch = getClassSelectorMatch(context)
      if (selectorMatch && project.classNames?.length) {
        return {
          from: selectorMatch.from,
          options: buildNamedOptions(project.classNames, "Aria project class"),
          validFor: /^[_a-zA-Z][\w-]*$/,
        }
      }
    }

    const standardContext =
      options.documentKind === "declarations"
        ? createDeclarationCompletionContext(context)
        : context
    const standard = await cssCompletionSource(standardContext)
    if (!standard) return null
    return options.documentKind === "declarations"
      ? rebaseDeclarationCompletion(standard)
      : standard
  }
}

/** Backwards-compatible alias for callers that edit a complete stylesheet. */
export function createCssVariableCompletionSource(
  getVariables: () => readonly VariableReferenceOption[],
): CompletionSource {
  return createCssCompletionSource(getVariables)
}
