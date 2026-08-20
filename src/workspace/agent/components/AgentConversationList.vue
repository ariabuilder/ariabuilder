<script setup lang="ts">
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/ui/app-icon"
import { cn } from "@/lib/utils"
import { formatRelativeTime } from "@/lib/relativeTime"
import type { AgentConversationSummary } from "../../../../shared/agent"

const props = defineProps<{
  conversations: AgentConversationSummary[]
  activeId: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  delete: [id: string]
}>()

function relativeTime(value: string): string {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? formatRelativeTime(ms) : ""
}
</script>

<template>
  <div
    data-aria-agent-history
    class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background"
  >
    <div
      v-if="conversations.length === 0"
      class="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground"
    >
      No previous conversations
    </div>
    <ul
      v-else
      class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-1.5"
    >
      <li v-for="conversation in conversations" :key="conversation.id">
        <div
          :class="
            cn(
              'group flex items-start gap-1 rounded-md px-1.5 py-1.5',
              conversation.id === activeId
                ? 'bg-muted/70'
                : 'hover:bg-muted/50',
            )
          "
        >
          <button
            type="button"
            class="min-w-0 flex-1 rounded-sm px-1 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
            :disabled="disabled"
            :aria-current="conversation.id === activeId ? 'true' : undefined"
            @click="emit('select', conversation.id)"
          >
            <div class="truncate text-xs font-medium text-foreground">
              {{ conversation.title }}
            </div>
            <div class="truncate text-[10px] leading-4 text-muted-foreground">
              {{ relativeTime(conversation.updatedAt) }}
            </div>
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            class="shrink-0 opacity-70 group-hover:opacity-100"
            :disabled="disabled"
            aria-label="Delete conversation"
            @click.stop="emit('delete', conversation.id)"
          >
            <AppIcon name="trash" class="size-3.5 shrink-0" />
          </Button>
        </div>
      </li>
    </ul>
  </div>
</template>
