import { parseStyleAttr } from "../../../../shared/composer"
import type { InspectorBreakpointOverride } from "./InspectorBreakpointIndicators.vue"

export type InspectorBreakpointStyleSource = {
  id: string
  label: string
  width: number | null
  styleText: string
}

export type InspectorSectionState = {
  hasAuthoredValues: boolean
  hasCurrentTargetValues: boolean
  overrideBreakpoints: InspectorBreakpointOverride[]
  currentBreakpoint: InspectorBreakpointOverride | null
  canReset: boolean
}

export function resolveInspectorSectionState(
  propertyNames: readonly string[],
  currentBreakpointId: string,
  sources: readonly InspectorBreakpointStyleSource[],
): InspectorSectionState {
  const propertySet = new Set(propertyNames)
  const overrides = sources.filter((source) => {
    const declarations = parseStyleAttr(source.styleText)
    return Object.keys(declarations).some((property) => propertySet.has(property))
  })
  const overrideBreakpoints = overrides.map((source) => ({
    id: source.id,
    label: source.label,
    width: source.width,
    isCurrent: source.id === currentBreakpointId,
  }))
  const currentSource = sources.find((source) => source.id === currentBreakpointId) ?? null
  const currentBreakpoint = currentSource ? {
    id: currentSource.id,
    label: currentSource.label,
    width: currentSource.width,
    isCurrent: true,
  } : null
  const hasCurrentTargetValues = overrideBreakpoints.some((item) => item.isCurrent)
  return {
    hasAuthoredValues: overrideBreakpoints.length > 0,
    hasCurrentTargetValues,
    overrideBreakpoints,
    currentBreakpoint,
    canReset: hasCurrentTargetValues,
  }
}
