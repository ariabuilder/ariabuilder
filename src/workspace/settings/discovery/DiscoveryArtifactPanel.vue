<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import DiscoveryArtifactEditor from "@/workspace/settings/discovery/DiscoveryArtifactEditor.vue"
import { m } from "@/paraglide/messages.js"

const props = defineProps<{
  mode: "auto" | "custom" | "off"
  customValue: string
  preview: string
  liveUrl?: string
  canEdit: boolean
  allowDisable?: boolean
  isEditing?: boolean
  isLoading?: boolean
  language?: "plain" | "xml"
  disabledMessage?: string
  unavailableReason?: string | null
}>()

const emit = defineEmits<{
  customize: []
  revert: []
  disable: []
  enable: []
  done: []
  "update:customValue": [value: string]
}>()

const showDisabledState = computed(() => props.mode === "off")

const editorValue = computed(() => {
  if (props.isEditing) {
    return props.customValue
  }
  if (props.mode === "custom") {
    return props.customValue || props.preview
  }
  return props.preview
})

const hasContent = computed(() => editorValue.value.trim().length > 0)

const statusLabel = computed(() => {
  if (props.mode === "off")
    return m.settings_discovery_artifact_status_disabled()
  if (props.mode === "custom")
    return m.settings_discovery_artifact_status_custom()
  if (!hasContent.value)
    return m.settings_discovery_artifact_status_suppressed()
  return m.settings_discovery_artifact_status_generated()
})

const statusVariant = computed(() => {
  if (props.mode === "off") return "outline" as const
  if (props.mode === "custom") return "default" as const
  if (!hasContent.value) return "outline" as const
  return "secondary" as const
})

const showUnavailableState = computed(
  () =>
    !showDisabledState.value &&
    !hasContent.value &&
    !props.isEditing &&
    Boolean(props.unavailableReason),
)

const showEditor = computed(
  () =>
    props.mode !== "off" &&
    (props.isEditing || hasContent.value) &&
    !showUnavailableState.value,
)
</script>

<template>
  <div class="flex h-full flex-col space-y-3 px-4 py-4">
    <div
      v-if="showDisabledState"
      class="rounded-sm border border-dashed border-border/50 bg-muted/20 px-4 py-8 text-center"
    >
      <AppIcon
        name="file"
        :size="20"
        class="mx-auto mb-2 text-muted-foreground/60"
      />
      <p class="text-sm text-muted-foreground">
        {{
          disabledMessage ?? m.settings_discovery_artifact_not_published()
        }}
      </p>
      <Button
        v-if="canEdit"
        variant="outline"
        size="sm"
        class="mt-4"
        :disabled="isLoading"
        @click="emit('enable')"
      >
        {{ m.settings_discovery_artifact_enable() }}
      </Button>
    </div>

    <template v-else>
      <div
        v-if="showUnavailableState"
        class="rounded-sm border border-dashed border-amber-500/30 bg-amber-500/5 px-4 py-6 text-center"
      >
        <AppIcon
          name="warning"
          :size="20"
          class="mx-auto mb-2 text-amber-500/80"
        />
        <p class="text-sm text-muted-foreground">
          {{ unavailableReason }}
        </p>
      </div>

      <DiscoveryArtifactEditor
        v-if="showEditor"
        :model-value="editorValue"
        :language="language ?? 'plain'"
        :readonly="!isEditing"
        :disabled="!canEdit || isLoading"
        @update:model-value="emit('update:customValue', $event)"
      />

      <div class="flex flex-wrap items-center gap-2">
        <template v-if="isEditing">
          <Button
            variant="outline"
            size="sm"
            :disabled="!canEdit || isLoading"
            @click="emit('done')"
          >
            {{ m.settings_discovery_artifact_done() }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="text-destructive hover:text-destructive"
            :disabled="!canEdit || isLoading"
            @click="emit('revert')"
          >
            {{ m.settings_discovery_artifact_revert() }}
          </Button>
        </template>

        <template v-else-if="mode === 'auto'">
          <Button
            variant="outline"
            size="sm"
            :disabled="!canEdit || isLoading"
            @click="emit('customize')"
          >
            {{ m.settings_discovery_artifact_customize() }}
          </Button>
          <Button
            v-if="allowDisable"
            variant="ghost"
            size="sm"
            :disabled="!canEdit || isLoading"
            @click="emit('disable')"
          >
            {{ m.settings_discovery_artifact_disable() }}
          </Button>
        </template>

        <template v-else-if="mode === 'custom'">
          <Button
            variant="outline"
            size="sm"
            :disabled="!canEdit || isLoading"
            @click="emit('customize')"
          >
            {{ m.settings_discovery_artifact_edit_override() }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="text-destructive hover:text-destructive"
            :disabled="!canEdit || isLoading"
            @click="emit('revert')"
          >
            {{ m.settings_discovery_artifact_revert() }}
          </Button>
          <Button
            v-if="allowDisable"
            variant="ghost"
            size="sm"
            :disabled="!canEdit || isLoading"
            @click="emit('disable')"
          >
            {{ m.settings_discovery_artifact_disable() }}
          </Button>
        </template>

        <Badge :variant="statusVariant" class="ml-auto text-[10px] font-medium">
          {{ statusLabel }}
        </Badge>

        <Button
          v-if="liveUrl"
          variant="ghost"
          size="sm"
          class="text-xs"
          as="a"
          :href="liveUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ m.settings_discovery_artifact_open_live() }}
          <AppIcon name="externalLink" :size="12" class="ml-1" />
        </Button>
      </div>
    </template>
  </div>
</template>
