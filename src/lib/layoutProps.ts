import {
  datePropExpression,
  titleFromPageFileName,
  todayDateInputValue,
} from "../../shared/composer/layoutAuthoring"
import type {
  AstroPropMap,
  PropField,
} from "../../shared/composer/types"
import { parseComposerPage } from "./composer"

export type LayoutPropDraftValue = string | boolean

export type SerializeLayoutPropDraftsOptions = {
  /** Fill blank string fields instead of erroring (page create from the file name). */
  emptyStringFallback?: string
  /** Skip blank string/date fields so the create dialog can stay submittable. */
  allowEmptyStrings?: boolean
}

export async function loadRequiredLayoutProps(
  projectPath: string,
  layoutFile: string,
): Promise<PropField[]> {
  if (!layoutFile) return []
  const parsed = await parseComposerPage(projectPath, layoutFile)
  if (!parsed.editable) {
    throw new Error(`Cannot read required props from ${layoutFile}.`)
  }
  return parsed.model.propSchema.filter(
    (field) => !field.optional && field.default === undefined,
  )
}

export function createLayoutPropDrafts(
  fields: readonly PropField[],
): Record<string, LayoutPropDraftValue> {
  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      field.type === "boolean"
        ? false
        : field.type === "enum"
          ? (field.options?.[0] ?? "")
          : field.type === "date"
            ? todayDateInputValue()
            : "",
    ]),
  )
}

export function serializeLayoutPropDrafts(
  fields: readonly PropField[],
  drafts: Readonly<Record<string, LayoutPropDraftValue>>,
  options: SerializeLayoutPropDraftsOptions = {},
): { props: AstroPropMap; error: string | null } {
  const props: AstroPropMap = {}
  const fallback = options.emptyStringFallback?.trim() ?? ""
  for (const field of fields) {
    const value = drafts[field.name]
    if (field.type === "attrs" || field.type === "other") {
      return {
        props: {},
        error: `Required prop “${field.name}” uses an unsupported preview expression. Add a source default before applying this layout.`,
      }
    }
    if (field.type === "boolean") {
      props[field.name] = value === true
        ? { type: "bare" }
        : { type: "expr", value: "false" }
      continue
    }
    const text = typeof value === "string" ? value.trim() : ""
    const filled = text || fallback
    if (!filled) {
      if (options.allowEmptyStrings) continue
      return { props: {}, error: `Enter a value for “${field.name}”.` }
    }
    if (field.type === "number") {
      const number = Number(filled)
      if (!Number.isFinite(number)) {
        return { props: {}, error: `Enter a valid number for “${field.name}”.` }
      }
      props[field.name] = { type: "expr", value: String(number) }
      continue
    }
    if (field.type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(filled)) {
        return { props: {}, error: `Enter a valid date for “${field.name}”.` }
      }
      props[field.name] = { type: "expr", value: datePropExpression(filled) }
      continue
    }
    props[field.name] = { type: "string", value: filled }
  }
  return { props, error: null }
}

export function pageNameLayoutFallback(name: string): string {
  return titleFromPageFileName(name)
}
