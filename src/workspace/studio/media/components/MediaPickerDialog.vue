<script setup lang="ts">
import { computed, useId } from "vue"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import type { MediaAsset, MediaAssetType } from "@/lib/media"
import { m } from "@/paraglide/messages.js"
import MediaPickerCatalog from "./MediaPickerCatalog.vue"

const props = withDefaults(
  defineProps<{
    open: boolean
    projectRoot: string
    title?: string
    description?: string
    mediaTypes?: readonly MediaAssetType[]
    requireSvg?: boolean
  }>(),
  {
    title: m.picker_media_title(),
    description: m.picker_media_description(),
    mediaTypes: () => [],
    requireSvg: false,
  },
)

const emit = defineEmits<{
  "update:open": [value: boolean]
  select: [asset: MediaAsset]
}>()

const uid = useId()
const titleId = computed(() => `media-picker-title-${uid}`)
const descriptionId = computed(() => `media-picker-description-${uid}`)

function select(asset: MediaAsset): void {
  emit("select", asset)
  emit("update:open", false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      :aria-labelledby="titleId"
      :aria-describedby="descriptionId"
      class="h-[min(80dvh,760px)]! w-[min(80dvw,1024px)]! max-w-[calc(100vw-1.5rem)]! gap-0 overflow-hidden p-0! overscroll-contain"
    >
      <DialogTitle :id="titleId" class="sr-only">{{ title }}</DialogTitle>
      <DialogDescription :id="descriptionId" class="sr-only">
        {{ description }}
      </DialogDescription>
      <MediaPickerCatalog
        v-if="open && projectRoot"
        :key="projectRoot"
        :project-root="projectRoot"
        :title="title"
        :description="description"
        :media-types="mediaTypes"
        :require-svg="requireSvg"
        @select="select"
      />
    </DialogContent>
  </Dialog>
</template>
