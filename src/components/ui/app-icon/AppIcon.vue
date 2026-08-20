<script setup lang="ts">
import { HugeiconsIcon } from "@hugeicons/vue"
import { appIcons, type AppIconName } from "@/icons/registry"
import { cn } from "@/lib/utils"

const props = withDefaults(
  defineProps<{
    name: AppIconName
    size?: number
    color?: string
    strokeWidth?: number
    class?: string
  }>(),
  {
    size: 16,
    color: "currentColor",
    strokeWidth: 1.5,
  },
)
</script>

<template>
  <!--
    Button styles use `[&_svg:not([class*='size-'])]:size-4`, which clamps SVGs
    to 16px unless a size-* class is present. Keep a size class so :size works.
  -->
  <HugeiconsIcon
    :icon="appIcons[name]"
    :size="size"
    :color="color"
    :stroke-width="strokeWidth"
    :class="cn('shrink-0 size-[var(--app-icon-size)]', props.class)"
    :style="{ '--app-icon-size': `${size}px` }"
  />
</template>
