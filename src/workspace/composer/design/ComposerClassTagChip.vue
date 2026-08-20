<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"

const props = withDefaults(defineProps<{
  label: string
  variant?: "utility" | "custom" | "rendered" | "bem"
  active?: boolean
  expanded?: boolean
  activatable?: boolean
  removable?: boolean
}>(), {
  variant: "utility",
  active: false,
  expanded: false,
  activatable: false,
  removable: true,
})

const emit = defineEmits<{
  activate: []
  remove: []
  "toggle-expand": []
}>()

const long = computed(() => props.label.length > 40 && props.variant !== "custom")
const chipClass = computed(() => {
  if (props.variant === "custom") {
    return props.active
      ? "border-primary/70 bg-primary/10 text-foreground"
      : "border-white/10 bg-muted text-foreground/90"
  }
  if (props.variant === "bem") {
    return "border-primary/40 bg-primary/10 text-foreground/90"
  }
  if (props.variant === "rendered") return "border-border/50 bg-muted/30 text-muted-foreground"
  return "border-primary/30 bg-primary/25 text-sidebar-foreground"
})
</script>

<template>
  <span
    data-remove-layout="overlay"
    :class="cn(
      'class-tag-chip group/chip inline-flex min-h-6 max-w-full items-center rounded-xs border border-dashed text-xs',
      variant === 'custom' && (active ? 'class-tag-chip--custom-active' : 'class-tag-chip--custom'),
      chipClass,
    )"
  >
    <Tooltip v-if="long && !expanded">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="min-w-0 max-w-48 truncate px-2 py-1 text-left font-mono focus-visible:outline-2 focus-visible:outline-primary"
          :aria-label="variant === 'custom' ? m.composer_inspector_classes_edit_named({ name: label }) : label"
          :disabled="!activatable"
          @click="activatable && emit('activate')"
        >{{ label }}</button>
      </TooltipTrigger>
      <TooltipContent side="bottom" class="max-w-sm break-all font-mono text-xs">{{ label }}</TooltipContent>
    </Tooltip>
    <button
      v-else
      type="button"
      :class="cn('min-w-0 px-2 py-1 text-left focus-visible:outline-2 focus-visible:outline-primary', variant !== 'custom' && 'font-mono', expanded && 'break-all whitespace-normal')"
      :aria-label="variant === 'custom' ? m.composer_inspector_classes_edit_named({ name: label }) : label"
      :disabled="!activatable"
      @click="activatable && emit('activate')"
    >{{ label }}</button>
    <button
      v-if="long"
      type="button"
      class="inline-flex size-6 shrink-0 items-center justify-center opacity-45 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="expanded ? m.composer_inspector_classes_collapse_named({ name: label }) : m.composer_inspector_classes_expand_named({ name: label })"
      @click="emit('toggle-expand')"
    >
      <AppIcon :name="expanded ? 'chevronUp' : 'chevronDown'" :size="11" aria-hidden="true" />
    </button>
    <button
      v-if="removable"
      type="button"
      class="class-tag-remove"
      :aria-label="m.composer_inspector_classes_remove_named({ name: label })"
      @click="emit('remove')"
    >
      <span class="class-tag-remove-btn"><AppIcon name="close" :size="10" aria-hidden="true" /></span>
    </button>
  </span>
</template>

<style scoped>
.class-tag-chip {
  position: relative;
  min-width: 0;
  transition: background-color 150ms ease, color 150ms ease;
}

.class-tag-remove {
  position: absolute;
  top: 50%;
  right: 1px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  padding-left: 0.625rem;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%);
  transition: opacity 100ms ease;
}

.class-tag-chip:hover > .class-tag-remove,
.class-tag-chip:focus-within > .class-tag-remove,
.class-tag-remove:focus-visible {
  opacity: 1;
  pointer-events: auto;
}

.class-tag-remove-btn {
  display: inline-flex;
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px dashed color-mix(in srgb, var(--border) 55%, transparent);
  border-radius: var(--radius-sm);
  background-color: var(--background);
  color: var(--muted-foreground);
  transition: background-color 100ms ease, border-color 100ms ease, color 100ms ease, box-shadow 100ms ease;
}

.class-tag-remove:hover .class-tag-remove-btn,
.class-tag-remove:focus-visible .class-tag-remove-btn {
  border-color: color-mix(in srgb, var(--destructive) 50%, transparent);
  background-color: color-mix(in srgb, var(--destructive) 5%, var(--background));
  color: var(--destructive);
  box-shadow: 0 1px 3px rgb(0 0 0 / 24%);
  outline: 2px solid var(--destructive);
  outline-offset: 1px;
}

.class-tag-remove:active .class-tag-remove-btn {
  border-style: solid;
  border-color: var(--border);
  background-color: var(--sidebar);
  color: var(--foreground);
  box-shadow: none;
}

@media (hover: none) {
  .class-tag-remove {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .class-tag-chip,
  .class-tag-remove,
  .class-tag-remove-btn {
    transition-duration: 0.01ms;
  }
}
</style>
