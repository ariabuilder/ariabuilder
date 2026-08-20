import { isMacPlatform } from "@/lib/keyboardShortcuts"
import { m } from "@/paraglide/messages.js"
import type { AppIconName } from "@/icons/registry"
import type { MenuItemDef } from "@/menu/types"

export type StudioMenuGroupOption = {
  id: string
  name: string
}

type RevealItemOverrides = Partial<
  Pick<Extract<MenuItemDef, { type: "item" }>, "id" | "icon">
>

/** Finder / folder reveal item with platform-aware label. */
export function revealInFolderMenuItem(
  overrides?: RevealItemOverrides,
): MenuItemDef {
  return {
    type: "item",
    id: overrides?.id ?? "reveal",
    label: isMacPlatform()
      ? m.menu_reveal_in_finder()
      : m.menu_reveal_in_folder(),
    icon: overrides?.icon ?? "folder",
  }
}

/** Move-to-group/folder submenu with `move-group:` / `move-group:{id}` action ids. */
export function moveToGroupSubmenu(options: {
  groups: readonly StudioMenuGroupOption[]
  currentGroupId?: string | null
  allLabel: string
  submenuLabel: string
  submenuId?: string
  icon?: AppIconName
}): MenuItemDef {
  const currentGroupId = options.currentGroupId ?? null

  const moveItems: MenuItemDef[] = [
    {
      type: "item",
      id: "move-group:",
      label: options.allLabel,
      disabled: currentGroupId == null,
    },
    ...options.groups.map(
      (group): MenuItemDef => ({
        type: "item",
        id: `move-group:${group.id}`,
        label: group.name,
        disabled: group.id === currentGroupId,
      }),
    ),
  ]

  return {
    type: "submenu",
    id: options.submenuId ?? "move-to-group",
    label: options.submenuLabel,
    icon: options.icon,
    items: moveItems,
  }
}
