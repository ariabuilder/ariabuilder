import type { RecentProject } from "@/lib/project"
import { isMacPlatform } from "@/lib/keyboardShortcuts"
import type { MenuItemDef } from "@/menu/types"
import { m } from "@/paraglide/messages.js"

type Options = {
  sessionOpen?: boolean
}

function revealInFolderLabel(): string {
  return isMacPlatform() ? m.menu_reveal_in_finder() : m.menu_reveal_in_folder()
}

export function recentProjectMenuItems(
  _project: RecentProject,
  options: Options = {},
): MenuItemDef[] {
  const items: MenuItemDef[] = [
    {
      type: "item",
      id: "open",
      label: options.sessionOpen ? m.menu_switch_to() : m.menu_open(),
      icon: "folderOpen",
    },
    {
      type: "item",
      id: "open-new-window",
      label: m.workspace_project_open_new_window(),
      icon: "externalLink",
    },
  ]

  if (options.sessionOpen) {
    items.push({
      type: "item",
      id: "dismiss",
      label: m.welcome_dismiss_session(),
      icon: "close",
    })
  }

  items.push(
    { type: "separator" },
    {
      type: "item",
      id: "reveal",
      label: revealInFolderLabel(),
      icon: "folder",
    },
    {
      type: "item",
      id: "copy-path",
      label: m.menu_copy_path(),
      icon: "copy",
    },
    {
      type: "item",
      id: "copy-name",
      label: m.menu_copy_name(),
      icon: "link",
    },
    { type: "separator" },
    {
      type: "item",
      id: "remove",
      label: m.welcome_remove_recent(),
      icon: "trash",
      destructive: true,
    },
  )

  return items
}
