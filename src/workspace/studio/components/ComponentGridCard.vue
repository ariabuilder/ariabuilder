<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardTitle,
} from "@/components/ui/card"
import { formatComponentUpdated } from "./componentsDisplay"
import type { ComponentsTableRow } from "./useComponentsTable"
import ComponentThumbnail from "./ComponentThumbnail.vue"

const props = defineProps<{
  component: ComponentsTableRow
  projectPath: string
  draggable?: boolean
  selected?: boolean
}>()

const emit = defineEmits<{
  select: [event: MouseEvent | KeyboardEvent]
  open: []
  dragstart: [event: DragEvent]
  dragend: []
}>()

const updatedLabel = computed(() =>
  formatComponentUpdated(props.component.mtimeMs),
)

const categoryLabel = computed(
  () => props.component.category?.trim() || null,
)

function onCardClick(event: MouseEvent) {
  if (event.metaKey || event.ctrlKey || event.shiftKey) {
    emit("select", event)
    return
  }
  emit("open")
}
</script>

<template>
  <div
    class="group relative z-0 isolate"
    :class="draggable ? 'cursor-grab active:cursor-grabbing' : ''"
    :draggable="draggable"
    role="option"
    :aria-selected="selected"
    tabindex="0"
    :data-state="selected ? 'selected' : undefined"
    :data-component-id="component.id"
    @dragstart="emit('dragstart', $event)"
    @dragend="emit('dragend')"
    @click="onCardClick"
    @keydown.enter.prevent="emit('open')"
    @keydown.space.prevent="emit('open')"
  >
    <Card
      class="transition-[box-shadow,background-color] duration-100 group-data-[state=selected]:bg-primary/5 group-data-[state=selected]:shadow-[inset_0_0_0_2px_var(--primary)] group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-primary"
    >
      <CardContent class="p-0">
        <div
          class="relative flex aspect-video items-center justify-center overflow-hidden rounded-sm bg-card"
          data-organizer-drag-preview
        >
          <ComponentThumbnail :component="component" :project-path="projectPath">
            <div class="flex flex-col items-center gap-2 text-muted-foreground/70">
              <AppIcon name="components" :size="28" aria-hidden="true" />
            </div>
          </ComponentThumbnail>
        </div>
      </CardContent>

      <CardFooter class="flex-col items-stretch gap-0.5 px-3 pb-3 pt-2.5">
        <CardTitle class="truncate text-sm font-regular leading-snug">
          {{ component.displayName }}
        </CardTitle>
        <div
          class="flex min-w-0 items-center justify-between gap-3 text-[10px] text-muted-foreground/70"
        >
          <CardDescription
            v-if="categoryLabel"
            class="min-w-0 truncate rounded-sm border border-dashed border-border/50 bg-sidebar/30 px-1.5 py-1 text-[10px] text-muted-foreground/60"
          >
            {{ categoryLabel }}
          </CardDescription>
          <CardDescription
            v-else
            class="min-w-0 truncate font-mono text-[10px] text-muted-foreground/60"
          >
            {{ component.id }}
          </CardDescription>
          <span class="shrink-0 tabular-nums text-muted-foreground/60">
            {{ updatedLabel }}
          </span>
        </div>
      </CardFooter>
    </Card>
  </div>
</template>
