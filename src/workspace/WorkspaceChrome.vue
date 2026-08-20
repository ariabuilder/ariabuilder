<script setup lang="ts">
import { useWindowFullscreen } from "@/composables/useWindowFullscreen"
import { cn } from "@/lib/utils"

const { fullscreen } = useWindowFullscreen()
</script>

<template>
  <!--
    Single DOM tree so rail/header/main never remount on fullscreen toggle.
    Windowed: header spans top; rail + main share the bottom row.
    Fullscreen: rail spans full height; header + main stack beside it.
  -->
  <div
    :class="cn(
      'grid h-svh max-h-svh overflow-hidden bg-background text-foreground',
      'grid-cols-[auto_1fr] grid-rows-[auto_1fr]',
    )"
  >
    <div
      :class="cn(
        'min-w-0',
        fullscreen ? 'col-start-2 row-start-1' : 'col-span-2 row-start-1',
      )"
    >
      <slot name="header" />
    </div>

    <div
      :class="cn(
        'min-h-0',
        fullscreen
          ? 'col-start-1 row-start-1 row-span-2'
          : 'col-start-1 row-start-2',
      )"
    >
      <slot name="rail" />
    </div>

    <div
      class="col-start-2 row-start-2 flex min-h-0 min-w-0 w-full flex-1"
    >
      <slot name="main" />
    </div>
  </div>
</template>
