<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import type { AppIconName } from "@/icons/registry"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"

const props = withDefaults(
  defineProps<{
    label: string
    icon: AppIconName
    view: "grid" | "list"
    pinned: boolean
    pinnable?: boolean
    draggable?: boolean
    disabled?: boolean
  }>(),
  { draggable: true, pinnable: true, disabled: false },
)

const emit = defineEmits<{
  activate: []
  "activate-immediate": []
  "toggle-pin": []
  "drag-start": [event: DragEvent]
  "drag-end": []
}>()

const itemClass = computed(() =>
  cn(
    "flex w-full items-center text-left text-xs text-muted-foreground transition-[color,background-color,border-color,opacity] duration-100 hover:text-foreground",
    props.view === "grid"
      ? "min-h-24 flex-col justify-center gap-2 rounded-md border border-dashed border-border bg-card/50 p-3 text-center hover:border-primary/50 hover:bg-primary/5"
      : cn(
          "gap-2 rounded-md border border-border bg-card/30 px-2 py-1.5 hover:bg-card/70",
          props.pinnable && "pr-9",
        ),
    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
    props.disabled && "cursor-not-allowed opacity-45 hover:border-border hover:bg-card/50 hover:text-muted-foreground",
  ),
)

const pinLabel = computed(() =>
  props.pinned
    ? m.composer_palette_unpin({ label: props.label })
    : m.composer_palette_pin({ label: props.label }),
)

function onDragStart(event: DragEvent) {
  if (!props.draggable) {
    event.preventDefault()
    return
  }
  emit("drag-start", event)
}
</script>

<template>
  <div
    class="group/palette-item relative min-w-0"
    :class="draggable && 'cursor-grab active:cursor-grabbing'"
    :draggable="draggable && !disabled"
    @dragstart="onDragStart"
    @dragend="emit('drag-end')"
  >
    <button
      type="button"
      :class="itemClass"
      :disabled="disabled"
      @click="!disabled && emit('activate')"
      @dblclick.prevent="emit('activate-immediate')"
    >
      <AppIcon
        :name="icon"
        :size="view === 'grid' ? 20 : 16"
        class="shrink-0 transition-colors group-hover/palette-item:text-primary"
        aria-hidden="true"
      />
      <span
        :class="
          view === 'grid'
            ? 'line-clamp-2 text-balance'
            : 'min-w-0 truncate'
        "
      >{{ label }}</span>
    </button>

    <Tooltip v-if="pinnable">
      <TooltipTrigger as-child>
        <button
          type="button"
          :aria-label="pinLabel"
          :aria-pressed="pinned"
          :class="
            cn(
              'pointer-events-none absolute right-1.5 z-10 flex size-6 items-center justify-center rounded-sm border border-transparent opacity-0 transition-[color,background-color,opacity] group-hover/palette-item:pointer-events-auto group-hover/palette-item:opacity-100 group-focus-within/palette-item:pointer-events-auto group-focus-within/palette-item:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
              view === 'grid' ? 'top-1.5' : 'top-1/2 -translate-y-1/2',
              pinned
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-background/80 hover:text-foreground',
            )
          "
          draggable="false"
          @pointerdown.stop
          @click.stop="emit('toggle-pin')"
          @dblclick.stop
          @dragstart.stop.prevent
        >
          <AppIcon name="star" :size="13" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" :side-offset="5">{{ pinLabel }}</TooltipContent>
    </Tooltip>
  </div>
</template>
