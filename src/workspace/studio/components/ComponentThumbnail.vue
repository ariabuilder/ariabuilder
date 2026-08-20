<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue"
import {
  getComponentThumb,
  onComponentThumbReady,
  peekComponentThumb,
} from "@/lib/thumbs"

const props = withDefaults(defineProps<{
  component: { id: string; mtimeMs: number }
  projectPath: string
  alt?: string
}>(), { alt: "" })

const thumbUrl = ref<string | null>(null)

function samePath(a: string, b: string) {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "")
  return normalize(a) === normalize(b)
}

async function loadThumb() {
  const projectPath = props.projectPath
  const id = props.component.id
  const mtimeMs = props.component.mtimeMs
  const cached = peekComponentThumb({ projectPath, id, mtimeMs })
  if (cached) {
    thumbUrl.value = cached
    return
  }
  try {
    const result = await getComponentThumb({ projectPath, id, mtimeMs })
    if (props.projectPath !== projectPath || props.component.id !== id) return
    if (result?.dataUrl) thumbUrl.value = result.dataUrl
  } catch {
    /* The fallback remains visible while preview generation recovers. */
  }
}

watch(
  () => [props.projectPath, props.component.id, props.component.mtimeMs] as const,
  (next, previous) => {
    const cached = peekComponentThumb({
      projectPath: props.projectPath,
      id: props.component.id,
      mtimeMs: props.component.mtimeMs,
    })
    const identityChanged = !previous || next[0] !== previous[0] || next[1] !== previous[1]
    if (cached || identityChanged) thumbUrl.value = cached
    void loadThumb()
  },
  { immediate: true },
)

let stopThumbReady: (() => void) | undefined
onMounted(() => {
  try {
    stopThumbReady = onComponentThumbReady((payload) => {
      if (!samePath(payload.projectPath, props.projectPath)) return
      if (payload.id !== props.component.id) return
      if (payload.dataUrl) {
        thumbUrl.value = payload.dataUrl
        return
      }
      void loadThumb()
    })
  } catch {
    /* The bridge is absent in renderer-only tests. */
  }
})
onUnmounted(() => stopThumbReady?.())
</script>

<template>
  <img
    v-if="thumbUrl"
    :src="thumbUrl"
    :alt="alt"
    class="absolute inset-0 size-full object-cover object-top outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
  />
  <slot v-else />
</template>
