<script setup lang="ts">
import { computed, ref } from "vue"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/ui/app-icon"
import { HeaderActionTooltip } from "@/workspace/studio/core"
import { useAgentPanel } from "../composables/useAgentPanel"
import { useAriaAgent } from "../composables/useAriaAgent"
import AgentChatView from "./AgentChatView.vue"
import type { AgentShellContext } from "../../../../shared/agent"

const AGENT_PANEL_WIDTH = "min(520px, calc(100vw - 2rem))"

const props = defineProps<{
  projectPath: string
  shellContext?: AgentShellContext
}>()

const panel = useAgentPanel()
const agent = useAriaAgent(() => props.projectPath)
const chatViewRef = ref<InstanceType<typeof AgentChatView> | null>(null)

const isOpen = computed(() => panel.open.value)
const isWorking = computed(() => agent.isStreaming.value)
</script>

<template>
  <div
    :class="[
      'agent-composer-panel-anchor fixed right-5 bottom-5 z-40',
      isOpen ? 'pointer-events-auto' : 'pointer-events-none',
    ]"
  >
    <aside
      :class="[
        'agent-composer-panel flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background/98 text-muted-foreground shadow-lg backdrop-blur-md',
        isOpen ? 'agent-composer-panel--open' : 'agent-composer-panel--closed',
      ]"
      :style="{ width: AGENT_PANEL_WIDTH, height: '70vh' }"
      :inert="!isOpen"
      role="complementary"
      aria-label="Aria Engineer"
    >
      <div
        class="flex shrink-0 items-center justify-between border-b border-dashed border-border/50 bg-background px-4 py-1"
      >
        <div class="flex min-w-0 items-center gap-2">
        <h2 class="font-sans text-sm font-semibold text-foreground">
          Aria Engineer
        </h2>
          <span
            v-if="isWorking"
            class="agent-streaming-pulse"
            aria-hidden="true"
          />
        </div>
        <div class="flex items-center gap-1">
          <HeaderActionTooltip label="Dock" side="bottom">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dock"
              @click="panel.dock()"
            >
              <AppIcon name="minimize" class="size-3.5 shrink-0" />
            </Button>
          </HeaderActionTooltip>
          <HeaderActionTooltip label="Copy" side="bottom">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Copy conversation"
              :disabled="agent.messages.value.length === 0"
              @click="chatViewRef?.copyConversation()"
            >
              <AppIcon name="copy" class="size-3.5 shrink-0" />
            </Button>
          </HeaderActionTooltip>
          <HeaderActionTooltip label="History" side="bottom">
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
          <HeaderActionTooltip label="New conversation" side="bottom">
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
          <HeaderActionTooltip label="Close" side="bottom">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Close"
              @click="chatViewRef?.close()"
            >
              <AppIcon name="close" class="size-3.5 shrink-0" />
            </Button>
          </HeaderActionTooltip>
        </div>
      </div>

      <AgentChatView
        ref="chatViewRef"
        :project-path="projectPath"
        :shell-context="shellContext"
      />
    </aside>
  </div>
</template>

<style scoped>
.agent-composer-panel {
  transform-origin: right center;
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.agent-composer-panel--open {
  transform: translateX(0);
}

.agent-composer-panel--closed {
  transform: translateX(calc(100% + 1.5rem));
}

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
