<script setup lang="ts">
import { ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"

const props = withDefaults(defineProps<{
  url?: string | null
  title?: string
  variant?: "table" | "card"
}>(), {
  url: null,
  title: "",
  variant: "table",
})

const failed = ref(false)
watch(() => props.url, () => { failed.value = false })
</script>

<template>
  <div
    :class="variant === 'card'
      ? 'absolute inset-0 grid place-items-center overflow-hidden bg-muted/25'
      : 'grid h-6 w-9 place-items-center overflow-hidden rounded-sm bg-card/30'"
  >
    <img
      v-if="url && !failed"
      :src="url"
      :alt="title ? `${title} preview` : 'Entry preview'"
      class="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
      loading="lazy"
      decoding="async"
      draggable="false"
      @error="failed = true"
    />
    <AppIcon
      v-else
      name="image"
      :size="variant === 'card' ? 32 : 16"
      class="text-muted-foreground/30"
      aria-hidden="true"
    />
  </div>
</template>
