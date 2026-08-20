<script setup lang="ts">
import type { SelectTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { ChevronDown } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { SelectIcon, SelectTrigger, useForwardProps } from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<
  SelectTriggerProps & {
    class?: HTMLAttributes["class"]
    hideIcon?: boolean
  }
>()

const delegatedProps = reactiveOmit(props, "class", "hideIcon")
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectTrigger
    data-slot="select-trigger"
    v-bind="forwardedProps"
    :class="
      cn(
        'flex h-9! w-full min-w-0 cursor-pointer items-center justify-between rounded-sm border border-solid border-border/50 bg-sidebar/40 px-4 py-1 text-start text-sm shadow-none outline-none ring-0 transition-[color,background-color,border-color]',
        'placeholder:text-muted-foreground/50 hover:bg-sidebar/80',
        'focus:border-border focus:bg-sidebar focus:outline-none focus:ring-0',
        'focus-visible:border-border focus-visible:bg-sidebar/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:ring-0',
        'data-[state=open]:border-border data-[state=open]:bg-sidebar/80',
        'aria-invalid:border-destructive disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate',
        props.class,
      )
    "
  >
    <slot />
    <SelectIcon v-if="!hideIcon" as-child>
      <ChevronDown class="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
    </SelectIcon>
  </SelectTrigger>
</template>
