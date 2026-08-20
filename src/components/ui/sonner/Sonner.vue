<script lang="ts" setup>
import type { ToasterProps } from "vue-sonner"
import { computed } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { Toaster as Sonner } from "vue-sonner"
import { AppIcon } from "@/components/ui/app-icon"
import { useAppearance } from "@/composables/useAppearance"
import "vue-sonner/style.css"

const props = defineProps<ToasterProps>()
const delegatedProps = reactiveOmit(props, "toastOptions", "position", "theme")

const { isDark } = useAppearance()
const theme = computed(
  () => props.theme ?? (isDark.value ? "dark" : "light"),
)
</script>

<template>
  <Sonner
    class="toaster group pointer-events-auto"
    :theme="theme"
    :position="props.position || 'bottom-right'"
    :toast-options="{
      classes: {
        toast:
          'group toast group-[.toaster]:dark:bg-sidebar! group-[.toaster]:text-muted-foreground! group-[.toaster]:border-border group-[.toaster]:shadow-sm group-[.toaster]:border-dashed! group-[.toaster]:bg-background!',
        description: 'group-[.toast]:text-muted-foreground',
        actionButton:
          'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
        cancelButton:
          'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
      },
    }"
    v-bind="delegatedProps"
  >
    <template #success-icon>
      <AppIcon name="checkCircleLinear" class="size-4 text-emerald-600" />
    </template>
    <template #info-icon>
      <AppIcon name="infoCircle" class="size-4 text-sky-600" />
    </template>
    <template #warning-icon>
      <AppIcon name="warning" class="size-4 text-amber-600" />
    </template>
    <template #error-icon>
      <AppIcon name="closeCircleBold" class="size-4 text-rose-600" />
    </template>
    <template #loading-icon>
      <AppIcon name="refresh" class="size-4 animate-spin text-primary/70" />
    </template>
  </Sonner>
</template>

<style>
/*
  Sonner paints with --normal-* vars (default light = #fff). Its
  [data-sonner-theme] selectors beat Tailwind bg-background, so map
  those vars onto the app design tokens instead.
*/
[data-sonner-toaster].toaster {
  --normal-bg: var(--background);
  --normal-bg-hover: var(--muted);
  --normal-text: var(--foreground);
  --normal-border: var(--border);
  --normal-border-hover: var(--border);
}
</style>
