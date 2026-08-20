<script setup lang="ts">
import HeaderActionTooltip from "./HeaderActionTooltip.vue"

withDefaults(
  defineProps<{
    label: string
    side?: "top" | "bottom" | "left" | "right"
  }>(),
  {
    side: "bottom",
  },
)
</script>

<template>
  <HeaderActionTooltip :label="label" :side="side">
    <slot />
  </HeaderActionTooltip>
</template>
