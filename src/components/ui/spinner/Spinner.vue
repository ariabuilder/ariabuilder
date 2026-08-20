<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <span
    role="status"
    aria-label="Loading"
    class="inline-flex"
  >
    <AppIcon
      name="loading"
      :class="cn('size-4 animate-spin', props.class)"
    />
  </span>
</template>
