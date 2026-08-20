<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { m } from "@/paraglide/messages.js"
import type { WordpressImportBatch, WordpressImportEvent } from "@/lib/cms"
import ShimmerText from "./ShimmerText.vue"
import WordPressImportWizard from "./WordPressImportWizard.vue"

const props = defineProps<{
  batch: WordpressImportBatch | null
  events: WordpressImportEvent[]
  isActive: boolean
  activeStepIndex: number
}>()

const visibleMessage = computed(
  () => props.batch?.currentMessage || m.import_wordpress_importing(),
)

const progress = computed(() =>
  Math.max(0, Math.min(Math.round(props.batch?.progressPercent ?? 0), 100)),
)

const recentEvents = computed(() => props.events.slice(-6).reverse())
</script>

<template>
  <section
    class="absolute right-7 top-5 z-30 w-[min(24rem,calc(100%-3.5rem))] rounded-md border border-border/80 bg-background/95 p-4 shadow-xl backdrop-blur supports-backdrop-filter:bg-background/85"
    aria-live="polite"
  >
    <div class="flex min-w-0 items-start justify-between gap-4">
      <div class="min-w-0">
        <p
          class="text-2xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
        >
          {{ m.import_wordpress_journey_title() }}
        </p>
        <p class="mt-2 font-sans text-base text-foreground">
          <ShimmerText v-if="isActive" :text="visibleMessage" />
          <span v-else>{{ visibleMessage }}</span>
        </p>
      </div>
      <AppIcon
        :name="isActive ? 'loading' : 'check'"
        :size="20"
        class="mt-1 shrink-0 text-muted-foreground"
        :class="isActive ? 'animate-spin' : ''"
      />
    </div>

    <div class="mt-4 rounded-md border border-dashed border-border/70 bg-muted/25 p-3">
      <WordPressImportWizard
        :active-index="activeStepIndex"
        :is-active="isActive"
      />
    </div>

    <div class="mt-5 h-1.5 overflow-hidden rounded-full bg-background">
      <div
        class="h-full rounded-full bg-primary transition-all duration-300"
        :style="{ width: `${progress}%` }"
      />
    </div>

    <div class="mt-4 space-y-2">
      <div
        v-for="event in recentEvents"
        :key="event.id"
        class="flex min-w-0 items-center gap-2 text-xs"
      >
        <span
          :class="[
            event.level === 'error'
              ? 'bg-destructive'
              : event.level === 'warn'
                ? 'bg-amber-500'
                : 'bg-primary',
            'size-1.5 shrink-0 rounded-full',
          ]"
        />
        <span class="truncate text-muted-foreground">{{ event.message }}</span>
        <span
          v-if="event.totalCount"
          class="ml-auto shrink-0 tabular-nums text-muted-foreground/70"
        >
          {{ event.completedCount ?? 0 }}/{{ event.totalCount }}
        </span>
      </div>
    </div>
  </section>
</template>
