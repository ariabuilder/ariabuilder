import type { AppIconName } from "@/icons/registry"
import type { ConfirmOptions } from "@/composables/useConfirm"

/**
 * Declarative menu model — features define data, AppContextMenu renders once.
 * Never re-compose ContextMenuItem trees in feature components.
 */
export type MenuConfirmOptions = Pick<
  ConfirmOptions,
  "title" | "description" | "confirmLabel" | "cancelLabel"
>

export type MenuItemDef =
  | {
      type: "item"
      id: string
      label: string
      icon?: AppIconName
      shortcut?: string
      disabled?: boolean
      destructive?: boolean
      hidden?: boolean
      /** When set, AppContextMenu awaits confirmation before emitting this action. */
      confirm?: MenuConfirmOptions
    }
  | {
      type: "separator"
      hidden?: boolean
    }
  | {
      type: "label"
      label: string
      hidden?: boolean
    }
  | {
      type: "icon-group"
      label: string
      actions: {
        id: string
        label: string
        icon: AppIconName
        disabled?: boolean
      }[]
      hidden?: boolean
    }
  | {
      type: "submenu"
      id: string
      label: string
      icon?: AppIconName
      items: MenuItemDef[]
      disabled?: boolean
      hidden?: boolean
    }

export type MenuActionHandler = (id: string) => void
