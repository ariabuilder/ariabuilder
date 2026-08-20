<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <span
    data-slot="shortcut-hint"
    aria-hidden="true"
    :class="cn(
      'rounded-sm border border-border/70 px-1 font-mono text-[9px]',
      props.class,
    )"
  >
    <slot />
  </span>
</template>
