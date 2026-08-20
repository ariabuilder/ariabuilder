<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import type { AppIconName } from "@/icons/registry"
import { previewMedia, type MediaAsset } from "@/lib/media"

const props = defineProps<{
  asset: MediaAsset
  projectRoot: string
}>()

const thumbUrl = ref<string | null>(null)
let loadGeneration = 0

const isImage = computed(() => props.asset.type === "image")

const placeholderIcon = computed<AppIconName>(() => {
  switch (props.asset.type) {
    case "font":
      return "typography"
    case "video":
      return "video"
    case "audio":
      return "audioWave"
    case "document":
      return "file"
    case "image":
      return "media"
    default:
      return "hardDrive"
  }
})

async function loadThumb() {
  const generation = ++loadGeneration
  thumbUrl.value = null
  if (props.asset.type !== "image") return

  try {
    const result = await previewMedia(props.projectRoot, props.asset.id)
    if (generation !== loadGeneration) return
    thumbUrl.value = result.dataUrl
  } catch {
    if (generation !== loadGeneration) return
    thumbUrl.value = null
  }
}

watch(
  () => [props.projectRoot, props.asset.id, props.asset.mtimeMs] as const,
  () => {
    void loadThumb()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  loadGeneration += 1
})
</script>

<template>
  <div
    class="relative aspect-3/2 w-12 shrink-0 overflow-hidden rounded-sm border border-border/50 bg-muted/40"
    aria-hidden="true"
  >
    <img
      v-if="thumbUrl && isImage"
      :src="thumbUrl"
      alt=""
      class="size-full object-cover"
      draggable="false"
      loading="lazy"
      decoding="async"
    />
    <div
      v-else
      class="flex size-full items-center justify-center text-muted-foreground/55"
    >
      <AppIcon :name="placeholderIcon" :size="14" />
    </div>
  </div>
</template>
