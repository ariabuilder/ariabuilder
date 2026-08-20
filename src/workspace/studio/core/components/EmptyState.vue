<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import type { AppIconName } from "@/icons/registry"
import { Button } from "@/components/ui/button"
import { m } from "@/paraglide/messages.js"

interface Props {
  icon?: AppIconName
  entityLabel: string
  entityLabelSingular?: string
  title?: string
  description?: string
  hideAction?: boolean
  createLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  icon: "pages",
  hideAction: false,
})

const emit = defineEmits<{
  create: []
}>()

const singular = computed(
  () => props.entityLabelSingular || props.entityLabel.replace(/s$/, ""),
)

const displayTitle = computed(() => {
  if (props.title) return props.title
  if (props.description) return m.studio_no_results()
  return m.studio_empty_title({ entity: singular.value })
})

const displayDescription = computed(
  () =>
    props.description ||
    m.studio_empty_description({ entity: singular.value }),
)

const actionLabel = computed(
  () => props.createLabel ?? m.studio_empty_create({ entity: singular.value }),
)
</script>

<template>
  <div
    class="flex min-h-[min(420px,50vh)] w-full items-center justify-center px-6 py-16"
  >
    <div
      class="empty-list-zone w-full max-w-md rounded-sm border border-dashed border-border/50 bg-sidebar px-8 py-10 text-center"
    >
      <div
        class="mx-auto mb-5 flex size-12 items-center justify-center rounded-md border border-dashed border-border/50 bg-background/60"
      >
        <AppIcon :name="props.icon" :size="20" class="text-muted-foreground" />
      </div>

      <h3 class="text-base font-medium tracking-tight text-foreground">
        {{ displayTitle }}
      </h3>
      <p
        class="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground"
      >
        {{ displayDescription }}
      </p>

      <Button
        v-if="!hideAction"
        class="mt-6"
        size="sm"
        @click="emit('create')"
      >
        {{ actionLabel }}
        <AppIcon name="plusSign" :size="14" class="ml-1.5" />
      </Button>

      <div v-if="$slots.actions" class="mt-6 flex flex-wrap items-center justify-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
