<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import type { AgentChatMessage } from "../../../../shared/agent"
import AgentMessageMarkdown from "./AgentMessageMarkdown.vue"
import AgentActivityIndicator from "./AgentActivityIndicator.vue"
import AgentToolStepGroup from "./AgentToolStepGroup.vue"

const props = defineProps<{
  messages: AgentChatMessage[]
  isStreaming?: boolean
  activity?: string | null
}>()

const emit = defineEmits<{
  resolveConfirmation: [messageId: string, stepId: string, approved: boolean]
}>()

function handleResolveConfirmation(
  messageId: string,
  stepId: string,
  approved: boolean,
) {
  emit("resolveConfirmation", messageId, stepId, approved)
}

const scrollerRef = ref<HTMLElement | null>(null)
const displayMessages = computed(() =>
  props.messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  ),
)

watch(
  () =>
    [
      props.messages.map((message) => message.content).join("\0"),
      props.messages
        .map((message) => JSON.stringify(message.toolSteps))
        .join("\0"),
      props.isStreaming,
      props.activity ?? "",
    ].join("\0"),
  async () => {
    await nextTick()
    const scroller = scrollerRef.value
    if (!scroller) return
    scroller.scrollTop = scroller.scrollHeight
  },
  { flush: "post" },
)

function isThinkingMessage(message: AgentChatMessage, index: number): boolean {
  return (
    props.isStreaming === true &&
    message.role === "assistant" &&
    index === displayMessages.value.length - 1
  )
}
</script>

<template>
  <div
    ref="scrollerRef"
    class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-y-contain px-4 py-4"
    @wheel.stop
  >
    <div
      v-for="(message, index) in displayMessages"
      :key="message.id"
      class="rounded-sm px-3 py-2 text-xs"
      :class="[
        message.role === 'user'
          ? 'ml-8 border-0.5 border-border/50 bg-card/30 text-foreground'
          : 'mr-8 border-0.5 border-primary/20 bg-card/30 text-foreground',
        message.role === 'assistant' &&
        isStreaming &&
        index === displayMessages.length - 1
          ? 'ring-1 ring-primary/20'
          : '',
      ]"
    >
      <AgentActivityIndicator
        v-if="activity && isThinkingMessage(message, index)"
        :activity="activity"
        :class="
          message.content.trim() || message.toolSteps?.length ? 'mb-2' : ''
        "
      />
      <template v-if="message.role === 'assistant'">
        <div
          v-if="message.reasoning"
          class="mb-2 text-xs text-muted-foreground italic whitespace-pre-wrap"
        >
          {{ message.reasoning }}
        </div>
        <AgentToolStepGroup
          v-if="message.toolSteps?.length"
          :steps="message.toolSteps"
          :message-id="message.id"
          :default-collapsed="true"
          class="mb-2"
          @resolve-confirmation="handleResolveConfirmation"
        />
        <AgentMessageMarkdown :content="message.content" />
        <p
          v-if="message.stopped"
          class="mt-1 text-[10px] text-muted-foreground"
        >
          Stopped
        </p>
      </template>
      <p v-else class="text-balance whitespace-pre-wrap">
        {{ message.content }}
      </p>
    </div>
  </div>
</template>
