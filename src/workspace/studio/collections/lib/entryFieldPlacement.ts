import { z } from "zod"
import type { EntryFieldOrderItem, FieldSchema } from "../../../../../shared/cms"
import { isCoverImageField } from "../../../../../shared/cms"

export const CmsEntryFieldPlacementSchema = z.enum(["main", "sidebar"])
export type CmsEntryFieldPlacement = z.infer<
  typeof CmsEntryFieldPlacementSchema
>

export function getEntryFieldPlacement(
  field: FieldSchema,
): CmsEntryFieldPlacement {
  if (isCoverImageField(field)) {
    return "sidebar"
  }

  return "main"
}

export function getOrderedEntryFieldPlacement(
  item: EntryFieldOrderItem,
  field: FieldSchema,
): CmsEntryFieldPlacement {
  if (item.kind === "field" && item.placement) {
    return CmsEntryFieldPlacementSchema.parse(item.placement)
  }

  return getEntryFieldPlacement(field)
}

export function entryFieldsForPlacement(
  fields: readonly FieldSchema[],
  placement: CmsEntryFieldPlacement,
): FieldSchema[] {
  const parsedPlacement = CmsEntryFieldPlacementSchema.parse(placement)
  return fields.filter(
    (field) => getEntryFieldPlacement(field) === parsedPlacement,
  )
}
