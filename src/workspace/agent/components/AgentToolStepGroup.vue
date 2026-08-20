<script setup lang="ts">
import { computed } from "vue"
import type { AgentToolStep } from "../../../../shared/agent"
import AgentToolStepRow from "./AgentToolStepRow.vue"
import AgentToolApprovalCard from "./AgentToolApprovalCard.vue"

const props = defineProps<{
  steps: AgentToolStep[]
  defaultCollapsed?: boolean
  messageId: string
}>()

const emit = defineEmits<{
  resolveConfirmation: [messageId: string, stepId: string, approved: boolean]
}>()

const readSteps = computed(() => props.steps.filter((step) => step.isReadTool))
const writeSteps = computed(() =>
  props.steps.filter((step) => !step.isReadTool),
)
</script>

<template>
  <div v-if="steps.length" class="space-y-2">
    <details
      v-if="readSteps.length"
      class="rounded-md border border-border/50 bg-muted/30 px-2 py-1"
      :open="!defaultCollapsed"
    >
      <summary class="cursor-pointer text-xs font-medium text-muted-foreground">
        Inspecting site… ({{ readSteps.length }}
        {{ readSteps.length === 1 ? "check" : "checks" }})
      </summary>
      <div class="mt-1 space-y-1">
        <AgentToolStepRow
          v-for="step in readSteps"
          :key="step.id"
          :step="step"
        />
      </div>
    </details>
    <AgentToolStepRow
      v-for="step in writeSteps"
      :key="step.id"
      :step="step"
    />
    <AgentToolApprovalCard
      v-for="step in writeSteps.filter(
        (item) => item.error?.code === 'CONFIRMATION_REQUIRED',
      )"
      :key="`confirmation-${step.id}`"
      :step="step"
      @approve="emit('resolveConfirmation', messageId, step.id, true)"
      @deny="emit('resolveConfirmation', messageId, step.id, false)"
    />
  </div>
</template>
