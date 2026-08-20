<script setup lang="ts">
import { computed } from "vue"
import { Badge } from "@/components/ui/badge"
import {
  formatExternalFieldValue,
  getExternalEntryImageUrl,
  getExternalEntryTitle,
  getExternalIdentityField,
} from "../../../../../shared/externalCollectionEntries"
import type {
  ExternalCollectionEntry,
  ExternalFieldDescriptor,
} from "../../../../../shared/types"
import ExternalEntryThumb from "./ExternalEntryThumb.vue"

const props = defineProps<{
  projectRoot: string
  entry: ExternalCollectionEntry
  fields: readonly ExternalFieldDescriptor[]
  sourceLabel: string
}>()

const emit = defineEmits<{ open: [entryId: string] }>()

const title = computed(() => getExternalEntryTitle(props.entry))
const imageUrl = computed(() => getExternalEntryImageUrl(
  props.entry,
  props.fields,
  props.projectRoot,
))
const identityKey = computed(() => getExternalIdentityField(props.fields)?.key)
const metadata = computed(() => props.fields
  .filter((field) =>
    !field.image &&
    !field.complex &&
    field.key !== identityKey.value &&
    props.entry.data[field.key] != null &&
    props.entry.data[field.key] !== "",
  )
  .slice(0, 2)
  .map((field) => ({
    key: field.key,
    label: field.label,
    value: formatExternalFieldValue(props.entry.data[field.key], field.type),
  })))
</script>

<template>
  <button
    type="button"
    class="group min-w-0 overflow-hidden rounded-lg border border-border bg-card text-start shadow-sm transition-[border-color,box-shadow,scale] hover:border-primary/40 hover:shadow-md active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    :aria-label="`Open ${title}`"
    @click="emit('open', entry.id)"
  >
    <div class="relative aspect-video overflow-hidden bg-muted/25">
      <ExternalEntryThumb
        :url="imageUrl"
        :title="title"
        variant="card"
      />
      <Badge
        variant="secondary"
        class="absolute start-3 top-3 z-10 max-w-[calc(100%-1.5rem)] truncate bg-background/90 text-2xs backdrop-blur-sm"
      >
        {{ sourceLabel }} · Read-only
      </Badge>
    </div>
    <div class="space-y-3 p-3.5">
      <h2 class="truncate text-sm font-medium leading-snug text-foreground">
        {{ title }}
      </h2>
      <dl v-if="metadata.length" class="space-y-1.5 text-2xs">
        <div
          v-for="item in metadata"
          :key="item.key"
          class="flex min-w-0 items-baseline justify-between gap-3"
        >
          <dt class="shrink-0 text-muted-foreground">{{ item.label }}</dt>
          <dd class="truncate text-foreground/80" :title="item.value">{{ item.value }}</dd>
        </div>
      </dl>
      <p v-else class="truncate text-2xs text-muted-foreground">
        {{ entry.locale || entry.id }}
      </p>
    </div>
  </button>
</template>
