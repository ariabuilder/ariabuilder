<script setup lang="ts">
import type { DropdownMenuSubTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { DropdownMenuSubTrigger, useForwardProps } from "reka-ui"
import { AppIcon } from "@/components/ui/app-icon"
import { cn } from "@/lib/utils"

const props = defineProps<
  DropdownMenuSubTriggerProps & {
    class?: HTMLAttributes["class"]
    inset?: boolean
  }
>()

const delegatedProps = reactiveOmit(props, "class", "inset")
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <DropdownMenuSubTrigger
    data-slot="dropdown-menu-sub-trigger"
    v-bind="forwardedProps"
    :class="
      cn(
        'flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground data-[inset]:pl-8',
        props.class,
      )
    "
  >
    <slot />
    <AppIcon name="chevronRight" :size="16" class="ml-auto" />
  </DropdownMenuSubTrigger>
</template>
