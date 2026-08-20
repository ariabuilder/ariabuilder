import { confirm } from "@/composables/useConfirm"
import type { MenuItemDef } from "@/menu/types"

type MenuActionItem = Extract<MenuItemDef, { type: "item" }>

/**
 * Run a menu item's optional confirm after the menu has closed.
 *
 * Reka/Radix closes the menu on the next tick after `select`, which unmounts
 * menu Content. Callers must dispatch the resulting action through a parent
 * that outlives that unmount (see AppContextMenu `dispatchAction`) — not via
 * `emit` from the items component after this await.
 *
 * Opening the AlertDialog in the same turn as menu dismiss also races body
 * scroll-lock cleanup, so we yield one macrotask first.
 */
export async function runMenuConfirm(item: MenuActionItem): Promise<boolean> {
  if (!item.confirm) return true
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  return confirm({
    ...item.confirm,
    destructive: item.destructive,
  })
}
