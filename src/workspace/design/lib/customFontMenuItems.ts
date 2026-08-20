import { m } from "@/paraglide/messages.js"
import type { MenuItemDef } from "@/menu/types"
import { revealInFolderMenuItem } from "@/workspace/studio/core"
import type { DesignCustomFont } from "../../../../shared/design"

export function customFontMenuItems(font: DesignCustomFont): MenuItemDef[] {
  return [
    revealInFolderMenuItem(),
    {
      type: "item",
      id: "delete",
      label: m.media_action_delete(),
      icon: "trash",
      destructive: true,
      confirm: {
        title: m.design_fonts_delete_confirm_title({ name: font.family }),
        description: m.design_fonts_delete_confirm_description(),
        confirmLabel: m.confirm_delete(),
        cancelLabel: m.confirm_cancel(),
      },
    },
  ]
}
