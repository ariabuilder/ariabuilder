import { m } from "@/paraglide/messages.js"
import type { MenuItemDef } from "@/menu/types"
import type { MediaAsset } from "@/lib/media"
import {
  moveToGroupSubmenu,
  revealInFolderMenuItem,
  type StudioMenuGroupOption,
} from "@/workspace/studio/core"

export function mediaMenuItems(
  asset: MediaAsset,
  options?: {
    groups?: readonly StudioMenuGroupOption[]
    currentGroupId?: string | null
  },
): MenuItemDef[] {
  const groups = options?.groups ?? []
  const currentGroupId = options?.currentGroupId ?? null

  const items: MenuItemDef[] = [
    { type: "item", id: "open", label: m.media_action_open() },
    { type: "item", id: "rename", label: m.media_action_rename() },
    { type: "item", id: "duplicate", label: m.media_action_duplicate() },
    revealInFolderMenuItem(),
    {
      type: "item",
      id: "copy-path",
      label: m.media_action_copy_path(),
      icon: "copy",
    },
  ]

  if (groups.length > 0) {
    items.push(
      moveToGroupSubmenu({
        groups,
        currentGroupId,
        allLabel: m.media_sidebar_all(),
        submenuLabel: m.media_action_move_to_folder(),
        submenuId: "move-to-folder",
      }),
    )
  }

  items.push(
    { type: "separator" },
    {
      type: "item",
      id: "delete",
      label: m.media_action_delete(),
      icon: "trash",
      destructive: true,
      confirm: {
        title: m.media_delete_confirm_title({ name: asset.name }),
        description: m.media_delete_confirm_description(),
        confirmLabel: m.confirm_delete(),
        cancelLabel: m.confirm_cancel(),
      },
    },
  )

  return items
}
