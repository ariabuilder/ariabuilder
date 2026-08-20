<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import type { EntryStatus } from "../../../../../shared/cms"

const props = withDefaults(
  defineProps<{
    status: EntryStatus
    isBusy?: boolean
    isModifiedSincePublish?: boolean
  }>(),
  {
    isBusy: false,
    isModifiedSincePublish: false,
  },
)

const emit = defineEmits<{
  publishNow: []
}>()

const isPublished = computed(() => props.status === "published")
const isArchived = computed(() => props.status === "archived")
const isDraft = computed(() => props.status === "draft")

const mainActionEnabled = computed(
  () =>
    ((isDraft.value || isArchived.value) && !props.isBusy) ||
    (isPublished.value && props.isModifiedSincePublish && !props.isBusy),
)

const showPublishedIdle = computed(
  () => isPublished.value && !props.isModifiedSincePublish,
)

const mainButtonLabel = computed(() => {
  if (
    props.isBusy &&
    (isDraft.value ||
      isArchived.value ||
      (isPublished.value && props.isModifiedSincePublish))
  ) {
    return m.cms_entry_publishing()
  }
  if (isPublished.value && props.isModifiedSincePublish) {
    return m.cms_entry_publish_changes()
  }
  if (isPublished.value) return m.cms_status_published()
  return m.cms_entries_action_publish()
})

const mainButtonVariant = computed(() =>
  mainActionEnabled.value ? "default" : "secondary",
)

const mainButtonClass = computed(() =>
  cn("h-9 rounded-r-none", showPublishedIdle.value && "opacity-60"),
)

function handleMainClick(): void {
  if (!mainActionEnabled.value) return
  emit("publishNow")
}
</script>

<template>
  <Button
    type="button"
    :variant="mainButtonVariant"
    size="default"
    :class="mainButtonClass"
    :disabled="!mainActionEnabled"
    @click="handleMainClick"
  >
    <AppIcon
      v-if="
        isBusy &&
        (isDraft ||
          isArchived ||
          (isPublished && isModifiedSincePublish))
      "
      name="loading"
      :size="14"
      class="mr-1.5 animate-spin"
    />
    {{ mainButtonLabel }}
  </Button>
</template>
