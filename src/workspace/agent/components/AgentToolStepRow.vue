<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import type { AgentToolStep } from "../../../../shared/agent"
import { toolDisplayName } from "../lib/toolDisplayNames"

const props = defineProps<{
  step: AgentToolStep
}>()

const displayName = computed(() =>
  toolDisplayName(props.step.toolName, props.step.isReadTool),
)
</script>

<template>
  <div
    class="mt-2 rounded-sm border border-border/50 bg-background px-2 py-2 text-xs"
    role="status"
    aria-live="polite"
  >
    <div class="flex items-center gap-2">
      <AppIcon
        v-if="step.status === 'running'"
        name="loading"
        class="size-3.5 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
      <AppIcon
        v-else-if="step.status === 'success'"
        name="checkLinear"
        class="size-3.5 text-emerald-600"
        aria-hidden="true"
      />
      <AppIcon
        v-else
        name="close"
        class="size-3.5 text-destructive"
        aria-hidden="true"
      />
      <span class="font-medium">{{ displayName }}</span>
      <span v-if="step.summary" class="text-muted-foreground">{{
        step.summary
      }}</span>
    </div>
    <div
      v-if="step.error && step.error.code !== 'CONFIRMATION_REQUIRED'"
      class="mt-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive"
      role="alert"
    >
      <p class="font-medium">{{ step.error.message }}</p>
      <p v-if="step.error.suggestedFix" class="mt-1 text-muted-foreground">
        {{ step.error.suggestedFix }}
      </p>
    </div>
  </div>
</template>
