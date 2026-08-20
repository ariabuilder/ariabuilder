import { describeComposerCmsSelection } from "./cmsBindings"
import { nodeAtMarkerPath } from "./paths"
import { TRANSLATION_FALLBACK_MARKER } from "./translationBindings"
import type { AstroDocumentModel, EditableNode } from "./types"

export const COMPOSER_CONTENT_BINDING_SOURCES = ["none", "project", "translations", "cms"] as const

export type ComposerContentBindingSource = (typeof COMPOSER_CONTENT_BINDING_SOURCES)[number]

const CMS_EXPRESSION = /@aria-cms-fallback|\bgetCollection\s*\(|\bgetEntry\s*\(|\?\.data\b|\.data\b/

function expressionsForNode(node: EditableNode): string[] {
  const expressions: string[] = []
  if (node.kind === "expr") expressions.push(node.value)
  if (node.kind === "map") expressions.push(node.head)
  if ("props" in node) {
    for (const value of Object.values(node.props)) {
      if (value.type === "expr" || value.type === "shorthand") expressions.push(value.value)
    }
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child.kind === "expr") expressions.push(child.value)
    }
  }
  return expressions
}

/** Source type to show in Inspector until the user picks a different one. */
export function inferComposerContentBindingSource(
  model: AstroDocumentModel,
  path: string,
): ComposerContentBindingSource {
  const node = nodeAtMarkerPath(model.nodes, path)
  if (!node) return "none"
  const expressions = expressionsForNode(node)
  const blob = expressions.join("\n")
  if (blob.includes(TRANSLATION_FALLBACK_MARKER)) return "translations"
  const selection = describeComposerCmsSelection(model, path)
  if (
    selection.ownership === "managed" ||
    selection.ownership === "adoptable" ||
    selection.ownership === "custom" ||
    CMS_EXPRESSION.test(blob)
  ) {
    return "cms"
  }
  return "none"
}

export function isComposerContentBindingSource(
  value: unknown,
): value is ComposerContentBindingSource {
  return COMPOSER_CONTENT_BINDING_SOURCES.includes(value as ComposerContentBindingSource)
}
