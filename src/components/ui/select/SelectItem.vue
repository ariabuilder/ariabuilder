<script setup lang="ts">
import type { SelectItemProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { SelectItem, SelectItemText, useForwardProps } from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<SelectItemProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectItem
    v-bind="forwardedProps"
    :class="
      cn(
        'relative flex w-full cursor-default select-none items-center border-0 border-b border-dashed border-border px-3 py-2 text-xs text-muted-foreground outline-none last:border-b-0',
        'hover:bg-sidebar/40 hover:text-accent-foreground',
        'focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        'active:bg-sidebar active:text-accent-foreground',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        props.class,
      )
    "
  >
    <SelectItemText class="flex min-w-0 flex-1 items-center justify-start text-left">
      <slot />
    </SelectItemText>
    <slot name="trailing" />
  </SelectItem>
</template>
