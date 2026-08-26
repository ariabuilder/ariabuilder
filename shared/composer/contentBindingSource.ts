import { describeComposerCmsSelection } from "./cmsBindings"
import { nodeAtMarkerPath } from "./paths"
import { TRANSLATION_FALLBACK_MARKER } from "./translationBindings"
import { PROJECT_DATA_FALLBACK_MARKER } from "./projectDataBindings"
import { parentPathOf } from "./mutate"
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
  // Managed markers are authoritative. A project field may legitimately contain
  // a property named `data`, which is otherwise only a CMS heuristic.
  if (blob.includes(PROJECT_DATA_FALLBACK_MARKER)) return "project"
  const selection = describeComposerCmsSelection(model, path)
  if (
    selection.ownership === "managed" ||
    selection.ownership === "adoptable" ||
    selection.ownership === "custom"
  ) {
    return "cms"
  }
  const localNames = new Set<string>()
  for (const imported of model.imports) localNames.add(imported.name)
  for (const match of model.extraFrontmatter.matchAll(/\bimport\s+([^;]+?)\s+from\s+["'][^"']+["']/g)) {
    const clause = match[1] ?? ""
    const defaultName = /^\s*([A-Za-z_$][\w$]*)/.exec(clause)?.[1]
    if (defaultName) localNames.add(defaultName)
    const named = /\{([^}]*)\}/.exec(clause)?.[1]
    for (const part of named?.split(",") ?? []) {
      const name = /(?:\bas\s+)?([A-Za-z_$][\w$]*)\s*$/.exec(part.trim())?.[1]
      if (name) localNames.add(name)
    }
  }
  for (const match of model.extraFrontmatter.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    if (match[1]) localNames.add(match[1])
  }
  let ancestorPath: string | null = path
  let managedCmsScope = false
  while (ancestorPath) {
    const ancestor = nodeAtMarkerPath(model.nodes, ancestorPath)
    if (ancestor?.kind === "map") {
      const receiver = /^(.*?)\.map\s*\(/s.exec(ancestor.head.trim())?.[1]?.trim()
      const receiverRoot = receiver && /^[A-Za-z_$][\w$]*/.exec(receiver)?.[0]
      if (receiverRoot && model.collectionBindings?.[receiverRoot]) managedCmsScope = true
      const parameter = /\.map\s*\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)/.exec(ancestor.head)?.[1]
      if (parameter) localNames.add(parameter)
    }
    ancestorPath = parentPathOf(ancestorPath)
  }
  if (managedCmsScope) return "cms"
  if ([...localNames].some((name) => new RegExp(`\\b${name}\\b`).test(blob))) return "project"
  if (CMS_EXPRESSION.test(blob)) return "cms"
  return "none"
}

export function isComposerContentBindingSource(
  value: unknown,
): value is ComposerContentBindingSource {
  return COMPOSER_CONTENT_BINDING_SOURCES.includes(value as ComposerContentBindingSource)
}
