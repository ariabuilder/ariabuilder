import {
  commitStringValue,
  isMotionClass,
  joinClassNames,
  nodeAtMarkerPath,
  removeClassListTokens,
  removeClassName,
  splitClassNames,
  staticClassListTokens,
} from "../../../../shared/composer"
import { markerPathForNodeId } from "../../../../shared/composer/paths"
import type {
  AstroDocumentModel,
  EditableNode,
  PropValue,
} from "../../../../shared/composer/types"

type ClassSourceNode = Extract<
  EditableNode,
  { props: Record<string, PropValue> }
>

export type ComposerClassTarget = {
  path: string
  node: ClassSourceNode
}

function hasProps(node: EditableNode): node is ClassSourceNode {
  return "props" in node
}

function childNodes(node: EditableNode): EditableNode[] {
  if (node.kind === "conditional") {
    return [...node.consequent, ...(node.alternate ?? [])]
  }
  return "children" in node && Array.isArray(node.children)
    ? node.children
    : []
}

function sameTokens(left: readonly string[], right: ReadonlySet<string>): boolean {
  const visible = left.filter((token) => !isMotionClass(token))
  return visible.length === right.size && visible.every((token) => right.has(token))
}

function descendantClassSource(
  node: EditableNode,
  rendered: ReadonlySet<string>,
): ClassSourceNode | null {
  for (const child of childNodes(node)) {
    if (hasProps(child)) {
      const classValue = child.props.class
      if (
        classValue?.type === "string"
        && sameTokens(splitClassNames(classValue.value), rendered)
      ) {
        return child
      }

      const classListValue = child.props["class:list"]
      const staticTokens = staticClassListTokens(classListValue)
      if (
        staticTokens.length > 0
        && staticTokens.every((token) => rendered.has(token))
      ) {
        return child
      }
    }

    const nested = descendantClassSource(child, rendered)
    if (nested) return nested
  }
  return null
}

/**
 * Resolve the source node represented by the live class readout. Fragments and
 * other source-only wrappers render through a child element, so the bridge can
 * report that child's classes for the wrapper selection. Only redirect when
 * the rendered tokens map unambiguously to source-owned static tokens.
 */
export function resolveComposerClassTarget(
  model: AstroDocumentModel | null | undefined,
  selectedPath: string | null | undefined,
  renderedClasses: readonly string[],
): ComposerClassTarget | null {
  if (!model || !selectedPath) return null
  const selected = nodeAtMarkerPath(model.nodes, selectedPath)
  if (!selected || !hasProps(selected)) return null
  if (selected.props.class != null || selected.props["class:list"] != null) {
    return { path: selectedPath, node: selected }
  }

  const rendered = new Set(renderedClasses)
  if (!rendered.size) return { path: selectedPath, node: selected }
  const descendant = descendantClassSource(selected, rendered)
  const path = descendant
    ? markerPathForNodeId(model.nodes, descendant.id)
    : null
  return descendant && path
    ? { path, node: descendant }
    : { path: selectedPath, node: selected }
}

export function removeComposerSourceClass(
  sourceNames: readonly string[],
  name: string,
): PropValue | undefined {
  return commitStringValue(
    undefined,
    joinClassNames(removeClassName([...sourceNames], name)),
  )
}

export function visibleComposerClassNames(
  names: readonly string[],
): string[] {
  return names.filter((name) => !isMotionClass(name))
}

/** Presentation-only class text; the underlying Astro expression is untouched. */
export function composerClassTextForInspector(
  value: PropValue | undefined,
  fallback: string,
): string {
  if (!value) return fallback
  const containsManagedToken = staticClassListTokens(value).some(isMotionClass)
  if (!containsManagedToken) return fallback
  const filtered = removeClassListTokens(value, isMotionClass)
  if (filtered.safe) {
    return filtered.value?.type === "string" || filtered.value?.type === "expr"
      ? filtered.value.value
      : ""
  }
  return fallback.replace(
    /\baria-(?:motion|parallax)(?:-[^\s"'`,\]}]+)?/g,
    "[Motion]",
  )
}

/** Keep Motion-owned tokens in Astro while the Classes inspector edits only user classes. */
export function preserveComposerMotionClasses(
  currentNames: readonly string[],
  value: PropValue | undefined,
): PropValue | undefined {
  if (value && value.type !== "string") return value
  return commitStringValue(undefined, joinClassNames([
    ...splitClassNames(value?.value ?? ""),
    ...currentNames.filter(isMotionClass),
  ]))
}
