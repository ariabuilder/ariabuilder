import type { AppIconName } from "@/icons/registry"
import type { CollectionScope } from "../../../../../shared/cms"

export type CollectionScopeOption = {
  value: CollectionScope
  label: string
  description: string
  icon: AppIconName
}

export const COLLECTION_SCOPE_OPTIONS: readonly CollectionScopeOption[] = [
  {
    value: "global",
    label: "Global",
    description: "Reuse entries anywhere across the site",
    icon: "globe",
  },
  {
    value: "collection",
    label: "Local",
    description: "Use entries only on this collection’s pages",
    icon: "local",
  },
] as const
