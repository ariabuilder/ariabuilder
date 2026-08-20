import {
  extractClassRuleCss,
  readClassDeclarations,
  writeClassDeclarations,
  type ClassRuleState,
} from "./cssRuleAst"
import { extractClassRulesByName } from "../designClassCss"
import { locateAtPath } from "./mutate"
import { renameClassRuleCss } from "./renameClassReferences"
import type { AstroDocumentModel, EditableNode, RawNode } from "./types"

export type AstroStyleClassRule = {
  name: string
  stylePath: string
  css: string
  styleText: string
}

function visitNodes(
  nodes: EditableNode[],
  prefix: string,
  visit: (node: EditableNode, path: string) => void,
): void {
  nodes.forEach((node, index) => {
    const path = prefix ? `${prefix}.${index}` : String(index)
    visit(node, path)
    if (node.kind === "conditional") {
      visitNodes(node.consequent, `${path}.t`, visit)
      if (node.alternate) visitNodes(node.alternate, `${path}.f`, visit)
      return
    }
    if ("children" in node && Array.isArray(node.children)) {
      visitNodes(node.children, path, visit)
    }
  })
}

export function discoverAstroStyleClasses(
  model: AstroDocumentModel | null | undefined,
): AstroStyleClassRule[] {
  if (!model) return []
  const byName = new Map<string, AstroStyleClassRule>()
  visitNodes(model.nodes, "", (node, stylePath) => {
    if (node.kind !== "raw" || node.name.toLowerCase() !== "style") return
    for (const rule of extractClassRulesByName(node.inner).values()) {
      byName.set(rule.name, {
        name: rule.name,
        stylePath,
        css: rule.css,
        styleText: node.inner,
      })
    }
  })
  return [...byName.values()]
}

function styleNodeForClass(
  model: AstroDocumentModel,
  name: string,
): { rule: AstroStyleClassRule; node: RawNode } | null {
  const rule = discoverAstroStyleClasses(model).find((entry) => entry.name === name)
  if (!rule) return null
  const node = locateAtPath(model.nodes, rule.stylePath)?.node
  return node?.kind === "raw" && node.name.toLowerCase() === "style"
    ? { rule, node }
    : null
}

export function readAstroStyleClassDeclarations(
  model: AstroDocumentModel | null | undefined,
  name: string,
  state: ClassRuleState = {},
): string | null {
  if (!model) return null
  const found = styleNodeForClass(model, name)
  return found ? readClassDeclarations(found.node.inner, name, state) : null
}

export function writeAstroStyleClassDeclarations(
  model: AstroDocumentModel,
  name: string,
  declarations: string,
  state: ClassRuleState = {},
): boolean {
  const found = styleNodeForClass(model, name)
  if (!found) return false
  found.node.inner = writeClassDeclarations(found.node.inner, name, declarations, state)
  return true
}

export function duplicateAstroStyleClass(
  model: AstroDocumentModel,
  sourceName: string,
  nextName: string,
): boolean {
  const found = styleNodeForClass(model, sourceName)
  if (!found || styleNodeForClass(model, nextName)) return false
  const sourceCss = extractClassRuleCss(found.node.inner, sourceName)
  if (!sourceCss) return false
  const duplicateCss = renameClassRuleCss(sourceCss, sourceName, nextName)
  found.node.inner = `${found.node.inner.replace(/\s+$/, "")}\n\n${duplicateCss}\n`
  return true
}
