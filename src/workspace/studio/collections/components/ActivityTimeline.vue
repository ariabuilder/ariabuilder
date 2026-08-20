<script setup lang="ts">
import { computed } from "vue"
import { m } from "@/paraglide/messages.js"
import type { CmsEntryActivityItem } from "../lib/entryActivity"

const props = withDefaults(
  defineProps<{
    items: readonly CmsEntryActivityItem[]
    isLoading?: boolean
    error?: string | null
    maxItems?: number
    title?: string
  }>(),
  {
    isLoading: false,
    error: null,
    maxItems: 5,
    title: "",
  },
)

defineOptions({ name: "CmsEntryActivityTimeline" })

const displayTitle = computed(
  () => props.title || m.cms_entry_activity(),
)

const visibleItems = computed(() => props.items.slice(0, props.maxItems))

function userInitial(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?"
}

function displayActivityAction(action: string): string {
  switch (action.trim().toLowerCase()) {
    case "created":
      return m.cms_entry_activity_action_created()
    case "published":
      return m.cms_entry_activity_action_published()
    case "archived":
      return m.cms_entry_activity_action_archived()
    case "unpublished":
      return m.cms_entry_activity_action_unpublished()
    case "restored":
      return m.cms_entry_activity_action_restored()
    case "duplicated":
      return m.cms_entry_activity_action_duplicated()
    case "updated":
      return m.cms_entry_activity_action_updated()
    case "saved":
      return m.cms_entry_activity_action_saved()
    default:
      return action
  }
}

function displayActivityTarget(target: string): string {
  switch (target.trim().toLowerCase()) {
    case "this entry":
      return m.cms_entry_activity_target_entry()
    case "content":
      return m.cms_entry_activity_target_content()
    case "a revision":
      return m.cms_entry_activity_target_revision()
    default:
      return target
  }
}

function isHighlightedItem(
  item: CmsEntryActivityItem,
  index: number,
): boolean {
  return item.isHighlighted ?? index === 0
}

function dotClass(item: CmsEntryActivityItem, index: number): string {
  if (isHighlightedItem(item, index)) {
    return "size-2.5 bg-primary ring-4 ring-primary/15"
  }
  return "size-2 bg-muted-foreground/25"
}

function railSegmentClass(
  item: CmsEntryActivityItem,
  index: number,
): string {
  if (isHighlightedItem(item, index)) {
    return "bg-[color-mix(in_srgb,var(--primary)_40%,transparent)]"
  }
  return "bg-border"
}
</script>

<template>
  <section
    class="overflow-hidden rounded-sm border border-solid border-border/50 bg-card/40"
  >
    <header class="flex items-baseline justify-between gap-3 px-5 pt-5 pb-1.5">
      <h2 class="m-0 min-w-0 font-sans text-sm font-semibold text-foreground">
        {{ displayTitle }}
      </h2>
    </header>

    <p v-if="error" class="m-0 px-5 pb-2 text-xs text-destructive">
      {{ error }}
    </p>

    <div v-if="isLoading" class="relative m-0 p-0">
      <div
        v-for="index in 3"
        :key="index"
        class="relative flex gap-3 py-2 pl-5"
      >
        <div
          v-if="index < 3"
          class="pointer-events-none absolute top-[1.5rem] left-[0.4375rem] h-full w-px -translate-x-1/2 bg-border/80"
          aria-hidden="true"
        />
        <div
          class="absolute top-[1.5rem] left-[0.4375rem] z-10 -translate-x-1/2 -translate-y-1/2 rounded-full animate-pulse"
          :class="
            index === 0
              ? 'size-2.5 bg-secondary/80 ring-4 ring-secondary/20'
              : 'size-2 bg-border/40'
          "
          aria-hidden="true"
        />
        <div
          class="relative z-10 ml-2 size-8 shrink-0 rounded-full bg-card/40 animate-pulse"
        />
        <div class="relative z-10 min-w-0 flex-1 space-y-1.5 pt-0.5">
          <div class="h-3 w-44 max-w-full rounded bg-card/40 animate-pulse" />
          <div class="h-2.5 w-28 rounded bg-card/40 animate-pulse" />
        </div>
      </div>
    </div>

    <p
      v-else-if="visibleItems.length === 0"
      class="m-0 py-8 text-center text-xs text-muted-foreground"
    >
      {{ m.cms_entry_activity_empty() }}
    </p>

    <ol v-else class="relative m-0 list-none pl-7 pr-2 pb-3 pt-1.5">
      <li
        v-for="(item, index) in visibleItems"
        :key="item.id"
        class="group relative flex gap-5 py-2.5 pl-5"
      >
        <div
          v-if="index < visibleItems.length - 1"
          class="pointer-events-none absolute top-[1.5rem] left-[0.4375rem] h-full w-px -translate-x-1/2"
          :class="railSegmentClass(item, index)"
          aria-hidden="true"
        />

        <div
          class="absolute top-[1.5rem] left-[0.4375rem] z-10 -translate-x-1/2 -translate-y-1/2 rounded-full"
          :class="dotClass(item, index)"
          aria-hidden="true"
        />

        <div
          class="relative z-10 ml-2 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-medium text-muted-foreground"
          aria-hidden="true"
        >
          {{ userInitial(item.userName) }}
        </div>

        <div class="relative z-10 min-w-0 flex-1">
          <p class="m-0 font-sans text-sm leading-snug">
            <span class="font-semibold text-foreground">{{ item.userName }}</span>
            <span class="text-muted-foreground">
              {{ " " }}{{ displayActivityAction(item.action) }}
              {{ " " }}{{ displayActivityTarget(item.target) }}
            </span>
          </p>
          <p class="m-0 mt-0.5 text-xs leading-snug text-muted-foreground">
            {{ item.timestamp }}
          </p>
        </div>
      </li>
    </ol>
  </section>
</template>
