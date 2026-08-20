<script setup lang="ts">
import type { ContrastEvaluation } from "@/workspace/design/lib/colorContrast"
import { formatContrastRatio } from "@/workspace/design/lib/colorContrast"

defineProps<{
  evaluation: ContrastEvaluation | null
}>()

function levelLabel(passes: boolean): string {
  return passes ? "✓" : "✗"
}
</script>

<template>
  <div
    v-if="evaluation"
    class="flex min-w-0 w-full items-center justify-center gap-x-1.5 overflow-hidden px-2 py-0 text-muted-foreground/70"
    role="status"
    aria-live="polite"
    :aria-label="`Contrast ratio ${formatContrastRatio(evaluation.ratio)}`"
  >
    <span class="whitespace-nowrap font-mono text-3xs">
      {{ formatContrastRatio(evaluation.ratio) }}
    </span>
    <span class="text-muted-foreground/40">·</span>
    <span class="whitespace-nowrap font-mono text-3xs">
      AA
      <span
        :class="
          evaluation.aaNormal
            ? 'text-emerald-600/70 dark:text-emerald-400/70'
            : 'text-amber-600/70 dark:text-amber-400/70'
        "
        >{{ levelLabel(evaluation.aaNormal) }}</span
      >
    </span>
    <span class="whitespace-nowrap font-mono text-3xs">
      AAA
      <span
        :class="
          evaluation.aaaNormal
            ? 'text-emerald-600/70 dark:text-emerald-400/70'
            : 'text-amber-600/70 dark:text-amber-400/70'
        "
        >{{ levelLabel(evaluation.aaaNormal) }}</span
      >
    </span>
  </div>
</template>
