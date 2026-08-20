<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { faviconPreview } from "@/lib/workspace"
import type { MediaAsset } from "@/lib/media"
import { m } from "@/paraglide/messages.js"
import MediaPickerDialog from "./MediaPickerDialog.vue"

const props = withDefaults(defineProps<{
  projectRoot: string
  modelValue: string
  inputId?: string
  previewAlt?: string
  disabled?: boolean
  allowClear?: boolean
}>(), {
  inputId: undefined,
  previewAlt: "",
  disabled: false,
  allowClear: true,
})

const emit = defineEmits<{
  "update:modelValue": [value: string]
}>()

const pickerOpen = ref(false)
const previewDataUrl = ref<string | null>(null)
const previewLoading = ref(false)
let previewRequest = 0

const displayPath = computed(() => props.modelValue.trim())

watch(
  () => [props.projectRoot, props.modelValue] as const,
  async ([projectRoot, value]) => {
    const request = ++previewRequest
    const path = value.trim()
    previewDataUrl.value = null
    if (!projectRoot || !path) {
      previewLoading.value = false
      return
    }
    previewLoading.value = true
    try {
      const result = await faviconPreview(projectRoot, path)
      if (request === previewRequest) previewDataUrl.value = result.dataUrl
    } catch {
      if (request === previewRequest) previewDataUrl.value = null
    } finally {
      if (request === previewRequest) previewLoading.value = false
    }
  },
  { immediate: true },
)

function selectAsset(asset: MediaAsset) {
  emit("update:modelValue", asset.url)
}
</script>

<template>
  <div class="space-y-2" data-project-image-picker>
    <div class="overflow-hidden rounded-md border border-border/70 bg-card/30">
      <div class="grid min-h-28 place-items-center bg-muted/25 p-4">
        <img
          v-if="previewDataUrl"
          :src="previewDataUrl"
          :alt="previewAlt"
          class="max-h-20 max-w-full rounded-sm object-contain ring-1 ring-black/10 dark:ring-white/15"
        />
        <AppIcon
          v-else
          name="media"
          :size="24"
          class="text-muted-foreground/45"
          aria-hidden="true"
        />
      </div>
      <div class="flex min-h-9 items-center justify-between gap-2 border-t border-border/60 px-2.5 py-1.5">
        <span class="min-w-0 truncate text-[10px] text-muted-foreground">
          {{ displayPath || m.picker_media_description() }}
        </span>
        <Button
          v-if="allowClear && displayPath"
          type="button"
          size="sm"
          variant="ghost"
          class="h-7 shrink-0 px-2 text-[10px]"
          :disabled="disabled"
          :aria-label="m.settings_general_clear_favicon()"
          @click="emit('update:modelValue', '')"
        >
          {{ m.settings_general_clear() }}
        </Button>
      </div>
    </div>

    <Button
      :id="inputId"
      type="button"
      size="sm"
      variant="outline"
      class="h-8 w-full"
      :disabled="disabled || !projectRoot"
      :aria-busy="previewLoading"
      @click="pickerOpen = true"
    >
      {{ m.picker_media_title() }}
    </Button>

    <MediaPickerDialog
      v-model:open="pickerOpen"
      :project-root="projectRoot"
      :media-types="['image']"
      @select="selectAsset"
    />
  </div>
</template>
