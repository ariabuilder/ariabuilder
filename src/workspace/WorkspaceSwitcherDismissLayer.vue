<script setup lang="ts">
defineEmits<{
  dismiss: []
}>()
</script>

<template>
  <div
    aria-hidden="true"
    data-workspace-switcher-dismiss-layer
    class="app-region-no-drag fixed inset-0 z-40 cursor-default"
    @pointerdown.prevent.stop="$emit('dismiss')"
  />
</template>
