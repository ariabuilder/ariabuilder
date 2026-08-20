<script setup lang="ts">
import type { SplitterResizeHandleEmits, SplitterResizeHandleProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { GripVertical } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { SplitterResizeHandle, useForwardPropsEmits } from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<
  SplitterResizeHandleProps & {
    class?: HTMLAttributes["class"]
    withHandle?: boolean
  }
>()
const emits = defineEmits<SplitterResizeHandleEmits>()

const delegatedProps = reactiveOmit(props, "class", "withHandle")
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SplitterResizeHandle
    data-slot="resizable-handle"
    v-bind="forwarded"
    :class="
      cn(
        // Dashed hairline (matches composer chrome). No solid `bg-*` fill —
        // focus ring-offset was flashing white while dragging.
        'relative flex w-0 items-center justify-center border-l border-dashed border-border/70 bg-transparent',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2',
        'focus-visible:ring-ring focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-offset-0',
        'data-[resize-handle-state=hover]:border-border data-[resize-handle-state=drag]:border-border',
        'data-[orientation=vertical]:h-0 data-[orientation=vertical]:w-full data-[orientation=vertical]:border-l-0 data-[orientation=vertical]:border-t',
        'data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:h-1 data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:-translate-y-1/2 data-[orientation=vertical]:after:translate-x-0',
        '[&[data-orientation=vertical]>div]:rotate-90',
        props.class,
      )
    "
  >
    <template v-if="props.withHandle">
      <div
        class="z-10 flex h-4 w-3 items-center justify-center rounded-xs border border-dashed border-border/70 bg-sidebar text-muted-foreground"
      >
        <slot>
          <GripVertical class="size-2.5" />
        </slot>
      </div>
    </template>
  </SplitterResizeHandle>
</template>
