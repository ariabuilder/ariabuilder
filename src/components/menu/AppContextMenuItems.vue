<script setup lang="ts">
import { AppIcon } from "@/components/ui/app-icon"
import {
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MenuItemDef } from "@/menu/types"
import { runMenuConfirm } from "@/menu/runMenuConfirm"

defineOptions({ name: "AppContextMenuItems" })

const props = defineProps<{
  items: MenuItemDef[]
  /**
   * Stable action sink from a parent that outlives the menu content.
   * Required for items with `confirm` — Content unmounts before confirm
   * resolves, so `emit('action')` after await is dropped.
   */
  dispatch: (id: string) => void
}>()

function visibleItems(items: MenuItemDef[]): MenuItemDef[] {
  return items.filter((item) => !item.hidden)
}

function itemKey(item: MenuItemDef, index: number): string {
  if (item.type === "item" || item.type === "submenu") return item.id
  if (item.type === "icon-group") return `icon-group-${item.label}`
  return `${item.type}-${index}`
}

function onSelect(item: Extract<MenuItemDef, { type: "item" }>) {
  if (item.disabled) return

  // Sync path: emit before the menu closes (same tick as select).
  if (!item.confirm) {
    props.dispatch(item.id)
    return
  }

  // Async confirm: menu Content unmounts on close. Dispatch through the
  // parent-provided callback (lives on AppContextMenu / card), not emit.
  const id = item.id
  const dispatch = props.dispatch
  void (async () => {
    if (!(await runMenuConfirm(item))) return
    dispatch(id)
  })()
}
</script>

<template>
  <template
    v-for="(item, index) in visibleItems(items)"
    :key="itemKey(item, index)"
  >
    <ContextMenuSeparator v-if="item.type === 'separator'" />

    <ContextMenuLabel v-else-if="item.type === 'label'">
      {{ item.label }}
    </ContextMenuLabel>

    <div
      v-else-if="item.type === 'icon-group'"
      role="group"
      :aria-label="item.label"
      class="flex items-center justify-between gap-3 px-2 py-1"
    >
      <span class="text-xs text-muted-foreground">{{ item.label }}</span>
      <TooltipProvider>
        <div class="flex items-center gap-1">
          <Tooltip v-for="action in item.actions" :key="action.id">
            <TooltipTrigger as-child>
              <ContextMenuItem
                :aria-label="action.label"
                :disabled="action.disabled"
                class="size-7 justify-center p-0"
                @select="!action.disabled && dispatch(action.id)"
              >
                <AppIcon :name="action.icon" :size="16" aria-hidden="true" />
              </ContextMenuItem>
            </TooltipTrigger>
            <TooltipContent side="top">{{ action.label }}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>

    <ContextMenuSub v-else-if="item.type === 'submenu'">
      <ContextMenuSubTrigger :disabled="item.disabled">
        <AppIcon v-if="item.icon" :name="item.icon" :size="16" />
        {{ item.label }}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuGroup>
          <AppContextMenuItems
            :items="item.items"
            :dispatch="dispatch"
          />
        </ContextMenuGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>

    <ContextMenuItem
      v-else
      :disabled="item.disabled"
      :variant="item.destructive ? 'destructive' : 'default'"
      @select="onSelect(item)"
    >
      <AppIcon v-if="item.icon" :name="item.icon" :size="16" />
      <span class="flex-1">{{ item.label }}</span>
      <ContextMenuShortcut v-if="item.shortcut">
        {{ item.shortcut }}
      </ContextMenuShortcut>
    </ContextMenuItem>
  </template>
</template>
