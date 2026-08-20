<script setup lang="ts">
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { m } from "@/paraglide/messages.js"

const props = withDefaults(
  defineProps<{
    count: number
    entityLabel: string
    showDuplicate?: boolean
    showDelete?: boolean
  }>(),
  {
    showDuplicate: true,
    showDelete: true,
  },
)

const emit = defineEmits<{
  duplicate: []
  delete: []
}>()

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s"
}
</script>

<template>
  <div class="flex items-center gap-2 whitespace-nowrap">
    <span class="pr-3 text-xs text-muted-foreground tabular-nums select-none">
      {{
        m.studio_selection_count({
          count: props.count,
          entity: `${props.entityLabel}${pluralSuffix(props.count)}`,
        })
      }}
    </span>
    <slot name="actions" />
    <Button
      v-if="props.showDuplicate"
      variant="outline"
      size="sm"
      class="h-9 text-muted-foreground hover:text-foreground!"
      @click="emit('duplicate')"
    >
      <AppIcon name="duplicate" :size="12" class="mr-1.5" />
      {{ m.studio_duplicate() }}
    </Button>
    <Button
      v-if="props.showDelete"
      variant="outline"
      size="sm"
      class="h-9 text-muted-foreground hover:text-destructive! hover:border-destructive!"
      @click="emit('delete')"
    >
      <AppIcon name="trash" :size="12" class="mr-1.5" />
      {{ m.studio_delete() }}
    </Button>
  </div>
</template>
