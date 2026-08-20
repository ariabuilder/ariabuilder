<script setup lang="ts">
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"

const props = withDefaults(
  defineProps<{
    currentPage?: number
    totalPages?: number
    /** Left-side meta label (e.g. "12 pages"). */
    meta?: string | null
    /** Force visibility even when a single page and no meta. */
    visible?: boolean
  }>(),
  {
    currentPage: 1,
    totalPages: 1,
    meta: null,
  },
)

const emit = defineEmits<{
  "update:currentPage": [page: number]
}>()

const showPagination = () => (props.totalPages ?? 1) > 1
</script>

<template>
  <div
    v-if="props.visible ?? (Boolean(props.meta) || showPagination())"
    class="flex h-10 shrink-0 select-none items-center justify-between gap-4 border-t border-dashed border-border bg-background px-7"
  >
    <span
      v-if="props.meta"
      class="text-[10px] text-muted-foreground tabular-nums"
    >
      {{ props.meta }}
    </span>
    <span v-else />

    <div v-if="showPagination()" class="flex items-center justify-end">
      <span class="text-[10px] text-muted-foreground tabular-nums">
        {{ props.currentPage }} / {{ props.totalPages }}
      </span>
      <div class="flex items-center gap-0 pl-6">
        <Button
          variant="ghost"
          size="icon"
          class="text-muted-foreground hover:text-foreground"
          :disabled="(props.currentPage ?? 1) <= 1"
          @click="emit('update:currentPage', (props.currentPage ?? 1) - 1)"
        >
          <AppIcon name="chevronLeft" :size="16" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="text-primary hover:text-foreground"
          :disabled="(props.currentPage ?? 1) >= (props.totalPages ?? 1)"
          @click="emit('update:currentPage', (props.currentPage ?? 1) + 1)"
        >
          <AppIcon name="chevronRight" :size="16" />
        </Button>
      </div>
    </div>
  </div>
</template>
