<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Badge } from "@/components/ui/badge"
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

const kindDotColor = computed((): string => {
  switch (props.collection.kind) {
    case "content":
      return "var(--published)"
    case "data":
      return "var(--primary)"
    case "config":
      return "var(--draft)"
    case "tags":
      return "var(--modified)"
    default:
      return "var(--muted-foreground)"
  }
})

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
      <div class="absolute start-3 top-3 z-30 flex items-center gap-1.5 rounded-md border border-border/50 bg-background/90 px-2 py-0.5 backdrop-blur-sm">
        <span
          class="size-1.5 shrink-0 rounded-full"
          :style="{ backgroundColor: kindDotColor }"
          aria-hidden="true"
        />
        <span class="text-2xs capitalize text-muted-foreground">
          {{ collection.kind }}
        </span>
      </div>
      <Badge
        variant="secondary"
        class="absolute end-3 top-3 z-30 max-w-[60%] truncate bg-background/90 text-2xs backdrop-blur-sm"
      >
        {{ collection.sourceLabel }}
      </Badge>
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
