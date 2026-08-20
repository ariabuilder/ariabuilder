<script setup lang="ts">
import { computed, useSlots } from "vue"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import ExpandableSearchInput from "./ExpandableSearchInput.vue"

interface Props {
  title: string
  description?: string
  searchQuery?: string
  entityLabelSingular?: string
  createLabel?: string
  hideCreate?: boolean
  reserveCloseSpace?: boolean
  controlsAlign?: "center" | "start"
  searchTooltipSide?: "top" | "bottom" | "left" | "right"
  hideSearch?: boolean
  mergeActions?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  hideCreate: false,
  reserveCloseSpace: false,
  controlsAlign: "center",
  searchTooltipSide: "bottom",
  hideSearch: false,
  mergeActions: false,
})

const emit = defineEmits<{
  "update:searchQuery": [value: string]
  create: []
}>()

const slots = useSlots()

const hasActions = computed(
  () => Boolean(slots.actions) || !props.hideCreate,
)
const defaultCreateLabel = computed(
  () =>
    props.createLabel ??
    (props.entityLabelSingular ? `New ${props.entityLabelSingular}` : "New"),
)
</script>

<template>
  <div
    :class="
      cn(
        'flex shrink-0 justify-between gap-0 overflow-visible bg-background px-7 py-7 max-[40rem]:flex-col max-[40rem]:items-stretch max-[40rem]:gap-4 max-[40rem]:px-4 max-[40rem]:py-5',
        props.controlsAlign === 'start' ? 'items-start' : 'items-center',
        props.reserveCloseSpace && 'pr-14',
        props.class,
      )
    "
  >
    <div class="flex min-w-0 flex-1 select-none items-center gap-3">
      <div class="min-w-0 space-y-0.5">
        <slot name="title">
          <h1
            class="truncate text-2xl font-medium tracking-tight"
          >
            {{ props.title }}
          </h1>
        </slot>
        <p
          v-if="props.description"
          class="text-sm text-muted-foreground/60"
        >
          {{ props.description }}
        </p>
      </div>
    </div>

    <TooltipProvider
      :delay-duration="0"
      :skip-delay-duration="0"
      :disable-hoverable-content="true"
      ignore-non-keyboard-focus
    >
      <div
        class="flex shrink-0 items-center justify-end overflow-x-auto scrollbar-none max-[40rem]:w-full max-[40rem]:justify-start [&::-webkit-scrollbar]:hidden"
      >
        <div
          class="flex shrink-0 items-center gap-0 [&_[data-slot=button]:hover]:z-10 [&_[data-slot=button]:focus-visible]:z-10 [&_[data-slot=button][data-state=open]]:z-10"
        >
          <slot v-if="!props.hideSearch" name="search">
            <ExpandableSearchInput
              :model-value="props.searchQuery ?? ''"
              :tooltip-side="props.searchTooltipSide"
              @update:model-value="emit('update:searchQuery', $event)"
            />
          </slot>
          <slot v-else name="search" />
          <slot name="toolbar" />
          <template v-if="props.mergeActions">
            <slot name="actions" />
            <Button
              v-if="!props.hideCreate"
              variant="default"
              size="md"
              @click="emit('create')"
            >
              {{ defaultCreateLabel }}
            </Button>
          </template>
        </div>

        <div
          v-if="hasActions && !props.mergeActions"
          class="ml-2 flex shrink-0 items-center gap-1.5 pl-2"
        >
          <slot name="actions" />
          <Button
            v-if="!props.hideCreate"
            variant="default"
            size="md"
            @click="emit('create')"
          >
            {{ defaultCreateLabel }}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  </div>
</template>
