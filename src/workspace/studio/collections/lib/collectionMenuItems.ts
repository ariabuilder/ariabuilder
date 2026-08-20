import { m } from "@/paraglide/messages.js"
import type { MenuItemDef } from "@/menu/types"
import type { CollectionSummary } from "../composables/useCollectionsList"

export function collectionMenuItems(
  collection: CollectionSummary,
): MenuItemDef[] {
  const items: MenuItemDef[] = [
    {
      type: "item",
      id: "open",
      label: m.cms_collections_action_open(),
      icon: "collections",
    },
    { type: "separator" },
    {
      type: "item",
      id: "copy-id",
      label: m.cms_collections_action_copy_id(),
      icon: "copy",
    },
  ]
  if (!collection.readOnly) {
    items.push(
      { type: "separator" },
      { type: "item", id: "delete", label: m.cms_collections_delete_one(), icon: "trash", destructive: true },
    )
  }
  return items
}
