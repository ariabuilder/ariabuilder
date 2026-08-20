<script setup lang="ts">
defineProps<{
  staged: number
  unstaged: number
  untracked: number
  stagedLabel: string
  unstagedLabel: string
  untrackedLabel: string
}>()
</script>

<template>
  <div class="grid grid-cols-3 gap-2">
    <div
      class="border border-dashed px-2.5 py-2 rounded-sm"
      style="border-color: var(--cr-frame, var(--border))"
    >
      <p class="text-lg font-medium tabular-nums tracking-tight">{{ staged }}</p>
      <p class="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {{ stagedLabel }}
      </p>
    </div>
    <div
      class="border border-dashed px-2.5 py-2 rounded-sm"
      style="border-color: var(--cr-frame, var(--border))"
    >
      <p class="text-lg font-medium tabular-nums tracking-tight">{{ unstaged }}</p>
      <p class="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {{ unstagedLabel }}
      </p>
    </div>
    <div
      class="border border-dashed px-2.5 py-2 rounded-sm"
      style="border-color: var(--cr-frame, var(--border))"
    >
      <p class="text-lg font-medium tabular-nums tracking-tight">{{ untracked }}</p>
      <p class="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {{ untrackedLabel }}
      </p>
    </div>
  </div>
</template>
