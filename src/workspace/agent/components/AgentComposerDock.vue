<script setup lang="ts">
import { computed, ref } from "vue"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/ui/app-icon"
import { HeaderActionTooltip } from "@/workspace/studio/core"
import { m } from "@/paraglide/messages.js"
import { useAriaAgent } from "../composables/useAriaAgent"
import AgentChatView from "./AgentChatView.vue"
import type { AgentShellContext } from "../../../../shared/agent"

const props = defineProps<{
  projectPath: string
  shellContext?: AgentShellContext
}>()

const agent = useAriaAgent(() => props.projectPath)
const chatViewRef = ref<InstanceType<typeof AgentChatView> | null>(null)
const isWorking = computed(() => agent.isStreaming.value)
</script>

<template>
  <section
    data-aria-composer-agent-dock
    data-state="open"
    class="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    aria-label="Aria Engineer"
  >
    <div
      class="flex h-12 shrink-0 items-center justify-between border-b border-dashed border-border bg-background/50 px-2 py-2 text-xs font-medium text-foreground dark:bg-sidebar/50"
    >
      <div class="flex min-w-0 items-center gap-2">
        <span class="truncate">{{ m.composer_left_agent() }}</span>
        <span
          v-if="isWorking"
          class="agent-streaming-pulse"
          aria-hidden="true"
        />
      </div>
      <div class="flex items-center gap-0.5">
        <HeaderActionTooltip label="History" side="top">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="History"
            data-aria-agent-history-toggle
            :disabled="isWorking"
            @click="chatViewRef?.toggleHistory()"
          >
            <AppIcon name="history" class="size-3.5 shrink-0" />
          </Button>
        </HeaderActionTooltip>
        <HeaderActionTooltip label="New conversation" side="top">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="New conversation"
            :disabled="isWorking"
            @click="chatViewRef?.clearChat()"
          >
            <AppIcon name="add" class="size-3.5 shrink-0" />
          </Button>
        </HeaderActionTooltip>
      </div>
    </div>

    <div
      id="composer-agent-dock-panel"
      class="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <AgentChatView
        ref="chatViewRef"
        compact
        :project-path="projectPath"
        :shell-context="shellContext"
      />
    </div>
  </section>
</template>

<style scoped>
.agent-streaming-pulse {
  width: 0.45rem;
  height: 0.45rem;
  flex-shrink: 0;
  border-radius: 9999px;
  background: color-mix(in oklch, var(--primary) 75%, white);
  box-shadow: 0 0 0 0 color-mix(in oklch, var(--primary) 45%, transparent);
  animation: agent-streaming-pulse 1.4s ease-out infinite;
}

@keyframes agent-streaming-pulse {
  0% {
    opacity: 0.85;
    box-shadow: 0 0 0 0 color-mix(in oklch, var(--primary) 40%, transparent);
  }
  70% {
    opacity: 1;
    box-shadow: 0 0 0 0.35rem
      color-mix(in oklch, var(--primary) 0%, transparent);
  }
  100% {
    opacity: 0.85;
    box-shadow: 0 0 0 0 color-mix(in oklch, var(--primary) 0%, transparent);
  }
}
</style>
