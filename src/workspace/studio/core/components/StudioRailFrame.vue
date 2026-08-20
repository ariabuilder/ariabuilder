<script setup lang="ts">
import { cn } from "@/lib/utils"

const props = defineProps<{
  title?: string
}>()
</script>

<template>
  <aside
    data-studio-organizer-rail
    :class="
      cn(
        'flex h-full min-h-0 w-70 shrink-0 flex-col overflow-hidden border-r border-dashed border-border/70 bg-background dark:bg-sidebar',
      )
    "
  >
    <div
      v-if="props.title"
      class="flex h-19 shrink-0 items-center border-b border-dashed border-border bg-background dark:bg-sidebar px-5"
    >
      <div class="min-w-0">
        <h2 class="truncate text-2xl font-sans font-medium tracking-tight">
          {{ props.title }}
        </h2>
      </div>
    </div>
    <slot />
  </aside>
</template>
