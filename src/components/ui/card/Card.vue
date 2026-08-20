<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="card"
    :class="
      cn(
        'bg-sidebar text-card-foreground flex flex-col gap-0 rounded-md border border-solid border-border/40 dark:border-border/70 py-0 shadow-none hover:shadow-xs transition-all duration-100 ease-out hover:bg-sidebar/50 hover:border-border hover:border-dashed cursor-pointer',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
