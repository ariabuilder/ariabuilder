<script setup lang="ts">
import { onErrorCaptured, ref } from "vue"
import { Button } from "@/components/ui/button"

const props = defineProps<{
  onReset?: () => void
}>()

const error = ref<Error | null>(null)
const generation = ref(0)

onErrorCaptured((err) => {
  error.value = err instanceof Error ? err : new Error(String(err))
  console.error("UI crash:", err)
  return false
})

function retry() {
  error.value = null
  generation.value += 1
  props.onReset?.()
}
</script>

<template>
  <div
    v-if="error"
    class="flex min-h-svh flex-col items-center justify-center gap-4 bg-background p-8 text-foreground"
  >
    <div class="max-w-lg space-y-2 text-center">
      <h1 class="text-lg font-semibold">Something went wrong</h1>
      <p
        data-aria-error
        class="font-mono text-xs break-all text-destructive"
      >
        {{ error.message }}
      </p>
    </div>
    <Button type="button" variant="outline" @click="retry">
      Try again
    </Button>
  </div>
  <!-- Remount slot content after retry so a hard-crashed tree can recover. -->
  <div v-else :key="generation" class="contents">
    <slot />
  </div>
</template>
