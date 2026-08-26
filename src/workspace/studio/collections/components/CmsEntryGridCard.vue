<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Card, CardFooter, CardTitle } from "@/components/ui/card"
import { m } from "@/paraglide/messages.js"
import { formatCmsRelativeTime } from "../lib/formatCmsTime"
import type { CmsEntryRow } from "../lib/entryRow"
import CmsEntryCoverThumb from "./CmsEntryCoverThumb.vue"

const props = withDefaults(
  defineProps<{
    entry: CmsEntryRow
    projectRoot?: string
    coverSupported?: boolean
  }>(),
  {
    projectRoot: "",
    coverSupported: true,
  },
)

const emit = defineEmits<{
  open: [id: string]
  duplicate: [id: string]
  publish: [id: string]
  unpublish: [id: string]
  archive: [id: string]
  delete: [id: string]
}>()

const updatedLabel = computed(() => formatCmsRelativeTime(props.entry.updatedAt))

const statusDotColor = computed((): string => {
  switch (props.entry.status) {
    case "published":
      return "var(--published)"
    case "draft":
      return "var(--draft)"
    case "archived":
      return "var(--archived)"
    default:
      return "var(--muted-foreground)"
  }
})

const statusLabel = computed(() => {
  switch (props.entry.status) {
    case "draft":
      return m.cms_status_draft()
    case "published":
      return m.cms_status_published()
    default:
      return m.cms_status_archived()
  }
})
</script>

<template>
  <Card
    class="group cursor-pointer overflow-hidden"
    tabindex="0"
    @click="emit('open', entry.id)"
    @keydown.enter.prevent="emit('open', entry.id)"
    @keydown.space.prevent="emit('open', entry.id)"
  >
    <div class="relative aspect-video overflow-hidden">
      <CmsEntryCoverThumb
        :frontmatter="entry.frontmatter"
        :title="entry.title"
        :project-root="projectRoot"
        variant="card"
        :cover-supported="coverSupported"
      />

      <div
        class="absolute left-3 top-3 z-30 flex items-center gap-1.5 rounded-md border border-border/50 bg-background/90 px-2 py-0.5 backdrop-blur-sm"
      >
        <span
          class="size-1.5 shrink-0 rounded-full"
          :style="{ backgroundColor: statusDotColor }"
          aria-hidden="true"
        />
        <span class="text-2xs capitalize text-muted-foreground">
          {{ statusLabel }}
        </span>
      </div>

      <div
        class="absolute right-3 top-3 z-30 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        @click.stop
      >
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" class="h-8! w-8!">
              <AppIcon name="moreHorizontal" :size="16" />
              <span class="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-44" @click.stop>
            <DropdownMenuItem @click="emit('open', entry.id)">
              <AppIcon name="edit" :size="14" class="mr-2" />
              {{ m.cms_entries_open() }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="emit('duplicate', entry.id)">
              <AppIcon name="copy" :size="14" class="mr-2" />
              {{ m.cms_entries_action_duplicate() }}
            </DropdownMenuItem>
            <DropdownMenuItem
              v-if="entry.status !== 'published'"
              @click="emit('publish', entry.id)"
            >
              <AppIcon name="publish" :size="14" class="mr-2" />
              {{ m.cms_entries_action_publish() }}
            </DropdownMenuItem>
            <DropdownMenuItem
              v-if="entry.status === 'published'"
              @click="emit('unpublish', entry.id)"
            >
              <AppIcon name="unpublish" :size="14" class="mr-2" />
              {{ m.cms_entries_action_unpublish() }}
            </DropdownMenuItem>
            <DropdownMenuItem
              v-if="entry.status !== 'archived'"
              @click="emit('archive', entry.id)"
            >
              <AppIcon name="archive" :size="14" class="mr-2" />
              {{ m.cms_entries_action_archive() }}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              @click="emit('delete', entry.id)"
            >
              <AppIcon name="trash" :size="14" class="mr-2" />
              {{ m.studio_delete() }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <CardFooter class="flex-col items-stretch gap-2 px-3.5 pb-3.5 pt-3">
      <CardTitle class="truncate text-sm font-medium leading-snug">
        {{ entry.title || m.cms_entries_untitled() }}
      </CardTitle>
      <div
        class="flex min-w-0 items-center justify-between gap-3 text-2xs text-muted-foreground"
      >
        <span class="truncate">{{ entry.locale }}</span>
        <span class="shrink-0 tabular-nums">{{ updatedLabel }}</span>
      </div>
    </CardFooter>
  </Card>
</template>
