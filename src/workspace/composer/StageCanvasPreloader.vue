<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue"
import PreloaderAriaLogo from "@/components/preloader/PreloaderAriaLogo.vue"

const props = withDefaults(
  defineProps<{
    compact?: boolean
    active?: boolean
  }>(),
  { compact: false, active: true },
)

const progress = ref(0)
let progressInterval: ReturnType<typeof setInterval> | null = null

function stopProgress(): void {
  if (progressInterval) {
    clearInterval(progressInterval)
    progressInterval = null
  }
}

function startProgress(): void {
  stopProgress()
  progress.value = 0
  progressInterval = setInterval(() => {
    progress.value = Math.min(progress.value + Math.random() * 8 + 3, 92)
  }, 90)
}

watch(
  () => props.active,
  (active) => {
    if (active) startProgress()
    else {
      stopProgress()
      progress.value = 100
    }
  },
  { immediate: true },
)

onMounted(() => {
  if (props.active) startProgress()
})

onUnmounted(() => {
  stopProgress()
  progress.value = 100
})
</script>

<template>
  <div
    class="relative flex items-center justify-center"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <PreloaderAriaLogo :compact="compact" :progress="progress" />
    <span class="sr-only">Loading canvas</span>
  </div>
</template>
