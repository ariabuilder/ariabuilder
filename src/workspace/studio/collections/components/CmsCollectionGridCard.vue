<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Card, CardDescription, CardFooter, CardTitle } from "@/components/ui/card"
import { m } from "@/paraglide/messages.js"
import { collectionKindIcon } from "../lib/collectionKindOptions"
import { formatCmsRelativeTime } from "../lib/formatCmsTime"
import type { CollectionSummary } from "../composables/useCollectionsList"

const props = defineProps<{
  collection: CollectionSummary
}>()

const emit = defineEmits<{
  open: [name: string]
}>()

const updatedLabel = computed(() =>
  formatCmsRelativeTime(props.collection.updatedAt),
)

const itemCountLabel = computed(() => {
  if (!props.collection.countAvailable) return "Entries unavailable"
  const count = props.collection.itemCount
  return count === 1
    ? m.cms_collections_one_entry()
    : m.cms_collections_entry_count({ count })
})
</script>

<template>
  <Card
    class="group cursor-pointer overflow-hidden"
    tabindex="0"
    @click="emit('open', collection.name)"
    @keydown.enter.prevent="emit('open', collection.name)"
    @keydown.space.prevent="emit('open', collection.name)"
  >
    <div class="relative aspect-video overflow-hidden bg-muted/25">
      <div class="absolute inset-0 flex items-center justify-center">
        <AppIcon
          :name="collectionKindIcon(collection.kind)"
          :size="48"
          class="text-muted-foreground"
        />
      </div>
      <div class="absolute inset-s-3 top-3 z-30 flex items-center gap-2 rounded-sm border border-border/50 bg-sidebar/90 px-2 py-1 backdrop-blur-sm">
        <span class="text-2xs capitalize text-muted-foreground">
          {{ collection.kind }}
        </span>
      </div>
    </div>

    <CardFooter class="flex-col items-stretch gap-2 px-3.5 pb-3.5 pt-3">
      <CardTitle class="truncate text-sm font-medium leading-snug">
        {{ collection.label }}
      </CardTitle>
      <p v-if="collection.readOnly" class="text-2xs text-muted-foreground">
        Read-only · {{ collection.sourceMode }} ·
        {{ collection.sourceLabel === 'Local Astro' ? 'Project files' : `${collection.cacheState} cache` }}
      </p>
      <div
        class="flex min-w-0 items-center justify-between gap-3 text-2xs text-muted-foreground"
      >
        <CardDescription
          class="truncate rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 tabular-nums text-2xs"
        >
          {{ itemCountLabel }}
        </CardDescription>
        <span class="shrink-0 tabular-nums">{{ updatedLabel }}</span>
      </div>
    </CardFooter>
  </Card>
</template>
