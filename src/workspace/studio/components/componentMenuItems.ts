import { m } from "@/paraglide/messages.js"
import type { MenuItemDef } from "@/menu/types"
import {
  moveToGroupSubmenu,
  revealInFolderMenuItem,
  type StudioMenuGroupOption,
} from "@/workspace/studio/core"
import type { ComponentsTableRow } from "./useComponentsTable"

export type ComponentMenuGroupOption = StudioMenuGroupOption

/** Declarative context menu for a filesystem component row/card. */
export function componentMenuItems(
  component: ComponentsTableRow,
  options?: {
    groups?: readonly ComponentMenuGroupOption[]
    currentGroupId?: string | null
    canUpdateGrouping?: boolean
  },
): MenuItemDef[] {
  const groups = options?.groups ?? []
  const canUpdateGrouping = options?.canUpdateGrouping ?? true
  const currentGroupId = options?.currentGroupId ?? null

  const items: MenuItemDef[] = [
    { type: "label", label: m.components_menu_navigate() },
    revealInFolderMenuItem(),
    { type: "separator" },
    { type: "label", label: m.components_menu_component() },
    {
      type: "item",
      id: "copy-path",
      label: m.components_action_copy_path(),
      icon: "copy",
    },
  ]

  if (canUpdateGrouping && groups.length > 0) {
    items.push(
      moveToGroupSubmenu({
        groups,
        currentGroupId,
        allLabel: m.components_sidebar_all(),
        submenuLabel: m.components_action_move_to_group(),
        icon: "components",
      }),
    )
  }

  items.push(
    { type: "separator" },
    {
      type: "item",
      id: "delete",
      label: m.components_action_delete(),
      icon: "trash",
      destructive: true,
      confirm: {
        title: m.components_delete_confirm_title({
          name: component.displayName,
        }),
        description: m.components_delete_confirm_description(),
      },
    },
  )

  return items
}
