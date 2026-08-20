<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import type { AppIconName } from "@/icons/registry"
import { previewMedia, type MediaAsset } from "@/lib/media"

const props = defineProps<{
  asset: MediaAsset
  projectRoot: string
}>()

const dataUrl = ref("")
let generation = 0

const placeholder = computed<AppIconName>(() => {
  if (props.asset.type === "video") return "video"
  if (props.asset.type === "audio") return "audioWave"
  if (props.asset.type === "font") return "typography"
  if (props.asset.type === "document") return "file"
  return "hardDrive"
})

watch(
  () => [props.projectRoot, props.asset.id, props.asset.type] as const,
  async ([projectRoot, , type]) => {
    const request = ++generation
    dataUrl.value = ""
    if (!projectRoot || type !== "image") return
    try {
      const result = await previewMedia(projectRoot, props.asset.id)
      if (request === generation) dataUrl.value = result.dataUrl ?? ""
    } catch {
      if (request === generation) dataUrl.value = ""
    }
  },
  { immediate: true },
)
</script>

<template>
  <img
    v-if="dataUrl"
    :src="dataUrl"
    alt=""
    class="block size-full object-cover outline -outline-offset-1 outline-black/10 dark:outline-white/10"
  />
  <AppIcon
    v-else
    :name="placeholder"
    :size="22"
    class="text-muted-foreground/70"
    aria-hidden="true"
  />
</template>
