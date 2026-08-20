<script setup lang="ts">
import badgeDark from "@/assets/aria-badge-primary-dark.svg"
import badgeLight from "@/assets/aria-badge-primary-light.svg"

const props = withDefaults(
  defineProps<{
    /** Force one mark (e.g. welcome is always dark chrome). */
    mode?: "auto" | "light" | "dark"
    class?: string
  }>(),
  {
    mode: "auto",
  },
)
</script>

<template>
  <!--
    dark.svg = dark glyph for light backgrounds
    light.svg = white glyph for dark backgrounds
  -->
  <template v-if="mode === 'light'">
    <img
      :src="badgeDark"
      alt=""
      draggable="false"
      :class="props.class"
    >
  </template>
  <template v-else-if="mode === 'dark'">
    <img
      :src="badgeLight"
      alt=""
      draggable="false"
      :class="props.class"
    >
  </template>
  <template v-else>
    <img
      :src="badgeDark"
      alt=""
      draggable="false"
      :class="['dark:hidden', props.class]"
    >
    <img
      :src="badgeLight"
      alt=""
      draggable="false"
      :class="['hidden dark:block', props.class]"
    >
  </template>
</template>
