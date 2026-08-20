<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { previewMedia } from "@/lib/media"
import { extractCmsEntryCover } from "../lib/entryCover"
import { resolveCmsMediaPreviewUrl } from "../lib/resolveMediaPreviewUrl"

const props = withDefaults(
  defineProps<{
    frontmatter: Record<string, unknown>
    title?: string
    projectRoot?: string
    variant?: "table" | "card"
    coverSupported?: boolean
  }>(),
  {
    title: "",
    projectRoot: "",
    variant: "table",
    coverSupported: true,
  },
)

defineOptions({ name: "CmsEntryCoverThumb" })

const coverFailed = ref(false)
const previewUrl = ref("")
let loadGeneration = 0

const cover = computed(() =>
  props.coverSupported ? extractCmsEntryCover(props.frontmatter) : null,
)

const coverUrl = computed(() => {
  if (coverFailed.value) return ""
  if (previewUrl.value) return previewUrl.value
  if (cover.value?.url) return cover.value.url
  const mediaId = cover.value?.mediaId
  return mediaId ? resolveCmsMediaPreviewUrl(mediaId) : ""
})

const coverAlt = computed(
  () => cover.value?.alt?.trim() || props.title || "Entry cover",
)

const rootClass = computed(() =>
  props.variant === "card"
    ? "absolute inset-0 grid place-items-center bg-muted/25"
    : "grid h-6 w-9 place-items-center overflow-hidden rounded-sm bg-card/30",
)

const iconClass = computed(() =>
  props.variant === "card"
    ? "text-muted-foreground/30"
    : "text-muted-foreground/40",
)

const iconSize = computed(() => (props.variant === "card" ? 32 : 16))

async function loadPreview(): Promise<void> {
  const generation = ++loadGeneration
  previewUrl.value = ""
  coverFailed.value = false

  const mediaId = cover.value?.mediaId
  if (!mediaId || !props.projectRoot) return

  try {
    const result = await previewMedia(props.projectRoot, mediaId)
    if (generation !== loadGeneration) return
    if (result.dataUrl) {
      previewUrl.value = result.dataUrl
    }
  } catch {
    if (generation !== loadGeneration) return
  }
}

function handleCoverError(): void {
  coverFailed.value = true
  previewUrl.value = ""
}

watch(
  () =>
    [
      props.projectRoot,
      cover.value?.mediaId ?? "",
      cover.value?.url ?? "",
      props.coverSupported,
    ] as const,
  () => {
    void loadPreview()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  loadGeneration += 1
})
</script>

<template>
  <div :class="rootClass">
    <img
      v-if="coverUrl"
      :src="coverUrl"
      :alt="coverAlt"
      class="h-full w-full object-cover"
      loading="lazy"
      decoding="async"
      draggable="false"
      @error="handleCoverError"
    />
    <AppIcon
      v-else
      name="image"
      :size="iconSize"
      :class="iconClass"
    />
  </div>
</template>
