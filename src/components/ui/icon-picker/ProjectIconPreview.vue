<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { appIcons, type AppIconName } from "@/icons/registry"
import { resolveProjectIcons } from "@/lib/design"
import { normalizeIconValue } from "@/lib/pickers/iconPicker"
import { cn } from "@/lib/utils"

const props = withDefaults(
  defineProps<{
    projectRoot?: string
    value?: string | null
    class?: string
  }>(),
  {
    projectRoot: "",
    value: "",
  },
)

const dataUrl = ref("")
let generation = 0

const normalized = computed(() => normalizeIconValue(props.value))
const isUrl = computed(() =>
  /^(https?:\/\/|\/|data:image\/)/.test(props.value?.trim() ?? ""),
)
const appIconName = computed<AppIconName | null>(() => {
  const value = props.value?.trim() ?? ""
  return value && value in appIcons ? (value as AppIconName) : null
})

watch(
  () => [props.projectRoot, normalized.value, isUrl.value, appIconName.value] as const,
  async ([projectRoot, iconId, url, local]) => {
    const request = ++generation
    dataUrl.value = ""
    if (!projectRoot || !iconId || url || local || !iconId.includes(":")) return
    try {
      const result = await resolveProjectIcons(projectRoot, [iconId])
      if (request === generation) dataUrl.value = result.icons[iconId]?.dataUrl ?? ""
    } catch {
      if (request === generation) dataUrl.value = ""
    }
  },
  { immediate: true },
)
</script>

<template>
  <span :class="cn('inline-flex items-center justify-center', props.class)">
    <img
      v-if="isUrl"
      :src="props.value ?? ''"
      alt=""
      class="block size-full object-contain"
    />
    <AppIcon
      v-else-if="appIconName"
      :name="appIconName"
      :size="20"
      class="size-full"
    />
    <span
      v-else-if="dataUrl"
      class="block size-full bg-current"
      :style="{
        maskImage: `url(${JSON.stringify(dataUrl)})`,
        WebkitMaskImage: `url(${JSON.stringify(dataUrl)})`,
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
      }"
      aria-hidden="true"
    />
    <AppIcon
      v-else
      name="collections"
      :size="20"
      class="size-full text-muted-foreground"
    />
  </span>
</template>
