<script setup lang="ts">
import { Badge } from "@/components/ui/badge"
import { AppIcon } from "@/components/ui/app-icon"

defineProps<{
  branch: string | null
  ahead?: number
  behind?: number
}>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Badge
      variant="outline"
      class="gap-1.5 rounded-none border-dashed font-mono font-normal"
    >
      <AppIcon name="branchingPaths" :size="12" />
      <span class="max-w-48 truncate">{{ branch ?? "—" }}</span>
    </Badge>
    <Badge
      v-if="(ahead ?? 0) > 0"
      variant="outline"
      class="rounded-none tabular-nums"
    >
      ↑ {{ ahead }}
    </Badge>
    <Badge
      v-if="(behind ?? 0) > 0"
      variant="outline"
      class="rounded-none tabular-nums"
    >
      ↓ {{ behind }}
    </Badge>
  </div>
</template>
