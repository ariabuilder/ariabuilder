<script setup lang="ts">
/**
 * Appear-only success check for color copy feedback.
 * Parent toggles visibility; cold state is unmounted / not rendered.
 */
defineProps<{
  color?: string
}>()
</script>

<template>
  <span
    class="t-success-check pointer-events-none absolute inset-0 z-10 items-center justify-center"
    data-draw
    data-state="in"
    aria-hidden="true"
    :style="{
      ...(color ? { color } : {}),
      '--check-rotate-from': '80deg',
      '--check-y-amount': '8px',
      '--check-blur-from': '6px',
      '--check-opacity-dur': '500ms',
      '--check-rotate-dur': '500ms',
      '--check-bob-dur': '500ms',
      '--check-blur-dur': '500ms',
      '--check-path-dur': '500ms',
    }"
  >
    <svg viewBox="0 0 24 24" fill="none" class="size-4 drop-shadow-sm">
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </span>
</template>
