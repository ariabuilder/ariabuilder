<script setup lang="ts">
import { computed } from "vue"
import { m } from "@/paraglide/messages.js"
import ShimmerText from "./ShimmerText.vue"

const steps = [
  () => m.import_wordpress_wizard_upload(),
  () => m.import_wordpress_wizard_analyze(),
  () => m.import_wordpress_wizard_review_mapping(),
  () => m.import_wordpress_wizard_check_content(),
  () => m.import_wordpress_wizard_apply(),
  () => m.import_wordpress_wizard_review_report(),
] as const

const props = defineProps<{
  activeIndex: number
  isActive?: boolean
}>()

const currentIndex = computed(() =>
  Math.max(0, Math.min(props.activeIndex, steps.length - 1)),
)

const currentStep = computed(() => steps[currentIndex.value]())
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-4">
      <span
        class="text-2xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
      >
        Step {{ currentIndex + 1 }} of {{ steps.length }}
      </span>
      <div class="flex items-center gap-1" aria-hidden="true">
        <span
          v-for="(_, index) in steps"
          :key="index"
          class="h-1.5 w-1.5 rounded-full transition-colors"
          :class="index <= currentIndex ? 'bg-primary' : 'bg-border'"
        />
      </div>
    </div>
    <p class="text-sm font-medium text-foreground">
      <ShimmerText v-if="isActive" :text="currentStep" />
      <span v-else>{{ currentStep }}</span>
    </p>
  </div>
</template>
