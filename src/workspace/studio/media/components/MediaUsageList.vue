<script setup lang="ts">
import { computed } from "vue"
import type { MediaAssetUsage } from "@/lib/media"
import { m } from "@/paraglide/messages.js"
import {
  formatUsageLineLabel,
  groupMediaUsages,
  mediaUsageRowTitle,
  type MediaUsageGroup,
} from "../lib/mediaUsages"

const props = defineProps<{
  usages: readonly MediaAssetUsage[]
}>()

const groups = computed(() => groupMediaUsages(props.usages))

function lineAriaLabel(group: MediaUsageGroup): string {
  if (group.lines.length === 1) {
    return m.media_usages_line({ line: String(group.lines[0]) })
  }
  return m.media_usages_lines({ count: String(group.lines.length) })
}
</script>

<template>
  <section v-if="groups.length" aria-labelledby="media-asset-usages-heading">
    <h2 id="media-asset-usages-heading" class="text-sm font-semibold">
      {{ m.media_usages_title() }}
    </h2>
    <ul class="mt-3 divide-y divide-dashed divide-border" role="list">
      <li
        v-for="group in groups"
        :key="group.file"
        class="flex min-w-0 items-center gap-3 py-3 first:pt-0"
        :title="mediaUsageRowTitle(group)"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ group.name }}</p>
          <p
            v-if="group.directory"
            class="mt-1 truncate font-mono text-[10px] text-muted-foreground"
          >
            {{ group.directory }}
          </p>
        </div>
        <span
          class="shrink-0 text-2xs tabular-nums text-muted-foreground"
          :aria-label="lineAriaLabel(group)"
        >
          {{ formatUsageLineLabel(group.lines) }}
        </span>
      </li>
    </ul>
  </section>
</template>
