import type { AppIconName } from "@/icons/registry"
import type { CollectionKind } from "../../../../../shared/cms"

export type CollectionKindOption = {
  value: CollectionKind
  label: string
  description: string
  icon: AppIconName
}

export const COLLECTION_KIND_OPTIONS: readonly CollectionKindOption[] = [
  {
    value: "content",
    label: "Content",
    description: "Blog posts, articles, and marketing content",
    icon: "pages",
  },
  {
    value: "data",
    label: "Data",
    description: "Structured data used across the site",
    icon: "databaseLine",
  },
  {
    value: "config",
    label: "Config",
    description: "Site-wide configuration settings",
    icon: "settings",
  },
  {
    value: "tags",
    label: "Tags",
    description: "Tags, categories, and labels",
    icon: "tag",
  },
] as const

export function collectionKindIcon(kind: CollectionKind): AppIconName {
  return (
    COLLECTION_KIND_OPTIONS.find((option) => option.value === kind)?.icon ??
    "collections"
  )
}
