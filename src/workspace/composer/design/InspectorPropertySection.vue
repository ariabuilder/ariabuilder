<script setup lang="ts">
import { computed, ref, useSlots } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

const props = withDefaults(defineProps<{
  title: string
  open?: boolean
  defaultOpen?: boolean
  hasChanges?: boolean
  showReset?: boolean
  resetDisabled?: boolean
  resetLabel?: string
  headerTinted?: boolean
  contentFlush?: boolean
  contentOnly?: boolean
  class?: string
}>(), {
  open: undefined,
  defaultOpen: false,
  hasChanges: false,
  showReset: false,
  resetDisabled: false,
  resetLabel: "Reset property",
  headerTinted: false,
  contentFlush: false,
  contentOnly: false,
})

const emit = defineEmits<{
  "update:open": [value: boolean]
  reset: []
}>()

const slots = useSlots()
const internalOpen = ref(props.defaultOpen)
const isOpen = computed({
  get: () => props.open ?? internalOpen.value,
  set: (value) => {
    internalOpen.value = value
    emit("update:open", value)
  },
})
</script>

<template>
  <slot v-if="contentOnly && slots.default" />

  <Collapsible v-else v-model:open="isOpen" :class="props.class">
    <div
      :data-inspector-section="title"
      :class="cn(
        'group -m-px flex h-10 w-[calc(100%+2px)] cursor-pointer items-center justify-between border-y border-dashed border-border px-2 text-xs font-medium transition-colors duration-150',
        isOpen
          ? 'bg-card/50 text-foreground'
          : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
        headerTinted && 'border-primary/20 bg-primary/5 text-foreground',
      )"
      @click="isOpen = !isOpen"
    >
      <CollapsibleTrigger class="flex h-full min-w-0 flex-1 items-center gap-2 rounded-none text-left font-sans focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary" @click.stop>
        <slot name="title"><span class="truncate">{{ title }}</span></slot>
        <slot name="header-content" />
      </CollapsibleTrigger>
      <div class="flex shrink-0 items-center gap-1">
        <slot name="actions" />
        <span
          v-if="hasChanges"
          data-testid="property-change-indicator"
          class="relative flex size-2 items-center justify-center"
          role="img"
          aria-label="Has authored values"
        >
          <span class="absolute inset-0 rounded-full bg-primary/35" />
          <span class="relative size-1.5 rounded-full bg-primary" />
        </span>
        <button
          v-if="showReset"
          data-testid="property-reset-button"
          type="button"
          class="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40"
          :aria-label="resetLabel"
          :title="resetLabel"
          :disabled="resetDisabled"
          @click.stop.prevent="emit('reset')"
        >
          <AppIcon name="close" :size="13" aria-hidden="true" />
        </button>
      </div>
    </div>
    <CollapsibleContent class="property-content overflow-hidden bg-muted/50">
      <div :class="cn('property-content-inner', contentFlush ? 'p-0' : 'px-3 py-4')">
        <slot v-if="slots.default" />
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<style scoped>
.property-content[data-state="open"] {
  animation: property-expand 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.property-content[data-state="closed"] {
  animation: property-collapse 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes property-expand {
  from { height: 0; }
  to { height: var(--reka-collapsible-content-height); }
}
@keyframes property-collapse {
  from { height: var(--reka-collapsible-content-height); }
  to { height: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .property-content[data-state="open"],
  .property-content[data-state="closed"] { animation-duration: 1ms; }
}
</style>
