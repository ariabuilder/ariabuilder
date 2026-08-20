<script setup lang="ts">
import { AppIcon } from "@/components/ui/app-icon"
import type { AppIconName } from "@/icons/registry"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type InspectorBreakpointOverride = {
  id: string
  label: string
  width: number | null
  isCurrent: boolean
}

defineProps<{
  breakpoints: readonly InspectorBreakpointOverride[]
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

function breakpointDeviceIcon(width: number | null): AppIconName {
  if (width == null || width < 768) return "deviceMobile"
  if (width < 1024) return "deviceTablet"
  return "deviceDesktop"
}
</script>

<template>
  <div
    v-if="breakpoints.length"
    class="inline-flex items-center gap-0.5"
    aria-label="Overrides by breakpoint"
  >
    <TooltipProvider v-for="breakpoint in breakpoints" :key="breakpoint.id">
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            :data-testid="`breakpoint-indicator-${breakpoint.id}`"
            :class="cn(
              'inline-flex size-6 items-center justify-center rounded-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary',
              breakpoint.isCurrent ? 'text-primary' : 'text-muted-foreground/70',
            )"
            :aria-label="`${breakpoint.label} breakpoint has authored values${breakpoint.width == null ? '' : ` at ${breakpoint.width}px`}`"
            :aria-pressed="breakpoint.isCurrent"
            @click.stop.prevent="emit('select', breakpoint.id)"
          >
            <AppIcon :name="breakpointDeviceIcon(breakpoint.width)" :size="14" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" class="text-xs">
          {{ breakpoint.label }}<template v-if="breakpoint.width != null"> · {{ breakpoint.width }}px</template>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>
