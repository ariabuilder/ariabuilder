import type { FieldSchema } from "../../../../../shared/cms"
import { isCoverImageField } from "../../../../../shared/cms"

export type CmsImageFieldLayout = "cover" | "compact"

export function cmsImageFieldLayout(field: FieldSchema): CmsImageFieldLayout {
  return isCoverImageField(field) ? "cover" : "compact"
}
