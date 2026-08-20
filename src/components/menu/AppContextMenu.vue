<script setup lang="ts">
import AppContextMenuItems from "@/components/menu/AppContextMenuItems.vue"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import type { MenuItemDef } from "@/menu/types"

const props = defineProps<{
  items: MenuItemDef[]
  class?: string
}>()

const emit = defineEmits<{
  action: [id: string]
  closeAutoFocus: [event: Event]
}>()

/** Stable across Content unmount — see AppContextMenuItems `dispatch`. */
function dispatchAction(id: string) {
  emit("action", id)
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child :class="props.class">
      <slot />
    </ContextMenuTrigger>
    <ContextMenuContent @close-auto-focus="emit('closeAutoFocus', $event)">
      <ContextMenuGroup>
        <AppContextMenuItems :items="items" :dispatch="dispatchAction" />
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>
