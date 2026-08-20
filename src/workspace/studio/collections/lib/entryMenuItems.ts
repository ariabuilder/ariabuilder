import { m } from "@/paraglide/messages.js"
import type { MenuItemDef } from "@/menu/types"
import type { CmsEntryRow } from "./entryRow"

export function entryMenuItems(entry: CmsEntryRow): MenuItemDef[] {
  const items: MenuItemDef[] = [
    {
      type: "item",
      id: "open",
      label: m.cms_entries_open(),
      icon: "edit",
    },
    {
      type: "item",
      id: "duplicate",
      label: m.cms_entries_action_duplicate(),
      icon: "copy",
    },
    { type: "separator" },
  ]

  if (entry.status !== "published") {
    items.push({
      type: "item",
      id: "publish",
      label: m.cms_entries_action_publish(),
      icon: "publish",
    })
  } else {
    items.push({
      type: "item",
      id: "unpublish",
      label: m.cms_entries_action_unpublish(),
      icon: "unpublish",
    })
  }

  if (entry.status !== "archived") {
    items.push({
      type: "item",
      id: "archive",
      label: m.cms_entries_action_archive(),
      icon: "archive",
    })
  }

  items.push(
    { type: "separator" },
    {
      type: "item",
      id: "copy-id",
      label: m.cms_entries_copy_id(),
      icon: "copy",
    },
    {
      type: "item",
      id: "delete",
      label: m.studio_delete(),
      icon: "trash",
      destructive: true,
    },
  )

  return items
}
