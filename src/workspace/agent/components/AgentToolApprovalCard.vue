<script setup lang="ts">
import { computed } from "vue"
import type { AgentToolStep } from "../../../../shared/agent"

const props = defineProps<{ step: AgentToolStep }>()
const emit = defineEmits<{
  approve: []
  deny: []
}>()

const categoryLabel = computed(() => {
  switch (props.step.error?.confirmationCategory) {
    case "delete_content":
      return "Delete content"
    case "publish_lifecycle":
      return "Change publication state"
    case "replace_content":
      return "Replace content"
    case "bulk_operation":
      return "Apply bulk change"
    default:
      return "Apply change"
  }
})

const consequenceLabel = computed(() => {
  switch (props.step.error?.confirmationCategory) {
    case "delete_content":
      return "Delete"
    case "publish_lifecycle":
      return "Confirm status change"
    case "replace_content":
      return "Replace content"
    case "bulk_operation":
      return "Apply to all"
    default:
      return "Confirm change"
  }
})
</script>

<template>
  <section
    class="rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
    :aria-labelledby="`agent-confirmation-${step.id}`"
  >
    <h3
      :id="`agent-confirmation-${step.id}`"
      class="m-0 text-xs font-semibold text-foreground"
    >
      {{ categoryLabel }}?
    </h3>
    <p class="mt-1 mb-0 text-xs leading-relaxed text-muted-foreground">
      {{ step.error?.message }}
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        class="min-h-9 rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        @click="emit('approve')"
      >
        {{ consequenceLabel }}
      </button>
      <button
        type="button"
        class="min-h-9 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        @click="emit('deny')"
      >
        Cancel
      </button>
    </div>
  </section>
</template>
