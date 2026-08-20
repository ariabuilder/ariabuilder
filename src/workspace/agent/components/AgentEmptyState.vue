<script setup lang="ts">
import { computed } from "vue"
import { Button } from "@/components/ui/button"
import type { AgentComposerMode, AgentShellContext } from "../../../../shared/agent"
import {
  agentEmptyStateGreeting,
  agentSuggestedPrompts,
} from "../lib/suggestedPrompts"

const props = defineProps<{
  composerMode: AgentComposerMode
  shellContext?: AgentShellContext
  compact?: boolean
}>()

const emit = defineEmits<{
  selectPrompt: [value: string]
}>()

const prompts = computed(() =>
  agentSuggestedPrompts(props.shellContext, props.composerMode),
)
const greeting = computed(() =>
  agentEmptyStateGreeting(props.shellContext, props.composerMode),
)
</script>

<template>
  <div
    :class="[
      'flex h-full flex-col',
      compact
        ? 'items-stretch justify-start gap-3 px-3 py-3 text-left'
        : 'items-center justify-center gap-8 px-10 text-center',
    ]"
  >
    <div :class="compact ? 'space-y-1' : 'max-w-md space-y-2'">
      <h3 class="text-sm font-medium text-balance text-foreground">
        {{ greeting.title }}
      </h3>
      <p class="text-xs text-balance text-muted-foreground">
        {{ greeting.subtitle }}
      </p>
    </div>
    <div
      :class="[
        'gap-2',
        compact ? 'flex w-full flex-col' : 'flex flex-wrap justify-center gap-3',
      ]"
    >
      <Button
        v-for="prompt in prompts"
        :key="prompt"
        variant="secondary"
        size="xs"
        :class="[
          'whitespace-normal text-left',
          compact ? 'w-full' : 'max-w-full',
        ]"
        @click="emit('selectPrompt', prompt)"
      >
        {{ prompt }}
      </Button>
    </div>
  </div>
</template>
