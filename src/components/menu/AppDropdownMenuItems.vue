<script setup lang="ts">
import { AppIcon } from "@/components/ui/app-icon"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MenuItemDef } from "@/menu/types"
import { runMenuConfirm } from "@/menu/runMenuConfirm"

defineOptions({ name: "AppDropdownMenuItems" })

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

  if (!item.confirm) {
    props.dispatch(item.id)
    return
  }

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
    <DropdownMenuSeparator v-if="item.type === 'separator'" />

    <DropdownMenuLabel v-else-if="item.type === 'label'">
      {{ item.label }}
    </DropdownMenuLabel>

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
              <DropdownMenuItem
                :aria-label="action.label"
                :disabled="action.disabled"
                class="size-7 justify-center p-0"
                @select="!action.disabled && dispatch(action.id)"
              >
                <AppIcon :name="action.icon" :size="16" aria-hidden="true" />
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="top">{{ action.label }}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>

    <DropdownMenuSub v-else-if="item.type === 'submenu'">
      <DropdownMenuSubTrigger :disabled="item.disabled">
        <AppIcon v-if="item.icon" :name="item.icon" :size="16" />
        {{ item.label }}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuGroup>
          <AppDropdownMenuItems
            :items="item.items"
            :dispatch="dispatch"
          />
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>

    <DropdownMenuItem
      v-else
      :disabled="item.disabled"
      :variant="item.destructive ? 'destructive' : 'default'"
      @select="onSelect(item)"
    >
      <AppIcon v-if="item.icon" :name="item.icon" :size="16" />
      <span class="flex-1">{{ item.label }}</span>
      <DropdownMenuShortcut v-if="item.shortcut">
        {{ item.shortcut }}
      </DropdownMenuShortcut>
    </DropdownMenuItem>
  </template>
</template>
