<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { computed, useAttrs } from "vue"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FLICKERING_NAV_ITEM_ROW_CLASS } from "../lib/flickeringNavGrid"
import FlickeringGridBackdrop from "./FlickeringGridBackdrop.vue"

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    active?: boolean
    dropHighlight?: boolean
    disabled?: boolean
    showGrid?: boolean
    /** Use `div` when the row contains nested buttons (e.g. group actions). */
    rowAs?: "button" | "div"
    class?: HTMLAttributes["class"]
  }>(),
  {
    active: false,
    dropHighlight: false,
    disabled: false,
    showGrid: true,
    rowAs: "button",
  },
)

const attrs = useAttrs()

const variant = computed(() => (props.active ? "nav-active" : "nav"))

const rowClass = computed(() =>
  cn(
    FLICKERING_NAV_ITEM_ROW_CLASS,
    // Organizer rows are padding-driven; override Button nav `h-10!`.
    "h-auto! min-h-10",
    // Let the left mask resolve into the canvas surface in light mode while
    // retaining the deeper sidebar fade that gives dark mode its depth.
    props.active &&
      "bg-background before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-20 before:border-t before:border-dashed before:border-border/50 before:content-[''] dark:bg-sidebar",
    props.dropHighlight && !props.active && "bg-sidebar/60 nav-border-active",
    props.class,
  ),
)
</script>

<template>
  <Button
    v-bind="attrs"
    :as="rowAs"
    :variant="variant"
    :disabled="disabled"
    :class="rowClass"
    :role="rowAs === 'div' ? 'button' : undefined"
    :tabindex="rowAs === 'div' && !disabled ? 0 : undefined"
  >
    <!-- Grid mounts only for the active route filter, never on hover or drop-target -->
    <FlickeringGridBackdrop v-if="active && showGrid" />
    <span
      class="relative z-10 flex w-full min-w-0 items-center justify-between gap-2"
    >
      <slot />
    </span>
  </Button>
</template>
