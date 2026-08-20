<script setup lang="ts">
import { Skeleton } from "@/components/ui/skeleton"

withDefaults(
  defineProps<{
    rows?: number
    columns?: number
  }>(),
  {
    rows: 5,
    columns: 4,
  },
)
</script>

<template>
  <div class="space-y-3 px-7 py-4">
    <div class="flex gap-4 border-b border-border pb-3">
      <Skeleton v-for="c in columns" :key="c" class="h-4 flex-1" />
    </div>
    <Skeleton v-for="r in rows" :key="r" class="h-14 w-full" />
  </div>
</template>
