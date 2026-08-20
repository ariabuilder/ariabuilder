<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { m } from "@/paraglide/messages.js"
import { HeaderActionDropdownTooltip } from "@/workspace/studio/core"
import type { EntryStatus } from "../../../../../shared/cms"

const props = withDefaults(
  defineProps<{
    status: EntryStatus
    isBusy?: boolean
    isDeleting?: boolean
    splitTrigger?: boolean
    emphasize?: boolean
  }>(),
  {
    isBusy: false,
    isDeleting: false,
    splitTrigger: true,
    emphasize: true,
  },
)

const emit = defineEmits<{
  unpublish: []
  archive: []
  delete: []
}>()

const isPublished = computed(() => props.status === "published")
const isArchived = computed(() => props.status === "archived")

const dropdownDisabled = computed(() => props.isBusy || props.isDeleting)
</script>

<template>
  <HeaderActionDropdownTooltip :label="m.cms_entry_more_actions()">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          type="button"
          :variant="
            splitTrigger ? (emphasize ? 'default' : 'secondary') : 'headerAction'
          "
          :size="splitTrigger ? 'default' : 'icon-header'"
          :class="
            splitTrigger
              ? emphasize
                ? 'h-9 rounded-l-none border-l border-primary-foreground/20 px-2'
                : 'h-9 rounded-l-none border-l border-border/60 px-2'
              : undefined
          "
          :disabled="dropdownDisabled"
          :aria-label="m.cms_entry_publish_options()"
        >
          <AppIcon name="chevronDown" :size="14" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-48">
        <DropdownMenuLabel class="text-2xs font-medium text-muted-foreground">
          {{ m.cms_entry_publish_status() }}
        </DropdownMenuLabel>

        <DropdownMenuItem
          v-if="isPublished"
          :disabled="isBusy"
          @click="emit('unpublish')"
        >
          <AppIcon name="unpublish" :size="14" class="mr-2" />
          {{
            isBusy
              ? m.cms_entry_unpublishing()
              : m.cms_entries_action_unpublish()
          }}
        </DropdownMenuItem>

        <DropdownMenuItem
          v-if="!isArchived"
          :disabled="isBusy"
          @click="emit('archive')"
        >
          <AppIcon name="archive" :size="14" class="mr-2" />
          {{ m.cms_entries_action_archive() }}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          :disabled="isBusy || isDeleting"
          @click="emit('delete')"
        >
          <AppIcon name="trash" :size="14" class="mr-2" />
          {{ m.studio_delete() }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </HeaderActionDropdownTooltip>
</template>
