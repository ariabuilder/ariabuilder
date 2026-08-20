import { m } from "@/paraglide/messages.js"
import type { MenuItemDef } from "@/menu/types"
import { revealInFolderMenuItem } from "@/workspace/studio/core"
import type { PagesTableRow } from "./usePagesTable"
import { isNavigableScanPage } from "../../../../shared/pages"

/** Declarative context / overflow menu for a filesystem page row/card. */
export function pageMenuItems(page: PagesTableRow): MenuItemDef[] {
  const isHome = page.route === "/"
  const isNavigable = isNavigableScanPage(page)
  const canEditInComposer = isNavigable || page.role === "cms-entry"

  return [
    { type: "label", label: m.pages_menu_navigate() },
    {
      type: "item",
      id: "details",
      label: m.pages_action_open(),
      icon: "settings01",
    },
    ...(canEditInComposer
      ? [
          {
            type: "item" as const,
            id: "composer",
            label: m.pages_action_edit_in_composer(),
            icon: "edit" as const,
          },
        ]
      : []),
    { type: "label", label: m.pages_menu_page() },
    {
      type: "item",
      id: "copy-route",
      label: m.pages_action_copy_route(),
      icon: "link",
    },
    {
      type: "item",
      id: "copy-path",
      label: m.pages_action_copy_path(),
      icon: "copy",
    },
    revealInFolderMenuItem(),
    {
      type: "item",
      id: "delete",
      label: m.pages_action_delete(),
      icon: "trash",
      destructive: true,
      disabled: isHome,
    },
  ]
}
