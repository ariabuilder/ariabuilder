<script setup lang="ts">
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

withDefaults(
  defineProps<{
    label: string
    side?: "top" | "bottom" | "left" | "right"
    portalled?: boolean
    fullWidth?: boolean
    disabled?: boolean
  }>(),
  {
    side: "bottom",
    portalled: true,
    fullWidth: false,
    disabled: false,
  },
)
</script>

<template>
  <TooltipProvider
    :delay-duration="0"
    :skip-delay-duration="0"
    :disable-hoverable-content="true"
  >
    <span :class="fullWidth ? 'flex w-full min-w-0' : 'inline-flex shrink-0'">
      <Tooltip>
        <TooltipTrigger as-child>
          <span
            class="inline-flex shrink-0 outline-none"
            :class="disabled ? 'cursor-not-allowed' : undefined"
            tabindex="-1"
          >
            <slot />
          </span>
        </TooltipTrigger>
        <TooltipContent
          :side="side"
          :side-offset="8"
          class="z-[60] whitespace-nowrap"
        >
          {{ label }}
        </TooltipContent>
      </Tooltip>
    </span>
  </TooltipProvider>
</template>
